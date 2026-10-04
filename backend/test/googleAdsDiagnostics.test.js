import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyKeyword, classifySearchTerm, searchTermSummary, diagnoseCampaigns, detectAnomalies, deviceInsights, scheduleInsights,
  landingPageInsights, messageMatch, adInsights, campaignBaselines, competitorTokens, qualityPatterns,
} from '../src/services/googleAdsDiagnostics.js';
import { normalizeKeywordQuality, normalizeLandingPageRow, normalizeHourRow, normalizeDeviceRow } from '../src/services/googleAdsDatasets.js';
import { withRatios } from '../src/services/googleAdsAnalytics.js';

const camp = (o) => withRatios({ customer_id: '1', campaign_id: 'c1', campaign_name: 'Search Bouquets', channel_type: 'SEARCH', cost: 1000, impressions: 20000, clicks: 500, conversions: 20, conversions_value: 4000, all_conversions: 25, active_days: 30, ...o });
const baseline = { cpa: 50, cvr: 0.04, source: 'campaign_average' };

// ── normalizers (041) ────────────────────────────────────────────────
test('Quality Score without a score stays null; components only take Google buckets', () => {
  const q = normalizeKeywordQuality({ adGroupId: 'g', criterionId: '7', qualityScore: null, adRelevance: 'below_average', expectedCtr: 'WEIRD' }, '2026-10-05');
  assert.equal(q.quality_score, null);
  assert.equal(q.ad_relevance, 'BELOW_AVERAGE');
  assert.equal(q.expected_ctr, null);
  assert.equal(q.snapshot_date, '2026-10-05');
  assert.equal(normalizeKeywordQuality({ adGroupId: 'g', criterionId: '7', qualityScore: 0 }, '2026-10-05').quality_score, null);
});

test('landing page metrics Google refused stay null; hours and devices are validated', () => {
  const lp = normalizeLandingPageRow({ date: '2026-09-01', url: 'https://x.my/bouquets', clicks: 10, conversions: null, unavailable: ['conversions'] });
  assert.equal(lp.conversions, null);
  assert.equal(lp.clicks, 10);
  assert.deepEqual(lp.unavailable, ['conversions']);
  assert.equal(normalizeHourRow({ date: '2026-09-01', campaignId: 'c', hour: 24 }), null);
  assert.equal(normalizeHourRow({ date: '2026-09-01', campaignId: 'c', hour: 0 }).hour, 0);
  assert.equal(normalizeDeviceRow({ date: '2026-09-01', campaignId: 'c', device: 'mobile' }).device, 'MOBILE');
  assert.equal(normalizeDeviceRow({ date: '2026-09-01', campaignId: 'c', device: 'FRIDGE' }), null);
});

// ── keywords ─────────────────────────────────────────────────────────
test('three clicks without a conversion is not a bad keyword', () => {
  assert.equal(classifyKeyword({ cost: 12, clicks: 3, impressions: 90, conversions: 0 }, baseline).classification, 'insufficient_data');
  // 25 clicks × 4% = 1 expected conversion, but spend is below one baseline CPA.
  assert.equal(classifyKeyword({ cost: 40, clicks: 25, impressions: 900, conversions: 0 }, baseline).classification, 'insufficient_data');
  assert.equal(classifyKeyword({ cost: 120, clicks: 60, impressions: 2000, conversions: 0 }, baseline).classification, 'no_conversion');
});

test('keyword classes follow CPA vs baseline, volume and lost impression share', () => {
  assert.equal(classifyKeyword({ cost: 40, clicks: 30, impressions: 900, conversions: 1 }, baseline).classification, 'high_potential', 'efficient, low volume');
  assert.equal(classifyKeyword({ cost: 200, clicks: 100, impressions: 3000, conversions: 5, search_lost_top_is_rank: 0.4 }, baseline).classification, 'high_potential', 'efficient, room to grow');
  assert.equal(classifyKeyword({ cost: 200, clicks: 100, impressions: 3000, conversions: 5, search_lost_top_is_rank: 0.1 }, baseline).classification, 'performing');
  assert.equal(classifyKeyword({ cost: 300, clicks: 100, impressions: 3000, conversions: 5 }, baseline).classification, 'performing', '1.2× baseline is within tolerance');
  assert.equal(classifyKeyword({ cost: 400, clicks: 100, impressions: 3000, conversions: 4 }, baseline).classification, 'underperforming');
});

