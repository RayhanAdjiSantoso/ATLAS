import test from 'node:test';
import assert from 'node:assert/strict';
import { planJobs, reconcileCheckpoints, runCovers } from '../src/services/googleAdsService.js';
import {
  normalizeCompetitiveRow, normalizeCampaignSetting, normalizeAdAsset, normalizeConversionRow, normalizeDatasetResults, idFrom,
} from '../src/services/googleAdsDatasets.js';
import {
  safeDiv, withRatios, pctChange, ppChange, classifyActions, goalTotals, campaignGoals, costPerGoal, periodShares, defaultGoal, contentHash,
} from '../src/services/googleAdsAnalytics.js';

// ── planJobs ──────────────────────────────────────────────────────────
const account = (o = {}) => ({
  id: 1, brand_id: 7, customer_id: '8269631235', backfill_from: '2026-08-01',
  resync_from: null, resync_to: null, resync_requested_at: null, ...o,
});
const run = (start_date, end_date, started_at, o = {}) => ({ customer_id: '8269631235', start_date, end_date, started_at, datasets: null, dataset_results: {}, ...o });
const months = (jobs) => jobs.map((j) => `${j.startDate}..${j.endDate}`);

test('legacy fetcher (no datasets declared) gets core-only jobs without a datasets field', () => {
  const { jobs } = planJobs([account()], [], '2026-10-04');
  assert.deepEqual(months(jobs), ['2026-10-01..2026-10-03', '2026-09-01..2026-09-30', '2026-08-01..2026-08-31']);
  assert.ok(jobs.every((j) => !('datasets' in j)));
  assert.deepEqual(jobs.map((j) => j.reason), ['current', 'backfill', 'backfill']);
});

test('a finished month is re-fetched at each reconcile checkpoint, not daily', () => {
  // September fetched on Oct 3 (day 3 after its end) — covered until day 30.
  const runs = [
    run('2026-09-01', '2026-09-30', '2026-10-03T18:00:00Z'),
    run('2026-08-01', '2026-08-31', '2026-10-03T18:00:00Z'),
  ];
  const oct10 = planJobs([account()], runs, '2026-10-10').jobs;
  assert.deepEqual(months(oct10), ['2026-10-01..2026-10-09'], 'September settled at day 3, August past day 30');
  const oct30 = planJobs([account()], runs, '2026-10-30').jobs;
  assert.deepEqual(months(oct30), ['2026-10-01..2026-10-29', '2026-09-01..2026-09-30'], 'day 30 checkpoint for September');
  const afterRecon = planJobs([account()], [...runs, run('2026-09-01', '2026-09-30', '2026-10-30T18:00:00Z')], '2026-11-02').jobs;
  assert.ok(!months(afterRecon).includes('2026-09-01..2026-09-30'));
});

test('before the first checkpoint last month is re-fetched every day (old behaviour)', () => {
  const runs = [run('2026-09-01', '2026-09-30', '2026-10-01T18:00:00Z')];
  const jobs = planJobs([account()], runs, '2026-10-02').jobs;
  assert.ok(months(jobs).includes('2026-09-01..2026-09-30'));
});

test('custom checkpoints from GOOGLE_ADS_RECONCILE_DAYS', () => {
  assert.deepEqual(reconcileCheckpoints('30, 3,90'), [3, 30, 90]);
  assert.deepEqual(reconcileCheckpoints(''), [3, 30]);
  assert.deepEqual(reconcileCheckpoints('x,-1'), [3, 30]);
});

test('declared datasets: months fetched by the old script only need the new datasets', () => {
  const runs = [
    run('2026-10-01', '2026-10-03', '2026-10-04T01:00:00Z'),
    run('2026-09-01', '2026-09-30', '2026-10-03T18:00:00Z'),
  ];
  const { jobs } = planJobs([account({ backfill_from: '2026-09-01' })], runs, '2026-10-04', { datasets: ['core', 'ads', 'conversions'] });
  assert.deepEqual(jobs.map((j) => j.datasets), [['ads', 'conversions'], ['ads', 'conversions']]);
  assert.equal(jobs[1].reason, 'backfill');
});

