import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
import type { ItemMetricCell } from './shopeeDeepDiveItemPivot';
import { parseOverviewNum } from './shopeeOverview';
import type { DeltaClassName, Sentiment, SheetRow } from './types';
import type { PivotFmt } from './shopeeDeepDivePivot';

// ══════════════════════════════════════════════════════
// SHOPEE ADS — PARETO / TRAFFIC / CONVERSION ANALYSIS
//
// All three replicate sections of the manual reference workbook that pivot
// over the Shopee "Product Performance" export (sheet "Produk dengan
// Performa Terbaik"), one row per product:
//
//   Pareto      — rank by Sales (Confirmed Order), Contribution % + Cumulative
//                 %. Newest period only, no %Change.
//   Traffic     — rank by Clicks / Impressions / CTR, each with %Change.
//   Conversion  — rank by Conversion Rate / Visit→ATC Rate / ATC→Purchase
//                 Rate, each with %Change.
//
// The sheet carries a product-level aggregate row (Kode Variasi === "-")
// plus one row per variant. Only the aggregate rows hold the traffic/
// conversion metrics (variant rows are "-" there) AND the variant rows
// repeat — not split — the parent's Sales figure, so everything here works
// off the aggregate rows only (parseProductPerfRows filters to them).
// ══════════════════════════════════════════════════════

function pickCol(headers: string[], opts: { exact?: string[]; includes?: string[][]; excludes?: string[] }): string | null {
  for (const want of opts.exact ?? []) {
    const hit = headers.find((h) => h.toLowerCase().trim() === want.toLowerCase());
    if (hit) return hit;
  }
  for (const group of opts.includes ?? []) {
    const excludes = (opts.excludes ?? []).map((s) => s.toLowerCase());
    const hit = headers.find((h) => {
      const lc = h.toLowerCase();
      return group.every((k) => lc.includes(k.toLowerCase())) && !excludes.some((k) => lc.includes(k));
    });
    if (hit) return hit;
  }
  return null;
}

export interface ProductPerfRecord {
  key: string; // Kode Produk when present, else the product name — used to align periods
  produk: string;
  kodeProduk: string;
  salesConfirmed: number; // Penjualan (Pesanan Siap Dikirim) (IDR)
  impressions: number; // Jumlah Produk Dilihat
  clicks: number; // Produk Diklik
  ctr: number; // Persentase Klik — percentage
  conversionRate: number; // Tingkat Konversi (Pesanan Siap Dikirim) — percentage
  visitToAtcRate: number; // Pengunjung Produk (ATC) / Produk Diklik — percentage
  atcToPurchaseRate: number; // Pesanan Siap Dikirim / Pengunjung Produk (ATC) — percentage (iferror→0)
  // Raw counts the Product Analysis charts plot directly. `visitors` is the
  // plain "Pengunjung Produk" column, which is NOT the denominator of
  // visitToAtcRate above (that one divides by Produk Diklik) — the rate is
  // left exactly as the existing Traffic/Conversion tables compute it, so
  // nothing already on screen moves. 0 when the export has no such column;
  // hasVisitorsCol() reports that separately so a section can say so instead
  // of drawing a chart of zeros.
  visitors: number;
  atc: number; // Pengunjung Produk (Masuk Keranjang) — the raw ATC count
}

// Whether the export carries a plain "Pengunjung Produk" column, separate
// from "Pengunjung Produk (Masuk Keranjang)".
export function hasVisitorsCol(rows: SheetRow[]): boolean {
  if (!rows.length) return false;
  return pickVisitorsCol(Object.keys(rows[0])) !== null;
}

function pickVisitorsCol(h: string[]): string | null {
  return pickCol(h, {
    exact: ['pengunjung produk', 'pengunjung produk (kunjungan)'],
    includes: [['pengunjung produk']],
    excludes: ['keranjang', 'atc', 'masuk'],
  });
}

