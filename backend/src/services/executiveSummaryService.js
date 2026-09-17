import * as repo from '../repositories/dailyTrackingRepository.js';
import { FIXED_SALES_LABELS, FIXED_SPEND_LABELS } from '../config/dailyTrackingChannels.js';
import pool from '../config/db.js';

// Executive Snapshot — the one cross-channel reading of Business Overview.
//
// Source: Daily Tracking (migration 024), and only Daily Tracking. Shopee's
// own fact tables hold the same marketplace revenue under a different
// definition, so summing both would double-count the one channel ATLAS
// imports twice. Daily Tracking is also the only source that spans Meta
// spend, marketplace sales, offline and B2B on a single daily grain.
//
// Absent ≠ zero throughout (PRODUCT.md rule 5): a channel with no row for a
// day contributes nothing, and a metric with no data at all stays null so the
// UI can say "belum ada data" instead of showing a confident Rp0.

// Which sales channels count as core Revenue, and which are reported
// separately as "+B2B & Website". The monthly report the screenshot comes
// from splits them this way; every brand-specific custom channel (e.g.
// "Corporate") is treated as B2B until told otherwise.
export const CORE_SALES_CHANNELS = new Set(['shopee', 'tiktok', 'tokopedia', 'offline_store', 'chat']);

const sumMaybe = (values) => {
  let total = 0;
  let has = false;
  for (const v of values) {
    const n = Number(v);
    if (v == null || Number.isNaN(n)) continue;
    total += n;
    has = true;
  }
  return has ? total : null;
};

const ratio = (a, b) => (a != null && b != null && b > 0 ? a / b : null);
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const shiftYear = (iso, years) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y - years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

// Display labels for one brand: the fixed channels plus whatever that brand
// added itself ("+ Tambah Channel Baru"). Raw keys must never reach the UI.
async function channelLabels(brandId) {
  const [sales, spend] = await Promise.all([
    repo.listCustomChannels(brandId, 'sales'),
    repo.listCustomChannels(brandId, 'spend'),
  ]);
  return {
    sales: { ...FIXED_SALES_LABELS, ...Object.fromEntries(sales.map((c) => [c.channel_key, c.label])) },
    spend: { ...FIXED_SPEND_LABELS, ...Object.fromEntries(spend.map((c) => [c.channel_key, c.label])) },
  };
}

// One period's totals, plus the per-channel and per-day detail the card draws.
async function readPeriod(brandId, start, end, labels) {
  const [salesRows, spendRows] = await Promise.all([
    repo.listSalesForMonth(brandId, start, end),
    repo.listSpendForMonth(brandId, start, end),
  ]);

  const core = salesRows.filter((r) => CORE_SALES_CHANNELS.has(r.channel_key));
  const revenue = sumMaybe(core.map((r) => r.revenue));
  const revenueAll = sumMaybe(salesRows.map((r) => r.revenue));
  const qty = sumMaybe(core.map((r) => r.qty_sold));
  const trx = sumMaybe(core.map((r) => r.transaksi));
  const amountSpent = sumMaybe(spendRows.map((r) => r.amount_spent));

  const byChannel = (rows, field, labels) => {
    const map = new Map();
    for (const r of rows) {
      map.set(r.channel_key, [...(map.get(r.channel_key) ?? []), r[field]]);
    }
    return [...map.entries()]
      .map(([key, values]) => ({ key, label: labels[key] ?? key, value: sumMaybe(values) }))
      .filter((c) => c.value != null)
      .sort((a, b) => b.value - a.value);
  };

  // Revenue per calendar day, for the daily chart. Days with no row at all are
  // absent rather than zero, so a gap in entry reads as a gap.
  const perDay = new Map();
  for (const r of salesRows) {
    if (r.revenue == null) continue;
    perDay.set(r.entry_date, (perDay.get(r.entry_date) ?? 0) + Number(r.revenue));
  }
  const daily = [];
  for (let date = start, i = 0; date <= end; date = addDays(date, 1), i += 1) {
    daily.push({ date, dayIndex: i + 1, revenue: perDay.has(date) ? perDay.get(date) : null });
  }

  return {
    range: { start, end, days: daysBetween(start, end) },
    totals: {
      amountSpent,
      revenue,
      revenueAll,
      qty,
      trx,
      aov: ratio(revenue, trx),
      aur: ratio(revenue, qty),
      costPerRevenue: ratio(amountSpent, revenue),
    },
    salesChannels: byChannel(salesRows, 'revenue', labels.sales),
    spendChannels: byChannel(spendRows, 'amount_spent', labels.spend),
    daily,
    hasData: salesRows.length > 0 || spendRows.length > 0,
  };
}

export const METRIC_DEFS = [
  { key: 'amountSpent', label: 'Amount Spent', kind: 'currency', sentiment: 'neutral' },
  { key: 'revenue', label: 'Revenue', kind: 'currency', sentiment: 'higher-better' },
  { key: 'revenueAll', label: 'Revenue +B2B & Website', kind: 'currency', sentiment: 'higher-better' },
  { key: 'qty', label: 'Qty', kind: 'number', sentiment: 'higher-better' },
  { key: 'trx', label: 'Trx', kind: 'number', sentiment: 'higher-better' },
  { key: 'aov', label: 'AOV', kind: 'currency', sentiment: 'higher-better' },
  { key: 'aur', label: 'AUR', kind: 'currency', sentiment: 'higher-better' },
];

const growth = (cur, prev) => (cur == null || prev == null || prev === 0 ? null : ((cur - prev) / prev) * 100);

export async function getExecutiveSummary({ brandId, startDate, endDate, compareStartDate, compareEndDate }) {
  // Same range one year earlier — the screenshot's third column. Always
  // computed, since it needs no extra input from the filter bar.
  const lastYear = { start: shiftYear(startDate, 1), end: shiftYear(endDate, 1) };

  const labels = await channelLabels(brandId);
  const [current, compare, yoy, brand] = await Promise.all([
    readPeriod(brandId, startDate, endDate, labels),
    compareStartDate && compareEndDate ? readPeriod(brandId, compareStartDate, compareEndDate, labels) : null,
    readPeriod(brandId, lastYear.start, lastYear.end, labels),
    pool.query('SELECT brand_name FROM public.brands WHERE brand_id = $1', [brandId]).then((r) => r.rows[0] ?? null),
  ]);

  const metrics = METRIC_DEFS.map((def) => ({
    ...def,
    current: current.totals[def.key],
    compare: compare?.totals[def.key] ?? null,
    lastYear: yoy.totals[def.key],
    growthCompare: compare ? growth(current.totals[def.key], compare.totals[def.key]) : null,
    growthLastYear: growth(current.totals[def.key], yoy.totals[def.key]),
  }));

  return {
    brand: brand?.brand_name ?? null,
    source: 'daily_tracking',
    metrics,
    current,
    compare,
    lastYear: yoy,
    // Nothing anywhere: the brand has never filled Daily Tracking for any of
    // the three windows, which the card reports as "belum ada data".
    hasAnyData: current.hasData || Boolean(compare?.hasData) || yoy.hasData,
  };
}
