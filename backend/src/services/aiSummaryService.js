import crypto from 'crypto';
import pool from '../config/db.js';

// AI Summary untuk Report Generator.
//
// Panggilan ke Gemini hanya boleh terjadi di sini: key-nya ada di
// process.env dan tidak pernah menyeberang ke browser. Frontend bicara ke
// endpoint ATLAS sendiri, backend yang jadi perantara.
//
// Urutan konteks yang dikirim ke model bukan urutan yang enak dibaca, tapi
// urutan yang membuat model menahan diri: identitas dan arah brand dulu,
// baru pelajaran periode-periode sebelumnya, baru angka periode ini. Angka
// yang datang terakhir dibaca sebagai bukti terhadap rencana yang sudah
// ada — bukan sebagai pemicu rekomendasi berdiri sendiri.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const TIMEOUT_MS = 60_000;
const HISTORY_LIMIT = 3;

// Bentuk output dikunci di sisi API, bukan diminta lewat kalimat. Model yang
// diminta "balas JSON saja" tetap sesekali membungkusnya dengan ```json atau
// kalimat pengantar; responseSchema membuat itu tidak mungkin.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    diagnosis: { type: 'STRING' },
    winning: { type: 'ARRAY', items: { type: 'STRING' } },
    challenge: { type: 'ARRAY', items: { type: 'STRING' } },
    strategic_direction: { type: 'ARRAY', items: { type: 'STRING' } },
    action_items: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['diagnosis', 'winning', 'challenge', 'strategic_direction', 'action_items'],
  propertyOrdering: ['diagnosis', 'winning', 'challenge', 'strategic_direction', 'action_items'],
};

const PLATFORM_LABEL = { meta: 'Meta Ads', shopee: 'Shopee Ads', tiktok: 'TikTok GMV Max' };

const SYSTEM_RULES = `Kamu analis performance marketing di agensi yang menangani brand ini. Tulis dalam Bahasa Indonesia yang lugas dan spesifik, seperti catatan analis untuk tim internal — bukan bahasa marketing.

Aturan yang mengikat:
1. Jangan pernah merekomendasikan tindakan hanya karena sebuah metrik naik atau turun. Setiap rekomendasi harus terhubung ke objective brand, konteks bisnisnya, pelajaran periode sebelumnya, constraint yang ada, atau rencana ke depan. Kalau kaitan itu tidak ada di konteks yang diberikan, jangan buat rekomendasinya.
2. Bedakan secara internal: FAKTA (angka yang tertulis di data), OBSERVASI (pola yang terlihat dari angka itu), HIPOTESIS (dugaan sebab yang belum terbukti), KEPUTUSAN (tindakan yang diusulkan). Jangan pernah menulis korelasi sebagai sebab-akibat. Kalau menduga penyebab, tandai dengan kata seperti "kemungkinan", "indikasi", atau "perlu dicek".
3. Sebut angka yang relevan saat berargumen, tapi jangan menyalin ulang seluruh tabel — pembaca sudah melihat tabelnya di atas ringkasan ini.
4. Kalau konteks brand kosong atau datanya terlalu tipis untuk menyimpulkan sesuatu, katakan itu apa adanya di diagnosis, dan biarkan array lain pendek. Lebih baik singkat daripada mengarang.
5. Perubahan periode yang kecil (di bawah ±5%) diperlakukan sebagai stabil, bukan tren, kecuali ada konteks yang menjelaskan sebaliknya.

Isi tiap bagian:
- diagnosis: satu paragraf. Apa yang sebenarnya terjadi pada periode ini dan mengapa itu penting bagi objective brand.
- winning: yang terbukti bekerja, dengan bukti angkanya.
- challenge: masalah nyata, dengan bukti angkanya. Bukan daftar semua yang turun.
- strategic_direction: arah untuk periode berikutnya, terhubung ke objective dan constraint.
- action_items: langkah konkret yang bisa dikerjakan, cukup spesifik untuk dieksekusi minggu depan.`;

