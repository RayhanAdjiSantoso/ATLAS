import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileStatus, worstStatus, trackingHealth, accountHealth } from '../src/services/googleAdsQuality.js';
import { scoreConfidence, diagnoseCampaigns, landingPageQuality, detectAnomalies } from '../src/services/googleAdsDiagnostics.js';
import { volumeTier, cooldownDays, RULESET_VERSION, CALIBRATION_LOG } from '../src/services/googleAdsRules.js';
import { withRatios } from '../src/services/googleAdsAnalytics.js';

test('reconciliation uses tolerances instead of demanding exact totals', () => {
  assert.equal(reconcileStatus(1000, 1000).level, 'exact');
  assert.equal(reconcileStatus(1000, 998.5).status, 'VALID', '0.15%: reporting variance');
  assert.equal(reconcileStatus(1000, 998.5).level, 'reporting_variance');
  assert.equal(reconcileStatus(1000, 970).status, 'UNVERIFIED', '3%: warning');
  assert.equal(reconcileStatus(1000, 900).status, 'INCONSISTENT', '10%: critical');
  assert.equal(reconcileStatus(0, 0).status, 'VALID');
  assert.equal(reconcileStatus(0, 5).status, 'UNVERIFIED');
  assert.equal(worstStatus(['VALID', 'PARTIAL', 'UNVERIFIED']), 'PARTIAL');
  assert.equal(worstStatus(['VALID', 'MISSING', 'INCONSISTENT']), 'MISSING');
});

const camp = (o) => withRatios({ customer_id: '1', campaign_id: 'c1', campaign_name: 'Search', cost: 900, impressions: 20000, clicks: 500, conversions: 20, conversions_value: 0, all_conversions: 25, active_days: 30, ...o });

test('Case 1 (JKT): Smart Bidding without primary conversions scores tracking as unhealthy', () => {
  const t = trackingHealth({
    campaigns: [camp({ conversions: 0, all_conversions: 55 })],
    settings: [{ customer_id: '1', campaign_id: 'c1', bidding_strategy_type: 'MAXIMIZE_CONVERSIONS' }],
    actions: [{ include_in_conversions: false, status: 'ENABLED', last_seen_at: new Date().toISOString() }], unverified: 2,
  });
  assert.equal(t.campaigns[0].score, 40);
  assert.equal(t.campaigns[0].healthy, false);
  assert.match(t.campaigns[0].deductions.map((d) => d.reason).join(' '), /MAXIMIZE_CONVERSIONS tanpa satu pun primary conversion/);
  assert.equal(t.account.healthy, false);
  assert.equal(t.map.get('account').healthy, false);
});

test('tracking health: inactive primary actions, silence in the last 7 days, stale metadata', () => {
  const old = new Date(Date.now() - 5 * 864e5).toISOString();
  const t = trackingHealth({
    campaigns: [camp({})], settings: [{ customer_id: '1', campaign_id: 'c1', bidding_strategy_type: 'MANUAL_CPC' }],
    actions: [{ include_in_conversions: true, status: 'REMOVED', last_seen_at: old }], recent: new Map([['1|c1', 0]]),
  });
  const reasons = t.campaigns[0].deductions.map((d) => d.reason);
  assert.equal(t.campaigns[0].score, 100 - 30 - 10 - 10);
  assert.ok(reasons.some((r) => /tidak aktif/.test(r)) && reasons.some((r) => /7 hari/.test(r)) && reasons.some((r) => /48 jam/.test(r)));
  assert.equal(trackingHealth({ campaigns: [camp({})], settings: [], actions: [] }).account.score, 100, 'nothing fired: healthy');
});

