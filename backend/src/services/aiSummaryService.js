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
export const PROMPT_VERSION = 'consultant-brief-v2';

// Bentuk output dikunci di sisi API, bukan diminta lewat kalimat. Model yang
// diminta "balas JSON saja" tetap sesekali membungkusnya dengan ```json atau
// kalimat pengantar; responseSchema membuat itu tidak mungkin.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    diagnosis: { type: 'STRING' },
    objective_alignment: { type: 'STRING' },
    winning: { type: 'ARRAY', items: { type: 'STRING' } },
    challenge: { type: 'ARRAY', items: { type: 'STRING' } },
    hypotheses: { type: 'ARRAY', items: { type: 'STRING' } },
    strategic_direction: { type: 'ARRAY', items: { type: 'STRING' } },
    action_items: { type: 'ARRAY', items: { type: 'STRING' } },
    risks: { type: 'ARRAY', items: { type: 'STRING' } },
    data_gaps: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['diagnosis', 'objective_alignment', 'winning', 'challenge', 'hypotheses', 'strategic_direction', 'action_items', 'risks', 'data_gaps'],
  propertyOrdering: ['diagnosis', 'objective_alignment', 'winning', 'challenge', 'hypotheses', 'strategic_direction', 'action_items', 'risks', 'data_gaps'],
};

const PLATFORM_LABEL = { meta: 'Meta Ads', shopee: 'Shopee Ads', tiktok: 'TikTok GMV Max' };

const SYSTEM_RULES = `Kamu adalah senior business & growth consultant yang bertanggung jawab mengubah data performance menjadi arahan keputusan. Tulis dalam Bahasa Indonesia yang lugas, tajam, dan spesifik seperti decision brief untuk consultant dan pemilik brand. Jangan sekadar menceritakan angka yang sudah terlihat di tabel.

Aturan yang mengikat:
1. Mulai dari Objective & Target, Strategic Priorities, Constraints & Concerns, lalu nilai apakah hasil periode utama mendekatkan brand ke arah tersebut. Gunakan juga karakter bisnis, positioning, produk/channel utama, dan historical learning yang relevan. Jika arah brand bertentangan dengan angka, sebutkan konflik itu secara eksplisit.
2. Analisis hanya rentang waktu yang diberikan. Periksa apakah jumlah hari kedua periode sebanding. Jika tidak, prioritaskan rate/rasio dibanding total dan nyatakan batas perbandingannya.
3. Lakukan triangulasi antarmetrik. Bedah hubungan skala vs efisiensi, volume vs conversion rate, biaya vs hasil, serta funnel/audience/product jika datanya tersedia. Jangan menarik keputusan dari satu metrik saja.
4. Bedakan dengan tegas: FAKTA adalah angka yang tersedia; OBSERVASI adalah pola; HIPOTESIS adalah dugaan penyebab; KEPUTUSAN adalah tindakan. Korelasi bukan sebab-akibat. Dugaan wajib memakai "kemungkinan", "indikasi", atau "perlu divalidasi" dan disertai cara memeriksanya.
5. Sebut angka paling material sebagai bukti, lalu jelaskan implikasi bisnisnya. Jangan menyalin seluruh tabel, membuat klaim di luar data, atau memberi saran generik seperti "optimalkan iklan" tanpa objek, alasan, ukuran berhasil, dan horizon waktu.
6. Perubahan di bawah ±5% diperlakukan sebagai stabil, kecuali konteks menunjukkan ambang lain. Waspadai denominator kecil dan lonjakan persentase yang tidak disertai volume.
7. Jika konteks atau data tidak cukup, tulis kekurangannya pada data_gaps. Jangan mengisi celah dengan asumsi.

Isi tiap bagian:
- diagnosis: 1 paragraf executive diagnosis (maksimal 180 kata): perubahan paling material, driver yang terlihat, trade-off, dan arti bisnisnya.
- objective_alignment: 1 paragraf singkat yang menilai keselarasan hasil terhadap Objective & Target dan Current Direction. Sebutkan konteks brand yang dipakai.
- winning: 2–4 poin yang benar-benar terbukti bekerja. Setiap poin berisi bukti angka + implikasi.
- challenge: 2–4 masalah paling material. Setiap poin berisi bukti angka + dampak terhadap target/constraint.
- hypotheses: 1–4 dugaan penyebab yang belum terbukti. Akhiri tiap poin dengan data atau pemeriksaan yang dibutuhkan untuk validasi.
- strategic_direction: 2–4 keputusan arah, berurutan dari dampak terbesar, terhubung ke objective dan constraint.
- action_items: 3–5 tindakan. Gunakan format persis "P1/P2/P3 · horizon waktu — tindakan spesifik | Alasan: ... | Ukur: ...". P1 paling mendesak.
- risks: 1–3 risiko jika arah ini dijalankan atau jika masalah dibiarkan, berikut leading indicator yang perlu dipantau.
- data_gaps: 0–4 kekurangan data/konteks yang membatasi keyakinan analisis. Jangan menulis poin generik.`;

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
    if (s.objective_alignment) lines.push(`Keselarasan objective: ${s.objective_alignment}`);
    if (s.winning?.length) lines.push(`Winning: ${s.winning.join('; ')}`);
    if (s.challenge?.length) lines.push(`Challenge: ${s.challenge.join('; ')}`);
    if (s.hypotheses?.length) lines.push(`Hipotesis yang pernah dicatat: ${s.hypotheses.join('; ')}`);
    if (s.strategic_direction?.length) lines.push(`Arah strategis: ${s.strategic_direction.join('; ')}`);
    if (s.action_items?.length) lines.push(`Action items yang disepakati: ${s.action_items.join('; ')}`);
    if (s.risks?.length) lines.push(`Risiko yang dipantau: ${s.risks.join('; ')}`);
    return lines.join('\n');
  });
}