test('Quality Score adds context and fixes, it never decides the class alone', () => {
  const k = classifyKeyword({ cost: 200, clicks: 100, impressions: 3000, conversions: 5, quality_score: 3, ad_relevance: 'BELOW_AVERAGE' }, baseline);
  assert.equal(k.classification, 'performing');
  assert.deepEqual(k.quality_flags, ['Quality Score 3', 'Ad relevance di bawah rata-rata']);
  assert.match(k.suggested_action, /headline/);
});

test('baselines: target CPA first, then the campaign, then the account', () => {
  const b = campaignBaselines([camp({}), camp({ campaign_id: 'c2', campaign_name: 'New', conversions: 0, cost: 50 })], [{ customer_id: '1', campaign_id: 'c1', target_cpa: 40 }]);
  assert.deepEqual(b.of({ customer_id: '1', campaign_id: 'c1' }).source, 'target_cpa');
  assert.equal(b.of({ customer_id: '1', campaign_id: 'c2' }).source, 'account_average');
  assert.equal(b.of({ campaign_name: 'search bouquets' }).cpa, 40, 'uploaded rows match by campaign name');
});

// ── search terms ─────────────────────────────────────────────────────
const ctx = {
  baselines: campaignBaselines([camp({})]),
  keywords: new Set(['florist kl']),
  competitors: competitorTokens(['bloomthis.co', 'petitefleur.com.my', 'flowerchimp.com.my'], ['petite', 'fleur', 'petitefleur']),
  ownTokens: ['petite', 'fleur', 'petitefleur'],
  locationsByCampaign: new Map([['search bouquets', ['kuala lumpur', 'selangor']]]),
  knownLocations: ['kuala lumpur', 'selangor', 'penang', 'johor bahru'],
};
const term = (search_term, o = {}) => ({ search_term, campaign_name: 'Search Bouquets', customer_id: '1', campaign_id: 'c1', match_type: 'BROAD', cost: 0, clicks: 0, impressions: 100, conversions: 0, ...o });

test('search term classes', () => {
  assert.deepEqual(competitorTokens(['bloomthis.co', 'petitefleur.com.my'], ['petitefleur']), ['bloomthis']);
  assert.equal(classifySearchTerm(term('cara merangkai bunga', { cost: 80, clicks: 30 }), ctx).classification, 'informational');
  assert.equal(classifySearchTerm(term('bloomthis bouquet', { cost: 80, clicks: 30 }), ctx).classification, 'competitor');
  assert.equal(classifySearchTerm(term('florist penang', { cost: 80, clicks: 30 }), ctx).classification, 'location_mismatch');
  assert.equal(classifySearchTerm(term('florist kuala lumpur', { cost: 80, clicks: 30 }), ctx).classification, 'potential_negative', 'targeted city is not a mismatch');
  assert.equal(classifySearchTerm(term('birthday bouquet delivery', { cost: 40, clicks: 20, conversions: 2 }), ctx).classification, 'new_keyword_opportunity');
  assert.equal(classifySearchTerm(term('florist kl', { cost: 40, clicks: 20, conversions: 2 }), ctx).classification, 'high_intent', 'already a keyword');
  assert.equal(classifySearchTerm(term('petite fleur kl', { cost: 300, clicks: 60 }), ctx).classification, 'monitoring', 'own brand is never a negative');
  assert.equal(classifySearchTerm(term('flowers', { cost: 10, clicks: 3 }), ctx).classification, 'monitoring', 'too little data');
  const conv = classifySearchTerm(term('cara pesan bunga online', { cost: 40, clicks: 20, conversions: 1 }), ctx);
  assert.equal(conv.classification, 'informational');
  assert.match(conv.reasons.join(' '), /jangan dijadikan negative/);
});