/* ── Perakitan konteks ──────────────────────────────────────────────── */

function section(title, body) {
  if (!body || (Array.isArray(body) && !body.length)) return null;
  return `## ${title}\n${Array.isArray(body) ? body.join('\n') : body}`;
}

function brandContextBlock(profile) {
  if (!profile) return null;
  const fields = [
    ['Brand, Produk & Customer', profile.brand_products_customer],
    ['Positioning & Purchase Driver', profile.positioning_driver],
    ['Key Products & Channels', profile.key_products_channels],
    ['Business Characteristics', profile.business_characteristics],
    ['Historical Learning', profile.historical_learning],
  ].filter(([, v]) => v?.trim());
  return fields.length ? fields.map(([k, v]) => `- ${k}: ${v.trim()}`) : null;
}

function currentDirectionBlock(profile) {
  if (!profile) return null;
  const fields = [
    ['Objective & Target', profile.objective_target],
    ['Strategic Priorities', profile.strategic_priorities],
    ['Constraints & Concerns', profile.constraints_concerns],
  ].filter(([, v]) => v?.trim());
  return fields.length ? fields.map(([k, v]) => `- ${k}: ${v.trim()}`) : null;
}

// Ringkasan periode-periode sebelumnya, versi yang tim setujui kalau ada.
function historyBlock(rows) {
  if (!rows.length) return null;
  return rows.map((row) => {
    const s = row.edited_summary ?? row.summary;
    const label = row.period_cur_label || row.created_at?.toISOString?.().slice(0, 10) || 'periode sebelumnya';
    const lines = [`### ${label}${row.edited_summary ? ' (sudah disunting tim)' : ''}`];
    if (s.diagnosis) lines.push(`Diagnosis: ${s.diagnosis}`);
    if (s.winning?.length) lines.push(`Winning: ${s.winning.join('; ')}`);
    if (s.challenge?.length) lines.push(`Challenge: ${s.challenge.join('; ')}`);
    if (s.action_items?.length) lines.push(`Action items yang disepakati: ${s.action_items.join('; ')}`);
    return lines.join('\n');
  });
}

function performanceBlock(performance) {
  const lines = [];
  if (performance.periodWarning) lines.push(`CATATAN PERIODE: ${performance.periodWarning}`);
  if (performance.notes?.length) performance.notes.forEach((n) => lines.push(`CATATAN: ${n}`));
  lines.push('', `Perbandingan: ${performance.period?.old ?? '—'} → ${performance.period?.cur ?? '—'}`, '');
  for (const kpi of performance.kpis ?? []) {
    lines.push(`- ${kpi.label}: ${kpi.old} → ${kpi.cur} (${kpi.delta})`);
  }
  if (performance.cpasKpis?.length) {
    lines.push('', 'CPAS:');
    for (const kpi of performance.cpasKpis) lines.push(`- ${kpi.label}: ${kpi.old} → ${kpi.cur} (${kpi.delta})`);
  }
  return lines;
}

export function buildPrompt({ brandName, platform, profile, history, performance }) {
  const blocks = [
    `Brand: ${brandName}. Platform: ${PLATFORM_LABEL[platform] ?? platform}.`,
    section('A. Brand Context', brandContextBlock(profile)) ?? '## A. Brand Context\n(belum diisi di Pengaturan Brand)',
    section('B. Current Direction', currentDirectionBlock(profile)) ?? '## B. Current Direction\n(belum diisi di Pengaturan Brand)',
    section('C. Historical / Period Learning', historyBlock(history)) ?? '## C. Historical / Period Learning\n(belum ada ringkasan periode sebelumnya)',
    section('D. Performance Data periode ini', performanceBlock(performance)),
    performance.upcoming ? section('E. Rencana / konteks periode berikutnya', performance.upcoming) : null,
    SYSTEM_RULES,
  ].filter(Boolean);
  return blocks.join('\n\n');
}

/* ── Panggilan model ────────────────────────────────────────────────── */

