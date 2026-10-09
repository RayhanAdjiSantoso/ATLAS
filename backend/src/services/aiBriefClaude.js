import Anthropic from '@anthropic-ai/sdk';
import { getExecutiveSummary } from './executiveSummaryService.js';
import * as library from './brandLibraryService.js';
import * as trackingRepo from '../repositories/dailyTrackingRepository.js';
import { AiSummaryError } from './aiSummaryService.js';

// Report Generator › AI Consultant Brief on Claude.
//
// Used whenever ANTHROPIC_API_KEY is set on the server; without it the
// generator keeps using Gemini (aiSummaryService.callGemini), so nothing
// breaks for an environment that has no key yet. The key never leaves the
// server — the browser only talks to ATLAS's own endpoint.
//
// The brief's shape is locked by a JSON schema on the API side
// (output_config.format), so the page never receives prose it has to guess
// at. Action items come back as structured objects and are flattened here
// into the "P1 · horizon — action | Alasan: … | Ukur: …" line the page and
// the edit form already understand, so old and new briefs read the same way.

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
// Effort trades depth for time and tokens. Measured on a full brief: medium
// took ~52-60 s, past what the serverless function's 60-second budget can
// hold, so low is the default; raise it where that limit does not apply.
const EFFORT = process.env.ANTHROPIC_EFFORT || 'low';
// Under Vercel's 60 s function limit, so a slow answer surfaces as a clear
// message instead of the platform cutting the request off.
const TIMEOUT_MS = Number(process.env.ANTHROPIC_TIMEOUT_MS) || 55_000;

export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY);

// An organisation-level key (not scoped to one workspace) must name the
// workspace on every request; a workspace-scoped key needs nothing here.
const WORKSPACE_ID = process.env.ANTHROPIC_WORKSPACE_ID || '';

let client = null;
const getClient = () => {
  client ??= new Anthropic({
    timeout: TIMEOUT_MS,
    // A retry after a timeout can never finish inside the function's budget.
    maxRetries: 0,
    defaultHeaders: WORKSPACE_ID ? { 'anthropic-workspace-id': WORKSPACE_ID } : undefined,
  });
  return client;
};

const str = { type: 'string' };
const strList = { type: 'array', items: str };
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export const BRIEF_SCHEMA = obj({
  headline: str,
  verdict: { type: 'string', enum: ['on_track', 'watch', 'off_track'] },
  verdict_reason: str,
  diagnosis: str,
  objective_alignment: str,
  key_metrics: {
    type: 'array',
    items: obj({ metric: str, movement: str, reading: str, tone: { type: 'string', enum: ['positive', 'negative', 'neutral'] } }),
  },
  winning: strList,
  challenge: strList,
  hypotheses: strList,
  strategic_direction: strList,
  action_items: {
    type: 'array',
    items: obj({ priority: { type: 'string', enum: ['P1', 'P2', 'P3'] }, horizon: str, action: str, rationale: str, measure: str }),
  },
  risks: strList,
  data_gaps: strList,
  next_review: str,
});