test('search term spend labels: observed, potentially irrelevant, confirmed unknown; coverage warning', () => {
  const classified = [
    classifySearchTerm(term('cara merangkai bunga', { cost: 80, clicks: 30 }), ctx),
    classifySearchTerm(term('bouquet murah', { cost: 20, clicks: 6 }), ctx),
    classifySearchTerm(term('birthday bouquet delivery', { cost: 40, clicks: 20, conversions: 2 }), ctx),
  ];
  const s = searchTermSummary(classified, 200);
  assert.equal(s.observed_no_conversion_spend, 100);
  assert.equal(s.potentially_irrelevant_spend, 80);
  assert.equal(s.confirmed_irrelevant_spend, null);
  assert.equal(s.coverage, 0.7);
  assert.match(s.coverage_warning, /70\.0%/);
  assert.deepEqual(s.negative_candidates.map((n) => n.text), ['cara merangkai bunga']);
});

// ── campaign diagnostics ─────────────────────────────────────────────
const period = (campaigns, days = 30) => ({
  campaigns, days,
  totals: withRatios(campaigns.reduce((a, c) => { for (const k of ['cost', 'impressions', 'clicks', 'conversions', 'conversions_value', 'all_conversions']) a[k] = (a[k] ?? 0) + c[k]; return a; }, {})),
});

test('bidding on conversions with none primary is a critical tracking finding (the Jakarta case)', () => {
  const c = camp({ conversions: 0, all_conversions: 55, conversions_value: 0 });
  const f = diagnoseCampaigns({ old: period([c]), cur: period([c]), settings: [{ customer_id: '1', campaign_id: 'c1', bidding_strategy_type: 'MAXIMIZE_CONVERSIONS', status: 'ENABLED' }] });
  const tracking = f.filter((x) => x.type === 'tracking_no_primary_conversion');
  assert.deepEqual(tracking.map((x) => x.entity_type).sort(), ['account', 'campaign']);
  assert.equal(tracking[0].severity, 'critical');
  assert.equal(f[0].severity, 'critical', 'sorted by severity');
});

test('CPA increase needs volume in both periods; changes in the period are context, not cause', () => {
  const old = camp({ cost: 1000, conversions: 20 });
  const cur = camp({ cost: 1600, conversions: 20 });
  const f = diagnoseCampaigns({ old: period([old]), cur: period([cur]), changes: [{ campaign_name: 'Search Bouquets', changed_at: '2026-09-12 10:00' }] });
  const cpa = f.find((x) => x.type === 'cpa_increase' && x.entity_type === 'campaign');
  assert.ok(cpa);
  assert.equal(cpa.severity, 'high');
  assert.equal(cpa.metrics.cost_per_conv.change, 0.6);
  assert.match(cpa.possible_causes.at(-1), /2026-09-12.*bukan bukti/);
  const small = diagnoseCampaigns({ old: period([camp({ conversions: 2, cost: 100 })]), cur: period([camp({ conversions: 2, cost: 300 })]) });
  assert.ok(!small.some((x) => x.type === 'cpa_increase'), 'two conversions are not enough');
});

test('budget-lost impression share: budget advice only with efficiency and volume, never from CPA alone', () => {
  const c = camp({ cost: 600, conversions: 20 });
  const f = diagnoseCampaigns({
    old: period([c]), cur: period([c]),
    competitive: [{ customer_id: '1', campaign_id: 'c1', search_budget_lost_is: 0.35, search_impression_share: 0.4, granularity: 'range' }],
  });
  const lost = f.find((x) => x.type === 'lost_is_budget');
  assert.equal(lost.severity, 'high');
  assert.match(lost.next_steps[0], /kualitas konversi dan target bisnis/);
});

test('budget underuse, and restrictive target when a target meets high rank-lost share', () => {
  const c = camp({ cost: 600, active_days: 30 });
  const base = { customer_id: '1', campaign_id: 'c1', status: 'ENABLED', budget_amount: 100 };
  const under = diagnoseCampaigns({ old: period([c]), cur: period([c]), settings: [base] });
  assert.ok(under.some((x) => x.type === 'budget_underused'));
  const tight = diagnoseCampaigns({ old: period([c]), cur: period([c]), settings: [{ ...base, target_cpa: 20 }], competitive: [{ customer_id: '1', campaign_id: 'c1', search_rank_lost_is: 0.5 }] });
  assert.ok(tight.some((x) => x.type === 'restrictive_target'));
});