test('a dataset that failed is planned again on its own; one that worked is not', () => {
  const runs = [run('2026-09-01', '2026-09-30', '2026-10-03T18:00:00Z', {
    datasets: ['core', 'ads', 'competitive', 'campaign_settings'],
    dataset_results: { core: { status: 'success' }, ads: { status: 'success' }, competitive: { status: 'failed' } },
  })];
  const { jobs } = planJobs([account({ backfill_from: '2026-09-01' })], runs, '2026-10-10', { datasets: ['core', 'ads', 'competitive'] });
  const sep = jobs.find((j) => j.startDate === '2026-09-01');
  assert.deepEqual(sep.datasets, ['competitive']);
});

test('runCovers reads old runs as core-only', () => {
  assert.equal(runCovers({ datasets: null }, 'core'), true);
  assert.equal(runCovers({ datasets: null }, 'ads'), false);
  assert.equal(runCovers({ datasets: ['core', 'ads'], dataset_results: {} }, 'core'), true);
  assert.equal(runCovers({ datasets: ['core', 'ads'], dataset_results: {} }, 'ads'), false);
  assert.equal(runCovers({ datasets: ['core', 'ads'], dataset_results: { ads: { status: 'skipped' } } }, 'ads'), false);
});

test('resync is cleared only once every declared dataset was re-fetched after the request', () => {
  const acc = account({ backfill_from: '2026-09-01', resync_from: '2026-09-01', resync_to: '2026-09-30', resync_requested_at: '2026-10-05T00:00:00Z' });
  const coreOnly = run('2026-09-01', '2026-09-30', '2026-10-06T01:00:00Z', { datasets: ['core'], dataset_results: { core: { status: 'success' } } });
  const r1 = planJobs([acc], [coreOnly], '2026-10-07', { datasets: ['core', 'ads'] });
  assert.deepEqual(r1.resyncDone, []);
  assert.deepEqual(r1.jobs.find((j) => j.startDate === '2026-09-01').datasets, ['ads']);
  assert.equal(r1.jobs.find((j) => j.startDate === '2026-09-01').reason, 'resync');
  const both = run('2026-09-01', '2026-09-30', '2026-10-07T01:00:00Z', { datasets: ['core', 'ads'], dataset_results: { core: { status: 'success' }, ads: { status: 'success' } } });
  assert.deepEqual(planJobs([acc], [coreOnly, both], '2026-10-08', { datasets: ['core', 'ads'] }).resyncDone, [1]);
});

// ── normalizers ───────────────────────────────────────────────────────
test('competitive rows: shares outside 0..1 and daily rows below campaign level are dropped', () => {
  const day = normalizeCompetitiveRow({ level: 'campaign', granularity: 'day', date: '2026-09-02', campaignId: '1', searchImpressionShare: 0.42, searchBudgetLostIs: 1.7, impressions: 100 });
  assert.equal(day.search_impression_share, 0.42);
  assert.equal(day.search_budget_lost_is, null);
  assert.equal(day.search_rank_lost_is, null, 'missing stays null, not 0');
  assert.equal(normalizeCompetitiveRow({ level: 'keyword', granularity: 'day', date: '2026-09-02' }), null);
  const range = normalizeCompetitiveRow({ level: 'keyword', granularity: 'range', startDate: '2026-09-01', endDate: '2026-09-30', criterionId: '55', keyword: 'bunga' });
  assert.equal(range.start_date, '2026-09-01');
  assert.equal(range.criterion_id, '55');
});

test('campaign settings: unused targets stay null, "no end date" is null, hash ignores key order', () => {
  const a = normalizeCampaignSetting({ campaignId: '9', biddingStrategyType: 'MAXIMIZE_CONVERSIONS', targetCpa: 0, endDate: '2037-12-30', startDate: '2026-01-05 00:00:00', locationsIncluded: ['Kuala Lumpur', 'Selangor'] });
  assert.equal(a.target_cpa, null);
  assert.equal(a.end_date, null);
  assert.equal(a.start_date, '2026-01-05');
  const b = normalizeCampaignSetting({ locationsIncluded: ['Selangor', 'Kuala Lumpur'], startDate: '2026-01-05', endDate: '2037-12-30', targetCpa: null, biddingStrategyType: 'MAXIMIZE_CONVERSIONS', campaignId: '9' });
  assert.equal(a.settings_hash, b.settings_hash);
  const c = normalizeCampaignSetting({ campaignId: '9', biddingStrategyType: 'MAXIMIZE_CONVERSIONS', targetCpa: 25, startDate: '2026-01-05', locationsIncluded: ['Kuala Lumpur', 'Selangor'] });
  assert.notEqual(a.settings_hash, c.settings_hash);
  assert.equal(normalizeCampaignSetting({ campaignId: '9' }).conversion_goals, null, 'unread goals stay unknown');
  assert.deepEqual(normalizeCampaignSetting({ campaignId: '9', conversionGoals: [] }).conversion_goals, []);
});

