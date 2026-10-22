import { CODE_TOPICS } from './aspects.js';
import { ENGINE_VERSION } from './lexicon.js';
import {
  ratingDistribution, sentimentDistribution, sentimentTrend, SENTIMENTS, topicStats, trendInsights,
} from '../aggregations.js';

// Google Reviews › the Code-Based summary: sentences assembled from the
// figures, never generated. It states what the numbers and matched words
// show, and makes no business recommendations — those need judgement the
// rules do not have (the AI method offers them).
//
// Same shape as the AI summary (topics, love, improve, executive), so the
// dashboard renders either.

const pct = (v) => `${(v ?? 0).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const n = (v) => Number(v ?? 0).toLocaleString('id-ID');

function aspectCounts(reviews, field) {
  const m = new Map();
  for (const r of reviews) for (const a of new Set(r[field] ?? [])) m.set(a, (m.get(a) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const topicName = (label) => CODE_TOPICS.find((t) => t.aspects.includes(label))?.name ?? label;

export function buildCodeSummary({ business, reviews }) {
  const read = reviews.filter((r) => SENTIMENTS.includes(r.sentiment));
  const dist = sentimentDistribution(reviews);
  const by = Object.fromEntries(dist.items.map((i) => [i.key, i]));
  const ratings = ratingDistribution(reviews);
  const trend = sentimentTrend(reviews, { granularity: 'month' });
  const insights = trendInsights(trend);
  const praised = aspectCounts(read, 'praises');
  const criticised = aspectCounts(read, 'complaints');
  const topics = topicStats(CODE_TOPICS, read);
  const unclear = read.filter((r) => r.evidence === 'ambiguous' || r.evidence === 'low_evidence' || r.evidence === 'no_evidence').length;

  // Topics carry a one-line, counted description instead of an AI insight.
  const topicsOut = CODE_TOPICS.map((t) => {
    const s = topics.find((x) => x.name === t.name);
    if (!s) return t;
    return {
      ...t,
      insight: `${n(s.count)} ulasan menyebut topik ini: ${n(s.sentiment.positive)} positif, ${n(s.sentiment.neutral)} netral, ${n(s.sentiment.negative)} negatif.`,
    };
  });

  const finding = (label, count, kind) => ({
    title: topicName(label),
    detail: `${n(count)} ulasan ${kind === 'love' ? 'memuji' : 'mengeluhkan'} aspek "${label}".`,
    aspects: [label],
    example_review_ids: [],
  });

  const overall = dist.analyzed
    ? `Dari ${n(dist.analyzed)} ulasan teks yang dianalisis, ${pct(by.positive.pct)} positif (${n(by.positive.count)}), ${pct(by.neutral.pct)} netral (${n(by.neutral.count)}), dan ${pct(by.negative.pct)} negatif (${n(by.negative.count)}).`
      + (ratings.average != null ? ` Rata-rata bintang dari ${n(ratings.rated)} ulasan yang terkumpul: ${ratings.average.toLocaleString('id-ID')}.` : '')
    : 'Belum ada ulasan teks yang dianalisis.';

  const limitations = [
    'Metode Code-Based membaca kata dan frasa dari leksikon: sarkasme, slang yang tidak umum, dan makna yang bergantung pada konteks bisa terbaca keliru.',
  ];
  if (unclear) limitations.push(`${n(unclear)} ulasan (${pct((unclear / Math.max(1, dist.analyzed)) * 100)}) bertanda bukti lemah atau campuran — periksa di Reviews Explorer.`);
  if (business.google_total && reviews.length < business.google_total) {
    limitations.push(`Data mencakup ${n(reviews.length)} dari ${n(business.google_total)} ulasan yang dilaporkan Google.`);
  }
  if (dist.ratingOnly) limitations.push(`${n(dist.ratingOnly)} ulasan hanya berisi bintang dan tidak masuk persentase sentimen.`);

  return {
    topics: topicsOut,
    love: praised.slice(0, 4).filter(([, c]) => c >= 2).map(([label, c]) => finding(label, c, 'love')),
    improve: criticised.slice(0, 4).filter(([, c]) => c >= 2).map(([label, c]) => finding(label, c, 'improve')),
    executive: {
      overall,
      strengths: praised.slice(0, 4).map(([label, c]) => `${topicName(label)}: ${n(c)} ulasan memuji aspek "${label}".`),
      complaints: criticised.slice(0, 4).map(([label, c]) => `${topicName(label)}: ${n(c)} ulasan mengeluhkan aspek "${label}".`),
      trend: insights.sufficient ? insights.items.map((i) => i.text).join(' ') : insights.message,
      actions: [],
      limitations,
    },
    engine: ENGINE_VERSION,
  };
}
