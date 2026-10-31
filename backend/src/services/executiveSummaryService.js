import * as repo from '../repositories/dailyTrackingRepository.js';
import { FIXED_SALES_LABELS, FIXED_SPEND_LABELS, ROAS_GROUPS } from '../config/dailyTrackingChannels.js';
import pool from '../config/db.js';

// Executive Snapshot — the one cross-channel reading of Brand Overview.
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

// Every total counts every channel — the same totals Brand Tracking shows —
// minus whatever the reader leaves out: sales channels (`excluded`) and ad
// spend channels (`excludedSpend`). A brand's own channel can carry something
// that is not a sale or a cost at all (Onycha's DRC holds returns; a file
// import can turn a "Qty Online" column into a spend channel), so which
// channels count is the reader's call rather than a list fixed here.

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
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const salesFilled = (r) => r.revenue != null || r.transaksi != null || r.qty_sold != null;
const spendFilled = (r) => r.amount_spent != null;

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

// One period's totals, plus the per-channel and per-day detail the panel
// draws. Pure: the rows come in, nothing is read here, so the arithmetic is
// testable without a database.
export function summarizePeriod({ salesRows, spendRows: allSpendRows, start, end, labels, excluded = new Set(), excludedSpend = new Set(), today = todayIso() }) {
  const counted = salesRows.filter((r) => !excluded.has(r.channel_key));
  const spendRows = allSpendRows.filter((r) => !excludedSpend.has(r.channel_key));
  const revenue = sumMaybe(counted.map((r) => r.revenue));
  const qty = sumMaybe(counted.map((r) => r.qty_sold));
  const trx = sumMaybe(counted.map((r) => r.transaksi));
  const amountSpent = sumMaybe(spendRows.map((r) => r.amount_spent));

  const byChannel = (rows, field, names) => {
    const map = new Map();
    for (const r of rows) {
      map.set(r.channel_key, [...(map.get(r.channel_key) ?? []), r[field]]);
    }
    return [...map.entries()]
      .map(([key, values]) => ({ key, label: names[key] ?? key, value: sumMaybe(values) }))
      .filter((c) => c.value != null)
      .sort((a, b) => b.value - a.value);
  };

  // One entry per calendar day, for the daily and cumulative charts and the
  // KPI sparklines. A day nobody entered stays null rather than zero, so a
  // gap in entry reads as a gap.
  const perDay = new Map();
  const add = (date, field, v) => {
    if (v == null || Number.isNaN(Number(v))) return;
    const day = perDay.get(date) ?? {};
    day[field] = (day[field] ?? 0) + Number(v);
    perDay.set(date, day);
  };
  for (const r of counted) {
    add(r.entry_date, 'revenue', r.revenue);
    add(r.entry_date, 'trx', r.transaksi);
    add(r.entry_date, 'qty', r.qty_sold);
  }
  for (const r of spendRows) add(r.entry_date, 'spend', r.amount_spent);
  const daily = [];
  for (let date = start, i = 0; date <= end; date = addDays(date, 1), i += 1) {
    const d = perDay.get(date) ?? {};
    daily.push({ date, dayIndex: i + 1, revenue: d.revenue ?? null, spend: d.spend ?? null, trx: d.trx ?? null, qty: d.qty ?? null });
  }

  // How much of the range is actually filled in. Only days before today are
  // due: today is still being sold and spend lands H-1. A channel with no
  // entry at all in the range is not part of this brand, so it is never
  // reported as incomplete.
  const due = daily.filter((d) => d.date < today).map((d) => d.date);
  const dueSet = new Set(due);
  const daysWith = (rows, filled) => new Set(rows.filter((r) => dueSet.has(r.entry_date) && filled(r)).map((r) => r.entry_date));
  const channelGaps = [];
  for (const [kind, rows, filled, names] of [['sales', counted, salesFilled, labels.sales], ['spend', spendRows, spendFilled, labels.spend]]) {
    const keys = [...new Set(rows.filter(filled).map((r) => r.channel_key))];
    for (const key of keys) {
      const n = daysWith(rows.filter((r) => r.channel_key === key), filled).size;
      if (n < due.length) channelGaps.push({ kind, key, label: names[key] ?? key, filled: n });
    }
  }
  const coverage = {
    due: due.length,
    salesDays: daysWith(counted, salesFilled).size,
    spendDays: daysWith(spendRows, spendFilled).size,
    channelGaps: channelGaps.sort((a, b) => a.filled - b.filled),
  };

  // Ad spend against the sales it buys, channel by channel (ROAS_GROUPS),
  // then every sales channel and every spend channel no group claims, each
  // on its own row with only its own side — so the chart accounts for every
  // rupiah instead of dropping what has no partner.
  const grouped = ROAS_GROUPS.map((g) => {
    const revenueG = sumMaybe(counted.filter((r) => g.sales.includes(r.channel_key)).map((r) => r.revenue));
    const spendG = sumMaybe(spendRows.filter((r) => g.spend.includes(r.channel_key)).map((r) => r.amount_spent));
    return { key: g.key, label: g.label, revenue: revenueG, spend: spendG, roas: ratio(revenueG, spendG) };
  }).filter((g) => g.revenue != null || g.spend != null);
  const groupedSales = new Set(ROAS_GROUPS.flatMap((g) => g.sales));
  const groupedSpend = new Set(ROAS_GROUPS.flatMap((g) => g.spend));
  const channelPairs = [
    ...grouped.map(({ key, label, revenue: r, spend: s }) => ({ key, label, revenue: r, spend: s })),
    ...byChannel(counted.filter((r) => !groupedSales.has(r.channel_key)), 'revenue', labels.sales)
      .map((c) => ({ key: `sales:${c.key}`, label: c.label, revenue: c.value, spend: null })),
    ...byChannel(spendRows.filter((r) => !groupedSpend.has(r.channel_key)), 'amount_spent', labels.spend)
      .map((c) => ({ key: `spend:${c.key}`, label: c.label, revenue: null, spend: c.value })),
  ].sort((a, b) => Math.max(b.revenue ?? 0, b.spend ?? 0) - Math.max(a.revenue ?? 0, a.spend ?? 0));

  return {
    range: { start, end, days: daysBetween(start, end) },
    totals: {
      amountSpent,
      revenue,
      qty,
      trx,
      aov: ratio(revenue, trx),
      aur: ratio(revenue, qty),
      costPerRevenue: ratio(amountSpent, revenue),
      // Blended ROAS: every counted rupiah sold over every rupiah spent, the
      // figure the monthly target sheet calls "ROAS Real".
      roas: ratio(revenue, amountSpent),
    },
    // ROAS per channel: each channel's own sales over the ad spend that buys
    // them (ROAS_GROUPS). A group with neither side filled is left out.
    channelRoas: grouped,
    channelPairs,
    daily,
    coverage,
    hasData: salesRows.length > 0 || allSpendRows.length > 0,
  };
}

