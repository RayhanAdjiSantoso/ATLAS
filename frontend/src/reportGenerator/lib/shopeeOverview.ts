import { computeDelta, deltaClassForSentiment, safeDiv } from './delta';
import type { DeltaClassName, Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// SHOPEE PRODUCT OVERVIEW PARSING — ported 1:1 from the original vanilla-JS logic.
// ══════════════════════════════════════════════════════

// NOTE: unlike parseShopeeNum (Shopee Ads export), the Product Overview export
// uses "." as thousands separator and "," as decimal — the original code's
// own inconsistency, preserved here rather than "fixed" as part of a 1:1 port.
export function parseOverviewNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).trim().replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.]/g, '');
  return parseFloat(s) || 0;
}

// Detects a period from the Product Overview filename (e.g.
// "...20260701_20260731...") — purely cosmetic (shown next to the row count),
// not fed into the report's period labels the way Shopee Ads/TikTok's
// filename detection is.
export function periodFromOverviewFilename(filename: string): string {
  const mn = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  const m = filename.match(/(\d{4})(\d{2})\d{2}.*?(\d{4})(\d{2})\d{2}/);
  if (!m) return '';
  const mo1 = parseInt(m[2]) - 1;
  const yr1 = m[1];
  const mo2 = parseInt(m[4]) - 1;
  const yr2 = m[3];
  return mo1 === mo2 && yr1 === yr2 ? mn[mo1] + ' ' + yr1 : mn[mo1] + '–' + mn[mo2] + ' ' + yr2;
}

export interface OverviewMetrics {
  pengunjung: number;
  produkDilihat: number;
  atc: number;
  produkAtc: number;
  purchase: number;
  produkDibeli: number;
  purchaseValue: number;
}

export function calcOverviewMetrics(rows: SheetRow[]): OverviewMetrics | null {
  if (!rows || !rows.length) return null;
  const findCol = (kw: string) => Object.keys(rows[0]).find((h) => h.toLowerCase().includes(kw.toLowerCase())) || null;
  const colPengunjung = findCol('Kunjungan');
  const colDilihat = findCol('Halaman Produk Dilihat');
  const colAtcVisitor = findCol('Menambahkan Produk ke Keranjang');
  const colAtcProduk = findCol('Dimasukkan ke Keranjang (Produk)');
  const colPurchase = findCol('Total Pembeli (Pesanan Dibuat)');
  const colProdukDibeli = findCol('Produk (Pesanan Dibuat)');
  const colPurchaseVal = findCol('Total Penjualan (Pesanan Dibuat)');
  const sum = (col: string | null) => (col ? rows.reduce((s, r) => s + parseOverviewNum(r[col]), 0) : 0);
  return {
    pengunjung: sum(colPengunjung),
    produkDilihat: sum(colDilihat),
    atc: sum(colAtcVisitor),
    produkAtc: sum(colAtcProduk),
    purchase: sum(colPurchase),
    produkDibeli: sum(colProdukDibeli),
    purchaseValue: sum(colPurchaseVal),
  };
}

export type OverviewMetricFmt = 'num' | 'rp' | 'pct';

export interface OverviewMetricDef {
  key: keyof OverviewMetrics;
  label: string;
  fmt: OverviewMetricFmt;
  sentiment: Sentiment;
}