// Reads the "Produk dengan Performa Terbaik" sheet rows, keeping only the
// product-level aggregate rows and mapping the Indonesian headers onto the
// metric set the three sections need. Derived rates are recomputed from raw
// counts (matching the reference workbook's pivot calculated fields) rather
// than trusting the sheet's own rounded percentage columns, except
// Conversion Rate which the reference takes straight from the export.
export function parseProductPerfRows(rows: SheetRow[]): ProductPerfRecord[] {
  if (!rows.length) return [];
  const h = Object.keys(rows[0]);
  const col = {
    produk: pickCol(h, { exact: ['produk'], includes: [['produk']], excludes: ['kode', 'unik', 'dilihat', 'diklik'] }),
    kodeProduk: pickCol(h, { exact: ['kode produk'] }),
    kodeVariasi: pickCol(h, { exact: ['kode variasi'] }),
    sales: pickCol(h, { includes: [['penjualan', 'siap dikirim']], excludes: ['per pesanan', 'dibuat'] }),
    impressions: pickCol(h, { exact: ['jumlah produk dilihat'] }),
    clicks: pickCol(h, { exact: ['produk diklik'] }),
    ctr: pickCol(h, { exact: ['persentase klik'] }),
    conversionRate: pickCol(h, { exact: ['tingkat konversi (pesanan siap dikirim)'] }),
    confirmedOrder: pickCol(h, { exact: ['pesanan siap dikirim'] }),
    visitorsAtc: pickCol(h, { includes: [['pengunjung produk', 'keranjang']] }),
    visitors: pickVisitorsCol(h),
  };
  const n = (row: SheetRow, c: string | null) => (c ? parseOverviewNum(row[c]) : 0);
  const out: ProductPerfRecord[] = [];
  for (const r of rows) {
    if (col.kodeVariasi && String(r[col.kodeVariasi] ?? '').trim() !== '-') continue; // variant row, skip
    const produk = col.produk ? String(r[col.produk] ?? '').trim() : '';
    const kodeProduk = col.kodeProduk ? String(r[col.kodeProduk] ?? '').trim() : '';
    if (!produk && !kodeProduk) continue;
    const clicks = n(r, col.clicks);
    const visitorsAtc = n(r, col.visitorsAtc);
    const confirmedOrder = n(r, col.confirmedOrder);
    out.push({
      key: kodeProduk && kodeProduk !== '-' ? kodeProduk : produk,
      produk,
      kodeProduk,
      salesConfirmed: n(r, col.sales),
      impressions: n(r, col.impressions),
      clicks,
      ctr: n(r, col.ctr),
      conversionRate: n(r, col.conversionRate),
      visitToAtcRate: clicks > 0 ? (visitorsAtc / clicks) * 100 : 0,
      atcToPurchaseRate: visitorsAtc > 0 ? (confirmedOrder / visitorsAtc) * 100 : 0,
      visitors: n(r, col.visitors),
      atc: visitorsAtc,
    });
  }
  return out;
}

// ── Pareto ───────────────────────────────────────────────────────────────

export interface ParetoRow {
  key: string;
  produk: string;
  sales: number;
  contribution: number; // % of total
  cumulative: number; // running % (last row = 100)
}

// Sums Sales (Confirmed Order) per product across every month's parsed
// records, so buildPareto below can rank lifetime contribution instead of a
// single period. Other fields are irrelevant to Pareto and just keep
// whichever month's values were seen first.
export function mergeProductPerfBySales(recordSets: ProductPerfRecord[][]): ProductPerfRecord[] {
  const merged = new Map<string, ProductPerfRecord>();
  for (const records of recordSets) {
    for (const r of records) {
      const existing = merged.get(r.key);
      if (existing) existing.salesConfirmed += r.salesConfirmed;
      else merged.set(r.key, { ...r });
    }
  }
  return [...merged.values()];
}

