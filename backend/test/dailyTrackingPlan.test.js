import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyTrackingPlan } from '../src/services/internalDashboardSync/dailyTrackingSync.js';

// Rows shaped like repo.dailySalesMonthly() / dailySpendMonthly().
const sale = (period, channel_key, revenue, { qty = 1, trx = 1, days = 30, noQty = 0, noTrx = 0, n = days } = {}) => ({
  period, channel_key, revenue: revenue === null ? null : String(revenue), n_revenue: revenue === null ? 0 : n,
  qty: qty === null ? null : String(qty), n_qty: qty === null ? 0 : n,
  trx: trx === null ? null : String(trx), n_trx: trx === null ? 0 : n,
  sold_without_qty: noQty, sold_without_trx: noTrx, days,
});
const spend = (period, channel_key, amount) => ({ period, channel_key, amount: amount === null ? null : String(amount), n_amount: amount === null ? 0 : 30, n_meta_api: 0 });
const plan = (o) => buildDailyTrackingPlan({ salesRows: [], spendRows: [], labels: [], ...o });
const month = (p, period) => p.months.find((m) => m.period === period);

test('channel keys map onto the enum; chat and custom channels go to the free-text table', () => {
  const p = plan({
    salesRows: [
      sale('2026-01', 'website', 100), sale('2026-01', 'tiktok', 50), sale('2026-01', 'offline_store', 20),
      sale('2026-01', 'chat', 30), sale('2026-01', 'corporate', 7),
    ],
    labels: [{ kind: 'sales', channel_key: 'corporate', label: 'Corporate' }],
  });
  const jan = month(p, '2026-01');
  assert.deepEqual(jan.channels.map((c) => c.channel).sort(), ['offline', 'tiktok_shop', 'website']);
  assert.deepEqual(jan.otherChannels.map((c) => c.channelLabel).sort(), ['Corporate', 'chat']);
  assert.equal(jan.metric.revenue, 207, 'revenue = sum of every channel');
  assert.equal(jan.writeChannels, true);
});

test('a channel with no saved revenue is absent — not 0; a saved 0 is kept', () => {
  const p = plan({ salesRows: [sale('2026-01', 'website', 100), sale('2026-01', 'shopee', null), sale('2026-01', 'tokopedia', 0)] });
  const jan = month(p, '2026-01');
  assert.equal(jan.channels.some((c) => c.channel === 'shopee'), false);
  assert.equal(jan.channels.find((c) => c.channel === 'tokopedia').sales, 0);
});

test('month quantity is null when a day sold without a quantity', () => {
  const p = plan({ salesRows: [sale('2026-07', 'website', 100, { qty: 10 }), sale('2026-07', 'tokopedia', 50, { qty: 3, noQty: 1 })] });
  const jul = month(p, '2026-07');
  assert.equal(jul.metric.qtySold, null);
  assert.equal(jul.metric.transaksi, 2);
  assert.ok(p.warnings.some((w) => w.code === 'incomplete_qty' && /Tokopedia/.test(w.message)));
});

test('spend keys map onto ad platforms; unknown custom spend is reported with its amount', () => {
  const p = plan({
    salesRows: [sale('2026-01', 'website', 100)],
    spendRows: [spend('2026-01', 'meta_boost_post', 10), spend('2026-01', 'shopee_iklanku', 5), spend('2026-01', 'google_ads', 3), spend('2026-01', 'lazads', 2), spend('2026-01', 'ttam', null)],
    labels: [{ kind: 'spend', channel_key: 'lazads', label: 'LazAds' }],
  });
  const jan = month(p, '2026-01');
  assert.deepEqual(Object.fromEntries(jan.platforms.map((x) => [x.platform, x.metrics.amount_spent])), { meta_boost: 10, iklanku_shopee: 5, google_ads: 3 });
  const w = p.warnings.find((x) => x.code === 'unsupported_platform');
  assert.equal(w.amount, 2);
  assert.match(w.message, /LazAds/);
});