test('ad assets: a performance-label change is not a copy change', () => {
  const base = { adGroupId: '1', adId: '2', headlines: [{ text: 'Fresh Flowers KL', pinned: 'HEADLINE_1', label: 'GOOD' }], descriptions: [{ text: 'Same-day delivery' }] };
  const relabelled = { ...base, headlines: [{ text: 'Fresh Flowers KL', pinned: 'HEADLINE_1', label: 'BEST' }], adStrength: 'EXCELLENT' };
  const edited = { ...base, headlines: [{ text: 'Fresh Flowers Delivery KL', pinned: 'HEADLINE_1' }] };
  assert.equal(normalizeAdAsset(base).content_hash, normalizeAdAsset(relabelled).content_hash);
  assert.notEqual(normalizeAdAsset(base).content_hash, normalizeAdAsset(edited).content_hash);
});

test('conversion rows take the action id from a resource name', () => {
  assert.equal(idFrom('customers/123/conversionActions/456'), '456');
  const r = normalizeConversionRow({ date: '2026-09-01', campaignId: '1', conversionActionId: 'customers/1/conversionActions/77', conversions: '1.5' });
  assert.equal(r.conversion_action_id, '77');
  assert.equal(r.conversions, 1.5, 'fractional conversions kept');
});

test('dataset results: only declared datasets with known statuses count', () => {
  const out = normalizeDatasetResults({
    ads: { status: 'success', rowCount: 12.4 },
    competitive: { status: 'success', rowCount: 3, levels: ['campaign', 'bogus'] },
    keyword_quality: { status: 'success' },
    conversions: { status: 'done' },
  }, ['core', 'ads', 'competitive', 'conversions']);
  assert.deepEqual(Object.keys(out), ['ads', 'competitive']);
  assert.equal(out.ads.rowCount, 12);
  assert.deepEqual(out.competitive.levels, ['campaign']);
});

// ── analytics ─────────────────────────────────────────────────────────
test('ratios: division by zero is null, never Infinity', () => {
  assert.equal(safeDiv(5, 0), null);
  assert.equal(safeDiv(null, 2), 0);
  const r = withRatios({ cost: 100, impressions: 0, clicks: 0, conversions: 0, conversions_value: 0 });
  assert.equal(r.ctr, null);
  assert.equal(r.avg_cpc, null);
  assert.equal(r.cost_per_conv, null);
  assert.equal(r.roas, 0);
  const s = withRatios({ cost: 50, impressions: 2000, clicks: 40, conversions: 2.5, conversions_value: 300 });
  assert.equal(s.ctr, 0.02);
  assert.equal(s.avg_cpm, 25);
  assert.equal(s.cost_per_conv, 20);
  assert.equal(s.cvr, 0.0625);
  assert.equal(s.roas, 6);
});

test('changes: growth from zero is flagged, not infinite; shares compare in points', () => {
  assert.deepEqual(pctChange(0, 10), { value: null, fromZero: true });
  assert.deepEqual(pctChange(0, 0), { value: null, fromZero: false });
  assert.equal(pctChange(200, 150).value, -0.25);
  assert.ok(Math.abs(ppChange(0.42, 0.5) - 8) < 1e-9);
});

const conv = (campaign_id, conversion_action_id, category, conversions, all_conversions = conversions, conversions_value = 0) => ({
  customer_id: '1', campaign_id, conversion_action_id, conversion_action_name: `a${conversion_action_id}`, conversion_category: category,
  conversions, all_conversions, conversions_value, all_conversions_value: conversions_value,
});