test('conversions that stop on a campaign that usually converts', () => {
  const f = diagnoseCampaigns({ old: period([camp({ conversions: 12 })]), cur: period([camp({ conversions: 0, all_conversions: 0, clicks: 300 })]) });
  assert.ok(f.some((x) => x.type === 'conversions_stopped' && x.severity === 'critical'));
});

// ── anomalies ────────────────────────────────────────────────────────
const days = (from, n, fn) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return { date: d.toISOString().slice(0, 10), ...fn(i) };
});

test('a spend spike against its own weekday baseline is an anomaly; normal wobble is not', () => {
  const series = days('2026-08-01', 45, (i) => ({ cost: 100 + (i % 3) * 5, clicks: 50 + (i % 2) * 3, conversions: 5 + (i % 2) }));
  series[44].cost = 400;
  const { anomalies, status } = detectAnomalies(series, '2026-09-08', '2026-09-14');
  assert.equal(status, 'anomaly');
  assert.deepEqual(anomalies.map((a) => [a.date, a.metric, a.direction]), [['2026-09-14', 'cost', 'up'], ['2026-09-14', 'cpa', 'up']]);
  assert.equal(anomalies[0].baseline, 'same_weekday_4w');
});

test('anomalies: small baselines are skipped and short history is "monitoring"', () => {
  const tiny = days('2026-08-01', 45, () => ({ cost: 5, clicks: 2, conversions: 0 }));
  tiny[44].clicks = 9;
  assert.equal(detectAnomalies(tiny, '2026-09-14', '2026-09-14').anomalies.filter((a) => a.metric === 'clicks').length, 0);
  const short = days('2026-09-10', 4, () => ({ cost: 100, clicks: 50, conversions: 5 }));
  assert.equal(detectAnomalies(short, '2026-09-12', '2026-09-13').status, 'monitoring');
});

// ── devices, schedule, landing pages, message match, ads ─────────────
test('device view: shares, flags, and no bid-adjustment advice under Smart Bidding', () => {
  const rows = [
    { device: 'MOBILE', cost: 800, impressions: 10000, clicks: 400, conversions: 10, conversions_value: 0, all_conversions: 10 },
    { device: 'DESKTOP', cost: 200, impressions: 2000, clicks: 100, conversions: 10, conversions_value: 0, all_conversions: 10 },
  ];
  const d = deviceInsights(rows, [{ status: 'ENABLED', bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }]);
  assert.equal(d.devices[0].device, 'MOBILE');
  assert.equal(d.devices[0].cost_share, 0.8);
  assert.match(d.devices[0].flags[0], /CPA 1,6× rata-rata/);
  assert.match(d.bid_adjustment_note, /Smart Bidding/);
  assert.equal(deviceInsights(rows, [{ status: 'ENABLED', bidding_strategy_type: 'MANUAL_CPC' }]).bid_adjustment_note, null);
});

test('schedule: no ad schedule advice without enough data, but the grid is there', () => {
  const grid = [{ dow: 1, hour: 9, cost: 50, impressions: 900, clicks: 40, conversions: 2, conversions_value: 0, days: 4 }];
  const s = scheduleInsights(grid, 30);
  assert.equal(s.data_sufficient, false);
  assert.match(s.note, /Belum cukup data/);
  assert.equal(s.grid.length, 1);
});

test('landing pages: missing conversions are said, not invented', () => {
  const lp = landingPageInsights([{ url: 'https://x.my/a', clicks: 80, impressions: 1000, cost: 40, conversions: null, speed_score: 3 }]);
  assert.equal(lp.conversions_available, false);
  assert.equal(lp.pages[0].cvr, null);
  assert.deepEqual(lp.pages[0].flags, ['Speed score mobile 3/10']);
});

