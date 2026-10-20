// Google Reviews › the numbers on the dashboard, computed from the reviews
// themselves — the AI summary may quote them but never supplies them.
//
// Denominators, stated once because every chart depends on them:
//   • sentiment shares: text reviews read as positive, neutral or negative.
//     Rating-only reviews and readings that failed are counted, and shown,
//     separately — never in the share.
//   • rating shares: reviews that carry a star rating.
// Periods use Jakarta time (UTC+7), the team's working day.

export const SENTIMENTS = ['positive', 'neutral', 'negative'];
const TZ_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86_400_000;

// Shares in one decimal that add up to exactly 100 (largest remainder), so
// a legend never reads 99,9% or 100,1%.
export function shares(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => null);
  const raw = counts.map((c) => (c / total) * 1000);
  const floors = raw.map(Math.floor);
  let left = 1000 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((v) => v / 10);
}

export function sentimentDistribution(reviews) {
  const count = { positive: 0, neutral: 0, negative: 0, rating_only: 0, failed: 0, pending: 0 };
  for (const r of reviews) count[r.sentiment ?? 'pending'] = (count[r.sentiment ?? 'pending'] ?? 0) + 1;
  const pcts = shares(SENTIMENTS.map((s) => count[s]));
  return {
    analyzed: SENTIMENTS.reduce((a, s) => a + count[s], 0),
    items: SENTIMENTS.map((s, i) => ({ key: s, count: count[s], pct: pcts[i] })),
    ratingOnly: count.rating_only,
    failed: count.failed,
    pending: count.pending,
  };
}

export function ratingDistribution(reviews) {
  const counts = [5, 4, 3, 2, 1].map((star) => reviews.filter((r) => r.rating === star).length);
  const pcts = shares(counts);
  const rated = counts.reduce((a, b) => a + b, 0);
  const sum = reviews.reduce((a, r) => a + (r.rating ?? 0), 0);
  return {
    rated,
    average: rated ? Math.round((sum / rated) * 100) / 100 : null,
    items: [5, 4, 3, 2, 1].map((star, i) => ({ star, count: counts[i], pct: pcts[i] })),
  };
}

/* ── Periods ──────────────────────────────────────────────────────────── */

const local = (d) => new Date(new Date(d).getTime() + TZ_OFFSET_MS);
const ymd = (d) => d.toISOString().slice(0, 10);

// The period a review date falls in: 'YYYY-MM' for months, the Monday
// 'YYYY-MM-DD' for ISO weeks.
export function periodKey(date, granularity) {
  const d = local(date);
  if (granularity === 'month') return ymd(d).slice(0, 7);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return ymd(new Date(d.getTime() - dow * DAY_MS));
}

function nextPeriod(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  return ymd(new Date(new Date(`${key}T00:00:00Z`).getTime() + 7 * DAY_MS));
}

