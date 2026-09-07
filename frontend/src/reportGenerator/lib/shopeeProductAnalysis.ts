import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
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

export interface ProductChartPairDef {
  id: 'traffic' | 'visit-atc' | 'atc-purchase';
  title: string;
  a: ProductMetricDef;
  b: ProductMetricDef;
}

const M = {
  impressions: { key: 'impressions', label: 'Impressions', fmt: 'num', sentiment: 'higher-better' },
  ctr: { key: 'ctr', label: 'CTR', fmt: 'pct', sentiment: 'higher-better' },
  visitors: { key: 'visitors', label: 'Visitor', fmt: 'num', sentiment: 'higher-better' },
  visitToAtcRate: { key: 'visitToAtcRate', label: 'ATC Rate', fmt: 'pct', sentiment: 'higher-better' },
  atc: { key: 'atc', label: 'ATC', fmt: 'num', sentiment: 'higher-better' },
  atcToPurchaseRate: { key: 'atcToPurchaseRate', label: 'Purchase Rate', fmt: 'pct', sentiment: 'higher-better' },
  revenue: { key: 'salesConfirmed', label: 'Revenue', fmt: 'rp', sentiment: 'higher-better' },
  conversionRate: { key: 'conversionRate', label: 'Conversion Rate', fmt: 'pct', sentiment: 'higher-better' },
} as const satisfies Record<string, ProductMetricDef>;

export const PRODUCT_CHART_PAIRS: readonly ProductChartPairDef[] = [
  { id: 'traffic', title: 'Traffic Analysis', a: M.impressions, b: M.ctr },
  { id: 'visit-atc', title: 'Visit → ATC Rate', a: M.visitors, b: M.visitToAtcRate },
  { id: 'atc-purchase', title: 'ATC → Purchase Rate', a: M.atc, b: M.atcToPurchaseRate },
];

export const POTENTIAL_METRICS = { revenue: M.revenue, conversionRate: M.conversionRate };

export interface ProductPairPoint {
  key: string;
  produk: string;
  aPct: number | null; // %Change of metric A — null when the product is new
  bPct: number | null;
  aOld: number | null;
  aCur: number | null;
  bOld: number | null;
  bCur: number | null;
}

// Joins the two metrics' per-product rankings by product key so one chart can
// draw both bars. Products missing from the older period have a null %Change
// and are dropped by the chart rather than shown as a 0% bar, which would
// read as "did not move" when the truth is "no comparison exists".
export function buildProductPairChange(
  oldRecords: ProductPerfRecord[],
  curRecords: ProductPerfRecord[],
  pair: ProductChartPairDef,
): ProductPairPoint[] {
  const aRows = buildProductRanking(oldRecords, curRecords, pair.a.key, pair.a.sentiment);
  const bByKey = new Map(buildProductRanking(oldRecords, curRecords, pair.b.key, pair.b.sentiment).map((r) => [r.key, r]));
  return aRows.map((a) => {
    const b = bByKey.get(a.key);
    return {
      key: a.key,
      produk: a.produk,
      aPct: a.deltaNum,
      bPct: b?.deltaNum ?? null,
      aOld: a.old,
      aCur: a.cur,
      bOld: b?.old ?? null,
      bCur: b?.cur ?? null,
    };
  });
}

export type ChartDirection = 'highest' | 'lowest';

// Sorts by the chosen metric's %Change and takes the top N. Products with no
// %Change for that metric are excluded from the ranking entirely.
export function rankProductPairs(points: ProductPairPoint[], sortBy: 'a' | 'b', direction: ChartDirection, count: number): ProductPairPoint[] {
  const pick = (p: ProductPairPoint) => (sortBy === 'a' ? p.aPct : p.bPct);
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
export function buildPotentialProducts(curRecords: ProductPerfRecord[], count = 5): PotentialProduct[] {
  return [...curRecords]
    .filter((r) => r.salesConfirmed > 0)
    .sort((a, b) => b.salesConfirmed - a.salesConfirmed)
    .slice(0, count)
    .map((r) => ({ key: r.key, produk: r.produk, revenue: r.salesConfirmed, conversionRate: r.conversionRate }));
}