test('negative month total from returns is refused; negative single days are fine', () => {
  const p = plan({ salesRows: [sale('2026-02', 'website', 100), sale('2026-02', 'drc', -30)] });
  const feb = month(p, '2026-02');
  assert.equal(feb.metric.revenue, 70, 'net revenue includes the returns');
  assert.equal(feb.otherChannels.some((c) => c.channelLabel === 'drc'), false, 'negative channel total not stored');
  assert.ok(p.warnings.some((w) => w.code === 'negative_channel_sales'));
});

test('spend without sales: spend kept, no revenue row, warning', () => {
  const p = plan({ spendRows: [spend('2026-09', 'meta_boost_post', 100)] });
  const sep = month(p, '2026-09');
  assert.equal(sep.metric, null);
  assert.equal(sep.platforms[0].metrics.amount_spent, 100);
  assert.ok(p.warnings.some((w) => w.code === 'spend_without_revenue'));
});

test('a month written before but now cleared in Daily Tracking is revisited as empty (stale rows go)', () => {
  const p = plan({ salesRows: [sale('2026-01', 'website', 100)], revisitPeriods: ['2026-02'] });
  const feb = month(p, '2026-02');
  assert.ok(feb, 'month present in plan');
  assert.equal(feb.metric, null);
  assert.deepEqual([feb.channels, feb.otherChannels, feb.platforms], [[], [], []]);
});

// Meta insights rows shaped like repo.metaInsightsMonthly().
const meta = (period, account_type, ad_account_id, campaign_name, v) => ({
  period, account_type, ad_account_id, campaign_name,
  spend: String(v.spend), impressions: v.impressions ?? null, link_clicks: v.clicks ?? null,
  purchase: v.purchase ?? null, purchase_value: v.value ?? null, ig_profile_visit: v.pv ?? null,
  view_content: null, atc: null, lpv: null,
});

test('Meta funnel: MAIN split by the account keyword, CPAS to meta_cpas, spend stays from Daily Tracking', () => {
  const p = plan({
    salesRows: [sale('2026-01', 'website', 100)],
    spendRows: [spend('2026-01', 'meta_boost_post', 10), spend('2026-01', 'meta_nonboost_post', 20)],
    metaRows: [
      meta('2026-01', 'MAIN', 'act_1', 'Jan - Profile Visit - A', { spend: 10, impressions: 1000, clicks: 5, pv: 300 }),
      meta('2026-01', 'MAIN', 'act_1', 'Jan - Conversion', { spend: 20, impressions: 4000, clicks: 40, purchase: 2, value: 900 }),
      meta('2026-01', 'CPAS', 'act_2', 'CPAS Jan', { spend: 7, impressions: 700, purchase: 1, value: 70 }),
    ],
    accounts: [{ ad_account_id: 'act_1', account_type: 'MAIN', boost_keyword: 'profile visit' }, { ad_account_id: 'act_2', account_type: 'CPAS', boost_keyword: null }],
  });
  const byP = Object.fromEntries(month(p, '2026-01').platforms.map((x) => [x.platform, x.metrics]));
  assert.equal(byP.meta_boost.amount_spent, 10);
  assert.equal(byP.meta_boost.ig_profile_visit, 300);
  assert.equal(byP.meta_boost.impressions, 1000);
  assert.equal(byP.meta_nonboost.purchase_value, 900);
  assert.equal(byP.meta_nonboost.view_content, null, 'no data -> null, not 0');
  assert.equal(byP.meta_cpas.amount_spent, 7, 'CPAS spend from insights when Daily Tracking has none');
  assert.ok(p.warnings.some((w) => w.code === 'spend_from_meta_insights'));
});