export const SYSTEM_PROMPT = `Kamu adalah partner senior di sebuah konsultan growth & performance marketing (setara standar MBB) yang menulis decision brief untuk pemilik brand dan tim akun MIL Digital. Tulis dalam Bahasa Indonesia yang lugas, tajam, dan profesional; istilah pemasaran digital yang lazim (ROAS, CTR, CPM, AOV, funnel) boleh tetap dalam Bahasa Inggris.

Cara berpikir:
- Answer first (pyramid principle): kesimpulan dulu, lalu bukti, lalu implikasi. Pembaca harus tahu jawabannya dari headline saja.
- Brief ini menilai apakah periode utama mendekatkan brand ke Objective & Target dan Current Direction-nya. Konteks brand, target bulanan, angka Brand Tracking, dan keputusan meeting terakhir adalah lensa; angka iklan platform adalah bukti.
- Triangulasi: jangan memutuskan dari satu metrik. Hubungkan skala vs efisiensi, volume vs conversion rate, biaya vs hasil, dan hasil iklan platform vs penjualan nyata di Brand Tracking. Jika atribusi platform dan penjualan nyata bergerak berlawanan, sebutkan.
- Bedakan FAKTA (angka tersedia), OBSERVASI (pola), HIPOTESIS (dugaan penyebab — pakai "kemungkinan"/"indikasi" dan sebut cara memvalidasinya), dan KEPUTUSAN.
- Perubahan di bawah ±5% dianggap stabil. Waspadai denominator kecil dan lonjakan persen tanpa volume. Jika jumlah hari dua periode tidak sebanding, utamakan rasio dibanding total dan nyatakan batasnya.
- Jangan mengarang angka, konteks, atau kejadian. Kekurangan data ditulis di data_gaps, bukan ditutup dengan asumsi.
- Tidak ada saran generik ("optimalkan iklan", "tingkatkan engagement"). Setiap rekomendasi punya objek, alasan, ukuran berhasil, dan horizon waktu.
- Tulis padat. Setiap kalimat harus membawa informasi.
- Keterbacaan: kalimat pendek (maks. ±25 kata), satu gagasan per kalimat. Jangan menumpuk lebih dari tiga angka dalam satu kalimat.
- Format angka Indonesia: desimal koma, ribuan titik, rupiah ringkas ("Rp25,8 jt", "Rp1,2 M"), persen dengan tanda ("+13,1%", "−21%"), ROAS "6,32x".
- Poin daftar dibuka dengan klaimnya, lalu bukti angka, lalu implikasi — maks. 30 kata per poin.

Isi tiap field:
- headline: satu kalimat kesimpulan (maks. 25 kata) yang menjawab "bagaimana periode ini dan apa yang harus dilakukan".
- verdict: on_track (bergerak ke target), watch (campuran / ada risiko material), off_track (menjauh dari target).
- verdict_reason: 1–2 kalimat alasan verdict, dengan angka.
- diagnosis: 3–5 kalimat pendek (total maks. 110 kata). Kalimat pertama = temuan paling material; kalimat berikutnya masing-masing satu driver, trade-off, atau arti bisnis.
- objective_alignment: 2–3 kalimat pendek (maks. 70 kata): keselarasan hasil dengan Objective & Target, Strategic Priorities, Constraints, target bulanan, dan keputusan meeting terakhir. Sebut konteks mana yang dipakai.
- key_metrics: 3–6 metrik paling material sebagai bukti. metric = nama; movement = angka lama → baru (perubahan), mis. "Rp12,1 jt → Rp15,4 jt (+27%)"; reading = arti bisnisnya dalam satu kalimat; tone = positive/negative/neutral menurut dampak bisnis (biaya naik tanpa hasil = negative).
- winning: 2–4 poin yang terbukti bekerja; tiap poin bukti angka + implikasi.
- challenge: 2–4 masalah paling material; tiap poin bukti angka + dampak ke target/constraint.
- hypotheses: 1–4 dugaan penyebab; akhiri dengan data/pemeriksaan untuk memvalidasinya.
- strategic_direction: 2–4 keputusan arah, dari dampak terbesar, terhubung ke objective dan constraint.
- action_items: 3–5 tindakan. priority P1 paling mendesak; horizon mis. "minggu ini", "2 minggu", "bulan depan"; action spesifik (objek + perubahan); rationale singkat; measure = metrik dan ambang keberhasilan.
- risks: 1–3 risiko berikut leading indicator yang dipantau.
- data_gaps: 0–4 kekurangan data/konteks yang benar-benar membatasi kesimpulan. Boleh kosong.
- next_review: 1 kalimat: apa yang harus dicek di review berikutnya dan kapan.`;

/* ── Extra context: what the brand actually sold, its target, its meetings ── */

