import { safeDiv } from '../../../lib/delta';
import { sumMaybe } from '../../../lib/business';
import type { DataBlock, TableRow } from '../types';
import { addBlock, chartBlock, count, dec, deltaOf, kpiBlock, kpiRow, L, money, tableBlock } from './helpers';

// Business Overview figures (Brand Tracking › Revenue Data), the same source and
// the same channel totals as the Business Overview tab. Only channels someone
// actually filled in appear: an empty channel is not a channel with zero sales.

export interface SalesDay {
  revenue: number | null;
  transaksi: number | null;
  qtySold: number | null;
}
export type SalesGrid = Record<string, Record<string, SalesDay>>;
export interface SalesChannel {
  key: string;
  label: string;
}

interface Totals {
  revenue: number | null;
  trx: number | null;
  qty: number | null;
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function channelTotals(grid: SalesGrid, key: string, start: string, end: string): Totals {
  const days = Object.entries(grid[key] ?? {}).filter(([d]) => inRange(d.slice(0, 10), start, end)).map(([, v]) => v);
  return { revenue: sumMaybe(days.map((d) => d?.revenue)), trx: sumMaybe(days.map((d) => d?.transaksi)), qty: sumMaybe(days.map((d) => d?.qtySold)) };
}

const addTotals = (list: Totals[]): Totals => ({
  revenue: sumMaybe(list.map((t) => t.revenue)),
  trx: sumMaybe(list.map((t) => t.trx)),
  qty: sumMaybe(list.map((t) => t.qty)),
});

function dailyRevenue(grid: SalesGrid, channels: SalesChannel[], start: string, end: string): Map<number, number> {
  const byDay = new Map<number, number>();
  for (const c of channels) {
    for (const [date, v] of Object.entries(grid[c.key] ?? {})) {
      const iso = date.slice(0, 10);
      if (!inRange(iso, start, end) || v?.revenue == null) continue;
      const day = Number(iso.slice(8, 10));
      byDay.set(day, (byDay.get(day) ?? 0) + v.revenue);
    }
  }
  return byDay;
}

export interface MonthGrid {
  month: string; // YYYY-MM
  label: string;
  grid: SalesGrid;
}

export interface BusinessBlocksResult {
  blocks: Record<string, DataBlock>;
  ids: Record<'kpi' | 'daily' | 'channelChart' | 'channelTable' | 'trend', string | null>;
  revenue: { old: number | null; cur: number | null } | null;
}

export function buildBusinessBlocks(input: {
  channels: SalesChannel[];
  oldGrid: SalesGrid;
  curGrid: SalesGrid;
  history: MonthGrid[];
  oldStart: string;
  oldEnd: string;
  curStart: string;
  curEnd: string;
  p1: string;
  p2: string;
}): BusinessBlocksResult {
  const { channels, oldGrid, curGrid, oldStart, oldEnd, curStart, curEnd, p1, p2 } = input;
  const blocks: Record<string, DataBlock> = {};
  const rows = channels.map((c) => ({ ...c, old: channelTotals(oldGrid, c.key, oldStart, oldEnd), cur: channelTotals(curGrid, c.key, curStart, curEnd) }));
  const filled = rows.filter((r) => r.old.revenue !== null || r.cur.revenue !== null);
  if (!filled.length) return { blocks, ids: { kpi: null, daily: null, channelChart: null, channelTable: null, trend: null }, revenue: null };

  const o = addTotals(rows.map((r) => r.old));
  const c = addTotals(rows.map((r) => r.cur));
  const kpi = addBlock(blocks, kpiBlock('business.kpi', 'business', L('Sales Performance'), [
    kpiRow('Revenue', money(o.revenue), money(c.revenue), 'higher-better'),
    kpiRow('Transactions', count(o.trx), count(c.trx), 'higher-better'),
    kpiRow('Qty', count(o.qty), count(c.qty), 'higher-better'),
    kpiRow('AOV', money(safeDiv(o.revenue, o.trx)), money(safeDiv(c.revenue, c.trx)), 'higher-better'),
    kpiRow('AUR', money(safeDiv(o.revenue, o.qty)), money(safeDiv(c.revenue, c.qty)), 'higher-better'),
    kpiRow('Avg. Basket Size', dec(safeDiv(o.qty, o.trx)), dec(safeDiv(c.qty, c.trx)), 'higher-better'),
  ], L('Sumber: Brand Tracking › Revenue Data (seluruh channel penjualan).', 'Source: Brand Tracking › Revenue Data (all sales channels).')));

  const oldDaily = dailyRevenue(oldGrid, channels, oldStart, oldEnd);
  const curDaily = dailyRevenue(curGrid, channels, curStart, curEnd);
  const lastDay = Math.max(0, ...oldDaily.keys(), ...curDaily.keys());
  const dayLabels = Array.from({ length: lastDay }, (_, i) => String(i + 1));
  const daily = addBlock(blocks, chartBlock('business.daily', 'business', L('Revenue Harian', 'Daily Revenue'), 'line', dayLabels, [
    { label: p1, role: 'old', values: dayLabels.map((_, i) => oldDaily.get(i + 1) ?? null) },
    { label: p2, role: 'cur', values: dayLabels.map((_, i) => curDaily.get(i + 1) ?? null) },
  ], 'money'));

  const bySales = [...filled].sort((a, b) => (b.cur.revenue ?? 0) - (a.cur.revenue ?? 0));
  const top = bySales.slice(0, 10);
  const channelChart = addBlock(blocks, chartBlock('business.channels.chart', 'business', L('Revenue per Channel', 'Revenue by Channel'), 'bar', top.map((r) => r.label), [
    { label: p1, role: 'old', values: top.map((r) => r.old.revenue) },
    { label: p2, role: 'cur', values: top.map((r) => r.cur.revenue) },
  ], 'money', bySales.length > top.length ? L(`Menampilkan ${top.length} channel dengan revenue terbesar.`, `Showing the top ${top.length} channels by revenue.`) : undefined));

  const tableRows: TableRow[] = bySales.map((r) => ({
    name: r.label,
    // Returns can leave a channel's month net negative, and an average over that means nothing.
    cells: { old: money(r.old.revenue), cur: money(r.cur.revenue), trx: count(r.cur.trx), aov: money((r.cur.trx ?? 0) > 0 ? safeDiv(r.cur.revenue, r.cur.trx) : null) },
    delta: deltaOf(r.old.revenue, r.cur.revenue, 'higher-better'),
  }));
  const channelTable = addBlock(blocks, tableBlock('business.channels.table', 'business', L('Channel Revenue'), 'Channel', [
    { key: 'old', label: 'Revenue · {old}' }, { key: 'cur', label: 'Revenue · {cur}' }, { key: 'trx', label: 'Transactions' }, { key: 'aov', label: 'AOV' },
  ], tableRows, { deltaLabel: 'Changes' }));

  // Month by month, per channel, the way the monthly decks stack it.
  const history = input.history.filter((m) => channels.some((ch) => Object.keys(m.grid[ch.key] ?? {}).length));
  const stack = bySales.slice(0, 6);
  const monthTotal = (m: MonthGrid, key: string) => sumMaybe(Object.values(m.grid[key] ?? {}).map((d) => d?.revenue));
  const trend = history.length >= 2
    ? addBlock(blocks, chartBlock('business.trend', 'business', L('Tren Revenue per Channel', 'Revenue Trend by Channel'), 'stacked', history.map((m) => m.label), stack.map((ch) => ({ label: ch.label, values: history.map((m) => monthTotal(m, ch.key)) })), 'money'))
    : null;

  return { blocks, ids: { kpi, daily, channelChart, channelTable, trend }, revenue: { old: o.revenue, cur: c.revenue } };
}
