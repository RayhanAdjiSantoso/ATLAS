// Integration test for Google Reviews Analytics: search → select → run
// (collect, analyze, summarize) → dashboard → explorer → incremental
// refresh → failure handling, against the real database.
// Opt-in: GOOGLE_REVIEWS_IT=1 node --test test/
// The source and the model are stand-ins (no paid service is called); every
// business it creates has a "__itgr_" Place ID and is deleted at the end.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const ENABLED = process.env.GOOGLE_REVIEWS_IT === '1';
const tag = `__itgr_${crypto.randomBytes(3).toString('hex')}`;

const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86_400_000).toISOString();

function makeSource(reviews, { pageSize = 4, fail = false } = {}) {
  const calls = { pages: 0 };
  return {
    calls,
    reviews,
    id: 'fake',
    label: 'Fake source',
    coverage: 'full',
    retentionDays: null,
    async searchBusinesses() {
      return [
        { placeId: `${tag}_bdg`, name: 'Klinik Uji — Bandung', address: 'Jl. Uji 1, Bandung', category: 'Klinik', rating: 4.6, totalReviews: 12, mapsUrl: 'https://maps.example/bdg' },
        { placeId: `${tag}_jkt`, name: 'Klinik Uji — Jakarta', address: 'Jl. Uji 2, Jakarta', category: 'Klinik', rating: 4.1, totalReviews: 80, mapsUrl: null },
      ];
    },
    async getBusiness(placeId) {
      return (await this.searchBusinesses()).find((b) => b.placeId === placeId) ?? null;
    },
    async fetchReviewsPage({ cursor }) {
      calls.pages += 1;
      if (fail) throw new Error('source down');
      const start = Number(cursor ?? 0);
      const page = this.reviews.slice(start, start + pageSize);
      const next = start + pageSize < this.reviews.length ? String(start + pageSize) : null;
      return { reviews: page, nextCursor: next };
    },
  };
}

// Newest first, as sources return them.
const REVIEWS = [
  { externalId: 'r12', reviewerName: 'Ani', rating: 5, date: day(70), text: 'Pelayanan ramah, dokter informatif' },
  { externalId: 'r11', reviewerName: 'Budi', rating: 2, date: day(65), text: 'Antri lama banget, waktu tunggu lama' },
  { externalId: 'r10', reviewerName: 'Citra', rating: 5, date: day(60), text: null },
  { externalId: 'r9', reviewerName: 'Dewi', rating: 5, date: day(50), text: 'Staff ramah dan tempat bersih' },
  { externalId: 'r9', reviewerName: 'Dewi', rating: 5, date: day(50), text: 'Staff ramah dan tempat bersih' }, // duplicate in the feed
  { externalId: 'r8', reviewerName: 'Eka', rating: 4, date: day(40), text: 'Pelayanan ramah, harga agak mahal' },
  { externalId: 'r7', reviewerName: 'Fajar', rating: 1, date: day(35), text: 'Waktu tunggu lama, staff tidak ramah' },
  { externalId: 'r6', reviewerName: 'Gita', rating: 5, date: day(30), text: 'Hasil treatment memuaskan, pelayanan ramah' },
  { externalId: 'r5', reviewerName: 'Hana', rating: 3, date: day(20), text: 'Biasa saja' },
  { externalId: 'r4', reviewerName: 'Indra', rating: 5, date: day(10), text: 'Dokter informatif dan sabar' },
];