function periodScopeBlock(period, performance) {
  const value = (v) => v || 'tanggal tidak tersedia';
  return [
    `- Periode pembanding: ${period?.oldLabel ?? performance.period?.old ?? '—'} (${value(period?.oldStart)} s.d. ${value(period?.oldEnd)})`,
    `- Periode utama: ${period?.curLabel ?? performance.period?.cur ?? '—'} (${value(period?.curStart)} s.d. ${value(period?.curEnd)})`,
  ];
}

function performanceBlock(performance) {
  const lines = [];
  if (performance.periodWarning) lines.push(`CATATAN PERIODE: ${performance.periodWarning}`);
  if (performance.notes?.length) performance.notes.forEach((n) => lines.push(`CATATAN: ${n}`));
  lines.push('', `Perbandingan: ${performance.period?.old ?? '—'} → ${performance.period?.cur ?? '—'}`, '');
  for (const kpi of performance.kpis ?? []) {
    const signal = kpi.signal ? `; interpretasi tampilan: ${kpi.signal}` : '';
    lines.push(`- ${kpi.label}: ${kpi.old} → ${kpi.cur} (${kpi.delta}${signal})`);
  }
  if (performance.cpasKpis?.length) {
    lines.push('', 'CPAS:');
    for (const kpi of performance.cpasKpis) lines.push(`- ${kpi.label}: ${kpi.old} → ${kpi.cur} (${kpi.delta})`);
  }
  return lines;
}

export function buildPrompt({ brandName, platform, period, profile, history, performance }) {
  const blocks = [
    `Brand: ${brandName}. Platform: ${PLATFORM_LABEL[platform] ?? platform}.`,
    section('A. Brand Context', brandContextBlock(profile)) ?? '## A. Brand Context\n(belum diisi di Pengaturan Brand)',
    section('B. Current Direction', currentDirectionBlock(profile)) ?? '## B. Current Direction\n(belum diisi di Pengaturan Brand)',
    section('C. Historical / Period Learning', historyBlock(history)) ?? '## C. Historical / Period Learning\n(belum ada ringkasan periode sebelumnya)',
    section('D. Scope perbandingan yang dipilih user', periodScopeBlock(period, performance)),
    section('E. Performance Data dalam scope tersebut', performanceBlock(performance)),
    performance.upcoming ? section('F. Rencana / konteks periode berikutnya', performance.upcoming) : null,
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
          temperature: 0.3,
          maxOutputTokens: 8192,
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
    // responseMimeType biasanya memberi JSON murni. Fallback fence hanya
    // mengakomodasi model alias lama yang kadang tetap membungkus hasilnya.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    parsed = JSON.parse(cleaned);
  } catch {
    const reason = data?.candidates?.[0]?.finishReason;
    throw new AiSummaryError(`Jawaban Gemini bukan JSON yang valid${reason ? ` (${reason})` : ''}.`);
  }
  return normaliseSummary(parsed);
}

// Bentuknya dijamin schema, isinya tidak: array bisa datang kosong atau
// berisi string kosong, dan UI tidak boleh merender butir hampa.
export function normaliseSummary(raw) {
  const list = (v) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : []);
  return {
    diagnosis: String(raw.diagnosis ?? '').trim(),
    objective_alignment: String(raw.objective_alignment ?? '').trim(),
    winning: list(raw.winning),
    challenge: list(raw.challenge),
    hypotheses: list(raw.hypotheses),
    strategic_direction: list(raw.strategic_direction),
    action_items: list(raw.action_items),
    risks: list(raw.risks),
    data_gaps: list(raw.data_gaps),
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
