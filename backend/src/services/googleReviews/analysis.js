import { requestJson } from './llm.js';

// Google Reviews › what the AI reads and writes.
//
// classifyBatch: one call reads up to BATCH_SIZE reviews. Sentiment comes
// from the words — the star rating is shown to the model as context only,
// because a 5-star review can still carry a complaint. Each review also gets
// the short aspect phrases it praises or criticises, written in Indonesian
// whatever the review's language, so "friendly staff" and "staff ramah" end
// up as one aspect and topics can be grouped across languages.
//
// generateSummary: one call over the computed figures and the aspect
// phrases. It groups aspects into topics and writes the summary; every count
// shown next to its output is computed afterwards from the reviews.

export const BATCH_SIZE = Number(process.env.GR_BATCH_SIZE) || 25;
const MAX_TEXT = 1500;

const str = { type: 'string' };
const strList = { type: 'array', items: str };

const CLASSIFY_SCHEMA = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'sentiment', 'confidence', 'language', 'praises', 'complaints'],
        properties: {
          id: str,
          sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
          confidence: { type: 'number' },
          language: str,
          praises: strList,
          complaints: strList,
        },
      },
    },
  },
};

const CLASSIFY_SYSTEM = `You classify customer reviews of a business from Google Maps. Reviews may be in Indonesian, English, a mix of both, or another language, and may use slang, abbreviations and emoji.

For each review return:
- sentiment, judged from what the text says (not from the star rating, which is context only):
  • positive — the customer is satisfied, praises the product, service or experience.
  • negative — the customer complains, is dissatisfied, or criticises.
  • neutral — informative with no clear feeling, OR praise and criticism with neither clearly dominating.
  Read negation and context ("tidak ramah" is negative; "lumayan, tapi antri lama banget" leans negative; sarcasm counts as what it means). A review that praises overall with one minor remark stays positive; one whose main point is a complaint is negative even with 4–5 stars.
- confidence: 0–1, how clear the sentiment is (0.9+ unambiguous, ~0.6 mixed or vague).
- language: ISO 639-1 code of the review (use "mixed" for Indonesian–English code-mixing).
- praises / complaints: 0–4 short aspect phrases each (1–4 words), what exactly is praised or criticised, ALWAYS written in natural lowercase Indonesian, generic enough to recur across reviews ("pelayanan ramah", "dokter informatif", "waktu tunggu lama", "harga mahal", "tempat bersih", "hasil treatment memuaskan"). Never include names of people, phone numbers or other personal data. Empty when the review names nothing specific.

Return exactly one result per review, with the review's id unchanged.`;

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s);

export async function classifyBatch(reviews) {
  const lines = reviews.map((r) => JSON.stringify({ id: String(r.id), stars: r.rating ?? null, text: clip(r.text, MAX_TEXT) }));
  const { data, model } = await requestJson({
    task: 'classify',
    system: CLASSIFY_SYSTEM,
    prompt: `Reviews (one JSON object per line):\n${lines.join('\n')}`,
    schema: CLASSIFY_SCHEMA,
    maxTokens: 300 + reviews.length * 160,
  });
  const byId = new Map();
  for (const r of Array.isArray(data?.results) ? data.results : []) {
    if (!['positive', 'neutral', 'negative'].includes(r?.sentiment)) continue;
    const phrases = (v) => (Array.isArray(v) ? v : [])
      .map((s) => String(s).toLowerCase().trim().replace(/\s+/g, ' '))
      .filter((s) => s && s.length <= 60)
      .slice(0, 4);
    byId.set(String(r.id), {
      sentiment: r.sentiment,
      confidence: Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, Math.round(r.confidence * 100) / 100)) : null,
      language: typeof r.language === 'string' ? r.language.slice(0, 10) : null,
      praises: phrases(r.praises),
      complaints: phrases(r.complaints),
    });
  }
  return { results: byId, model };
}

/* ── Summary ──────────────────────────────────────────────────────────── */

const finding = {
  type: 'object',
  required: ['title', 'detail', 'aspects', 'example_review_ids'],
  properties: { title: str, detail: str, aspects: strList, example_review_ids: strList },
};

