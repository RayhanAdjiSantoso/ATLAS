import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExclusions, buildWordCloud, reviewTerms } from '../src/services/googleReviews/textAnalytics.js';
import {
  highlightStats, periodKey, ratingDistribution, sentimentDistribution, sentimentTrend, shares, topicStats, trendInsights,
} from '../src/services/googleReviews/aggregations.js';
import { normaliseSummary } from '../src/services/googleReviews/analysis.js';

/* ── Text ─────────────────────────────────────────────────────────────── */

test('terms: lowercase, slang folded, stopwords dropped, phrases close up', () => {
  const t = reviewTerms('Pelayanannya SANGAT ramah bgt, tempatnya bersih!!', new Set());
  assert.ok(t.has('pelayanan ramah'));
  assert.ok(t.has('tempat bersih'));
  assert.ok(t.has('ramah'));
  assert.ok(!t.has('sangat'));
  assert.ok(!t.has('banget'));
  // filler is not a term alone
  assert.ok(!t.has('tempat'));
});

test('terms: phrases never cross punctuation', () => {
  const t = reviewTerms('Parkir susah. Dokter ramah', new Set());
  assert.ok(t.has('parkir susah'));
  assert.ok(t.has('dokter ramah'));
  assert.ok(!t.has('susah dokter'));
});

test('terms: a pair may close over a dropped word, a three-word phrase may not', () => {
  const t = reviewTerms('Harga mahal untuk hasil yang biasa', new Set());
  assert.ok(t.has('harga mahal'));
  assert.ok(t.has('mahal hasil'));
  assert.ok(!t.has('harga mahal hasil'));
  assert.ok(reviewTerms('waktu tunggu lama', new Set()).has('waktu tunggu lama'));
});

test('terms: negation kept inside a phrase, never alone', () => {
  const t = reviewTerms('staffnya gak ramah', new Set());
  assert.ok(t.has('tidak ramah'));
  assert.ok(t.has('staff tidak ramah'));
  assert.ok(!t.has('tidak'));
  const en = reviewTerms("The staff wasn't friendly", new Set());
  assert.ok(en.has('not friendly'));
});

test('terms: names after a title and reviewer/business names are left out', () => {
  const ex = buildExclusions({ businessName: 'Alluderma Skin & Aesthetic Clinic', reviewerNames: ['Rina Wulandari'] });
  const t = reviewTerms('Treatment di Alluderma bagus, dr. Sarah sabar. Makasih kak Rina dan dokter Budi', ex);
  for (const bad of ['alluderma', 'sarah', 'rina', 'budi', 'wulandari']) {
    assert.ok(![...t].some((x) => x.split(' ').includes(bad)), `${bad} leaked: ${[...t]}`);
  }
  assert.ok(t.has('treatment bagus'));
  assert.ok(t.has('sabar'));
});

test('word cloud counts reviews, not repetitions, and folds a word into its phrase', () => {
  const reviews = [
    { id: 1, text: 'pelayanan ramah, ramah, ramah sekali', sentiment: 'positive' },
    { id: 2, text: 'Pelayanan ramah dan cepat', sentiment: 'positive' },
    { id: 3, text: 'pelayanan ramah tapi antri lama', sentiment: 'neutral' },
  ];
  const cloud = buildWordCloud(reviews, { exclusions: new Set() });
  const phrase = cloud.find((w) => w.term === 'pelayanan ramah');
  assert.equal(phrase.count, 3);
  assert.equal(phrase.positive, 2);
  assert.equal(phrase.neutral, 1);
  assert.ok(!cloud.some((w) => w.term === 'ramah'), 'ramah should be folded into "pelayanan ramah"');
});

test('word cloud of an empty set is empty', () => {
  assert.deepEqual(buildWordCloud([], { exclusions: new Set() }), []);
});

/* ── Shares & distributions ──────────────────────────────────────────── */

test('shares always add up to exactly 100', () => {
  for (const counts of [[1, 1, 1], [172, 43, 24], [2, 1, 0], [7, 0, 0], [33, 33, 34]]) {
    const s = shares(counts);
    assert.equal(Math.round(s.reduce((a, b) => a + b, 0) * 10), 1000, String(counts));
  }
  assert.deepEqual(shares([0, 0, 0]), [null, null, null]);
});

test('sentiment shares use only text reviews read as pos/neu/neg', () => {
  const reviews = [
    ...Array(6).fill({ sentiment: 'positive' }),
    ...Array(2).fill({ sentiment: 'neutral' }),
    ...Array(2).fill({ sentiment: 'negative' }),
    ...Array(5).fill({ sentiment: 'rating_only' }),
    { sentiment: 'failed' },
    { sentiment: null },
  ];
  const d = sentimentDistribution(reviews);
  assert.equal(d.analyzed, 10);
  assert.deepEqual(d.items.map((i) => i.pct), [60, 20, 20]);
  assert.equal(d.ratingOnly, 5);
  assert.equal(d.failed, 1);
  assert.equal(d.pending, 1);
});

test('rating distribution counts rated reviews only', () => {
  const r = ratingDistribution([{ rating: 5 }, { rating: 5 }, { rating: 1 }, { rating: null }]);
  assert.equal(r.rated, 3);
  assert.equal(r.items[0].count, 2);
  assert.equal(r.items[4].count, 1);
  assert.equal(r.average, 3.67);
});

/* ── Trend ────────────────────────────────────────────────────────────── */