test('purchase and lead stay apart; a manual mapping wins over the category default', () => {
  const rows = [conv('c1', '10', 'PURCHASE', 4, 4, 800), conv('c2', '20', 'CONTACT', 6), conv('c2', '30', 'ADD_TO_CART', 0, 40)];
  const classified = classifyActions(rows, [{ customer_id: '1', conversion_action_id: '30', include_in_conversions: false, category: 'ADD_TO_CART' }],
    [{ customer_id: '1', conversion_action_id: '20', goal: 'lead' }]);
  assert.deepEqual(classified.map((c) => [c.goal, c.goal_source]), [['purchase', 'default'], ['lead', 'manual'], ['micro', 'default']]);
  assert.equal(classified[2].primary, false, 'secondary action');
  const totals = goalTotals(classified);
  assert.equal(totals.purchase.conversions, 4);
  assert.equal(totals.lead.conversions, 6);
  assert.equal(totals.micro.conversions, 0);
  assert.equal(totals.micro.all_conversions, 40, 'secondary actions only show in all conversions');
  assert.equal(totals.purchase.unverified, 1);
  assert.equal(defaultGoal('SOMETHING_NEW'), 'other');
});

test('campaign goal comes from bidding first, then from its conversions; cost per result has both views', () => {
  const classified = classifyActions([conv('c1', '10', 'PURCHASE', 4, 4, 800), conv('c2', '20', 'CONTACT', 6), conv('c2', '10', 'PURCHASE', 1, 1, 100)]);
  const goals = campaignGoals(classified, [{ customer_id: '1', campaign_id: 'c1', conversion_goals: [{ category: 'PURCHASE', biddable: true }] }]);
  assert.deepEqual(goals.get('1|c1'), { goal: 'purchase', source: 'bidding' });
  assert.deepEqual(goals.get('1|c2'), { goal: 'lead', source: 'conversions' });
  const campaigns = [{ customer_id: '1', campaign_id: 'c1', cost: 200 }, { customer_id: '1', campaign_id: 'c2', cost: 300 }];
  const p = costPerGoal('purchase', campaigns, classified, goals);
  assert.equal(p.results, 5);
  assert.equal(p.blended_cost_per_result, 100);
  assert.equal(p.focus_cost_per_result, 50);
  assert.equal(p.focus_roas, 4);
  const l = costPerGoal('lead', campaigns, classified, goals);
  assert.equal(l.focus_cost_per_result, 50);
  assert.equal(l.blended_roas, null, 'no ROAS for leads');
  assert.equal(costPerGoal('micro', campaigns, classified, goals).blended_cost_per_result, null);
});

test('impression share: Google range value wins; daily values are weighted by eligible impressions', () => {
  const exact = periodShares({ rangeRow: { search_impression_share: '0.5', search_budget_lost_is: null } });
  assert.equal(exact.granularity, 'range');
  assert.equal(exact.search_impression_share, 0.5);
  assert.equal(exact.search_budget_lost_is, null);
  // Day 1: 100 impr at 50% -> 200 eligible. Day 2: 300 impr at 25% -> 1200 eligible.
  // Period share = 400 / 1400, not the 37.5% plain average.
  const est = periodShares({ dayRows: [
    { impressions: 100, search_impression_share: 0.5, search_budget_lost_is: 0.1 },
    { impressions: 300, search_impression_share: 0.25, search_budget_lost_is: 0.6 },
  ] });
  assert.equal(est.granularity, 'daily_estimate');
  assert.ok(Math.abs(est.search_impression_share - 400 / 1400) < 1e-9);
  assert.ok(Math.abs(est.search_budget_lost_is - (0.1 * 200 + 0.6 * 1200) / 1400) < 1e-9);
  assert.equal(periodShares({ dayRows: [{ impressions: 0, search_impression_share: null }] }).granularity, 'unavailable');
});

test('content hash is stable under key order and ignores listed fields', () => {
  assert.equal(contentHash({ a: 1, b: { c: 2, d: 3 } }), contentHash({ b: { d: 3, c: 2 }, a: 1 }));
  assert.equal(contentHash({ a: 1, t: 5 }, ['t']), contentHash({ a: 1, t: 9 }, ['t']));
});