// User-facing control for which uploaded months feed Pareto — "Semua
// Bulan" (every month, the original all-time behavior), "range" (an
// inclusive Bulan Awal–Bulan Akhir span), or "single" (exactly one month).
export interface ParetoRangeSelection {
  mode: 'all' | 'range' | 'single';
  start: string | null; // 'YYYY-MM', range mode
  end: string | null; // 'YYYY-MM', range mode
  single: string | null; // 'YYYY-MM', single mode
}

export const DEFAULT_PARETO_RANGE: ParetoRangeSelection = { mode: 'all', start: null, end: null, single: null };

// One monthly Product Performance upload — the raw sheet rows plus which
// calendar month they belong to (from the brand library's period_month),
// needed to filter by the selection above before merging into Pareto.
export interface ProductPerfMonth {
  month: string; // 'YYYY-MM'
  rows: SheetRow[];
}

export function selectParetoMonths(months: ProductPerfMonth[], sel: ParetoRangeSelection): ProductPerfMonth[] {
  if (sel.mode === 'single') return sel.single ? months.filter((m) => m.month === sel.single) : [];
  if (sel.mode === 'range') {
    if (!sel.start || !sel.end) return [];
    const [lo, hi] = sel.start <= sel.end ? [sel.start, sel.end] : [sel.end, sel.start];
    return months.filter((m) => m.month >= lo && m.month <= hi);
  }
  return months;
}

export function buildPareto(records: ProductPerfRecord[]): ParetoRow[] {
  const ranked = [...records].filter((r) => r.salesConfirmed > 0).sort((a, b) => b.salesConfirmed - a.salesConfirmed);
  const total = ranked.reduce((s, r) => s + r.salesConfirmed, 0);
  let running = 0;
  return ranked.map((r) => {
    const contribution = total > 0 ? (r.salesConfirmed / total) * 100 : 0;
    running += contribution;
    return { key: r.key, produk: r.produk, sales: r.salesConfirmed, contribution, cumulative: running };
  });
}

// ── Traffic / Conversion metric rankings ─────────────────────────────────

export type ProductMetricKey =
  | 'clicks'
  | 'impressions'
  | 'ctr'
  | 'conversionRate'
  | 'visitToAtcRate'
  | 'atcToPurchaseRate'
  | 'visitors'
  | 'atc'
  | 'salesConfirmed';

export interface ProductMetricDef {
  key: ProductMetricKey;
  label: string;
  fmt: PivotFmt;
  sentiment: Sentiment;
}

export const TRAFFIC_METRIC_DEFS: readonly ProductMetricDef[] = [
  { key: 'clicks', label: 'Clicks', fmt: 'num', sentiment: 'higher-better' },
  { key: 'impressions', label: 'Impressions', fmt: 'num', sentiment: 'higher-better' },
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', sentiment: 'higher-better' },
];

export const CONVERSION_METRIC_DEFS: readonly ProductMetricDef[] = [
  { key: 'conversionRate', label: 'Conversion Rate', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'visitToAtcRate', label: 'Visit → ATC Rate', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'atcToPurchaseRate', label: 'ATC → Purchase Rate', fmt: 'pct', sentiment: 'higher-better' },
];

export interface ProductRankRow {
  key: string;
  produk: string;
  old: number | null; // null when the product is absent in the old period, or when there is no old period at all
  cur: number | null;
  deltaNum: number | null;
  delta: string;
  cls: DeltaClassName;
}