export class AiSummaryError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.statusCode = status;
  }
}

// 503 dari Gemini berarti modelnya sedang penuh, bukan permintaannya salah.
// Diamati pada key ini: permintaan identik bisa 200 lalu 503 beberapa detik
// kemudian, jadi mencoba ulang memang menaikkan peluang berhasil. Dua kali
// dengan jeda 2 dan 5 detik; lebih dari itu hanya menahan pengguna menunggu
// untuk gangguan yang sedang berlangsung di sisi Google, dan tombol
// "Coba lagi" di UI adalah percobaan ketiga yang dia kendalikan sendiri.
const BUSY_BACKOFF_MS = [2000, 5000];

export async function callGemini(prompt, { attempt = 0 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiSummaryError('GEMINI_API_KEY belum diset di server.', 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${GEMINI_URL}/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new AiSummaryError(
      err.name === 'AbortError'
        ? 'Gemini tidak merespons dalam 60 detik. Coba lagi sebentar lagi.'
        : `Tidak bisa menghubungi Gemini: ${err.message}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 503 && attempt < BUSY_BACKOFF_MS.length) {
    await new Promise((resolve) => setTimeout(resolve, BUSY_BACKOFF_MS[attempt]));
    return callGemini(prompt, { attempt: attempt + 1 });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // Kutip pesan aslinya secukupnya: "429" tanpa konteks tidak membantu
    // siapa pun, tapi body penuh bisa memuat echo dari prompt.
    const detail = body.slice(0, 300);
    if (response.status === 429) throw new AiSummaryError('Kuota Gemini sedang habis (rate limit). Coba lagi beberapa saat lagi.', 429);
    if (response.status === 401 || response.status === 403) throw new AiSummaryError('GEMINI_API_KEY ditolak Google. Periksa key di server.', 502);
    if (response.status === 503) throw new AiSummaryError('Model Gemini sedang penuh (503) setelah 3 percobaan. Ini gangguan sementara di sisi Google — coba lagi sebentar lagi.', 503);
    throw new AiSummaryError(`Gemini menolak permintaan (HTTP ${response.status}): ${detail}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text.trim()) {
    const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason;
    throw new AiSummaryError(`Gemini mengembalikan jawaban kosong${reason ? ` (${reason})` : ''}.`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiSummaryError('Jawaban Gemini bukan JSON yang valid.');
  }
  return normaliseSummary(parsed);
}

// Bentuknya dijamin schema, isinya tidak: array bisa datang kosong atau
// berisi string kosong, dan UI tidak boleh merender butir hampa.
function normaliseSummary(raw) {
  const list = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);
  return {
    diagnosis: String(raw.diagnosis ?? '').trim(),
    winning: list(raw.winning),
    challenge: list(raw.challenge),
    strategic_direction: list(raw.strategic_direction),
    action_items: list(raw.action_items),
  };
}

/* ── Cache + riwayat ────────────────────────────────────────────────── */

// Key JSON diurutkan dulu sebelum di-hash. JSON.stringify mempertahankan
// urutan penyisipan, jadi tanpa ini dua payload yang isinya identik tapi
// disusun dengan urutan field berbeda menghasilkan hash berbeda — cache
// meleset diam-diam dan model dipanggil ulang untuk jawaban yang sama.
// Field yang undefined memang hilang saat transit JSON, dan itu benar:
// "tidak dikirim" dan "dikirim sebagai undefined" adalah payload yang sama.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .reduce((out, k) => { out[k] = canonical(value[k]); return out; }, {});
  }
  return value;
}

export function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex').slice(0, 32);
}

const SUMMARY_COLUMNS = `
  s.id, s.brand_id, s.platform, s.period_old_label, s.period_cur_label,
  s.period_old_start::text AS period_old_start, s.period_old_end::text AS period_old_end,
  s.period_cur_start::text AS period_cur_start, s.period_cur_end::text AS period_cur_end,
  s.payload_hash, s.summary, s.edited_summary, s.model, s.created_at, s.updated_at, s.edited_at,
  u.full_name AS generated_by_name, e.full_name AS edited_by_name
`;