function fakeModel(counter) {
  return async ({ task, prompt }) => {
    if (task === 'classify') {
      counter.classified += 1;
      const lines = prompt.split('\n').slice(1).map((l) => JSON.parse(l));
      counter.reviews += lines.length;
      return {
        model: 'fake-model',
        data: {
          results: lines.map((r) => {
            const t = r.text.toLowerCase();
            const complaints = [];
            const praises = [];
            if (t.includes('lama')) complaints.push('waktu tunggu lama');
            if (t.includes('mahal')) complaints.push('harga mahal');
            if (t.includes('tidak ramah')) complaints.push('staff tidak ramah');
            else if (t.includes('ramah')) praises.push('pelayanan ramah');
            if (t.includes('informatif')) praises.push('dokter informatif');
            const sentiment = complaints.length > praises.length ? 'negative' : praises.length ? 'positive' : 'neutral';
            return { id: r.id, sentiment, confidence: 0.9, language: 'id', praises, complaints };
          }),
        },
      };
    }
    counter.summaries += 1;
    return {
      model: 'fake-model',
      data: {
        topics: [
          { name: 'Keramahan', aspects: ['pelayanan ramah', 'staff tidak ramah'], insight: 'i' },
          { name: 'Waktu Tunggu', aspects: ['waktu tunggu lama'], insight: 'i' },
          { name: 'Parkir', aspects: ['parkir sempit'], insight: 'tidak ada bukti' },
        ],
        love: [{ title: 'Pelayanan ramah', detail: 'd', aspects: ['pelayanan ramah'], example_review_ids: ['999999'] }],
        improve: [{ title: 'Waktu tunggu', detail: 'd', aspects: ['waktu tunggu lama'], example_review_ids: [] }],
        executive: { overall: 'o', strengths: ['s'], complaints: ['c'], trend: 't', actions: [{ action: 'a', reason: 'r' }], limitations: ['l'] },
      },
    };
  };
}

async function runToEnd(service, businessId, mode) {
  let run = await service.startRun(businessId, { mode, method: 'ai' });
  for (let i = 0; i < 30 && run.status === 'running'; i += 1) run = await service.stepRun(run.id);
  return run;
}