// Ranks products by `metric` for the current period (descending), with the
// old-period value and %Change alongside. When `oldRecords` is empty the
// old/%Change columns are all null — the caller renders a single-period
// table and prompts for the older upload (decision: never hide the section).
export function buildProductRanking(
  oldRecords: ProductPerfRecord[],
  curRecords: ProductPerfRecord[],
  metric: ProductMetricKey,
  sentiment: Sentiment,
): ProductRankRow[] {
  const hasOld = oldRecords.length > 0;
  const oldByKey = new Map(oldRecords.map((r) => [r.key, r]));
  const rows: ProductRankRow[] = curRecords.map((r) => {
    const cur = r[metric];
    const oldRec = oldByKey.get(r.key);
    const old = hasOld ? (oldRec ? oldRec[metric] : null) : null;
    const { deltaNum, deltaStr } = old === null ? { deltaNum: null, deltaStr: '—' } : computeDelta(old, cur);
    return {
      key: r.key,
      produk: r.produk,
      old,
      cur,
      deltaNum,
      delta: hasOld ? formatDeltaID(deltaNum, deltaStr) : '—',
      cls: deltaClassForSentiment(deltaNum, sentiment),
    };
  });
  return rows.sort((a, b) => (b.cur ?? 0) - (a.cur ?? 0));
}

export interface ProductMetricRanking {
  metric: ProductMetricKey;
  label: string;
  fmt: PivotFmt;
  rows: ProductRankRow[];
}

export function buildProductRankings(
  oldRecords: ProductPerfRecord[],
  curRecords: ProductPerfRecord[],
  defs: readonly ProductMetricDef[],
): ProductMetricRanking[] {
  return defs.map((def) => ({
    metric: def.key,
    label: def.label,
    fmt: def.fmt,
    rows: buildProductRanking(oldRecords, curRecords, def.key, def.sentiment),
  }));
}

// ── Product Analysis charts — metric pairs and their %Change series ───────
//
// The three "Lowest & Highest" charts each plot ONE pair of metrics as
// grouped bars, one group per product. What the bars carry is the %Change
// between the two uploaded periods, not the absolute value: the pairs mix
// units (Impressions in the tens of thousands next to a CTR of 5%), so a
// shared axis only works once both are expressed as change. It also makes
// the Highest/Lowest toggle mean something — which products moved most.
//
// Pareto and Produk Potensial are single-period by design and live below.

// A chart group is a set of metrics that answer one question, not a fixed
// pair: Traffic is read by reach (Impressions), by volume (Clicks) and by
// efficiency (CTR). The chart draws ONE of them at a time — the one being
// sorted by — because a second series the reader did not ask to rank is
// noise competing with the ranking they did ask for.
export interface ProductChartGroupDef {
  id: 'traffic' | 'conversion';
  title: string;
  metrics: readonly ProductMetricDef[];
}

const M = {
  impressions: { key: 'impressions', label: 'Impressions', fmt: 'num', sentiment: 'higher-better' },
  clicks: { key: 'clicks', label: 'Clicks', fmt: 'num', sentiment: 'higher-better' },
  ctr: { key: 'ctr', label: 'CTR', fmt: 'pct', sentiment: 'higher-better' },
  visitors: { key: 'visitors', label: 'Visitor', fmt: 'num', sentiment: 'higher-better' },
  visitToAtcRate: { key: 'visitToAtcRate', label: 'ATC Rate', fmt: 'pct', sentiment: 'higher-better' },
  atc: { key: 'atc', label: 'ATC', fmt: 'num', sentiment: 'higher-better' },
  atcToPurchaseRate: { key: 'atcToPurchaseRate', label: 'Purchase Rate', fmt: 'pct', sentiment: 'higher-better' },
  revenue: { key: 'salesConfirmed', label: 'Revenue', fmt: 'rp', sentiment: 'higher-better' },
  conversionRate: { key: 'conversionRate', label: 'Conversion Rate', fmt: 'pct', sentiment: 'higher-better' },
} as const satisfies Record<string, ProductMetricDef>;

export const PRODUCT_CHART_GROUPS: readonly ProductChartGroupDef[] = [
  { id: 'traffic', title: 'Traffic Analysis', metrics: [M.impressions, M.ctr, M.clicks] },
  // Visit → ATC and ATC → Purchase used to be two charts of two metrics each.
  // They answer one question — where conversion leaks — so they are one chart
  // whose metric picker walks the funnel: overall, then each step.
  { id: 'conversion', title: 'Conversion Analysis', metrics: [M.conversionRate, M.visitToAtcRate, M.atcToPurchaseRate] },
];

