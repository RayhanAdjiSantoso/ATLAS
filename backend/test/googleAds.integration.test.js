// Integration test for the Google Ads ingest -> report path, through HTTP
// (routes, validators, ingest-key auth) and the real database.
// Opt-in: GOOGLE_ADS_IT=1 node --test test/
// Creates a throw-away brand "__itga_<random>" with one Google Ads account
// and deletes everything it created at the end.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const ENABLED = process.env.GOOGLE_ADS_IT === '1';
const KEY = `it-${crypto.randomBytes(6).toString('hex')}`;
const tag = `__itga_${crypto.randomBytes(3).toString('hex')}`;
const CUSTOMER = String(9000000000 + Math.floor(Math.random() * 999999999)).slice(0, 10);

test('Google Ads ingest and report against the database', { skip: !ENABLED && 'set GOOGLE_ADS_IT=1 to run' }, async (t) => {
  process.env.DAILY_TRACKING_INGEST_API_KEY = KEY;
  const { default: app } = await import('../src/app.js');
  const { default: pool } = await import('../src/config/db.js');
  const service = await import('../src/services/googleAdsService.js');

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/google-ads/ingest`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': KEY }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  // Dates: the month before the current one, so it is a finished month.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const mStart = d.toISOString().slice(0, 10);
  const mEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const day = (n) => `${mStart.slice(0, 8)}${String(n).padStart(2, '0')}`;

  const { rows: [brand] } = await pool.query(`INSERT INTO brands (brand_name) VALUES ($1) RETURNING brand_id`, [tag]);
  const brandId = brand.brand_id;
  await pool.query(`INSERT INTO google_ads_accounts (brand_id, customer_id, backfill_from) VALUES ($1, $2, $3)`, [brandId, CUSTOMER, mStart]);

  const count = async (table) => Number((await pool.query(`SELECT count(*) FROM ${table} WHERE customer_id = $1`, [CUSTOMER])).rows[0].count);
  const coreRow = (date, cost, conv) => ({ date, level: 'campaign', campaignId: 'c1', campaignName: 'Search Brand', channelType: 'SEARCH', cost, impressions: 1000, clicks: 50, conversions: conv, conversionsValue: conv * 100, allConversions: conv + 3 });

  try {
    await t.test('rejects a wrong ingest key', async () => {
      const res = await fetch(`${base}/jobs`, { headers: { 'X-Ingest-Key': 'nope' } });
      assert.equal(res.status, 401);
    });

    await t.test('legacy script: core-only run, unchanged contract', async () => {
      const jobs = await call('GET', '/jobs');
      const mine = jobs.body.jobs.filter((j) => j.customerId === CUSTOMER);
      assert.ok(mine.length >= 1);
      assert.ok(mine.every((j) => !('datasets' in j)), 'old script sees no datasets field');
      assert.equal(jobs.body.snapshots, undefined);

      const start = await call('POST', '/start', { customerId: CUSTOMER, startDate: mStart, endDate: mEnd, source: 'ads_script', account: { name: 'IT', currencyCode: 'MYR', timeZone: 'Asia/Kuala_Lumpur' } });
      assert.equal(start.status, 200);
      const rows = await call('POST', '/rows', { runId: start.body.runId, rows: [coreRow(day(1), 100, 2), coreRow(day(2), 200, 3)] });
      assert.equal(rows.body.written, 2);
      const undeclared = await call('POST', '/dataset', { runId: start.body.runId, dataset: 'ads', rows: [{ date: day(1), adGroupId: 'g', adId: 'a' }] });
      assert.equal(undeclared.status, 409, 'a legacy run cannot carry new datasets');
      const fin = await call('POST', '/finish', { runId: start.body.runId, status: 'success', rowCount: 2 });
      assert.equal(fin.status, 200);
      const log = (await pool.query(`SELECT datasets FROM google_ads_fetch_log WHERE fetch_run_id = $1`, [start.body.runId])).rows[0];
      assert.equal(log.datasets, null);
    });

    let competitiveRunId;
    await t.test('v2 script: only the new datasets are due for a month the old script fetched', async () => {
      const jobs = await call('GET', '/jobs?datasets=core,ads,conversions,competitive');
      const job = jobs.body.jobs.find((j) => j.customerId === CUSTOMER && j.startDate === mStart);
      assert.ok(job, 'last month is planned');
      assert.ok(!job.datasets.includes('core') || job.reason === 'reconcile' || job.reason === 'backfill');
      assert.ok(job.datasets.includes('ads') && job.datasets.includes('conversions') && job.datasets.includes('competitive'));
      assert.deepEqual(jobs.body.snapshots, ['campaign_settings', 'conversion_actions', 'ad_assets']);
    });

    await t.test('v2 run: every dataset lands, retry does not duplicate, bad declarations are refused', async () => {
      const bad = await call('POST', '/start', { customerId: CUSTOMER, startDate: mStart, endDate: mEnd, datasets: ['core', 'quality_score'] });
      assert.equal(bad.status, 400);

      const datasets = ['ads', 'conversions', 'competitive', 'campaign_settings', 'conversion_actions', 'ad_assets'];
      const start = await call('POST', '/start', { customerId: CUSTOMER, startDate: mStart, endDate: mEnd, datasets });
      const runId = start.body.runId;
      competitiveRunId = runId;
      const send = (dataset, rows) => call('POST', '/dataset', { runId, dataset, rows });
      const ads = [
        { date: day(1), campaignId: 'c1', campaignName: 'Search Brand', adGroupId: 'g1', adGroupName: 'Bunga', adId: 'a1', adType: 'RESPONSIVE_SEARCH_AD', adStatus: 'ENABLED', cost: 60, impressions: 600, clicks: 30, conversions: 2, conversionsValue: 200, allConversions: 3 },
        { date: day(1), campaignId: 'c1', adGroupId: 'g1', adId: 'a2', cost: 40, impressions: 400, clicks: 20, conversions: 0 },
        { date: '1999-01-01', campaignId: 'c1', adGroupId: 'g1', adId: 'a3', cost: 1 },
      ];
      assert.equal((await send('ads', ads)).body.written, 2, 'row outside the run range dropped');
      assert.equal((await send('ads', ads)).body.written, 2, 'retry upserts');
      assert.equal(await count('google_ads_ads_daily'), 2);
      await send('conversions', [
        { date: day(1), campaignId: 'c1', campaignName: 'Search Brand', conversionActionId: 'customers/1/conversionActions/11', conversionActionName: 'Purchase', conversionCategory: 'PURCHASE', conversions: 2, conversionsValue: 200, allConversions: 2, allConversionsValue: 200 },
        { date: day(2), campaignId: 'c1', conversionActionId: '22', conversionActionName: 'WhatsApp click', conversionCategory: 'CONTACT', conversions: 3, allConversions: 3 },
        { date: day(2), campaignId: 'c1', conversionActionId: '33', conversionActionName: 'Add to cart', conversionCategory: 'ADD_TO_CART', conversions: 0, allConversions: 9 },
        // Like KL's WhatsApp leads: UNKNOWN category, absent from the conversion_actions listing below.
        { date: day(2), campaignId: 'c1', conversionActionId: '44', conversionActionName: 'Conversation started', conversionCategory: 'UNKNOWN', conversions: 1, allConversions: 1, conversionsValue: 1 },
      ]);
      await send('competitive', [
        { level: 'campaign', granularity: 'range', startDate: mStart, endDate: mEnd, campaignId: 'c1', impressions: 2000, searchImpressionShare: 0.4, searchBudgetLostIs: 0.35, searchRankLostIs: 0.25 },
        { level: 'campaign', granularity: 'day', date: day(1), campaignId: 'c1', impressions: 1000, searchImpressionShare: 0.5 },
        { level: 'keyword', granularity: 'range', startDate: mStart, endDate: mEnd, campaignId: 'c1', adGroupId: 'g1', criterionId: '77', keyword: 'bunga kl', matchType: 'PHRASE', searchImpressionShare: 0.3 },
      ]);
      await send('campaign_settings', [{ campaignId: 'c1', campaignName: 'Search Brand', status: 'ENABLED', biddingStrategyType: 'MAXIMIZE_CONVERSIONS', biddingStrategySource: 'CAMPAIGN', budgetAmount: 50, targetCpa: null, conversionGoals: [{ category: 'PURCHASE', origin: 'WEBSITE', biddable: true }], locationsIncluded: ['Kuala Lumpur'] }]);
      await send('conversion_actions', [
        { conversionActionId: '11', name: 'Purchase', category: 'PURCHASE', status: 'ENABLED', includeInConversions: true },
        { conversionActionId: '22', name: 'WhatsApp click', category: 'CONTACT', status: 'ENABLED', includeInConversions: true },
        { conversionActionId: '33', name: 'Add to cart', category: 'ADD_TO_CART', status: 'ENABLED', includeInConversions: false },
      ]);
      await send('ad_assets', [{ campaignId: 'c1', adGroupId: 'g1', adId: 'a1', adType: 'RESPONSIVE_SEARCH_AD', adStrength: 'GOOD', finalUrls: ['https://example.com'], headlines: [{ text: 'Fresh Flowers KL', pinned: 'HEADLINE_1', label: 'BEST' }], descriptions: [{ text: 'Same-day delivery' }] }]);

      const fin = await call('POST', '/finish', {
        runId, status: 'success', rowCount: 0,
        datasets: Object.fromEntries(datasets.map((ds) => [ds, { status: 'success', rowCount: 3, ...(ds === 'competitive' ? { levels: ['campaign', 'keyword'] } : {}) }])),
      });
      assert.equal(fin.status, 200);
      const log = (await pool.query(`SELECT note, dataset_results FROM google_ads_fetch_log WHERE fetch_run_id = $1`, [runId])).rows[0];
      assert.equal(log.dataset_results.ads.status, 'success');
      assert.ok(!/tidak mengembalikan data/.test(log.note ?? ''), 'a run without core is not "Google returned nothing"');
      assert.equal(await count('google_ads_daily'), 2, 'core rows untouched by a datasets-only run');
    });

    await t.test('a failed dataset keeps its older rows; a successful one replaces its range', async () => {
      const start = await call('POST', '/start', { customerId: CUSTOMER, startDate: mStart, endDate: mEnd, datasets: ['ads', 'competitive', 'campaign_settings'] });
      const runId = start.body.runId;
      await call('POST', '/dataset', { runId, dataset: 'ads', rows: [{ date: day(1), campaignId: 'c1', adGroupId: 'g1', adId: 'a1', cost: 61, impressions: 600, clicks: 30 }] });
      // Settings changed: a target appeared.
      await call('POST', '/dataset', { runId, dataset: 'campaign_settings', rows: [{ campaignId: 'c1', campaignName: 'Search Brand', status: 'ENABLED', biddingStrategyType: 'MAXIMIZE_CONVERSIONS', biddingStrategySource: 'CAMPAIGN', budgetAmount: 50, targetCpa: 30, conversionGoals: [{ category: 'PURCHASE', origin: 'WEBSITE', biddable: true }], locationsIncluded: ['Kuala Lumpur'] }] });
      await call('POST', '/finish', { runId, status: 'success', rowCount: 0, datasets: { ads: { status: 'success', rowCount: 1 }, competitive: { status: 'failed', rowCount: 0, note: 'field ditolak' }, campaign_settings: { status: 'success', rowCount: 1 } } });
      assert.equal(await count('google_ads_ads_daily'), 1, 'ad a2 no longer in Google: removed');
      assert.equal(await count('google_ads_competitive_metrics'), 3, 'competitive failed: older rows kept');
      const versions = (await pool.query(`SELECT target_cpa::float FROM google_ads_campaign_settings WHERE customer_id = $1 ORDER BY valid_from`, [CUSTOMER])).rows;
      assert.deepEqual(versions.map((v) => v.target_cpa), [null, 30], 'settings history kept');

      // Same settings again: no new version.
      const again = await call('POST', '/start', { customerId: CUSTOMER, startDate: mStart, endDate: mEnd, datasets: ['campaign_settings'] });
      await call('POST', '/dataset', { runId: again.body.runId, dataset: 'campaign_settings', rows: [{ campaignId: 'c1', campaignName: 'Search Brand', status: 'ENABLED', biddingStrategyType: 'MAXIMIZE_CONVERSIONS', biddingStrategySource: 'CAMPAIGN', budgetAmount: 50, targetCpa: 30, conversionGoals: [{ category: 'PURCHASE', origin: 'WEBSITE', biddable: true }], locationsIncluded: ['Kuala Lumpur'] }] });
      await call('POST', '/finish', { runId: again.body.runId, status: 'success', rowCount: 0, datasets: { campaign_settings: { status: 'success', rowCount: 1 } } });
      assert.equal(await count('google_ads_campaign_settings'), 2);
      assert.ok(competitiveRunId);
    });

    await t.test('report: old sections intact, new datasets added, purchase and lead apart', async () => {
      const report = await service.getReport({ brandId, oldStart: mStart, oldEnd: mStart, curStart: mStart, curEnd: mEnd });
      assert.equal(report.cur.totals.cost, 300, 'account total from campaign level only');
      assert.ok(Array.isArray(report.cur.searchTerms) && Array.isArray(report.cur.keywords), 'old keys still present');
      assert.equal(report.cur.goals.purchase.conversions, 2);
      assert.equal(report.cur.goals.lead.conversions, 4, 'WhatsApp click + Conversation started');
      assert.equal(report.cur.goals.micro.conversions, 0);
      assert.equal(report.cur.goals.micro.all_conversions, 9);
      assert.equal(report.cur.goals.purchase.focus_cost_per_result, 150, 'campaign bids to purchase: 300 / 2');
      assert.equal(report.cur.goals.lead.focus_campaigns, 0, 'no campaign works for leads');
      assert.equal(report.cur.goals.lead.blended_cost_per_result, 75);
      const msg = report.conversionActionMeta.find((a) => a.conversion_action_id === '44');
      assert.equal(msg.source, 'conversions_only', 'unlisted action still offered for mapping');
      assert.equal(msg.goal, 'lead');
      assert.equal(report.cur.conversionActions.find((a) => a.conversion_action_id === '44').primary, true);
      assert.equal(report.cur.conversionActions.find((a) => a.conversion_action_id === '33').primary, false);
      assert.equal(report.cur.competitive.campaigns[0].granularity, 'range');
      assert.equal(report.cur.competitive.campaigns[0].search_budget_lost_is, 0.35);
      assert.equal(report.cur.competitive.keywords.length, 1);
      assert.equal(report.old.competitive.campaigns[0].granularity, 'daily_estimate', 'one-day period has no Google range figure');
      assert.equal(report.cur.ads[0].headlines[0].text, 'Fresh Flowers KL');
      assert.equal(report.cur.ads[0].ctr, 0.05);
      assert.equal(report.campaignSettings[0].target_cpa, 30);
      // The settings changed today: outside last month, inside a period that reaches today.
      assert.equal(report.campaignSettingChanges.length, 0);
      const now = await service.getReport({ brandId, oldStart: mStart, oldEnd: mStart, curStart: mStart, curEnd: today });
      assert.ok(now.campaignSettingChanges.some((c) => c.changed_fields.some((f) => f.field === 'target_cpa' && f.from == null && f.to === 30)));
      assert.ok(report.dataAvailability.ads.last_date);
      assert.equal(report.conversionActionMeta.find((a) => a.conversion_action_id === '22').goal_source, 'default');
    });

    await t.test('brand mapping wins over the category default', async () => {
      const res = await service.setConversionGoal({ brandId, customerId: CUSTOMER, conversionActionId: '22', goal: 'other', userId: null });
      assert.equal(res.actions.find((a) => a.conversion_action_id === '22').goal_source, 'manual');
      const report = await service.getReport({ brandId, oldStart: mStart, oldEnd: mStart, curStart: mStart, curEnd: mEnd });
      assert.equal(report.cur.goals.lead.conversions, 1);
      assert.equal(report.cur.goals.other.conversions, 3);
      const mapped = await service.setConversionGoal({ brandId, customerId: CUSTOMER, conversionActionId: '44', goal: 'lead', userId: null });
      assert.equal(mapped.actions.find((a) => a.conversion_action_id === '44').goal_source, 'manual', 'an unlisted action can be mapped');
      await assert.rejects(service.setConversionGoal({ brandId, customerId: '1234567890', conversionActionId: '22', goal: 'lead', userId: null }), /tidak ditemukan/);
    });

    await t.test('removing the account removes every dataset', async () => {
      const { rows: [acc] } = await pool.query(`SELECT google_ads_account_id AS id FROM google_ads_accounts WHERE customer_id = $1`, [CUSTOMER]);
      await service.removeAccount({ brandId, accountId: acc.id });
      for (const table of ['google_ads_daily', 'google_ads_ads_daily', 'google_ads_conversion_daily', 'google_ads_competitive_metrics',
        'google_ads_campaign_settings', 'google_ads_conversion_actions', 'google_ads_ad_assets', 'google_ads_conversion_goal_map']) {
        assert.equal(await count(table), 0, table);
      }
    });
  } finally {
    await pool.query(`DELETE FROM google_ads_fetch_log WHERE customer_id = $1`, [CUSTOMER]);
    await pool.query(`DELETE FROM brands WHERE brand_id = $1`, [brandId]);
    server.close();
    await pool.end();
  }
});