test('Google Reviews pipeline against the database', { skip: !ENABLED && 'set GOOGLE_REVIEWS_IT=1 to run' }, async (t) => {
  const { default: pool } = await import('../src/config/db.js');
  const providers = await import('../src/services/googleReviews/providers/index.js');
  const llm = await import('../src/services/googleReviews/llm.js');
  const service = await import('../src/services/googleReviews/googleReviewsService.js');

  const source = makeSource([...REVIEWS]);
  const counter = { classified: 0, reviews: 0, summaries: 0 };
  providers.registerProviders({ search: source, reviews: source });
  llm.setModelForTests(fakeModel(counter));

  try {
    let business;
    await t.test('search lists similar names apart by Place ID', async () => {
      const results = await service.searchBusinesses('Klinik Uji', 1);
      assert.equal(results.length, 2);
      assert.notEqual(results[0].placeId, results[1].placeId);
      business = await service.selectBusiness(`${tag}_bdg`, null);
      assert.equal(business.name, 'Klinik Uji — Bandung');
      assert.equal(business.googleTotal, 12);
      const again = await service.searchBusinesses('Klinik Uji', 1);
      assert.equal(again.find((r) => r.placeId === `${tag}_bdg`).businessId, business.id);
      assert.equal(again.find((r) => r.placeId === `${tag}_jkt`).businessId, null);
    });

    await t.test('first run collects everything once, reads text reviews, summarises', async () => {
      const run = await runToEnd(service, business.id, 'incremental');
      assert.equal(run.status, 'done', run.error);
      assert.equal(run.mode, 'full', 'first run is always full');
      assert.equal(run.newReviews, 9, 'duplicate in the feed is stored once');
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM public.gr_reviews WHERE business_id = $1', [business.id]);
      assert.equal(rows[0].n, 9);
      assert.equal(counter.reviews, 8, 'the rating-only review is not sent to the model');
      assert.equal(counter.summaries, 1);
    });

    await t.test('dashboard: coverage, shares, topics backed by evidence', async () => {
      const d = await service.getDashboard(business.id, undefined, { method: 'ai' });
      assert.equal(d.coverage.googleTotal, 12);
      assert.equal(d.coverage.collected, 9);
      assert.equal(d.coverage.analyzed, 8);
      assert.equal(d.coverage.ratingOnly, 1);
      assert.equal(d.coverage.limited, true, '9 of 12 is a partial set');
      const sum = d.sentiment.items.reduce((a, i) => a + i.pct, 0);
      assert.equal(Math.round(sum * 10), 1000);
      assert.equal(d.sentiment.items.reduce((a, i) => a + i.count, 0), 8);
      assert.equal(d.ratings.rated, 9);
      assert.ok(!d.topics.some((x) => x.name === 'Parkir'), 'no topic without evidence');
      assert.equal(d.topics.find((x) => x.name === 'Waktu Tunggu').count, 2);
      assert.ok(d.love[0].examples.length > 0 && d.love[0].examples.every((e) => e.id !== 999999), 'made-up example ids are rejected');
      assert.ok(d.wordCloud.overall.length > 0);
      assert.ok(!d.wordCloud.overall.some((w) => /\b(ani|budi|dewi|klinik uji)\b/.test(w.term)));
      assert.equal(d.summary.stale, false);
    });

    await t.test('explorer filters, sorts and pages', async () => {
      const all = await service.listReviews(business.id, { method: 'ai',  pageSize: 5 });
      assert.equal(all.total, 9);
      assert.equal(all.pages, 2);
      assert.equal(all.items.length, 5);
      assert.equal(all.items[0].text, REVIEWS[0].text, 'newest first by default');
      const oldest = await service.listReviews(business.id, { method: 'ai',  sort: 'oldest' });
      assert.equal(oldest.items[0].text, 'Dokter informatif dan sabar');
      const neg = await service.listReviews(business.id, { method: 'ai',  sentiment: 'negative' });
      assert.ok(neg.items.every((r) => r.sentiment === 'negative') && neg.total === 2);
      const ro = await service.listReviews(business.id, { method: 'ai',  sentiment: 'rating_only' });
      assert.equal(ro.total, 1);
      const fives = await service.listReviews(business.id, { method: 'ai',  rating: '5' });
      assert.equal(fives.total, 5);
      const term = await service.listReviews(business.id, { method: 'ai',  term: 'pelayanan ramah' });
      assert.equal(term.total, 3);
      const topic = await service.listReviews(business.id, { method: 'ai',  topic: 'Waktu Tunggu' });
      assert.equal(topic.total, 2);
      const ranged = await service.listReviews(business.id, { method: 'ai',  from: day(30).slice(0, 10), to: day(50).slice(0, 10) });
      assert.equal(ranged.total, 4);
      const none = await service.listReviews(business.id, { method: 'ai',  q: 'zzzz-tidak-ada' });
      assert.equal(none.total, 0);
      assert.equal(none.items.length, 0);
    });

    await t.test('incremental refresh reads only what is new or edited', async () => {
      source.reviews.unshift({ externalId: 'r13', reviewerName: 'Joko', rating: 1, date: day(80), text: 'Waktu tunggu lama sekali' });
      const pagesBefore = source.calls.pages;
      const readBefore = counter.reviews;
      const run = await runToEnd(service, business.id, 'incremental');
      assert.equal(run.status, 'done', run.error);
      assert.equal(run.newReviews, 1);
      assert.equal(source.calls.pages - pagesBefore, 2, 'stops at the first page with nothing new');
      assert.equal(counter.reviews - readBefore, 1);
      assert.equal(counter.summaries, 2, 'dataset changed, so the summary is rebuilt');

      const unchanged = await runToEnd(service, business.id, 'incremental');
      assert.equal(unchanged.newReviews, 0);
      assert.equal(counter.summaries, 2, 'nothing changed, summary reused');
    });

    await t.test('a failing source is retried, then the run fails safely', async () => {
      const broken = makeSource([], { fail: true });
      providers.registerProviders({ reviews: broken });
      let run = await service.startRun(business.id, { mode: 'full' });
      for (let i = 0; i < 3; i += 1) {
        run = await service.stepRun(run.id);
        assert.equal(run.status, 'running');
        assert.match(run.error, /source down/);
      }
      run = await service.stepRun(run.id);
      assert.equal(run.status, 'failed');
      const d = await service.getDashboard(business.id, undefined, { method: 'ai' });
      assert.equal(d.coverage.collected, 10, 'collected data survives a failed refresh');
      providers.registerProviders({ reviews: source });
    });

    await t.test('a block from the source ends the run at once, without retries', async () => {
      let calls = 0;
      const blocked = {
        ...makeSource([]),
        async fetchReviewsPage() {
          calls += 1;
          throw Object.assign(new Error('Google meminta verifikasi CAPTCHA'), { fatal: true, statusCode: 503 });
        },
      };
      providers.registerProviders({ reviews: blocked });
      let run = await service.startRun(business.id, { mode: 'full' });
      run = await service.stepRun(run.id);
      assert.equal(run.status, 'failed');
      assert.match(run.error, /CAPTCHA/);
      assert.equal(calls, 1);
      providers.registerProviders({ reviews: source });
    });

    await t.test('limited source: phases, notice, approximate dates and fresh business info', async () => {
      const phases = [];
      const limited = {
        ...makeSource([]),
        id: 'limited',
        coverage: 'limited',
        coverageNote: 'Sumber terbatas.',
        retentionDays: 30,
        async fetchReviewsPage({ onProgress }) {
          for (const p of ['init', 'open', 'load', 'collect']) { onProgress?.(p); phases.push(p); }
          return {
            reviews: [
              { externalId: 'L1', rating: 5, date: day(40), datePrecision: 'month', text: 'Pelayanan ramah' },
              { externalId: 'L2', rating: 2, date: day(10), datePrecision: 'year', text: 'Waktu tunggu lama' },
            ],
            nextCursor: null,
            business: { name: 'Klinik Uji — Bandung', address: 'Jl. Uji 1, Bandung', category: 'Klinik', rating: 4.9, totalReviews: null },
            notice: 'Google Maps menampilkan 2 dari 12 ulasan.',
          };
        },
      };
      providers.registerProviders({ reviews: limited });
      const run = await runToEnd(service, business.id, 'full');
      assert.equal(run.status, 'done', run.error);
      assert.deepEqual(phases, ['init', 'open', 'load', 'collect']);
      assert.match(run.coverageNote, /2 dari 12/);
      assert.doesNotMatch(run.coverageNote, /Sumber terbatas/, 'the standing caveat is not repeated in the run note');
      const { rows } = await pool.query(
        "SELECT external_id, date_precision, expires_at IS NOT NULL AS expires FROM public.gr_reviews WHERE business_id = $1 AND source = 'limited' ORDER BY external_id",
        [business.id],
      );
      assert.deepEqual(rows.map((r) => [r.external_id, r.date_precision, r.expires]), [['L1', 'month', true], ['L2', 'year', true]]);
      const d = await service.getDashboard(business.id, undefined, { method: 'ai' });
      assert.match(d.coverage.sourceNote, /Sumber terbatas/);
      assert.ok(d.coverage.earliest < d.coverage.latest, 'earliest/latest sort by time');
      assert.equal(d.business.googleRating, 4.9, 'fresh rating from the visit');
      assert.equal(d.business.googleTotal, 12, 'a total the source could not read keeps the last known one');
      assert.ok(d.trend.imprecise >= 1, 'year-precise review stays out of the monthly trend');
      const listed = await service.listReviews(business.id, { method: 'ai',  q: 'Pelayanan ramah' });
      assert.ok(listed.items.some((r) => r.datePrecision === 'month'));

      // Read again unchanged: nothing new, no summary rebuild, dates kept.
      const { rows: before } = await pool.query("SELECT external_id, review_date FROM public.gr_reviews WHERE business_id = $1 AND source = 'limited' ORDER BY external_id", [business.id]);
      const again = await runToEnd(service, business.id, 'incremental');
      assert.equal(again.newReviews, 0);
      const { rows: after } = await pool.query("SELECT external_id, review_date FROM public.gr_reviews WHERE business_id = $1 AND source = 'limited' ORDER BY external_id", [business.id]);
      assert.deepEqual(after, before);
      providers.registerProviders({ reviews: source });
    });

    await t.test('one active run per business', async () => {
      const a = await service.startRun(business.id, {});
      const b = await service.startRun(business.id, {});
      assert.equal(a.id, b.id);
      const cancelled = await service.cancelRun(a.id);
      assert.equal(cancelled.status, 'cancelled');
    });
  } finally {
    llm.setModelForTests(null);
    providers.registerProviders({ search: null, reviews: null });
    await pool.query("DELETE FROM public.gr_businesses WHERE place_id LIKE $1", [`${tag}%`]);
    await pool.end();
  }
});