const ID_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function periodLabel(key, granularity) {
  if (granularity === 'month') {
    const [y, m] = key.split('-').map(Number);
    return `${ID_MONTHS_SHORT[m - 1]} ${y}`;
  }
  const [y, m, d] = key.split('-').map(Number);
  return `${d} ${ID_MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

// Sentiment per period, every period between the first and last included
// (an empty one is a period with no *collected* text review, not proof there
// were no reviews). The period holding `now` is marked partial.
// A date known only to the month ("6 months ago") has no week; one known
// only to the year has neither. Such reviews stay out of the finer trend and
// are counted as `imprecise` instead of being put in a period they may not
// belong to.
const TOO_COARSE = { week: new Set(['month', 'year']), month: new Set(['year']) };

export function sentimentTrend(reviews, { granularity = 'month', from, to, now = new Date() } = {}) {
  const g = granularity === 'week' ? 'week' : 'month';
  const fromMs = from ? new Date(`${from}T00:00:00+07:00`).getTime() : -Infinity;
  const toMs = to ? new Date(`${to}T23:59:59.999+07:00`).getTime() : Infinity;
  const read = reviews.filter((r) => SENTIMENTS.includes(r.sentiment));
  const undated = read.filter((r) => !r.review_date).length;
  const dated = read.filter((r) => r.review_date
    && new Date(r.review_date).getTime() >= fromMs && new Date(r.review_date).getTime() <= toMs);
  const imprecise = dated.filter((r) => TOO_COARSE[g].has(r.date_precision)).length;
  const inRange = dated.filter((r) => !TOO_COARSE[g].has(r.date_precision));
  if (!inRange.length) return { granularity: g, points: [], undated, imprecise };

  const byKey = new Map();
  for (const r of inRange) {
    const k = periodKey(r.review_date, g);
    const p = byKey.get(k) ?? { positive: 0, neutral: 0, negative: 0 };
    p[r.sentiment] += 1;
    byKey.set(k, p);
  }
  const keys = [...byKey.keys()].sort();
  const first = from ? periodKey(new Date(fromMs), g) : keys[0];
  const last = to ? periodKey(new Date(Math.min(toMs, now.getTime())), g) : keys.at(-1);
  const current = periodKey(now, g);

  const points = [];
  for (let k = first; k <= last; k = nextPeriod(k, g)) {
    const c = byKey.get(k) ?? { positive: 0, neutral: 0, negative: 0 };
    const total = c.positive + c.neutral + c.negative;
    const [pp, np, ng] = shares([c.positive, c.neutral, c.negative]);
    points.push({
      period: k,
      label: periodLabel(k, g),
      total,
      positive: c.positive,
      neutral: c.neutral,
      negative: c.negative,
      positivePct: pp,
      neutralPct: np,
      negativePct: ng,
      partial: k === current,
    });
    if (points.length > 520) break; // ten years of weeks: a guard, not a limit anyone meets
  }
  return { granularity: g, points, undated, imprecise };
}

// A period needs this many read reviews before its shares are compared.
export const MIN_PERIOD_REVIEWS = 5;

// Plain statements about the trend, each one checkable against the chart.
// Only complete periods with enough reviews are compared.
export function trendInsights(trend) {
  const unit = trend.granularity === 'week' ? 'minggu' : 'bulan';
  const solid = trend.points.filter((p) => !p.partial && p.total >= MIN_PERIOD_REVIEWS);
  if (solid.length < 2) {
    return {
      sufficient: false,
      message: `Belum cukup data untuk tren yang representatif: perlu minimal dua ${unit} lengkap dengan ≥${MIN_PERIOD_REVIEWS} ulasan teks yang terbaca. Periode tanpa ulasan terkumpul tidak berarti tidak ada ulasan pada periode itu.`,
      items: [],
    };
  }
  const fmt = (v) => `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
  const items = [];
  const [prev, last] = solid.slice(-2);
  const dPos = last.positivePct - prev.positivePct;
  if (Math.abs(dPos) >= 10) {
    items.push({
      tone: dPos > 0 ? 'positive' : 'negative',
      text: `Proporsi sentimen positif ${dPos > 0 ? 'naik' : 'turun'} dari ${fmt(prev.positivePct)} (${prev.label}, ${prev.total} ulasan) ke ${fmt(last.positivePct)} (${last.label}, ${last.total} ulasan).`,
    });
  }
  if (solid.length >= 4) {
    const recent = solid.slice(-2);
    const before = solid.slice(-4, -2);
    const avg = (arr) => arr.reduce((a, p) => a + p.negativePct, 0) / arr.length;
    const rising = recent[0].negativePct > before.at(-1).negativePct && recent[1].negativePct >= recent[0].negativePct;
    if (rising && avg(recent) - avg(before) >= 5) {
      items.push({
        tone: 'negative',
        text: `Sentimen negatif meningkat dalam dua ${unit} terakhir: rata-rata ${fmt(avg(recent))} dibanding ${fmt(avg(before))} pada dua ${unit} sebelumnya.`,
      });
    }
  }
  if (last.total >= prev.total * 1.2 && last.positivePct <= prev.positivePct - 5) {
    items.push({
      tone: 'negative',
      text: `Jumlah ulasan naik (${prev.total} → ${last.total}) tetapi proporsi positif turun (${fmt(prev.positivePct)} → ${fmt(last.positivePct)}).`,
    });
  }
  if (!items.length) {
    items.push({ tone: 'neutral', text: `Komposisi sentimen ${last.label} relatif stabil dibanding ${prev.label} (positif ${fmt(prev.positivePct)} → ${fmt(last.positivePct)}).` });
  }
  return { sufficient: true, message: null, items };
}

/* ── Topics & highlights ──────────────────────────────────────────────── */

const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

// The AI groups aspect phrases into topics; how many reviews each topic has,
// and which way they lean, is counted here from the reviews.
export function topicStats(topics, reviews) {
  return (topics ?? [])
    .map((t) => {
      const members = new Set((t.aspects ?? []).map(norm));
      const hits = reviews.filter((r) => (r.aspects ?? []).some((a) => members.has(norm(a))));
      const c = { positive: 0, neutral: 0, negative: 0 };
      for (const r of hits) if (c[r.sentiment] !== undefined) c[r.sentiment] += 1;
      const dominant = hits.length ? SENTIMENTS.reduce((best, s) => (c[s] > c[best] ? s : best), 'positive') : null;
      // A topic whose mentions split evenly between praise and complaint is
      // "mixed", not whichever happened to be counted first.
      const mixed = hits.length && c.positive && c.negative && Math.abs(c.positive - c.negative) / hits.length < 0.2;
      return { name: t.name, insight: t.insight, aspects: [...members], count: hits.length, sentiment: c, dominant: mixed ? 'mixed' : dominant };
    })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);
}

// "What customers love" / "Areas for improvement": each finding counts the
// reviews that praise (or criticise) one of its aspects, and its examples are
// checked to really be such reviews.
export function highlightStats(findings, reviews, side) {
  const field = side === 'love' ? 'praises' : 'complaints';
  return (findings ?? [])
    .map((f) => {
      const members = new Set((f.aspects ?? []).map(norm));
      const hits = reviews.filter((r) => (r[field] ?? []).some((a) => members.has(norm(a))));
      const hitIds = new Set(hits.map((r) => String(r.id)));
      let examples = (f.example_review_ids ?? []).map(String).filter((id) => hitIds.has(id));
      if (!examples.length) {
        examples = hits
          .filter((r) => r.text)
          .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || (b.text.length > 40) - (a.text.length > 40))
          .slice(0, 2)
          .map((r) => String(r.id));
      }
      const byId = new Map(hits.map((r) => [String(r.id), r]));
      return {
        title: f.title,
        detail: f.detail,
        count: hits.length,
        examples: examples.slice(0, 2).map((id) => {
          const r = byId.get(id);
          return { id: r.id, rating: r.rating, date: r.review_date, text: r.text };
        }),
      };
    })
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);
}

// Topics a review touches, for the explorer's column.
export function reviewTopics(review, topics) {
  const own = new Set((review.aspects ?? []).map(norm));
  return (topics ?? []).filter((t) => (t.aspects ?? []).some((a) => own.has(norm(a)))).map((t) => t.name);
}