test('period keys use Jakarta time and ISO weeks', () => {
  // 31 Jan 20:00 UTC is already 1 Feb in Jakarta
  assert.equal(periodKey('2026-01-31T20:00:00Z', 'month'), '2026-02');
  // Sunday 8 Mar 2026 belongs to the week starting Monday 2 Mar
  assert.equal(periodKey('2026-03-08T05:00:00Z', 'week'), '2026-03-02');
  assert.equal(periodKey('2026-03-09T05:00:00Z', 'week'), '2026-03-09');
});

const mk = (date, sentiment) => ({ review_date: date, sentiment });

test('trend fills empty periods and marks the current one partial', () => {
  const reviews = [mk('2026-01-10T03:00:00Z', 'positive'), mk('2026-03-05T03:00:00Z', 'negative'), mk('2026-03-06T03:00:00Z', 'rating_only')];
  const t = sentimentTrend(reviews, { granularity: 'month', now: new Date('2026-03-20T00:00:00Z') });
  assert.deepEqual(t.points.map((p) => p.period), ['2026-01', '2026-02', '2026-03']);
  assert.equal(t.points[1].total, 0);
  assert.equal(t.points[1].positivePct, null);
  assert.equal(t.points[2].negative, 1);
  assert.equal(t.points[2].total, 1, 'rating-only is not in the trend');
  assert.equal(t.points[2].partial, true);
});

test('trend respects the date range', () => {
  const reviews = [mk('2026-01-10T03:00:00Z', 'positive'), mk('2026-02-10T03:00:00Z', 'positive'), mk('2026-03-10T03:00:00Z', 'negative')];
  const t = sentimentTrend(reviews, { granularity: 'month', from: '2026-02-01', to: '2026-02-28', now: new Date('2026-06-01T00:00:00Z') });
  assert.deepEqual(t.points.map((p) => p.period), ['2026-02']);
});

test('trend insights need two solid complete periods', () => {
  const thin = sentimentTrend([mk('2026-01-10T03:00:00Z', 'positive')], { now: new Date('2026-06-01T00:00:00Z') });
  assert.equal(trendInsights(thin).sufficient, false);

  const reviews = [];
  for (let i = 0; i < 10; i += 1) reviews.push(mk(`2026-01-${String(i + 1).padStart(2, '0')}T03:00:00Z`, i < 9 ? 'positive' : 'negative'));
  for (let i = 0; i < 10; i += 1) reviews.push(mk(`2026-02-${String(i + 1).padStart(2, '0')}T03:00:00Z`, i < 5 ? 'positive' : 'negative'));
  const t = sentimentTrend(reviews, { now: new Date('2026-06-01T00:00:00Z') });
  const ins = trendInsights(t);
  assert.equal(ins.sufficient, true);
  assert.ok(ins.items.some((i) => i.tone === 'negative' && /turun/.test(i.text)), JSON.stringify(ins.items));
});

/* ── Topics & highlights ─────────────────────────────────────────────── */

test('topic counts come from reviews; topics without evidence are dropped', () => {
  const reviews = [
    { id: 1, sentiment: 'positive', aspects: ['pelayanan ramah'], praises: ['pelayanan ramah'], complaints: [], text: 'ramah', rating: 5 },
    { id: 2, sentiment: 'negative', aspects: ['waktu tunggu lama'], praises: [], complaints: ['waktu tunggu lama'], text: 'lama', rating: 2 },
    { id: 3, sentiment: 'positive', aspects: ['staff ramah'], praises: ['staff ramah'], complaints: [], text: 'staff ramah', rating: 5 },
  ];
  const topics = topicStats([
    { name: 'Keramahan Staff', aspects: ['pelayanan ramah', 'staff ramah'], insight: 'x' },
    { name: 'Waktu Tunggu', aspects: ['waktu tunggu lama'], insight: 'y' },
    { name: 'Parkir', aspects: ['parkir sempit'], insight: 'z' },
  ], reviews);
  assert.deepEqual(topics.map((t) => [t.name, t.count, t.dominant]), [['Keramahan Staff', 2, 'positive'], ['Waktu Tunggu', 1, 'negative']]);

  const love = highlightStats([{ title: 'Ramah', detail: '', aspects: ['staff ramah', 'pelayanan ramah'], example_review_ids: ['2', '3'] }], reviews, 'love');
  assert.equal(love[0].count, 2);
  // review 2 is a complaint, so it is not accepted as an example of praise
  assert.deepEqual(love[0].examples.map((e) => e.id), [3]);
});

test('summary normalisation drops empty findings and topics', () => {
  const s = normaliseSummary({
    topics: [{ name: 'A', aspects: ['X'], insight: 'i' }, { name: '', aspects: ['y'] }, { name: 'B', aspects: [] }],
    love: [{ title: 'T', detail: 'd', aspects: ['a'], example_review_ids: [] }, { title: 'U', aspects: [] }],
    improve: null,
    executive: { overall: ' ok ', strengths: ['s', ''], actions: [{ action: 'do', reason: 'r' }, { action: '' }] },
  });
  assert.deepEqual(s.topics.map((t) => t.name), ['A']);
  assert.equal(s.topics[0].aspects[0], 'x');
  assert.equal(s.love.length, 1);
  assert.deepEqual(s.improve, []);
  assert.equal(s.executive.overall, 'ok');
  assert.deepEqual(s.executive.strengths, ['s']);
  assert.equal(s.executive.actions.length, 1);
});
