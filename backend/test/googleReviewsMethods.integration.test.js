// Integration test: the two sentiment methods stay separate against the real
// database — no AI call on the code path, readings side by side, each view
// reading one method, AI unavailable without a key, engine-version re-reads.
// Opt-in: GOOGLE_REVIEWS_IT=1 node --test test/
// Reviews here are labelled TEST and built in code.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const ENABLED = process.env.GOOGLE_REVIEWS_IT === '1';
const tag = `__itmeth_${crypto.randomBytes(3).toString('hex')}`;

const REVIEWS = [
  { externalId: 'M1', rating: 5, date: '2026-09-01T03:00:00Z', text: 'TEST: pelayanannya sangat ramah dan tempatnya nyaman' },
  { externalId: 'M2', rating: 5, date: '2026-09-02T03:00:00Z', text: 'TEST: bagus banget, tapi antri lama sekali dan harganya mahal' },
  { externalId: 'M3', rating: 4, date: '2026-09-03T03:00:00Z', text: 'TEST: saya datang untuk konsultasi kemarin' },
  { externalId: 'M4', rating: 1, date: '2026-09-04T03:00:00Z', text: 'TEST: kecewa, staffnya jutek' },
  { externalId: 'M5', rating: 5, date: '2026-09-05T03:00:00Z', text: null },
];

function source(reviews) {
  return {
    id: 'fake_m', label: 'Fake', coverage: 'full', retentionDays: null,
    async searchBusinesses() { return [{ placeId: `${tag}_p`, name: `Klinik ${tag} (TEST)`, address: 'Jl. Uji', category: 'Klinik', rating: 4.5, totalReviews: 5 }]; },
    async getBusiness() { return (await this.searchBusinesses())[0]; },
    async fetchReviewsPage() { return { reviews, nextCursor: null }; },
  };
}

