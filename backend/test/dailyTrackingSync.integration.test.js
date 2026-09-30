// Integration tests for the ATLAS Daily Tracking -> fact tables roll-up.
// Opt-in: INTERNAL_DASHBOARD_IT=1 node --test test/
// Creates throw-away brands "__itdt_<random>_*" with Daily Tracking rows
// and deletes everything it created at the end.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import pool from '../src/config/db.js';
import { syncBrandFromDailyTracking, syncAllFromDailyTracking } from '../src/services/internalDashboardSync/dailyTrackingSync.js';
import { refreshMetaAccountsMirror } from '../src/services/internalDashboardSync/metaAccountsMirror.js';
import * as dailyTrackingService from '../src/services/dailyTrackingService.js';
import { getBenchmark } from '../src/services/internalDashboardService.js';
import * as repo from '../src/repositories/internalDashboardRepository.js';

const ENABLED = process.env.INTERNAL_DASHBOARD_IT === '1';
const tag = `__itdt_${crypto.randomBytes(3).toString('hex')}`;
const ids = {};
const NOW = Date.parse('2026-02-15T05:00:00Z'); // Feb 2026 = running month

async function addSales(brandId, date, channelKey, revenue, qty = 1, trx = 1) {
  await pool.query(
    `INSERT INTO daily_channel_sales (brand_id, entry_date, channel_key, revenue, qty_sold, transaksi) VALUES ($1, $2, $3, $4, $5, $6)`,
    [brandId, date, channelKey, revenue, qty, trx],
  );
}
async function addSpend(brandId, date, channelKey, amount) {
  await pool.query(`INSERT INTO daily_channel_spend (brand_id, entry_date, channel_key, amount_spent) VALUES ($1, $2, $3, $4)`, [brandId, date, channelKey, amount]);
}
async function factState(brandId) {
  const q = async (sql) => (await pool.query(sql, [brandId])).rows;
  return {
    cmm: await q(`SELECT to_char(period,'YYYY-MM') p, revenue, transaksi, qty_sold, is_partial_month, source::text s, target_sales FROM client_monthly_metrics WHERE brand_id=$1 ORDER BY 1`),
    ccs: await q(`SELECT to_char(period,'YYYY-MM') p, channel::text c, sales, source::text s FROM client_channel_sales_monthly WHERE brand_id=$1 ORDER BY 1,2`),
    ccso: await q(`SELECT to_char(period,'YYYY-MM') p, channel_label c, sales_amount, source::text s FROM client_channel_sales_other WHERE brand_id=$1 ORDER BY 1,2`),
    cps: await q(`SELECT to_char(period,'YYYY-MM') p, platform::text pl, amount_spent, impressions, link_clicks, purchase_value, is_partial_month, source::text s FROM client_platform_spend_monthly WHERE brand_id=$1 ORDER BY 1,2`),
  };
}