// Parallel arrays indexed by the group's metric order: pct[i] is the
// %Change of metrics[i]. Null means the product is absent from the older
// period, so no comparison exists — the chart drops it rather than drawing a
// 0% bar, which would read as "did not move".
export interface ProductChartPoint {
  key: string;
  produk: string;
  pct: (number | null)[];
  old: (number | null)[];
  cur: (number | null)[];
}

// Joins every metric's per-product ranking by product key, so one chart can
// switch between them without refetching or re-deriving anything.
export function buildProductChartPoints(
  oldRecords: ProductPerfRecord[],
  curRecords: ProductPerfRecord[],
  group: ProductChartGroupDef,
): ProductChartPoint[] {
  const perMetric = group.metrics.map(
    (m) => new Map(buildProductRanking(oldRecords, curRecords, m.key, m.sentiment).map((r) => [r.key, r] as const)),
  );
  const lead = buildProductRanking(oldRecords, curRecords, group.metrics[0].key, group.metrics[0].sentiment);
  return lead.map((r) => ({
    key: r.key,
    produk: r.produk,
    pct: perMetric.map((m) => m.get(r.key)?.deltaNum ?? null),
    old: perMetric.map((m) => m.get(r.key)?.old ?? null),
    cur: perMetric.map((m) => m.get(r.key)?.cur ?? null),
  }));
}

export type ChartDirection = 'highest' | 'lowest';

// Sorts by the chosen metric's %Change and takes the top N. Products with no
// %Change for that metric are excluded from the ranking entirely.
export function rankProductPoints(points: ProductChartPoint[], metricIndex: number, direction: ChartDirection, count: number): ProductChartPoint[] {
  const pick = (p: ProductChartPoint) => p.pct[metricIndex] ?? null;
  return points
    .filter((p) => pick(p) !== null)
    .sort((x, y) => (direction === 'highest' ? (pick(y) as number) - (pick(x) as number) : (pick(x) as number) - (pick(y) as number)))
    .slice(0, count);
}

// ── Produk Potensial ─────────────────────────────────────────────────────
export interface PotentialProduct {
  key: string;
  produk: string;
  revenue: number;
  conversionRate: number;
}

// Top N by revenue in the newest period. "Potensial" is read as "already
// earning" — revenue leads the sort, conversion rate rides alongside so a
// high-revenue product converting badly is visible as a headroom case.
export function buildPotentialProducts(curRecords: ProductPerfRecord[], count = 10): PotentialProduct[] {
  return [...curRecords]
    .filter((r) => r.salesConfirmed > 0)
    .sort((a, b) => b.salesConfirmed - a.salesConfirmed)
    .slice(0, count)
    .map((r) => ({ key: r.key, produk: r.produk, revenue: r.salesConfirmed, conversionRate: r.conversionRate }));
}

// ── "Per Performa" item pivot (Analisis Per Item) ────────────────────────
// A dedicated metric universe drawn only from the "Produk dengan Performa
// Terbaik" sheet's own columns — kept separate from ItemMetricVars (which
// covers Iklan Produk/Toko ad exports) so the "Per Performa" tab's metric
// picker never offers a column this sheet doesn't actually have.

export interface PerfMetricVars {
  impressions: number;
  clicks: number;
  ctr: number;
  atc: number;
  atcRate: number;
  ordersCreated: number;
  ordersReady: number;
  buyersCreated: number;
  buyersReady: number;
  conversionCreated: number;
  conversionReady: number;
  salesCreated: number;
  salesReady: number;
  aovCreated: number;
  aovReady: number;
  visitors: number;
  likes: number;
}