const rp = (v) => (v == null ? '—' : `Rp${Math.round(v).toLocaleString('id-ID')}`);
const x = (v) => (v == null ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })}x`);
const pct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

// Brand Tracking for the two periods (real sales and spend, blended and per
// channel ROAS), the main period's monthly target, and the last meetings.
// Each part is optional; a part that fails or is empty is simply left out.
export async function gatherBrandContext(brandId, period) {
  const out = { tracking: null, target: null, minutes: null };
  const { curStart, curEnd, oldStart, oldEnd } = period ?? {};

  if (curStart && curEnd) {
    try {
      const s = await getExecutiveSummary({ brandId, startDate: curStart, endDate: curEnd, compareStartDate: oldStart || undefined, compareEndDate: oldEnd || undefined });
      if (s.current?.hasData) {
        const m = Object.fromEntries(s.metrics.map((k) => [k.key, k]));
        const line = (key, label, fmt) => (m[key] ? `- ${label}: ${fmt(m[key].compare)} → ${fmt(m[key].current)}${m[key].growthCompare != null ? ` (${pct(m[key].growthCompare)})` : ''}` : null);
        const lines = [
          line('revenueAll', 'Total penjualan semua channel', rp),
          line('amountSpent', 'Total belanja iklan semua channel', rp),
          line('roas', 'ROAS blended (penjualan ÷ belanja iklan)', x),
          line('trx', 'Transaksi', (v) => (v == null ? '—' : Math.round(v).toLocaleString('id-ID'))),
          line('aov', 'AOV', rp),
        ].filter(Boolean);
        const prev = new Map((s.compare?.channelRoas ?? []).map((c) => [c.key, c]));
        for (const c of s.current.channelRoas ?? []) {
          const p = prev.get(c.key);
          lines.push(`- ${c.label}: penjualan ${rp(c.revenue)}, belanja ${rp(c.spend)}, ROAS ${x(c.roas)}${p?.roas != null ? ` (sebelumnya ${x(p.roas)})` : ''}`);
        }
        out.tracking = lines;
      }
    } catch { /* Brand Tracking is extra context, never a reason to fail */ }

    try {
      const month = curStart.slice(0, 7);
      const t = await trackingRepo.getTarget(brandId, `${month}-01`);
      if (t && (t.target_sales || t.target_spend)) {
        const sales = t.target_sales != null ? Number(t.target_sales) : null;
        const spend = t.target_spend != null ? Number(t.target_spend) : null;
        const alloc = Object.entries(t.allocation ?? {}).map(([k, v]) => `${k} ${v}%`).join(', ');
        out.target = [
          `- Bulan ${month}: target penjualan ${rp(sales)}, budget iklan ${rp(spend)}${sales && spend ? `, target ROAS ${x(sales / spend)}` : ''}`,
          alloc ? `- Alokasi budget per channel: ${alloc}` : null,
          t.notes ? `- Catatan target: ${clip(t.notes, 300)}` : null,
        ].filter(Boolean);
      }
    } catch { /* optional */ }
  }

  try {
    const minutes = (await library.listMinutes(brandId, { endDate: curEnd || undefined })).slice(0, 3);
    if (minutes.length) {
      out.minutes = minutes.map((m) => {
        const date = String(m.meeting_date).slice(0, 10);
        return [
          `### ${date} (${m.meeting_type ?? 'meeting'})`,
          m.meeting_recap ? `Recap: ${clip(m.meeting_recap.replace(/\s+/g, ' '), 700)}` : null,
          m.todo_mil ? `To do MIL: ${clip(m.todo_mil.replace(/\s+/g, ' '), 400)}` : null,
          m.todo_client ? `To do klien: ${clip(m.todo_client.replace(/\s+/g, ' '), 300)}` : null,
        ].filter(Boolean).join('\n');
      });
    }
  } catch { /* optional */ }

  return out;
}

export function contextSections(extra) {
  const sec = (title, body) => (body?.length ? `## ${title}\n${body.join('\n')}` : null);
  return [
    sec('G. Penjualan & belanja nyata (Brand Tracking, semua channel, periode yang sama)', extra.tracking),
    sec('H. Target & budget bulan periode utama', extra.target),
    sec('I. Minutes of Meeting terbaru (keputusan & to do)', extra.minutes),
  ].filter(Boolean);
}