test('Daily Tracking roll-up against the database', { skip: !ENABLED && 'set INTERNAL_DASHBOARD_IT=1 to run' }, async (t) => {
  for (const k of ['A', 'B']) {
    const { rows } = await pool.query(`INSERT INTO brands (brand_name, status, sub_industry) VALUES ($1, 'active', $2) RETURNING brand_id`, [`${tag}_${k}`, `${tag}_sub`]);
    ids[k] = rows[0].brand_id;
  }
  const { A, B } = ids;

  try {
    await pool.query(`INSERT INTO daily_tracking_channels (brand_id, kind, channel_key, label) VALUES ($1, 'sales', 'corporate', 'Corporate')`, [A]);
    for (let d = 1; d <= 31; d += 1) {
      const date = `2026-01-${String(d).padStart(2, '0')}`;
      await addSales(A, date, 'website', 1000, 2, 1);
      await addSales(A, date, 'chat', 500, 1, 1);
      await addSpend(A, date, 'meta_boost_post', 100);
      await addSales(B, date, 'shopee', 2000, 1, 1);
      await addSpend(B, date, 'meta_boost_post', 200);
    }
    await addSales(A, '2026-01-05', 'corporate', 700, 1, 1);
    for (let d = 1; d <= 10; d += 1) {
      const date = `2026-02-${String(d).padStart(2, '0')}`;
      await addSales(A, date, 'website', 1000, 2, 1);
      await addSales(B, date, 'shopee', 2000, 1, 1);
      await addSpend(B, date, 'meta_boost_post', 200);
    }

    // Manual data before any sync: a Jan revenue, a target, a boost row with
    // funnel numbers, a platform Daily Tracking does not have, and a row
    // left by the retired Google Sheets sync.
    await repo.upsertMonthlyMetric({ brandId: A, period: '2026-01-01', revenue: 12345, transaksi: null, qtySold: null, targetSales: 99999, userId: null });
    await repo.upsertPlatformSpend({ brandId: A, period: '2026-01-01', platform: 'google_ads', userId: null, metrics: { amount_spent: 777 } });
    await repo.upsertChannelSale({ brandId: A, period: '2026-01-01', channel: 'shopee', sales: 42, userId: null, source: 'google_sheets' });

    await t.test('revenue, channels and spend come from Daily Tracking; sync wins over manual values', async () => {
      const r = await syncBrandFromDailyTracking(A, null, { now: NOW });
      const s = await factState(A);
      const jan = s.cmm.find((x) => x.p === '2026-01');
      assert.equal(Number(jan.revenue), 31 * 1500 + 700);
      assert.equal(Number(jan.qty_sold), 31 * 3 + 1);
      assert.equal(jan.s, 'atlas_daily_tracking');
      assert.equal(Number(jan.target_sales), 99999, 'hand-entered target kept');
      assert.equal(r.overwrittenManual.find((o) => o.table === 'client_monthly_metrics').old.revenue, 12345);
      assert.deepEqual(s.ccs.filter((x) => x.p === '2026-01').map((x) => [x.c, Number(x.sales)]), [['website', 31000]]);
      assert.deepEqual(s.ccso.filter((x) => x.p === '2026-01').map((x) => [x.c, Number(x.sales_amount)]), [['Corporate', 700], ['chat', 15500]]);
    });

    await t.test('Meta funnel comes from Meta Ads insights, split by the mirrored Boost keyword', async () => {
      // mirror: stub Meta Ads Automation's brandList — only this test's brands
      const saved = (await pool.query('SELECT * FROM brand_ad_accounts')).rows;
      try {
        await refreshMetaAccountsMirror({ fetchList: async () => [
          { id: 'act_it_main', client: 'x', type: 'MAIN', boostMatch: 'Profile Visit', atlasBrandId: A },
          { id: 'act_it_unlinked', client: 'y', type: 'MAIN', boostMatch: 'x', atlasBrandId: null },
        ] });
        const { rows: acc } = await pool.query('SELECT ad_account_id, boost_keyword FROM brand_ad_accounts WHERE brand_id = $1', [A]);
        assert.deepEqual(acc, [{ ad_account_id: 'act_it_main', boost_keyword: 'profile visit' }], 'keyword lower-cased, unlinked skipped');
        await pool.query(
          `INSERT INTO meta_ads_insights_daily (brand_id, account_type, ad_account_id, entry_date, campaign_id, campaign_name, age, gender, amount_spent, impressions, link_clicks, purchases, purchase_value, metrics, fetch_run_id)
           VALUES ($1,'MAIN','act_it_main','2026-01-10','c1','Jan PROFILE VISIT','25-34','female',3100,50000,900,NULL,NULL,'{"profile_visits":1200}','it'),
                  ($1,'MAIN','act_it_main','2026-01-10','c2','Jan Conversion','25-34','female',500,8000,70,3,4000,'{}','it')`,
          [A],
        );
        await syncBrandFromDailyTracking(A, null, { now: NOW });
        const s = await factState(A);
        const boost = s.cps.find((x) => x.p === '2026-01' && x.pl === 'meta_boost');
        assert.equal(Number(boost.amount_spent), 3100, 'spend from Daily Tracking');
        assert.equal(Number(boost.impressions), 50000);
        assert.equal(Number(boost.link_clicks), 900);
        const nonboost = s.cps.find((x) => x.p === '2026-01' && x.pl === 'meta_nonboost');
        assert.equal(Number(nonboost.amount_spent), 500, 'no Daily Tracking spend -> from insights');
        assert.equal(Number(nonboost.purchase_value), 4000);
      } finally {
        await pool.query('DELETE FROM brand_ad_accounts');
        for (const r of saved) {
          await pool.query(
            'INSERT INTO brand_ad_accounts (brand_id, ad_account_id, account_name, account_type, boost_keyword, is_primary, synced_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [r.brand_id, r.ad_account_id, r.account_name, r.account_type, r.boost_keyword, r.is_primary, r.synced_at, r.created_at],
          );
        }
      }
    });

    await t.test('saving in Daily Tracking updates the dashboard with no sync step', async () => {
      await dailyTrackingService.upsertEntries({ brandId: A, entryDate: '2026-01-20', sales: [{ channelKey: 'website', revenue: 5000, qtySold: 1, transaksi: 1 }], spend: [], userId: null });
      const s = await factState(A);
      assert.deepEqual(s.ccs.find((x) => x.p === '2026-01' && x.c === 'website').sales, String(30 * 1000 + 5000) + '.00');
    });

    await t.test('manual rows with no Daily Tracking counterpart stay; retired Sheets rows go', async () => {
      const s = await factState(A);
      assert.ok(s.cps.some((x) => x.pl === 'google_ads' && x.s === 'manual_form'));
      assert.equal(s.ccs.some((x) => x.c === 'shopee'), false, 'google_sheets row removed');
    });

    await t.test('running month flagged partial; sync twice changes nothing', async () => {
      // the auto-refresh in the previous test ran with the real clock
      await syncBrandFromDailyTracking(A, null, { now: NOW });
      const before = await factState(A);
      assert.equal(before.cmm.find((x) => x.p === '2026-02').is_partial_month, true);
      const r2 = await syncBrandFromDailyTracking(A, null, { now: NOW });
      assert.deepEqual(await factState(A), before);
      assert.equal(r2.overwrittenManual.length, 0);
      assert.equal(r2.deletedStale.length, 0);
    });

    await t.test('dry run writes nothing', async () => {
      await addSales(A, '2026-01-06', 'corporate', 300, 1, 1);
      const before = await factState(A);
      const r = await syncBrandFromDailyTracking(A, null, { now: NOW, dryRun: true });
      assert.equal(r.dryRun, true);
      assert.deepEqual(await factState(A), before);
    });

    await t.test('a month deleted in Daily Tracking disappears from the dashboard on the next sync', async () => {
      await pool.query(`DELETE FROM daily_channel_sales WHERE brand_id = $1 AND entry_date >= '2026-02-01'`, [A]);
      await syncBrandFromDailyTracking(A, null, { now: NOW });
      const s = await factState(A);
      assert.equal(s.cmm.some((x) => x.p === '2026-02'), false);
      assert.equal(s.ccs.some((x) => x.p === '2026-02'), false);
    });

    await t.test('portfolio sync keeps going per brand; partial months excluded from S5', async () => {
      const res = await syncAllFromDailyTracking(null, { now: NOW, brandIds: [A, B] });
      assert.equal(res.succeeded, 2);
      const janBench = await getBenchmark({ client_id: B, period: '2026-01' });
      const febBench = await getBenchmark({ client_id: B, period: '2026-02' });
      const roasN = (x) => x.distribution.find((d) => d.metric === 'blended_roas').n;
      assert.equal(roasN(janBench), 2);
      assert.equal(roasN(febBench), 0, 'running month is partial -> excluded');
    });

    await t.test('a brand without Daily Tracking data gets a clear 404, nothing logged as failed', async () => {
      const { rows } = await pool.query(`INSERT INTO brands (brand_name, status) VALUES ($1, 'active') RETURNING brand_id`, [`${tag}_C`]);
      ids.C = rows[0].brand_id;
      await assert.rejects(syncBrandFromDailyTracking(ids.C, null, { now: NOW }), (e) => e.statusCode === 404);
      const { rows: logs } = await pool.query('SELECT 1 FROM data_ingestion_log WHERE brand_id = $1', [ids.C]);
      assert.equal(logs.length, 0);
    });
  } finally {
    const all = Object.values(ids);
    await pool.query('DELETE FROM data_ingestion_log WHERE brand_id = ANY($1::int[])', [all]);
    await pool.query('DELETE FROM brands WHERE brand_id = ANY($1::int[])', [all]);
  }
});

test.after(async () => { await pool.end(); });