export const PERFORMANCE_BUILTIN_METRICS: readonly { key: keyof PerfMetricVars; label: string; fmt: PivotFmt; sentiment: Sentiment }[] = [
  { key: 'ordersReady', label: 'Pesanan Siap Dikirim', fmt: 'num', sentiment: 'higher-better' },
  { key: 'buyersReady', label: 'Order', fmt: 'num', sentiment: 'higher-better' },
  { key: 'atc', label: 'ATC', fmt: 'num', sentiment: 'higher-better' },
  { key: 'atcRate', label: 'Tingkat ATC', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'impressions', label: 'Dilihat', fmt: 'num', sentiment: 'higher-better' },
  { key: 'clicks', label: 'Diklik', fmt: 'num', sentiment: 'higher-better' },
  { key: 'ctr', label: 'CTR', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'visitors', label: 'Pengunjung', fmt: 'num', sentiment: 'higher-better' },
  { key: 'ordersCreated', label: 'Pesanan Dibuat', fmt: 'num', sentiment: 'higher-better' },
  { key: 'buyersCreated', label: 'Pembeli (Pesanan Dibuat)', fmt: 'num', sentiment: 'higher-better' },
  { key: 'conversionReady', label: 'Konversi (Siap Dikirim)', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'conversionCreated', label: 'Konversi (Dibuat)', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'salesReady', label: 'Penjualan (Siap Dikirim)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'salesCreated', label: 'Penjualan (Dibuat)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'aovReady', label: 'AOV (Siap Dikirim)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'aovCreated', label: 'AOV (Dibuat)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'likes', label: 'Suka', fmt: 'num', sentiment: 'higher-better' },
];

export const DEFAULT_PERFORMANCE_SELECTIONS: readonly (keyof PerfMetricVars)[] = ['buyersReady', 'atc'];

// Every column below is matched by its exact Shopee header — several of the
// sheet's headers are near-duplicates that only differ by "Pesanan Dibuat"
// vs "Pesanan Siap Dikirim" (e.g. "Tingkat Konversi Pesanan (...)" vs
// "Tingkat Konversi (...)"), so pickCol's fuzzy `includes` fallback is too
// eager to trust here — exact match only.
function performanceCols(h: string[]) {
  return {
    produk: pickCol(h, { exact: ['produk'], includes: [['produk']], excludes: ['kode', 'unik', 'dilihat', 'diklik'] }),
    kodeProduk: pickCol(h, { exact: ['kode produk'] }),
    kodeVariasi: pickCol(h, { exact: ['kode variasi'] }),
    impressions: pickCol(h, { exact: ['jumlah produk dilihat'] }),
    clicks: pickCol(h, { exact: ['produk diklik'] }),
    ctr: pickCol(h, { exact: ['persentase klik'] }),
    atc: pickCol(h, { exact: ['pengunjung produk (menambahkan produk ke keranjang)'] }),
    atcRate: pickCol(h, { exact: ['tingkat konversi produk dimasukkan ke keranjang'] }),
    ordersCreated: pickCol(h, { exact: ['pesanan dibuat'] }),
    ordersReady: pickCol(h, { exact: ['pesanan siap dikirim'] }),
    buyersCreated: pickCol(h, { exact: ['total pembeli (pesanan dibuat)'] }),
    buyersReady: pickCol(h, { exact: ['total pembeli (pesanan siap dikirim)'] }),
    conversionCreated: pickCol(h, { exact: ['tingkat konversi (pesanan yang dibuat)'] }),
    conversionReady: pickCol(h, { exact: ['tingkat konversi (pesanan siap dikirim)'] }),
    salesCreated: pickCol(h, { exact: ['total penjualan (pesanan dibuat) (idr)'] }),
    salesReady: pickCol(h, { exact: ['penjualan (pesanan siap dikirim) (idr)'] }),
    aovCreated: pickCol(h, { exact: ['penjualan per pesanan (pesanan dibuat) (idr)'] }),
    aovReady: pickCol(h, { exact: ['penjualan per pesanan (pesanan siap dikirim) (idr)'] }),
    visitors: pickVisitorsCol(h),
    likes: pickCol(h, { exact: ['suka'] }),
  };
}