export const OVERVIEW_METRIC_DEFS: OverviewMetricDef[] = [
  { key: 'pengunjung', label: 'Pengunjung', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkDilihat', label: 'Produk Dilihat', fmt: 'num', sentiment: 'higher-better' },
  { key: 'atc', label: 'Add to Cart (ATC)', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkAtc', label: 'Produk ATC', fmt: 'num', sentiment: 'higher-better' },
  { key: 'purchase', label: 'Purchase', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkDibeli', label: 'Produk Dibeli', fmt: 'num', sentiment: 'higher-better' },
  { key: 'purchaseValue', label: 'Purchase Value', fmt: 'rp', sentiment: 'higher-better' },
];

// Derived ratio metrics — computed purely from the 7 metrics above, not from
// any new raw column. Kept in a separate defs array (and rendered in its own
// "Conversion & Ratio Metrics" sub-section) so it's visually obvious to a
// non-technical reader that these are calculated, not raw export data.
export interface OverviewCalcMetricDef {
  key: string;
  label: string;
  fmt: OverviewMetricFmt;
  sentiment: Sentiment;
  // Returns null (rendered "—") instead of Infinity/NaN when the underlying
  // denominator is 0 — see safeDiv.
  calc: (m: OverviewMetrics) => number | null;
}

export const OVERVIEW_CALC_METRIC_DEFS: OverviewCalcMetricDef[] = [
  // Denominator is "Add to Cart (ATC)" (visitor-level), NOT "Produk ATC"
  // (product-level) — ATC to Order tracks how many ATC-ing visitors convert.
  { key: 'atcToOrder', label: 'ATC to Order (%)', fmt: 'pct', sentiment: 'higher-better', calc: (m) => pctOrNull(m.purchase, m.atc) },
  { key: 'conversionRate', label: 'Conversion Rate (%)', fmt: 'pct', sentiment: 'higher-better', calc: (m) => pctOrNull(m.purchase, m.pengunjung) },
  { key: 'aov', label: 'AOV - Average Order Value (Rp)', fmt: 'rp', sentiment: 'higher-better', calc: (m) => safeDiv(m.purchaseValue, m.purchase) },
  { key: 'aur', label: 'AUR - Average Unit Retail (Rp)', fmt: 'rp', sentiment: 'higher-better', calc: (m) => safeDiv(m.purchaseValue, m.produkDibeli) },
];

function pctOrNull(num: number, den: number): number | null {
  const r = safeDiv(num, den);
  return r === null ? null : r * 100;
}

export interface OverviewKpiRow {
  key: string;
  label: string;
  old: string;
  cur: string;
  deltaNum: number | null;
  delta: string;
  cls: DeltaClassName;
}

function fmtOverviewVal(v: number | null, fmt: OverviewMetricFmt): string {
  if (v === null) return '—';
  if (fmt === 'rp') return 'Rp' + Math.round(v).toLocaleString('id-ID');
  if (fmt === 'pct') return v.toFixed(2) + '%';
  return Math.round(v).toLocaleString('id-ID');
}

function buildOverviewRow(key: string, label: string, vOld: number | null, vCur: number | null, fmt: OverviewMetricFmt, sentiment: Sentiment): OverviewKpiRow {
  const { deltaNum, deltaStr } = vOld !== null && vCur !== null ? computeDelta(vOld, vCur) : { deltaNum: null, deltaStr: '—' };
  const cls = deltaClassForSentiment(deltaNum, sentiment);
  return {
    key,
    label,
    old: fmtOverviewVal(vOld, fmt),
    cur: fmtOverviewVal(vCur, fmt),
    deltaNum,
    delta: deltaStr,
    cls,
  };
}

// Pure row-builder extracted from the original buildOverviewKPITable (which
// mixed this calculation with HTML string rendering) — the JSX table itself
// is built by the Shopee tab UI component in a later checkpoint.
export function buildOverviewKPIRows(mOld: OverviewMetrics | null, mCur: OverviewMetrics | null): OverviewKpiRow[] {
  return OVERVIEW_METRIC_DEFS.map((def) => buildOverviewRow(def.key, def.label, mOld ? mOld[def.key] : null, mCur ? mCur[def.key] : null, def.fmt, def.sentiment));
}

// Same shape as buildOverviewKPIRows, for the derived ratio metrics.
export function buildOverviewCalcRows(mOld: OverviewMetrics | null, mCur: OverviewMetrics | null): OverviewKpiRow[] {
  return OVERVIEW_CALC_METRIC_DEFS.map((def) => buildOverviewRow(def.key, def.label, mOld ? def.calc(mOld) : null, mCur ? def.calc(mCur) : null, def.fmt, def.sentiment));
}
