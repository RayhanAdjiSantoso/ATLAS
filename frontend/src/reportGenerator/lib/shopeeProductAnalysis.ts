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

export type ProductMetricKey = 'clicks' | 'impressions' | 'ctr' | 'conversionRate' | 'visitToAtcRate' | 'atcToPurchaseRate';

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
