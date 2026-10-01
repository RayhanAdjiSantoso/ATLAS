// Daily Tracking: import column selection, channel aliases, delete / move a
// custom channel. The parser part is pure; the rest needs the local DB:
//   INTERNAL_DASHBOARD_IT=1 node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import XLSX from 'xlsx';
import { parseDailyTrackingFile } from '../src/services/dailyTrackingImportParser.js';

const ENABLED = process.env.INTERNAL_DASHBOARD_IT === '1';

// A small Daily Tracking file: header row + two days.
function workbookBuffer(header, rows) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Daily');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const HEADER = ['Tanggal', 'Total Revenue Website', 'Kuantitas', 'Transaksi', 'Boost Post', 'CPAS Tokped', 'TikTok GMV', 'Profile Visits'];
const ROWS = [
  ['2026-01-01', 1000, 1, 1, 100, 20, 30, 400],
  ['2026-01-02', 2000, 2, 1, 150, 25, 35, 500],
];

test('aliases: "CPAS Tokped" and "TikTok GMV" are the fixed CPAS Tokopedia / GMV Max channels', () => {
  const p = parseDailyTrackingFile(workbookBuffer(HEADER, ROWS), 'x.xlsx');
  const byId = Object.fromEntries(p.columns.map((c) => [c.id, c]));
  assert.equal(byId['spend:cpas_tokopedia'].isCustom, false);
  assert.equal(byId['spend:cpas_tokopedia'].label, 'CPAS Tokopedia');
  assert.deepEqual(byId['spend:cpas_tokopedia'].fileLabels, ['CPAS Tokped']);
  assert.equal(byId['spend:gmv_max'].isCustom, false);
  assert.equal(byId['spend:gmv_max'].total, 65);
  assert.equal(byId['spend:profile_visits'].isCustom, true, 'unrecognised column stays a custom channel');
  assert.equal(byId['sales:website'].rows, 2);
});