// Shaped like Petite Fleur KL on 2026-10-04: LP experience below average on
// most scored keywords, ad relevance on fewer, many keywords unscored.
test('a Quality Score component weak across most keyword spend is one account finding', () => {
  const kw = (quality_score, lpe, rel, cost) => ({ quality_score, landing_page_experience: lpe, ad_relevance: rel, expected_ctr: 'AVERAGE', cost, quality_date: '2026-10-04' });
  const keywords = [
    ...Array.from({ length: 8 }, () => kw(3, 'BELOW_AVERAGE', 'BELOW_AVERAGE', 30)),
    ...Array.from({ length: 6 }, () => kw(7, 'BELOW_AVERAGE', 'ABOVE_AVERAGE', 20)),
    ...Array.from({ length: 6 }, () => kw(8, 'AVERAGE', 'ABOVE_AVERAGE', 10)),
    ...Array.from({ length: 5 }, () => ({ quality_score: null, cost: 5 })),
  ];
  const f = qualityPatterns(keywords);
  assert.deepEqual(f.map((x) => x.type), ['quality_landing_page_experience', 'quality_ad_relevance']);
  assert.equal(f[0].severity, 'high', '360 of 420 cost = 86%');
  assert.match(f[0].facts[0], /14 dari 20 keyword/);
  assert.match(f[0].facts[1], /^5 keyword belum punya/);
  assert.equal(qualityPatterns(keywords.slice(0, 9)).length, 0, 'fewer than 10 scored keywords: no pattern claimed');
});

test('landing pages: the long tail is summed, totals still cover every page', () => {
  const rows = Array.from({ length: 130 }, (_, i) => ({ url: `https://x.my/p${i}`, clicks: 200 - i, impressions: 1000, cost: 1, conversions: null }));
  const lp = landingPageInsights(rows);
  assert.equal(lp.pages.length, 100);
  assert.equal(lp.pages[0].url, 'https://x.my/p0');
  assert.equal(lp.others.pages, 30);
  assert.equal(lp.totals.pages, 130);
  assert.equal(lp.totals.cost, 130);
  assert.equal(lp.totals.conversions, null, 'unavailable stays null in totals');
  assert.equal(lp.totals.clicks, lp.pages.reduce((a, p) => a + p.clicks, 0) + lp.others.clicks);
});

test('message match flags ad groups whose keyword spend is missing from headlines', () => {
  const keywords = [
    { customer_id: '1', ad_group_id: 'g1', ad_group_name: 'Dried', campaign_name: 'S', keyword: 'dried flowers', cost: 90 },
    { customer_id: '1', ad_group_id: 'g1', ad_group_name: 'Dried', campaign_name: 'S', keyword: 'florist kl', cost: 10 },
  ];
  const ok = messageMatch(keywords, [{ customer_id: '1', ad_group_id: 'g1', headlines: [{ text: 'Dried Flower Bouquets' }], final_urls: ['https://x.my/dried-flowers'] }]);
  assert.equal(ok[0].headline_match, 0.9);
  assert.equal(ok[0].flag, null);
  const bad = messageMatch(keywords, [{ customer_id: '1', ad_group_id: 'g1', headlines: [{ text: 'Fresh Roses Same Day' }], final_urls: ['https://x.my/'] }]);
  assert.equal(bad[0].headline_match, 0);
  assert.match(bad[0].flag, /headline/);
});

test('ad view compares ads within their ad group only', () => {
  const ads = [
    withRatios({ customer_id: '1', ad_group_id: 'g1', ad_id: 'a1', cost: 300, impressions: 5000, clicks: 100, conversions: 0, ad_strength: 'AVERAGE' }),
    withRatios({ customer_id: '1', ad_group_id: 'g1', ad_id: 'a2', cost: 200, impressions: 3000, clicks: 120, conversions: 6 }),
  ];
  const out = adInsights(ads);
  assert.ok(out[0].flags.includes('Biaya besar tanpa konversi dibanding iklan lain di ad group'));
  assert.ok(out[0].flags.includes('Ad strength AVERAGE'));
  assert.ok(out[1].flags.includes('CTR tertinggi di ad group'));
  assert.ok(out[1].flags.includes('CVR tertinggi di ad group'));
});
