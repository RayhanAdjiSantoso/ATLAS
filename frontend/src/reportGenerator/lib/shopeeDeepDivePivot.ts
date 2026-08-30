import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
import { findShopeeCol, parseShopeeNum } from './shopeeAds';
import type { DeltaClassName, Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// FASE 3 — SHOPEE DEEP-DIVE
// Step 4: pivot ringkas per channel (Iklan Produk / Iklan Toko / Iklan Live)
// + tabel "Iklan Shopee Overall".
//
// Iklan Live's raw export has a fundamentally different column set (no
// Dilihat/Jumlah Klik/CPM/CPC — replaced by Penonton/CPV, verified against
// the real "Iklan live.csv" export and the reference spreadsheet's own
// "Iklan Live" pivot section), so it gets its own metric shape instead of
// being forced into the standard one.
// ══════════════════════════════════════════════════════

function sumCol(rows: SheetRow[], keyword: string): number {
  const col = findShopeeCol(rows, keyword);
  if (!col) return 0;
  return rows.reduce((s, r) => s + parseShopeeNum(r[col]), 0);
}

export interface StandardChannelMetrics {
  biaya: number;
  dilihat: number;
  cpm: number;
  klik: number;
  ctr: number;
  cpc: number;
  pesanan: number;
  cvr: number;
  cpp: number;
  produkTerjual: number;
  itemsPerOrder: number;
  penjualan: number;
  aov: number;
  aur: number;
  roas: number;
  // Share of the whole store's ads spend/revenue this channel represents —
  // filled in afterwards via withChannelShare() once "Iklan Shopee Overall"
  // itself has been computed (see buildShopeeDeepDiveReport), since the
  // denominator is Overall's own biaya/penjualan, not available yet at the
  // point each individual channel's raw metrics are first summed.
  pctBudget: number;
  pctRevenue: number;
}

// Used for Iklan Produk and Iklan Toko (Iklan Shopee Overall is instead
// derived by combineOverallMetrics() below, from these channels' own
// already-computed totals — see that function for why).
export function calcStandardChannelMetrics(rows: SheetRow[]): StandardChannelMetrics {
  const biaya = sumCol(rows, 'Biaya');
  const dilihat = sumCol(rows, 'Dilihat');
  const klik = sumCol(rows, 'Jumlah Klik');
  const pesanan = sumCol(rows, 'Konversi'); // Konversi = Pesanan, matches calcShopeeMetrics' own convention
  const produkTerjual = sumCol(rows, 'Produk Terjual');
  const penjualan = sumCol(rows, 'Omzet Penjualan');

  return {
    biaya,
    dilihat,
    cpm: dilihat > 0 ? (biaya / dilihat) * 1000 : 0,
    klik,
    ctr: dilihat > 0 ? (klik / dilihat) * 100 : 0,
    cpc: klik > 0 ? biaya / klik : 0,
    pesanan,
    cvr: klik > 0 ? (pesanan / klik) * 100 : 0,
    cpp: pesanan > 0 ? biaya / pesanan : 0,
    produkTerjual,
    itemsPerOrder: pesanan > 0 ? produkTerjual / pesanan : 0,
    penjualan,
    aov: pesanan > 0 ? penjualan / pesanan : 0,
    aur: produkTerjual > 0 ? penjualan / produkTerjual : 0,
    roas: biaya > 0 ? penjualan / biaya : 0,
    pctBudget: 0,
    pctRevenue: 0,
  };
}

export interface LiveChannelMetrics {
  biaya: number;
  penonton: number;
  cpv: number;
  pesanan: number;
  cvr: number;
  cpp: number;
  penjualan: number;
  aov: number;
  roas: number;
  pctBudget: number;
  pctRevenue: number;
}

export function calcLiveChannelMetrics(rows: SheetRow[]): LiveChannelMetrics {
  const biaya = sumCol(rows, 'Biaya');
  const penonton = sumCol(rows, 'Penonton');
  const pesanan = sumCol(rows, 'Pesanan');
  const penjualan = sumCol(rows, 'Omzet Penjualan');

  return {
    biaya,
    penonton,
    cpv: penonton > 0 ? biaya / penonton : 0,
    pesanan,
    cvr: penonton > 0 ? (pesanan / penonton) * 100 : 0,
    cpp: pesanan > 0 ? biaya / pesanan : 0,
    penjualan,
    aov: pesanan > 0 ? penjualan / pesanan : 0,
    roas: biaya > 0 ? penjualan / biaya : 0,
    pctBudget: 0,
    pctRevenue: 0,
  };
}

// Combines the 3 already-computed channels into "Iklan Shopee Overall".
// Deliberately NOT "concatenate every channel's raw rows and re-sum
// columns" (which was the original approach) — Iklan Live's raw export has
// no "Dilihat"/"Konversi" columns at all (it uses "Penonton"/"Pesanan"
// instead), so that approach silently dropped Live's audience/orders from
// Overall's Dilihat and Pesanan. Summing the channels' own already-correct
// numbers avoids relying on column names lining up at all.
export function combineOverallMetrics(produk: StandardChannelMetrics, toko: StandardChannelMetrics, live: LiveChannelMetrics): StandardChannelMetrics {
  const biaya = produk.biaya + toko.biaya + live.biaya;
  const dilihat = produk.dilihat + toko.dilihat + live.penonton;
  const klik = produk.klik + toko.klik; // Live has no click concept
  const pesanan = produk.pesanan + toko.pesanan + live.pesanan;
  const produkTerjual = produk.produkTerjual + toko.produkTerjual; // Live doesn't report units sold
  const penjualan = produk.penjualan + toko.penjualan + live.penjualan;

  return {
    biaya,
    dilihat,
    cpm: dilihat > 0 ? (biaya / dilihat) * 1000 : 0,
    klik,
    ctr: dilihat > 0 ? (klik / dilihat) * 100 : 0,
    cpc: klik > 0 ? biaya / klik : 0,
    pesanan,
    cvr: klik > 0 ? (pesanan / klik) * 100 : 0,
    cpp: pesanan > 0 ? biaya / pesanan : 0,
    produkTerjual,
    itemsPerOrder: pesanan > 0 ? produkTerjual / pesanan : 0,
    penjualan,
    aov: pesanan > 0 ? penjualan / pesanan : 0,
    aur: produkTerjual > 0 ? penjualan / produkTerjual : 0,
    roas: biaya > 0 ? penjualan / biaya : 0,
    pctBudget: 0, // not shown for Overall itself — trivially 100%
    pctRevenue: 0,
  };
}

// Fills in pctBudget/pctRevenue now that Overall's own biaya/penjualan are
// known — kept as a separate pass (rather than a parameter on the calc
// functions above) specifically to avoid the circular dependency: Overall's
// own totals are only known once every channel's biaya/penjualan already
// exist.
export function withChannelShare<T extends { biaya: number; penjualan: number; pctBudget: number; pctRevenue: number }>(m: T, overallBiaya: number, overallPenjualan: number): T {
  return {
    ...m,
    pctBudget: overallBiaya > 0 ? (m.biaya / overallBiaya) * 100 : 0,
    pctRevenue: overallPenjualan > 0 ? (m.penjualan / overallPenjualan) * 100 : 0,
  };
}

// ══════════════════════════════════════════════════════
// Generic old-vs-cur pivot row builder (%Change), shared by all metric
// shapes above.
// ══════════════════════════════════════════════════════

export type PivotFmt = 'rp' | 'pct' | 'roas' | 'num';

export interface PivotMetricDef<T> {
  key: keyof T;
  label: string;
  fmt: PivotFmt;
  sentiment: Sentiment;
}

export interface PivotRow {
  key: string;
  label: string;
  old: string;
  cur: string;
  oldNum: number;
  curNum: number;
  deltaNum: number | null;
  delta: string;
  cls: DeltaClassName;
}

// Indonesian numeral convention throughout: "." for thousands, "," for
// decimals (e.g. Rp1.234.567, 12,34%, 1,23x) — toLocaleString('id-ID')
// already gives dot-thousands for the integer 'rp'/'num' cases, but
// pct/roas need an explicit decimal-comma format since .toFixed() always
// uses a dot regardless of locale.
export function fmtPivotVal(val: number, fmt: PivotFmt): string {
  if (fmt === 'rp') return 'Rp' + Math.round(val).toLocaleString('id-ID');
  if (fmt === 'pct') return val.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  if (fmt === 'roas') return val.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'x';
  return Math.round(val).toLocaleString('id-ID');
}

export function buildPivotRows<T>(mOld: T, mCur: T, defs: readonly PivotMetricDef<T>[]): PivotRow[] {
  return defs.map((def) => {
    const vOld = mOld[def.key] as number;
    const vCur = mCur[def.key] as number;
    const { deltaNum, deltaStr } = computeDelta(vOld, vCur);
    return {
      key: String(def.key),
      label: def.label,
      old: fmtPivotVal(vOld, def.fmt),
      cur: fmtPivotVal(vCur, def.fmt),
      oldNum: vOld,
      curNum: vCur,
      deltaNum,
      delta: formatDeltaID(deltaNum, deltaStr),
      cls: deltaClassForSentiment(deltaNum, def.sentiment),
    };
  });
}

// "Iklan Shopee Overall" doesn't show %Budget/%Revenue (trivially 100% of
// itself) — Produk/Toko append them via CHANNEL_METRIC_DEFS below.
export const OVERALL_METRIC_DEFS: readonly PivotMetricDef<StandardChannelMetrics>[] = [
  { key: 'biaya', label: 'Biaya', fmt: 'rp', sentiment: 'neutral' },
  { key: 'dilihat', label: 'Dilihat', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cpm', label: 'CPM', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'klik', label: 'Jumlah Klik', fmt: 'num', sentiment: 'higher-better' },
  { key: 'ctr', label: '%Klik', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cpc', label: 'CPC', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'pesanan', label: 'Pesanan', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cvr', label: 'CVR', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cpp', label: 'Cost per Purchase', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'produkTerjual', label: 'Produk Terjual', fmt: 'num', sentiment: 'higher-better' },
  { key: 'itemsPerOrder', label: 'Items/Order', fmt: 'num', sentiment: 'higher-better' },
  { key: 'penjualan', label: 'Penjualan', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'aov', label: 'AOV', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'aur', label: 'AUR', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'roas', label: 'ROAS', fmt: 'roas', sentiment: 'higher-better' },
];

export const CHANNEL_METRIC_DEFS: readonly PivotMetricDef<StandardChannelMetrics>[] = [
  ...OVERALL_METRIC_DEFS,
  { key: 'pctBudget', label: '% Budget', fmt: 'pct', sentiment: 'neutral' },
  { key: 'pctRevenue', label: '% Revenue', fmt: 'pct', sentiment: 'higher-better' },
];

export const LIVE_METRIC_DEFS: readonly PivotMetricDef<LiveChannelMetrics>[] = [
  { key: 'biaya', label: 'Biaya', fmt: 'rp', sentiment: 'neutral' },
  { key: 'penonton', label: 'Penonton', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cpv', label: 'CPV', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'pesanan', label: 'Pesanan', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cvr', label: 'CVR', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cpp', label: 'Cost per Purchase', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'penjualan', label: 'Penjualan', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'aov', label: 'AOV', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'roas', label: 'ROAS', fmt: 'roas', sentiment: 'higher-better' },
  { key: 'pctBudget', label: '% Budget', fmt: 'pct', sentiment: 'neutral' },
  { key: 'pctRevenue', label: '% Revenue', fmt: 'pct', sentiment: 'higher-better' },
];

// ══════════════════════════════════════════════════════
// Step 5: which channel (Iklan Produk vs Iklan Toko) is "dominant" — decides
// which per-item pivot (product-level vs keyword-level) opens by default.
//
// The spec asks for a "combination" of 4 signals without pinning an exact
// formula: %Budget share, %Revenue share, and the magnitude of %Change on
// Biaya and Penjualan. Implemented as a 4-way vote — whichever channel wins
// more of those 4 signals is dominant — with %Budget share as the explicit
// tie-breaker the spec calls out for the ambiguous (2-2) case.
// ══════════════════════════════════════════════════════

export type DominantChannel = 'produk' | 'toko';

export function detectDominantChannel(produkOld: StandardChannelMetrics, produkCur: StandardChannelMetrics, tokoOld: StandardChannelMetrics, tokoCur: StandardChannelMetrics): DominantChannel {
  const budgetShareProduk = produkCur.biaya + tokoCur.biaya > 0 ? produkCur.biaya / (produkCur.biaya + tokoCur.biaya) : 0.5;
  const revenueShareProduk = produkCur.penjualan + tokoCur.penjualan > 0 ? produkCur.penjualan / (produkCur.penjualan + tokoCur.penjualan) : 0.5;
  const changeBiayaProduk = Math.abs(computeDelta(produkOld.biaya, produkCur.biaya).deltaNum ?? 0);
  const changeBiayaToko = Math.abs(computeDelta(tokoOld.biaya, tokoCur.biaya).deltaNum ?? 0);
  const changePenjualanProduk = Math.abs(computeDelta(produkOld.penjualan, produkCur.penjualan).deltaNum ?? 0);
  const changePenjualanToko = Math.abs(computeDelta(tokoOld.penjualan, tokoCur.penjualan).deltaNum ?? 0);

  let produkVotes = 0;
  let tokoVotes = 0;
  if (budgetShareProduk > 0.5) produkVotes++;
  else if (budgetShareProduk < 0.5) tokoVotes++;
  if (revenueShareProduk > 0.5) produkVotes++;
  else if (revenueShareProduk < 0.5) tokoVotes++;
  if (changeBiayaProduk > changeBiayaToko) produkVotes++;
  else if (changeBiayaToko > changeBiayaProduk) tokoVotes++;
  if (changePenjualanProduk > changePenjualanToko) produkVotes++;
  else if (changePenjualanToko > changePenjualanProduk) tokoVotes++;

  if (produkVotes !== tokoVotes) return produkVotes > tokoVotes ? 'produk' : 'toko';
  // Tie-breaker: %Budget share, as specified.
  return budgetShareProduk >= 0.5 ? 'produk' : 'toko';
}