test('Daily Tracking channel management against the database', { skip: !ENABLED && 'set INTERNAL_DASHBOARD_IT=1 to run' }, async (t) => {
  const { default: pool } = await import('../src/config/db.js');
  const service = await import('../src/services/dailyTrackingService.js');
  const name = `__itch_${crypto.randomBytes(3).toString('hex')}`;
  const { rows: [{ brand_id: brandId }] } = await pool.query(`INSERT INTO brands (brand_name, status) VALUES ($1, 'active') RETURNING brand_id`, [name]);
  const buffer = workbookBuffer(HEADER, ROWS);

  try {
    await t.test('preview stores nothing and lists every column', async () => {
      const p = await service.previewImport({ brandId, buffer, filename: 'x.xlsx' });
      assert.deepEqual(p.columns.map((c) => c.id).sort(), ['sales:website', 'spend:cpas_tokopedia', 'spend:gmv_max', 'spend:meta_boost_post', 'spend:profile_visits']);
      assert.equal(p.columns.find((c) => c.id === 'spend:profile_visits').isNew, true);
      const { rows } = await pool.query('SELECT count(*)::int n FROM daily_channel_spend WHERE brand_id = $1', [brandId]);
      assert.equal(rows[0].n, 0);
    });

    await t.test('import saves only ticked columns and remembers the rest as ignored', async () => {
      const r = await service.importFromFile({ brandId, buffer, filename: 'x.xlsx', userId: null, selected: ['sales:website', 'spend:meta_boost_post', 'spend:cpas_tokopedia', 'spend:gmv_max'] });
      assert.deepEqual(r.ignoredColumns, [{ kind: 'spend', label: 'Profile Visits' }]);
      const { rows } = await pool.query('SELECT channel_key, count(*)::int n FROM daily_channel_spend WHERE brand_id = $1 GROUP BY 1 ORDER BY 1', [brandId]);
      assert.deepEqual(rows, [{ channel_key: 'cpas_tokopedia', n: 2 }, { channel_key: 'gmv_max', n: 2 }, { channel_key: 'meta_boost_post', n: 2 }]);
      const { rows: ch } = await pool.query('SELECT channel_key FROM daily_tracking_channels WHERE brand_id = $1', [brandId]);
      assert.deepEqual(ch, [], 'no pill created for the skipped column');
    });

    await t.test('next upload flags the column ignored last time and leaves it unticked', async () => {
      const p = await service.previewImport({ brandId, buffer, filename: 'x.xlsx' });
      assert.deepEqual(p.previouslyIgnored.map((c) => c.label), ['Profile Visits']);
      assert.equal(p.columns.find((c) => c.id === 'spend:profile_visits').previouslyIgnored, true);
    });

    await t.test('ticking it again imports it and forgets the ignore', async () => {
      await service.importFromFile({ brandId, buffer, filename: 'x.xlsx', userId: null, selected: ['sales:website', 'spend:meta_boost_post', 'spend:cpas_tokopedia', 'spend:gmv_max', 'spend:profile_visits'] });
      const p = await service.previewImport({ brandId, buffer, filename: 'x.xlsx' });
      assert.equal(p.previouslyIgnored.length, 0);
    });

    await t.test('typing an alias as a new channel is refused', async () => {
      await assert.rejects(service.addCustomChannel({ brandId, kind: 'spend', label: 'CPAS Tokped', userId: null }), (e) => e.statusCode === 409 && /CPAS Tokopedia/.test(e.message));
    });

    await t.test('move a custom spend channel to Revenue Data: amounts become revenue', async () => {
      const r = await service.moveCustomChannel({ brandId, kind: 'spend', channelKey: 'profile_visits', userId: null });
      assert.equal(r.movedEntries, 2);
      const { rows: sales } = await pool.query(`SELECT revenue FROM daily_channel_sales WHERE brand_id = $1 AND channel_key = 'profile_visits' ORDER BY entry_date`, [brandId]);
      assert.deepEqual(sales.map((x) => Number(x.revenue)), [400, 500]);
      const { rows: spend } = await pool.query(`SELECT 1 FROM daily_channel_spend WHERE brand_id = $1 AND channel_key = 'profile_visits'`, [brandId]);
      assert.equal(spend.length, 0);
      const ch = await service.listChannels(brandId);
      assert.ok(ch.sales.some((c) => c.key === 'profile_visits' && c.usage.rows === 2));
    });

    await t.test('a channel with a negative day cannot move to spend', async () => {
      await pool.query(`UPDATE daily_channel_sales SET revenue = -5 WHERE brand_id = $1 AND channel_key = 'profile_visits' AND entry_date = '2026-01-01'`, [brandId]);
      await assert.rejects(service.moveCustomChannel({ brandId, kind: 'sales', channelKey: 'profile_visits', userId: null }), (e) => e.statusCode === 422);
    });

    await t.test('fixed channels cannot be deleted or moved', async () => {
      await assert.rejects(service.deleteCustomChannel({ brandId, kind: 'spend', channelKey: 'gmv_max', userId: null }), (e) => e.statusCode === 400);
      await assert.rejects(service.moveCustomChannel({ brandId, kind: 'sales', channelKey: 'website', userId: null }), (e) => e.statusCode === 400);
    });

    await t.test('delete removes the pill and all its entries', async () => {
      const r = await service.deleteCustomChannel({ brandId, kind: 'sales', channelKey: 'profile_visits', userId: null });
      assert.equal(r.deletedEntries, 2);
      const ch = await service.listChannels(brandId);
      assert.equal(ch.sales.some((c) => c.key === 'profile_visits'), false);
    });
  } finally {
    await pool.query('DELETE FROM data_ingestion_log WHERE brand_id = $1', [brandId]);
    await pool.query('DELETE FROM daily_tracking_ingestion_log WHERE brand_id = $1', [brandId]);
    await pool.query('DELETE FROM brands WHERE brand_id = $1', [brandId]);
    await pool.end();
  }
});
