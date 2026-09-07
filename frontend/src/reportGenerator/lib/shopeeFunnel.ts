import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
import { findShopeeCol, parseShopeeNum } from './shopeeAds';
import type { PivotFmt } from './shopeeDeepDivePivot';
import type { DeltaClassName, Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// SHOPEE ADS — FUNDAMENTAL ANALYSIS (funnel decomposition)
//
// Replicates the "Fundamental Analysis" section of the manual reference
// workbook (sheet "S Report - Gilang", pivot "S Report - Gilang" over "S
// Overall Ads"). Source = Iklan Produk + Iklan Toko combined, 2 periods.
//
// Iklan Live is deliberately NOT part of this funnel: its export has no
// impression/click/CTR columns at all ("Penonton" is an audience count, not
// an impression), so it cannot be forced into an impression→click→purchase
// tree. Its GMV is surfaced as a separate footnote instead (see
// shopeeFunnelReport.ts) so its contribution isn't lost.
//
// "Tambah ke Keranjang" (ATC) is only reported by the Iklan Produk export —
// Iklan Toko has no such column — so the ATC branch is understated relative
// to the combined Clicks/Purchases it sits between. The reference workbook
// has the exact same limitation; the ratio CVR = ClicksATC × ATCPurchase is
// still computed against the same combined Clicks denominator as the Traffic
// node above it, so the multiplicative funnel identity stays internally
// consistent. The UI carries a footnote about this.
// ══════════════════════════════════════════════════════

// Prefers an exact (case-insensitive) header match, falling back to
// findShopeeCol's substring behaviour — needed because "Konversi" /
// "Tambah ke Keranjang" both have "Persentase …" / "… Langsung" siblings a
// plain substring search could otherwise grab.
function exactCol(rows: SheetRow[], name: string): string | null {
  if (!rows.length) return null;
  const hit = Object.keys(rows[0]).find((h) => h.toLowerCase().trim() === name.toLowerCase());
  return hit ?? findShopeeCol(rows, name);
}

function sumExact(rows: SheetRow[], name: string): number {
  const col = exactCol(rows, name);
  if (!col) return 0;
  return rows.reduce((s, r) => s + parseShopeeNum(r[col]), 0);
}

// Raw column sums for one channel's rows. `addToCart` will be 0 for any
// channel whose export lacks the column (Iklan Toko).
export interface FunnelChannelSums {
  impressions: number; // Dilihat
  clicks: number; // Jumlah Klik
  addToCart: number; // Tambah ke Keranjang (Iklan Produk only)
  purchases: number; // Konversi
  itemsSold: number; // Produk Terjual
  gmv: number; // Omzet Penjualan (revenue attributed to ads)
  spend: number; // Biaya
}

export function sumFunnelChannel(rows: SheetRow[]): FunnelChannelSums {
  return {
    impressions: sumExact(rows, 'Dilihat'),
    clicks: sumExact(rows, 'Jumlah Klik'),
    addToCart: sumExact(rows, 'Tambah ke Keranjang'),
    purchases: sumExact(rows, 'Konversi'),
    itemsSold: sumExact(rows, 'Produk Terjual'),
    gmv: sumExact(rows, 'Omzet Penjualan'),
    spend: sumExact(rows, 'Biaya'),
  };
}

export function addFunnelChannelSums(...parts: FunnelChannelSums[]): FunnelChannelSums {
  return parts.reduce(
    (acc, p) => ({
      impressions: acc.impressions + p.impressions,
      clicks: acc.clicks + p.clicks,
      addToCart: acc.addToCart + p.addToCart,
      purchases: acc.purchases + p.purchases,
      itemsSold: acc.itemsSold + p.itemsSold,
      gmv: acc.gmv + p.gmv,
      spend: acc.spend + p.spend,
    }),
    { impressions: 0, clicks: 0, addToCart: 0, purchases: 0, itemsSold: 0, gmv: 0, spend: 0 },
  );
}

// Every derived value a funnel node can display. Rates are ratio-of-sums
// (matching Excel pivot calculated fields) and are expressed as percentages
// where the format is 'pct' — the %Change between periods is scale-invariant
// so this only affects the displayed old/cur figure.
export interface FunnelMetrics {
  gmvOverall: number; // store-wide GMV (Total Omzet Toko, entered manually)
  gmvAds: number; // = sums.gmv
  adContribution: number; // gmvAds / gmvOverall  (%)
  roas: number; // gmvAds / spend
  spend: number;
  impressions: number;
  cpm: number; // spend / impressions * 1000
  clicks: number;
  ctr: number; // clicks / impressions  (%)
  cpc: number; // spend / clicks
  addToCart: number;
  clicksToAtcRate: number; // addToCart / clicks  (%)
  cpAtc: number; // spend / addToCart
  purchases: number;
  atcToPurchaseRate: number; // purchases / addToCart  (%)  — can exceed 100%, see header note
  cpp: number; // spend / purchases
  cvr: number; // purchases / clicks  (%)
  itemsSold: number;
  aov: number; // gmvAds / purchases
  abs: number; // itemsSold / purchases
  aur: number; // gmvAds / itemsSold
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function funnelMetrics(sums: FunnelChannelSums, gmvOverall: number): FunnelMetrics {
  return {
    gmvOverall,
    gmvAds: sums.gmv,
    adContribution: div(sums.gmv, gmvOverall) * 100,
    roas: div(sums.gmv, sums.spend),
    spend: sums.spend,
    impressions: sums.impressions,
    cpm: div(sums.spend, sums.impressions) * 1000,
    clicks: sums.clicks,
    ctr: div(sums.clicks, sums.impressions) * 100,
    cpc: div(sums.spend, sums.clicks),
    addToCart: sums.addToCart,
    clicksToAtcRate: div(sums.addToCart, sums.clicks) * 100,
    cpAtc: div(sums.spend, sums.addToCart),
    purchases: sums.purchases,
    atcToPurchaseRate: div(sums.purchases, sums.addToCart) * 100,
    cpp: div(sums.spend, sums.purchases),
    cvr: div(sums.purchases, sums.clicks) * 100,
    itemsSold: sums.itemsSold,
    aov: div(sums.gmv, sums.purchases),
    abs: div(sums.itemsSold, sums.purchases),
    aur: div(sums.gmv, sums.itemsSold),
  };
}

// ── Flat "Values" panel ──────────────────────────────────────────────────
// The full metric list, old vs cur with %Change — same shape as the
// reference workbook's left-hand pivot table (kept alongside the tree, not
// replaced by it).

export interface FunnelValueDef {
  key: keyof FunnelMetrics;
  label: string;
  fmt: PivotFmt;
  sentiment: Sentiment;
}

export const FUNNEL_VALUE_DEFS: readonly FunnelValueDef[] = [
  { key: 'gmvOverall', label: 'GMV (Overall)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'gmvAds', label: 'GMV (Ads)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'adContribution', label: 'Kontribusi Iklan', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'roas', label: 'ROAS', fmt: 'roas', sentiment: 'higher-better' },
  { key: 'spend', label: 'Amount Spend', fmt: 'rp', sentiment: 'neutral' },
  { key: 'impressions', label: 'Impressions', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cpm', label: 'CPM', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'clicks', label: 'Clicks', fmt: 'num', sentiment: 'higher-better' },
  { key: 'ctr', label: 'CTR', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cpc', label: 'CPC', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'addToCart', label: 'Add to Cart', fmt: 'num', sentiment: 'higher-better' },
  { key: 'clicksToAtcRate', label: 'Clicks → ATC Rate', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cpAtc', label: 'Cost per ATC (CPATC)', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'purchases', label: 'Purchases', fmt: 'num', sentiment: 'higher-better' },
  { key: 'atcToPurchaseRate', label: 'ATC → Purchase Rate', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cpp', label: 'Cost per Purchase (CPP)', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'cvr', label: 'Conversion Rate (CVR)', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'itemsSold', label: 'Items Sold', fmt: 'num', sentiment: 'higher-better' },
  { key: 'aov', label: 'Average Order Value (AOV)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'abs', label: 'Average Basket Size (ABS)', fmt: 'num', sentiment: 'higher-better' },
  { key: 'aur', label: 'Average Unit Retail (AUR)', fmt: 'rp', sentiment: 'higher-better' },
];

export interface FunnelValueRow {
  key: string;
  label: string;
  fmt: PivotFmt;
  oldNum: number;
  curNum: number;
  deltaNum: number | null;
  delta: string;
  cls: DeltaClassName;
}

export function buildFunnelValues(mOld: FunnelMetrics, mCur: FunnelMetrics): FunnelValueRow[] {
  return FUNNEL_VALUE_DEFS.map((def) => {
    const oldNum = mOld[def.key];
    const curNum = mCur[def.key];
    const { deltaNum, deltaStr } = computeDelta(oldNum, curNum);
    return {
      key: def.key,
      label: def.label,
      fmt: def.fmt,
      oldNum,
      curNum,
      deltaNum,
      delta: formatDeltaID(deltaNum, deltaStr),
      cls: deltaClassForSentiment(deltaNum, def.sentiment),
    };
  });
}

// ── "Symptom Analysis" tree panel ────────────────────────────────────────
// The 13 funnel nodes, drawn as an indented tree with the exact connector
// glyphs the reference workbook uses (│ ├ └). Each row shows ONLY that
// node's %Change (green/red) — the full old/cur/Change figures live in the
// Values panel next to it.
//
// `prefix` is the literal tree-line string that precedes the label, encoded
// once here (13 static nodes) so the component stays a dumb renderer.

export interface FunnelTreeDef {
  key: keyof FunnelMetrics;
  label: string;
  prefix: string;
  // Nesting level for the redesigned tree view (0 = root GMV).
  depth: number;
  fmt: PivotFmt;
  sentiment: Sentiment;
}

export const FUNNEL_TREE_DEFS: readonly FunnelTreeDef[] = [
  { key: 'gmvAds', label: 'Gross Merchandise Value', prefix: '', depth: 0, fmt: 'rp', sentiment: 'higher-better' },
  { key: 'purchases', label: 'Transaction', prefix: '├─ ', depth: 1, fmt: 'num', sentiment: 'higher-better' },
  { key: 'clicks', label: 'Traffic', prefix: '│  ├─ ', depth: 2, fmt: 'num', sentiment: 'higher-better' },
  { key: 'impressions', label: 'Impressions', prefix: '│  │  ├─ ', depth: 3, fmt: 'num', sentiment: 'higher-better' },
  { key: 'spend', label: 'Spending', prefix: '│  │  │  ├─ ', depth: 4, fmt: 'rp', sentiment: 'neutral' },
  { key: 'cpm', label: 'CPM', prefix: '│  │  │  └─ ', depth: 4, fmt: 'rp', sentiment: 'lower-better' },
  { key: 'ctr', label: 'CTR', prefix: '│  │  └─ ', depth: 3, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cvr', label: 'Conversion Rate', prefix: '│  └─ ', depth: 2, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'clicksToAtcRate', label: 'Clicks → ATC Rate', prefix: '│     ├─ ', depth: 3, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'atcToPurchaseRate', label: 'ATC → Purchase Rate', prefix: '│     └─ ', depth: 3, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'aov', label: 'Average Order Value', prefix: '└─ ', depth: 1, fmt: 'rp', sentiment: 'higher-better' },
  { key: 'abs', label: 'Average Basket Size', prefix: '   ├─ ', depth: 2, fmt: 'num', sentiment: 'higher-better' },
  { key: 'aur', label: 'Average Unit Retail', prefix: '   └─ ', depth: 2, fmt: 'rp', sentiment: 'higher-better' },
];

export interface FunnelTreeRow {
  key: string;
  label: string;
  prefix: string;
  depth: number;
  fmt: PivotFmt;
  oldNum: number;
  curNum: number;
  deltaNum: number | null;
  delta: string;
  cls: DeltaClassName;
}

export function buildFunnelTree(mOld: FunnelMetrics, mCur: FunnelMetrics): FunnelTreeRow[] {
  return FUNNEL_TREE_DEFS.map((def) => {
    const oldNum = mOld[def.key];
    const curNum = mCur[def.key];
    const { deltaNum, deltaStr } = computeDelta(oldNum, curNum);
    return {
      key: def.key,
      label: def.label,
      prefix: def.prefix,
      depth: def.depth,
      fmt: def.fmt,
      oldNum,
      curNum,
      deltaNum,
      delta: formatDeltaID(deltaNum, deltaStr),
      cls: deltaClassForSentiment(deltaNum, def.sentiment),
    };
  });
}