const SUMMARY_FROM = `
  FROM ads_reports.ai_summaries s
  LEFT JOIN public.users u ON u.user_id = s.generated_by
  LEFT JOIN public.users e ON e.user_id = s.edited_by
`;

export async function findCached(brandId, platform, payloadHash) {
  const result = await pool.query(
    `SELECT ${SUMMARY_COLUMNS} ${SUMMARY_FROM}
     WHERE s.brand_id = $1 AND s.platform = $2::ads_reports.platform_enum AND s.payload_hash = $3`,
    [brandId, platform, payloadHash],
  );
  return result.rows[0] ?? null;
}

// Periode sebelumnya untuk konteks. Hash yang berbeda pada label periode
// yang sama berarti datanya diperbarui, bukan periode baru — jadi hanya
// ringkasan terbaru per label yang ikut, supaya model tidak membaca dua
// versi Agustus yang saling bertentangan.
export async function listHistory(brandId, platform, excludeHash, limit = HISTORY_LIMIT) {
  const result = await pool.query(
    `SELECT DISTINCT ON (s.period_cur_label) ${SUMMARY_COLUMNS} ${SUMMARY_FROM}
     WHERE s.brand_id = $1 AND s.platform = $2::ads_reports.platform_enum
       AND ($3::text IS NULL OR s.payload_hash <> $3)
     ORDER BY s.period_cur_label, s.created_at DESC`,
    [brandId, platform, excludeHash ?? null],
  );
  return result.rows
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
}

export async function listForBrand(brandId, platform) {
  const result = await pool.query(
    `SELECT ${SUMMARY_COLUMNS} ${SUMMARY_FROM}
     WHERE s.brand_id = $1 AND ($2::text IS NULL OR s.platform = $2::ads_reports.platform_enum)
     ORDER BY s.created_at DESC LIMIT 50`,
    [brandId, platform ?? null],
  );
  return result.rows;
}

export async function saveSummary({ brandId, platform, period, payloadHash, inputPayload, summary, userId }) {
  const result = await pool.query(
    `INSERT INTO ads_reports.ai_summaries
       (brand_id, platform, period_old_label, period_cur_label,
        period_old_start, period_old_end, period_cur_start, period_cur_end,
        payload_hash, input_payload, summary, model, generated_by)
     VALUES ($1, $2::ads_reports.platform_enum, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (brand_id, platform, payload_hash) DO UPDATE SET
       summary = EXCLUDED.summary, input_payload = EXCLUDED.input_payload,
       model = EXCLUDED.model, generated_by = EXCLUDED.generated_by, updated_at = now()
     RETURNING id`,
    [
      brandId, platform, period?.oldLabel ?? null, period?.curLabel ?? null,
      period?.oldStart ?? null, period?.oldEnd ?? null, period?.curStart ?? null, period?.curEnd ?? null,
      payloadHash, JSON.stringify(inputPayload), JSON.stringify(summary), MODEL, userId ?? null,
    ],
  );
  const saved = await pool.query(`SELECT ${SUMMARY_COLUMNS} ${SUMMARY_FROM} WHERE s.id = $1`, [result.rows[0].id]);
  return saved.rows[0];
}

export async function saveEdit(id, brandId, edited, userId) {
  const result = await pool.query(
    `UPDATE ads_reports.ai_summaries
     SET edited_summary = $3, edited_by = $4, edited_at = now(), updated_at = now()
     WHERE id = $1 AND brand_id = $2 RETURNING id`,
    [id, brandId, JSON.stringify(normaliseSummary(edited)), userId ?? null],
  );
  if (!result.rowCount) return null;
  const saved = await pool.query(`SELECT ${SUMMARY_COLUMNS} ${SUMMARY_FROM} WHERE s.id = $1`, [id]);
  return saved.rows[0];
}

export { MODEL };