test('account health is a weighted summary with its breakdown', () => {
  const h = accountHealth({
    tracking: { account: { score: 40 } },
    freshnessMap: { campaign: { kind: 'daily', status: 'VALID' }, devices: { kind: 'daily', status: 'STALE' } },
    runs: [{ status: 'success' }, { status: 'success' }, { status: 'failed' }, { status: 'success' }],
    unverified: 1, actions: 4, findings: [{ severity: 'critical', status: 'diagnosis' }, { severity: 'high', status: 'monitoring' }],
    alerts: [{ severity: 'critical', status: 'open' }],
  });
  assert.deepEqual(h.parts, { tracking: 40, freshness: 50, sync: 75, configuration: 75, diagnostics: 60, alerts: 50 });
  assert.equal(h.score, Math.round(40 * 0.3 + 50 * 0.15 + 75 * 0.15 + 75 * 0.1 + 60 * 0.2 + 50 * 0.1));
  assert.equal(h.label, 'Bermasalah');
});

test('confidence: volume first, then data quality, tracking, campaign age and overlapping changes', () => {
  assert.equal(volumeTier(2), 'low');
  assert.equal(volumeTier(12), 'medium');
  assert.equal(volumeTier(40), 'high');
  assert.equal(scoreConfidence({ conversions: 40 }).level, 'high');
  // CPA up 30% on 2 conversions in a 5-day-old campaign: low.
  const thin = scoreConfidence({ conversions: 2, newCampaignDays: 5 });
  assert.equal(thin.level, 'low');
  assert.ok(thin.reasons.some((r) => /Campaign baru berjalan 5 hari/.test(r)));
  const broken = scoreConfidence({ conversions: 40, trackingUnhealthy: true, dataQualityIssue: 'Konversi per action tidak cocok' });
  assert.equal(broken.score, 85 - 25 - 20);
  assert.equal(scoreConfidence({ clicks: 2000, conversionBased: false, trackingUnhealthy: true }).level, 'high', 'click findings do not depend on tracking');
});

const period = (campaigns, days = 30) => ({
  campaigns, days,
  totals: withRatios(campaigns.reduce((a, c) => { for (const k of ['cost', 'impressions', 'clicks', 'conversions', 'conversions_value', 'all_conversions']) a[k] = (a[k] ?? 0) + c[k]; return a; }, {})),
});

test('low-volume findings become "monitoring" with no action; tracking stays critical', () => {
  const old = camp({ conversions: 6, cost: 300 });
  const cur = camp({ conversions: 6, cost: 600, active_days: 8 });
  const settings = [{ customer_id: '1', campaign_id: 'c1', start_date: '2026-09-20', bidding_strategy_type: 'MAXIMIZE_CONVERSIONS', status: 'ENABLED' }];
  const f = diagnoseCampaigns({ old: period([old]), cur: period([cur]), settings, curEnd: '2026-09-30' }).find((x) => x.type === 'cpa_increase' && x.entity_type === 'campaign');
  assert.equal(f.status, 'monitoring', 'new campaign (11 days) with 6 conversions');
  assert.equal(f.severity, 'low');
  assert.match(f.next_steps[0], /Pantau/);
  assert.equal(f.ruleset_version, RULESET_VERSION);
  const jkt = diagnoseCampaigns({ old: period([camp({ conversions: 0, all_conversions: 40 })]), cur: period([camp({ conversions: 0, all_conversions: 55 })]), settings });
  const t = jkt.find((x) => x.type === 'tracking_no_primary_conversion' && x.entity_type === 'campaign');
  assert.deepEqual([t.severity, t.status], ['critical', 'diagnosis']);
});

test('per-rule minimums: no CPA, CVR or CTR finding on thin samples', () => {
  const thin = diagnoseCampaigns({ old: period([camp({ conversions: 2, clicks: 60, impressions: 600, cost: 100 })]), cur: period([camp({ conversions: 2, clicks: 60, impressions: 600, cost: 300 })]) });
  assert.ok(!thin.some((x) => ['cpa_increase', 'cvr_drop', 'ctr_drop', 'cpc_increase'].includes(x.type)));
  const stopped = diagnoseCampaigns({ old: period([camp({ conversions: 4 })]), cur: period([camp({ conversions: 0, all_conversions: 0 })]) });
  assert.ok(!stopped.some((x) => x.type === 'conversions_stopped'), 'four conversions before is not "usually converts"');
});