async function readPeriod(brandId, start, end, labels, excluded, excludedSpend) {
  const [salesRows, spendRows] = await Promise.all([
    repo.listSalesForMonth(brandId, start, end),
    repo.listSpendForMonth(brandId, start, end),
  ]);
  return {
    ...summarizePeriod({ salesRows, spendRows, start, end, labels, excluded, excludedSpend }),
    keys: { sales: new Set(salesRows.map((r) => r.channel_key)), spend: new Set(spendRows.map((r) => r.channel_key)) },
  };
}

export const METRIC_DEFS = [
  { key: 'amountSpent', label: 'Amount Spent', kind: 'currency', sentiment: 'neutral' },
  { key: 'revenue', label: 'Revenue', kind: 'currency', sentiment: 'higher-better' },
  { key: 'qty', label: 'Qty', kind: 'number', sentiment: 'higher-better' },
  { key: 'trx', label: 'Trx', kind: 'number', sentiment: 'higher-better' },
  { key: 'aov', label: 'AOV', kind: 'currency', sentiment: 'higher-better' },
  { key: 'aur', label: 'AUR', kind: 'currency', sentiment: 'higher-better' },
  { key: 'roas', label: 'ROAS Blended', kind: 'ratio', sentiment: 'higher-better' },
];

const growth = (cur, prev) => (cur == null || prev == null || prev === 0 ? null : ((cur - prev) / prev) * 100);

export async function getExecutiveSummary({ brandId, startDate, endDate, compareStartDate, compareEndDate, excludeChannels = [], excludeSpendChannels = [] }) {
  // Same range one year earlier — the screenshot's third column. Always
  // computed, since it needs no extra input from the filter bar.
  const lastYear = { start: shiftYear(startDate, 1), end: shiftYear(endDate, 1) };
  const excluded = new Set(excludeChannels);
  const excludedSpend = new Set(excludeSpendChannels);

  const labels = await channelLabels(brandId);
  const [current, compare, yoy, brand] = await Promise.all([
    readPeriod(brandId, startDate, endDate, labels, excluded, excludedSpend),
    compareStartDate && compareEndDate ? readPeriod(brandId, compareStartDate, compareEndDate, labels, excluded, excludedSpend) : null,
    readPeriod(brandId, lastYear.start, lastYear.end, labels, excluded, excludedSpend),
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

  // The channels the reader can count or leave out, per kind: any with a row
  // in the main or comparison range, plus any already left out, so switching
  // a channel off never makes its switch disappear. Fixed channels first, in
  // their usual order, then the brand's own.
  const choices = (kind, left) => {
    const inData = (key) => current.keys[kind].has(key) || Boolean(compare?.keys[kind].has(key));
    const order = Object.keys(labels[kind]);
    return [...new Set([...current.keys[kind], ...(compare?.keys[kind] ?? []), ...left])]
      .filter((key) => labels[kind][key] || inData(key))
      .sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999))
      .map((key) => ({ key, label: labels[kind][key] ?? key, counted: !left.has(key) }));
  };

  const strip = ({ keys, ...period }) => period;
  return {
    brand: brand?.brand_name ?? null,
    source: 'daily_tracking',
    metrics,
    channels: { sales: choices('sales', excluded), spend: choices('spend', excludedSpend) },
    current: strip(current),
    compare: compare ? strip(compare) : null,
    lastYear: strip(yoy),
    // Nothing anywhere: the brand has never filled Daily Tracking for any of
    // the three windows, which the card reports as "belum ada data".
    hasAnyData: current.hasData || Boolean(compare?.hasData) || yoy.hasData,
  };
}