test('code-based and AI-based sentiment stay separate', { skip: !ENABLED && 'set GOOGLE_REVIEWS_IT=1 to run' }, async (t) => {
  const { default: pool } = await import('../src/config/db.js');
  const providers = await import('../src/services/googleReviews/providers/index.js');
  const llm = await import('../src/services/googleReviews/llm.js');
  const service = await import('../src/services/googleReviews/googleReviewsService.js');
  const { ENGINE_VERSION } = await import('../src/services/googleReviews/codeSentiment/engine.js');

  providers.registerProviders({ search: source(REVIEWS), reviews: source(REVIEWS) });
  const calls = { classify: 0, summary: 0 };
  // Every answer from this "model" is the opposite of the obvious reading,
  // so a code result that leaked from it would be visible.
  const aiModel = async ({ task, prompt }) => {
    if (task === 'classify') {
      calls.classify += 1;
      const lines = prompt.split('\n').slice(1).map((l) => JSON.parse(l));
      return { model: 'test-model', data: { results: lines.map((r) => ({ id: r.id, sentiment: 'neutral', confidence: 0.5, language: 'id', praises: [], complaints: [] })) } };
    }
    calls.summary += 1;
    return { model: 'test-model', data: { topics: [], love: [], improve: [], executive: { overall: 'AI (TEST)', strengths: [], complaints: [], trend: '', actions: [{ action: 'x', reason: 'y' }], limitations: [] } } };
  };
  const forbidden = async () => { throw new Error('AI was called on the code path'); };
  const drive = async (run) => { let r = run; for (let i = 0; i < 20 && r.status === 'running'; i += 1) r = await service.stepRun(r.id); return r; };
  const codeRows = async (id) => (await pool.query(
    "SELECT r.external_id, a.sentiment, a.engine_version, a.evidence FROM public.gr_review_analysis a JOIN public.gr_reviews r ON r.id = a.review_id WHERE r.business_id = $1 AND a.method = 'code' ORDER BY r.external_id", [id],
  )).rows;

  try {
    const business = await service.selectBusiness(`${tag}_p`, null);

    await t.test('collect + code-based run: no AI call at all, and code is the default', async () => {
      llm.setModelForTests(forbidden);
      const run = await drive(await service.startRun(business.id, { mode: 'full' }));
      assert.equal(run.status, 'done', run.error);
      assert.equal(run.method, 'code');
      const rows = await codeRows(business.id);
      assert.deepEqual(rows.map((r) => r.sentiment), ['positive', 'negative', 'neutral', 'negative', 'rating_only']);
      assert.ok(rows.every((r) => r.engine_version === ENGINE_VERSION));
      const d = await service.getDashboard(business.id);
      assert.equal(d.analysis.method, 'code');
      assert.deepEqual(d.sentiment.items.map((i) => i.count), [1, 1, 2]);
      assert.equal(d.sentiment.ratingOnly, 1, 'rating-only never judged by its stars');
      assert.equal(d.summary.method, 'code');
      assert.deepEqual(d.summary.executive.actions, []);
      assert.ok(d.topics.some((x) => x.name === 'Kecepatan & Waktu Tunggu'));
      assert.equal(d.dataSource.analysis.status, 'done');
    });

    await t.test('AI disabled: the AI view says unavailable, AI runs are refused, code still works', async () => {
      llm.setModelForTests(null);
      const ai = await service.getDashboard(business.id, undefined, { method: 'ai' });
      assert.equal(ai.analysis.methods.ai.available, false);
      assert.equal(ai.sentiment.analyzed, 0, 'no code result shown as AI');
      assert.equal(ai.summary, null);
      await assert.rejects(service.startAnalysis(business.id, null, 'ai'), /tidak tersedia/);
      const again = await drive(await service.startAnalysis(business.id, null, 'code'));
      assert.equal(again.status, 'done');
      assert.equal(again.toAnalyze, 0, 'nothing new for code: cached');
    });

    await t.test('AI run alongside: both readings kept, never mixed', async () => {
      llm.setModelForTests(aiModel);
      const run = await drive(await service.startAnalysis(business.id, null, 'ai'));
      assert.equal(run.status, 'done', run.error);
      assert.equal(calls.classify, 1, 'one batch for four text reviews');
      const { rows } = await pool.query(
        'SELECT a.method, count(*)::int AS n FROM public.gr_review_analysis a JOIN public.gr_reviews r ON r.id = a.review_id WHERE r.business_id = $1 GROUP BY a.method ORDER BY a.method',
        [business.id],
      );
      assert.deepEqual(rows, [{ method: 'ai', n: 5 }, { method: 'code', n: 5 }]);
      const ai = await service.getDashboard(business.id, undefined, { method: 'ai' });
      const code = await service.getDashboard(business.id, undefined, { method: 'code' });
      assert.deepEqual(ai.sentiment.items.map((i) => i.count), [0, 4, 0], 'AI view: only AI readings');
      assert.deepEqual(code.sentiment.items.map((i) => i.count), [1, 1, 2], 'code view unchanged by the AI run');
      assert.equal(ai.summary.executive.overall, 'AI (TEST)');
      assert.notEqual(code.summary.executive.overall, 'AI (TEST)');
      assert.equal(code.analysis.methods.ai.readings, 5);
      assert.equal(code.analysis.methods.code.readings, 5);
      // Explorer and trend follow the method too.
      const exAi = await service.listReviews(business.id, { method: 'ai', sentiment: 'neutral' });
      const exCode = await service.listReviews(business.id, { method: 'code', sentiment: 'neutral' });
      assert.equal(exAi.total, 4);
      assert.equal(exCode.total, 1, 'code reads only M3 as neutral');
      assert.ok(exCode.items.every((r) => r.evidence), 'code readings carry their evidence label');
      const trAi = await service.getTrend(business.id, { method: 'ai' });
      assert.equal(trAi.points.reduce((a, p) => a + p.neutral, 0), 4);
    });

    await t.test('no re-read when nothing changed; an edited review is re-read by each method only when run', async () => {
      calls.classify = 0;
      llm.setModelForTests(forbidden);
      const code = await drive(await service.startAnalysis(business.id, null, 'code'));
      assert.equal(code.toAnalyze, 0);
      REVIEWS[2].text = 'TEST: saya datang untuk konsultasi kemarin, dokternya ramah sekali';
      const refresh = await drive(await service.startRun(business.id, { mode: 'full', method: 'code' }));
      assert.equal(refresh.status, 'done', refresh.error);
      assert.equal(refresh.toAnalyze, 1, 'only the edited review');
      const rows = await codeRows(business.id);
      assert.equal(rows.find((r) => r.external_id === 'M3').sentiment, 'positive');
      // The AI view now shows that review as waiting, not with the code result.
      const ai = await service.getDashboard(business.id, undefined, { method: 'ai' });
      assert.equal(ai.sentiment.pending, 1);
      assert.equal(ai.dataSource.analysis.status, 'pending');
      llm.setModelForTests(aiModel);
      const aiRun = await drive(await service.startAnalysis(business.id, null, 'ai'));
      assert.equal(aiRun.toAnalyze, 1);
      assert.equal(calls.classify, 1);
    });

    await t.test('a new code engine version re-reads code readings only', async () => {
      await pool.query(
        "UPDATE public.gr_review_analysis a SET engine_version = 'code-0.0.1' FROM public.gr_reviews r WHERE r.id = a.review_id AND r.business_id = $1 AND a.method = 'code'",
        [business.id],
      );
      const d = await service.getDashboard(business.id);
      assert.equal(d.dataSource.analysis.status, 'not_run', 'old-engine readings are not shown as current');
      calls.classify = 0;
      llm.setModelForTests(forbidden);
      const run = await drive(await service.startAnalysis(business.id, null, 'code'));
      assert.equal(run.toAnalyze, 5);
      assert.ok((await codeRows(business.id)).every((r) => r.engine_version === ENGINE_VERSION));
      llm.setModelForTests(aiModel);
      const ai = await drive(await service.startAnalysis(business.id, null, 'ai'));
      assert.equal(ai.toAnalyze, 0, 'AI readings untouched by a code engine change');
    });
  } finally {
    llm.setModelForTests(null);
    providers.registerProviders({ search: null, reviews: null });
    await pool.query('DELETE FROM public.gr_businesses WHERE place_id LIKE $1', [`${tag}%`]);
    await pool.end();
  }
});