const SUMMARY_SCHEMA = {
  type: 'object',
  required: ['topics', 'love', 'improve', 'executive'],
  properties: {
    topics: {
      type: 'array',
      items: { type: 'object', required: ['name', 'aspects', 'insight'], properties: { name: str, aspects: strList, insight: str } },
    },
    love: { type: 'array', items: finding },
    improve: { type: 'array', items: finding },
    executive: {
      type: 'object',
      required: ['overall', 'strengths', 'complaints', 'trend', 'actions', 'limitations'],
      properties: {
        overall: str,
        strengths: strList,
        complaints: strList,
        trend: str,
        actions: {
          type: 'array',
          items: { type: 'object', required: ['action', 'reason'], properties: { action: str, reason: str } },
        },
        limitations: strList,
      },
    },
  },
};

const SUMMARY_SYSTEM = `Kamu adalah konsultan marketing & customer experience senior yang membaca hasil analisis ulasan Google sebuah bisnis untuk tim agensi digital marketing. Tulis dalam Bahasa Indonesia yang profesional, lugas, dan singkat.

Aturan:
- Semua temuan harus berdasar pada data yang diberikan. Jangan mengarang angka, ulasan, kejadian, atau penyebab.
- Angka yang boleh dikutip hanya angka yang ada di data. Jika menyebut jumlah, pakai angka itu persis.
- Bedakan fakta ("38 ulasan menyebut…") dari interpretasi ("kemungkinan…", "indikasi…").
- Jangan menyimpulkan sebab-akibat dari pergerakan tren; tulis sebagai korelasi atau dugaan yang perlu divalidasi.
- Jika cakupan data terbatas (ulasan terkumpul jauh lebih sedikit dari total Google, sedikit ulasan teks, atau periode pendek), sebutkan di limitations dan jangan menggeneralisasi ke semua pelanggan.
- Kalimat pendek, satu gagasan per kalimat. Format angka Indonesia (koma desimal).

Isi:
- topics: 4–8 topik yang benar-benar muncul, dinamai sesuai jenis bisnis (mis. untuk klinik: "Kualitas Dokter", "Hasil Treatment"; untuk restoran: "Rasa Makanan", "Kecepatan Penyajian"). aspects = daftar frasa aspek yang PERSIS diambil dari daftar aspek yang diberikan (praises maupun complaints) yang termasuk topik itu. insight = satu kalimat apa kata pelanggan tentang topik itu.
- love: 2–4 hal yang paling sering dipuji. aspects persis dari daftar praises. example_review_ids: 1–2 id ulasan contoh dari sampel yang diberikan.
- improve: 0–4 keluhan berulang atau area perbaikan. aspects persis dari daftar complaints. Kosongkan bila tidak ada keluhan yang berarti — jangan mengada-adakan.
- executive.overall: 2–3 kalimat sentimen pelanggan secara keseluruhan dengan angka utama.
- executive.strengths: 2–4 poin kekuatan utama.
- executive.complaints: 0–4 poin keluhan utama.
- executive.trend: 1–3 kalimat ringkasan tren sentimen; jika data tren tidak cukup, katakan itu.
- executive.actions: 3–5 rekomendasi spesifik dan bisa dieksekusi tim marketing/CX (apa yang dilakukan + alasan berbasis data).
- executive.limitations: 1–3 keterbatasan data yang relevan.`;

export async function generateSummary(input) {
  const { data, model } = await requestJson({
    task: 'summary',
    system: SUMMARY_SYSTEM,
    prompt: `Data analisis (JSON):\n${JSON.stringify(input)}`,
    schema: SUMMARY_SCHEMA,
    maxTokens: 6000,
  });
  return { summary: normaliseSummary(data), model };
}

const text = (v) => String(v ?? '').trim();
const list = (v) => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
const findings = (v) => (Array.isArray(v) ? v : [])
  .map((f) => ({ title: text(f?.title), detail: text(f?.detail), aspects: list(f?.aspects).map((a) => a.toLowerCase()), example_review_ids: list(f?.example_review_ids) }))
  .filter((f) => f.title && f.aspects.length);

export function normaliseSummary(raw) {
  const e = raw?.executive ?? {};
  return {
    topics: (Array.isArray(raw?.topics) ? raw.topics : [])
      .map((t) => ({ name: text(t?.name), aspects: list(t?.aspects).map((a) => a.toLowerCase()), insight: text(t?.insight) }))
      .filter((t) => t.name && t.aspects.length),
    love: findings(raw?.love),
    improve: findings(raw?.improve),
    executive: {
      overall: text(e.overall),
      strengths: list(e.strengths),
      complaints: list(e.complaints),
      trend: text(e.trend),
      actions: (Array.isArray(e.actions) ? e.actions : []).map((a) => ({ action: text(a?.action), reason: text(a?.reason) })).filter((a) => a.action),
      limitations: list(e.limitations),
    },
  };
}
