import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePeriod } from '../src/services/executiveSummaryService.js';

// Rows shaped like dailyTrackingRepository.listSalesForMonth / listSpendForMonth.
const sale = (entry_date, channel_key, revenue, transaksi = null, qty_sold = null) => ({ entry_date, channel_key, revenue, transaksi, qty_sold });
const spend = (entry_date, channel_key, amount_spent) => ({ entry_date, channel_key, amount_spent });
const labels = { sales: { shopee: 'Shopee', website: 'Website', offline_store: 'Offline Store', drc: 'DRC' }, spend: { shopee_iklanku: 'Shopee Iklanku', meta_boost_post: 'Meta Boost Post' } };
const summarize = (o) => summarizePeriod({ salesRows: [], spendRows: [], start: '2026-10-01', end: '2026-10-03', labels, today: '2026-11-01', ...o });

test('every sales channel counts, minus the ones left out', () => {
  const salesRows = [
    sale('2026-10-01', 'shopee', 100, 10, 12),
    sale('2026-10-01', 'website', 50, 4, 4),
    sale('2026-10-02', 'drc', -20, -2, -2),
  ];
  const all = summarize({ salesRows });
  assert.equal(all.totals.trx, 12);
  assert.equal(all.totals.revenue, 130);

  const noDrc = summarize({ salesRows, excluded: new Set(['drc']) });
  assert.equal(noDrc.totals.trx, 14);
  assert.equal(noDrc.totals.revenue, 150);
  assert.equal(noDrc.totals.aov, 150 / 14);
  assert.equal(noDrc.daily[1].revenue, null, 'a day holding only a left-out channel stays empty');
});

test('daily carries revenue, spend, trx and qty per day, null where nothing was entered', () => {
  const p = summarize({
    salesRows: [sale('2026-10-01', 'shopee', 100, 10, 12), sale('2026-10-01', 'website', 50, 4, null)],
    spendRows: [spend('2026-10-01', 'shopee_iklanku', 20), spend('2026-10-03', 'meta_boost_post', 0)],
  });
  assert.deepEqual(p.daily.map((d) => [d.revenue, d.spend, d.trx, d.qty]), [[150, 20, 14, 12], [null, null, null, null], [null, 0, null, null]]);
});

test('coverage counts only due days and names the channels with gaps', () => {
  const p = summarize({
    today: '2026-10-03',
    salesRows: [sale('2026-10-01', 'shopee', 1), sale('2026-10-02', 'shopee', 1), sale('2026-10-01', 'website', 1), sale('2026-10-03', 'website', 1)],
    spendRows: [spend('2026-10-01', 'shopee_iklanku', 5), spend('2026-10-02', 'shopee_iklanku', null)],
  });
  assert.equal(p.coverage.due, 2, 'today is not due yet');
  assert.equal(p.coverage.salesDays, 2);
  assert.equal(p.coverage.spendDays, 1, 'a row with an empty amount is not filled');
  assert.deepEqual(p.coverage.channelGaps.map((g) => [g.kind, g.key, g.filled]), [['sales', 'website', 1], ['spend', 'shopee_iklanku', 1]]);
});

test('channel pairs keep every rupiah: grouped channels, then unpaired sales and spend', () => {
  const p = summarize({
    salesRows: [sale('2026-10-01', 'shopee', 300), sale('2026-10-01', 'offline_store', 80)],
    spendRows: [spend('2026-10-01', 'shopee_iklanku', 30), spend('2026-10-01', 'meta_boost_post', 40)],
  });
  assert.deepEqual(p.channelPairs, [
    { key: 'shopee', label: 'Shopee', revenue: 300, spend: 30 },
    { key: 'sales:offline_store', label: 'Offline Store', revenue: 80, spend: null },
    { key: 'spend:meta_boost_post', label: 'Meta Boost Post', revenue: null, spend: 40 },
  ]);
  assert.equal(p.totals.roas, 380 / 70);
});

test('spend channels left out drop from spend, ROAS, coverage and the channel pairs', () => {
  const p = summarize({
    today: '2026-10-03',
    salesRows: [sale('2026-10-01', 'shopee', 300), sale('2026-10-02', 'shopee', 100)],
    spendRows: [spend('2026-10-01', 'shopee_iklanku', 30), spend('2026-10-01', 'qty_online', 300), spend('2026-10-02', 'shopee_iklanku', 10)],
    excludedSpend: new Set(['qty_online']),
  });
  assert.equal(p.totals.amountSpent, 40);
  assert.equal(p.totals.roas, 10);
  assert.deepEqual(p.daily.map((d) => d.spend), [30, 10, null]);
  assert.deepEqual(p.coverage.channelGaps, []);
  assert.deepEqual(p.channelPairs.map((c) => c.key), ['shopee']);
});