test('Meta funnel: a MAIN account without keyword is reported, not guessed', () => {
  const p = plan({
    salesRows: [sale('2026-01', 'website', 100)],
    metaRows: [meta('2026-01', 'MAIN', 'act_9', 'Boost post Jan', { spend: 50, impressions: 10 })],
    accounts: [],
  });
  assert.equal(month(p, '2026-01').platforms.length, 0);
  assert.ok(p.warnings.some((w) => w.code === 'boost_keyword_missing' && /act_9/.test(w.message)));
});

test('Meta funnel: Daily Tracking vs Meta API spend gap is flagged', () => {
  const p = plan({
    salesRows: [sale('2026-01', 'website', 100)],
    spendRows: [spend('2026-01', 'meta_boost_post', 100)],
    metaRows: [meta('2026-01', 'MAIN', 'act_1', 'profile visit', { spend: 150 })],
    accounts: [{ ad_account_id: 'act_1', account_type: 'MAIN', boost_keyword: 'profile visit' }],
  });
  assert.ok(p.warnings.some((w) => w.code === 'meta_spend_mismatch'));
  assert.equal(month(p, '2026-01').platforms[0].metrics.amount_spent, 100, 'Daily Tracking value kept');
});

// Shopee Ads rows shaped like repo.shopeeAdsMonthly().
const shopeeRow = (period, days, v) => ({ period, days, impressions: String(v.impr), purchase: String(v.orders), purchase_value: String(v.sales), spend: String(v.spend) });

test('Shopee funnel: a fully covered month adds impressions / orders / ad sales to Daily Tracking spend', () => {
  const p = plan({
    salesRows: [sale('2026-08', 'shopee', 100)],
    spendRows: [spend('2026-08', 'shopee_iklanku', 1000)],
    shopeeRows: [shopeeRow('2026-08', 31, { impr: 50000, orders: 20, sales: 9000, spend: 1000 })],
  });
  const ik = month(p, '2026-08').platforms.find((x) => x.platform === 'iklanku_shopee').metrics;
  assert.equal(ik.amount_spent, 1000, 'spend from Daily Tracking');
  assert.equal(ik.impressions, 50000);
  assert.equal(ik.purchase, 20);
  assert.equal(ik.purchase_value, 9000);
  assert.equal(ik.link_clicks, null, 'clicks are not in the export -> null, not 0');
});

test('Shopee funnel: partial month or no Daily Tracking spend -> not used, with a note', () => {
  const partial = plan({
    salesRows: [sale('2026-09', 'shopee', 100)],
    spendRows: [spend('2026-09', 'shopee_iklanku', 1000)],
    shopeeRows: [shopeeRow('2026-09', 23, { impr: 1, orders: 1, sales: 1, spend: 1 })],
  });
  assert.equal(month(partial, '2026-09').platforms[0].metrics.impressions, undefined);
  assert.ok(partial.warnings.some((w) => w.code === 'shopee_funnel_partial'));

  const noSpend = plan({
    salesRows: [sale('2026-08', 'shopee', 100)],
    shopeeRows: [shopeeRow('2026-08', 31, { impr: 1, orders: 1, sales: 1, spend: 500 })],
  });
  assert.equal(month(noSpend, '2026-08').platforms.length, 0, 'no spend row created from Performance Overview');
  assert.ok(noSpend.warnings.some((w) => w.code === 'shopee_funnel_without_spend'));
});

test('Shopee funnel: Daily Tracking vs Performance Overview spend gap is flagged, Daily Tracking kept', () => {
  const p = plan({
    salesRows: [sale('2026-08', 'shopee', 100)],
    spendRows: [spend('2026-08', 'shopee_iklanku', 1000)],
    shopeeRows: [shopeeRow('2026-08', 31, { impr: 1, orders: 1, sales: 1, spend: 1500 })],
  });
  assert.ok(p.warnings.some((w) => w.code === 'shopee_spend_mismatch'));
  assert.equal(month(p, '2026-08').platforms[0].metrics.amount_spent, 1000);
});