function parsePerformanceGroups(rows: SheetRow[]): Map<string, { produk: string; vars: PerfMetricVars }> {
  const out = new Map<string, { produk: string; vars: PerfMetricVars }>();
  if (!rows.length) return out;
  const h = Object.keys(rows[0]);
  const col = performanceCols(h);
  const n = (row: SheetRow, c: string | null) => (c ? parseOverviewNum(row[c]) : 0);
  for (const r of rows) {
    if (col.kodeVariasi && String(r[col.kodeVariasi] ?? '').trim() !== '-') continue; // variant row, skip
    const produk = col.produk ? String(r[col.produk] ?? '').trim() : '';
    const kodeProduk = col.kodeProduk ? String(r[col.kodeProduk] ?? '').trim() : '';
    if (!produk && !kodeProduk) continue;
    const key = kodeProduk && kodeProduk !== '-' ? kodeProduk : produk;
    out.set(key, {
      produk: produk || key,
      vars: {
        impressions: n(r, col.impressions),
        clicks: n(r, col.clicks),
        ctr: n(r, col.ctr),
        atc: n(r, col.atc),
        atcRate: n(r, col.atcRate),
        ordersCreated: n(r, col.ordersCreated),
        ordersReady: n(r, col.ordersReady),
        buyersCreated: n(r, col.buyersCreated),
        buyersReady: n(r, col.buyersReady),
        conversionCreated: n(r, col.conversionCreated),
        conversionReady: n(r, col.conversionReady),
        salesCreated: n(r, col.salesCreated),
        salesReady: n(r, col.salesReady),
        aovCreated: n(r, col.aovCreated),
        aovReady: n(r, col.aovReady),
        visitors: n(r, col.visitors),
        likes: n(r, col.likes),
      },
    });
  }
  return out;
}

export interface PerformancePivotRow {
  key: string;
  produk: string;
  metrics: ItemMetricCell[];
}

// Sorted by |%Change| of the first selected metric descending — same "what
// moved the most" default as buildProdukPivot/buildKeywordPivot.
export function buildPerformancePivot(
  oldRows: SheetRow[],
  curRows: SheetRow[],
  selectedKeys: readonly (keyof PerfMetricVars)[] = DEFAULT_PERFORMANCE_SELECTIONS,
): PerformancePivotRow[] {
  const oldGroups = parsePerformanceGroups(oldRows);
  const curGroups = parsePerformanceGroups(curRows);
  const keys = new Set([...oldGroups.keys(), ...curGroups.keys()]);
  const defByKey = new Map(PERFORMANCE_BUILTIN_METRICS.map((m) => [m.key, m]));
  const rows: PerformancePivotRow[] = [];
  for (const key of keys) {
    const gOld = oldGroups.get(key);
    const gCur = curGroups.get(key);
    const produk = gCur?.produk ?? gOld?.produk ?? key;
    const metrics: ItemMetricCell[] = selectedKeys.map((mk) => {
      const def = defByKey.get(mk);
      const oldVal = gOld ? gOld.vars[mk] : 0;
      const curVal = gCur ? gCur.vars[mk] : 0;
      const { deltaNum, deltaStr } = computeDelta(oldVal, curVal);
      return {
        id: mk,
        label: def?.label ?? mk,
        fmt: def?.fmt ?? 'num',
        old: oldVal,
        cur: curVal,
        deltaNum,
        delta: formatDeltaID(deltaNum, deltaStr),
        cls: deltaClassForSentiment(deltaNum, def?.sentiment ?? 'neutral'),
      };
    });
    rows.push({ key, produk, metrics });
  }
  return rows.sort((a, b) => Math.abs(b.metrics[0]?.deltaNum ?? 0) - Math.abs(a.metrics[0]?.deltaNum ?? 0));
}