test('lost IS budget becomes a budget opportunity only with efficiency, volume and healthy tracking', () => {
  const c = camp({ cost: 600, conversions: 20 });
  const share = [{ customer_id: '1', campaign_id: 'c1', search_budget_lost_is: 0.35, search_impression_share: 0.4, granularity: 'range' }];
  const ok = diagnoseCampaigns({ old: period([c]), cur: period([c]), competitive: share }).find((x) => x.type === 'lost_is_budget');
  assert.match(ok.next_steps[0], /Peluang budget/);
  const broken = diagnoseCampaigns({ old: period([c]), cur: period([c]), competitive: share, trackingHealth: new Map([['1|c1', { healthy: false }]]) }).find((x) => x.type === 'lost_is_budget');
  assert.match(broken.next_steps[0], /Perbaiki tracking konversi dulu/);
  const rank = diagnoseCampaigns({ old: period([c]), cur: period([c]), competitive: [{ customer_id: '1', campaign_id: 'c1', search_rank_lost_is: 0.5 }] }).find((x) => x.type === 'lost_is_rank');
  assert.match(rank.next_steps[0], /Menambah budget tidak mengatasi/);
});

test('landing page experience is grouped by final URL (the KL pattern)', () => {
  const kw = (keyword, ad_group_id, lpe, cost = 10) => ({ customer_id: '1', ad_group_id, keyword, landing_page_experience: lpe, cost });
  const keywords = [
    ...['dried flowers', 'preserved flowers', 'dried bouquet', 'dried roses'].map((k, i) => kw(k, 'g1', i < 3 ? 'BELOW_AVERAGE' : 'AVERAGE')),
    kw('florist kl', 'g2', 'ABOVE_AVERAGE'), { customer_id: '1', ad_group_id: 'g2', keyword: 'bunga', landing_page_experience: null, cost: 1 },
  ];
  const ads = [
    { customer_id: '1', ad_group_id: 'g1', final_urls: ['https://petitefleurmy.com/collections/dried-preserved-flowers?utm=x'] },
    { customer_id: '1', ad_group_id: 'g2', final_urls: ['https://petitefleurmy.com/'] },
  ];
  const q = landingPageQuality(keywords, ads);
  assert.deepEqual(q.summary, { scored: 5, unscored: 1, below: 3, average: 1, above: 1 });
  assert.deepEqual([q.pages[0].url, q.pages[0].keywords, q.pages[0].below, q.pages[0].opportunity], ['https://petitefleurmy.com/collections/dried-preserved-flowers', 4, 3, true]);
  assert.equal(q.pages[1].url, 'https://petitefleurmy.com');
});

test('anomalies: a noisy series needs a bigger deviation; low volume is monitoring', () => {
  const days = Array.from({ length: 45 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 7, 1 + i));
    return { date: d.toISOString().slice(0, 10), cost: [60, 140, 90, 200, 50, 170, 110][i % 7] * (1 + (i % 3) * 0.4), clicks: 50, conversions: 1 };
  });
  const r = detectAnomalies(days, '2026-09-08', '2026-09-14');
  assert.ok(r.monitoring_metrics.includes('conversions'), 'median 1 conversion: too thin to flag');
  assert.ok(r.anomalies.every((a) => a.metric !== 'conversions'));
  assert.equal(r.ruleset_version, RULESET_VERSION);
});

test('rules are versioned with a calibration log; cooldown depends on the alert type', () => {
  assert.ok(CALIBRATION_LOG.some((e) => e.version === RULESET_VERSION));
  assert.equal(cooldownDays('cpa_increase'), 7);
  assert.equal(cooldownDays('sync_failed'), 0);
  assert.equal(cooldownDays('something_new'), 3);
});