/* ── Call ──────────────────────────────────────────────────────────────── */

const clean = (v) => String(v ?? '').trim();
const list = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);

// Structured action → the one-line form the page parses and the editor edits.
const actionLine = (a) => {
  if (typeof a === 'string') return clean(a);
  const head = `${a.priority || 'P2'} · ${clean(a.horizon) || 'segera'} — ${clean(a.action)}`;
  return [head, a.rationale && `Alasan: ${clean(a.rationale)}`, a.measure && `Ukur: ${clean(a.measure)}`].filter(Boolean).join(' | ');
};

export function normaliseBrief(raw) {
  const verdict = ['on_track', 'watch', 'off_track'].includes(raw.verdict) ? raw.verdict : null;
  return {
    headline: clean(raw.headline),
    verdict,
    verdict_reason: clean(raw.verdict_reason),
    diagnosis: clean(raw.diagnosis),
    objective_alignment: clean(raw.objective_alignment),
    key_metrics: (Array.isArray(raw.key_metrics) ? raw.key_metrics : [])
      .map((k) => ({ metric: clean(k.metric), movement: clean(k.movement), reading: clean(k.reading), tone: ['positive', 'negative', 'neutral'].includes(k.tone) ? k.tone : 'neutral' }))
      .filter((k) => k.metric),
    winning: list(raw.winning),
    challenge: list(raw.challenge),
    hypotheses: list(raw.hypotheses),
    strategic_direction: list(raw.strategic_direction),
    action_items: (Array.isArray(raw.action_items) ? raw.action_items : []).map(actionLine).filter(Boolean),
    risks: list(raw.risks),
    data_gaps: list(raw.data_gaps),
    next_review: clean(raw.next_review),
  };
}

export async function generateBrief(prompt) {
  let res;
  try {
    // Refusal fallback on by default for this model: a safety decline is
    // re-run on a fallback model inside the same call instead of failing.
    res = await getClient().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: BRIEF_SCHEMA } },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiSummaryError('ANTHROPIC_API_KEY ditolak. Periksa key di server.', 502);
    if (err instanceof Anthropic.PermissionDeniedError) throw new AiSummaryError('API key Claude tidak punya akses ke model ini.', 502);
    if (err instanceof Anthropic.RateLimitError) throw new AiSummaryError('Batas pemakaian Claude tercapai (rate limit). Coba lagi beberapa saat lagi.', 429);
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AiSummaryError('Claude belum selesai menyusun brief dalam batas waktu. Coba lagi — atau turunkan ANTHROPIC_EFFORT.', 504);
    if (err instanceof Anthropic.BadRequestError && /workspace/i.test(err.message)) throw new AiSummaryError('API key Claude belum terikat ke workspace. Isi ANTHROPIC_WORKSPACE_ID di environment server, atau buat API key di dalam sebuah workspace di console Anthropic.', 400);
    if (err instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(err.message)) throw new AiSummaryError('Saldo kredit API Claude habis. Isi ulang di console Anthropic.', 402);
    if (err instanceof Anthropic.APIError && err.status) throw new AiSummaryError(`Claude menolak permintaan (HTTP ${err.status}): ${String(err.message).slice(0, 240)}`, err.status >= 500 ? 502 : 400);
    if (err instanceof Anthropic.APIConnectionError) throw new AiSummaryError(`Tidak bisa menghubungi Claude: ${err.message}`);
    throw err;
  }

  if (res.stop_reason === 'refusal') throw new AiSummaryError('Claude menolak membuat ringkasan untuk data ini.', 422);
  if (res.stop_reason === 'max_tokens') throw new AiSummaryError('Jawaban Claude terpotong (max_tokens). Coba lagi.', 502);
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiSummaryError('Jawaban Claude bukan JSON yang valid.');
  }
  return { summary: normaliseBrief(parsed), model: res.model, usage: res.usage };
}
