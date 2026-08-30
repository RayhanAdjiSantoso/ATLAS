import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
import { evaluateFormula } from './formula';
import { findShopeeCol, parseShopeeNum } from './shopeeAds';
import type { CategorizedRow } from './shopeeDeepDive';
import { type PivotFmt, type StandardChannelMetrics } from './shopeeDeepDivePivot';
import type { DeltaClassName, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// FASE 3 — SHOPEE DEEP-DIVE, Step 5
//
// Two item-level pivots are ALWAYS built regardless of which channel turned
// out dominant (see shopeeDeepDivePivot.detectDominantChannel) — the
// dominant one is just which tab opens by default in the UI:
//   - per-produk (Iklan Produk): one metric column, defaulting to whichever
//     of the 5 candidates moved the most at the channel level, but pickable
//     (or a custom formula) via the UI's metric selector.
//   - per-keyword (Iklan Toko - Keyword): 1+ metric columns, defaulting to
//     Biaya + Konversi + CPP, likewise pickable/custom.
//
// Both pivots share the same variable set per item (ItemMetricVars) so a
// custom formula written for one works unmodified for the other.
// ══════════════════════════════════════════════════════

export interface ItemMetricVars {
  biaya: number;
  pesanan: number;
  produkTerjual: number;
  penjualan: number;
  dilihat: number;
  klik: number;
  cpp: number;
  roas: number;
  kontribusi: number;
}

export const ITEM_BUILTIN_METRICS: readonly { key: keyof ItemMetricVars; label: string; fmt: PivotFmt; sentiment: 'higher-better' | 'lower-better' | 'neutral' }[] = [
  { key: 'biaya', label: 'Biaya', fmt: 'rp', sentiment: 'neutral' },
  { key: 'pesanan', label: 'Pesanan', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkTerjual', label: 'Produk Terjual', fmt: 'num', sentiment: 'higher-better' },
  { key: 'penjualan', label: 'Penjualan', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'dilihat', label: 'Dilihat', fmt: 'num', sentiment: 'higher-better' },
  { key: 'klik', label: 'Jumlah Klik', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cpp', label: 'Cost per Purchase', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'roas', label: 'ROAS', fmt: 'roas', sentiment: 'higher-better' },
  { key: 'kontribusi', label: 'Kontribusi Iklan', fmt: 'pct', sentiment: 'higher-better' },
];

// The 5 original spec candidates — kept as their own subset since
// pickDominantProdukMetric only ever chooses among these.
export const PRODUK_PIVOT_CANDIDATES: readonly (keyof ItemMetricVars)[] = ['biaya', 'pesanan', 'cpp', 'penjualan', 'roas'];

export type MetricSelection = { kind: 'builtin'; key: keyof ItemMetricVars } | { kind: 'formula'; id: string; label: string; formula: string; fmt: PivotFmt };

export function metricSelectionId(sel: MetricSelection): string {
  return sel.kind === 'builtin' ? sel.key : sel.id;
}

export function metricSelectionLabel(sel: MetricSelection): string {
  if (sel.kind === 'formula') return sel.label;
  return ITEM_BUILTIN_METRICS.find((m) => m.key === sel.key)?.label ?? sel.key;
}

export function metricSelectionFmt(sel: MetricSelection): PivotFmt {
  if (sel.kind === 'formula') return sel.fmt;
  return ITEM_BUILTIN_METRICS.find((m) => m.key === sel.key)?.fmt ?? 'num';
}

function metricSelectionSentiment(sel: MetricSelection): 'higher-better' | 'lower-better' | 'neutral' {
  if (sel.kind === 'formula') return 'neutral'; // direction of "better" isn't knowable for an arbitrary formula
  return ITEM_BUILTIN_METRICS.find((m) => m.key === sel.key)?.sentiment ?? 'neutral';
}

function resolveMetricValue(vars: ItemMetricVars, sel: MetricSelection): number {
  if (sel.kind === 'builtin') return vars[sel.key];
  try {
    return evaluateFormula(sel.formula, vars as unknown as Record<string, number>);
  } catch {
    return 0; // formulas are validated at creation time (validateFormula); this only guards a stale/corrupt selection
  }
}

function deriveVars(biaya: number, pesanan: number, produkTerjual: number, penjualan: number, dilihat: number, klik: number, omzetTotal: number): ItemMetricVars {
  return {
    biaya,
    pesanan,
    produkTerjual,
    penjualan,
    dilihat,
    klik,
    cpp: pesanan > 0 ? biaya / pesanan : 0,
    roas: biaya > 0 ? penjualan / biaya : 0,
    kontribusi: omzetTotal > 0 ? (penjualan / omzetTotal) * 100 : 0,
  };
}

// Picks whichever of the 5 candidate metrics moved the most (in absolute
// %Change) at the whole-channel level — that single metric is what the
// per-produk breakdown below is built around by default, so the report
// highlights whatever actually drove the channel's change.
export function pickDominantProdukMetric(channelOld: StandardChannelMetrics, channelCur: StandardChannelMetrics): keyof ItemMetricVars {
  let best: keyof ItemMetricVars = PRODUK_PIVOT_CANDIDATES[0];
  let bestAbs = -1;
  for (const key of PRODUK_PIVOT_CANDIDATES) {
    const abs = Math.abs(computeDelta(channelOld[key as keyof StandardChannelMetrics] as number, channelCur[key as keyof StandardChannelMetrics] as number).deltaNum ?? 0);
    if (abs > bestAbs) {
      bestAbs = abs;
      best = key;
    }
  }
  return best;
}

// ── Per-produk pivot ("3. Analyze Pvt Iklan Produk" equivalent) ──────────

interface ProdukGroupBase {
  category: string;
  series: string;
  vars: ItemMetricVars;
}

function sumProdukGroups(rows: CategorizedRow[], omzetTotal: number): Map<string, ProdukGroupBase> {
  const plainRows = rows.map((r) => r.row);
  const biayaCol = findShopeeCol(plainRows, 'biaya');
  const konvCol = findShopeeCol(plainRows, 'konversi');
  const produkTerjualCol = findShopeeCol(plainRows, 'produk terjual');
  const penjualanCol = findShopeeCol(plainRows, 'omzet penjualan');
  const dilihatCol = findShopeeCol(plainRows, 'dilihat');
  const klikCol = findShopeeCol(plainRows, 'jumlah klik');
  const sums = new Map<string, { category: string; series: string; biaya: number; pesanan: number; produkTerjual: number; penjualan: number; dilihat: number; klik: number }>();
  for (const r of rows) {
    const g = sums.get(r.cleanName) ?? { category: r.category, series: r.series, biaya: 0, pesanan: 0, produkTerjual: 0, penjualan: 0, dilihat: 0, klik: 0 };
    g.biaya += biayaCol ? parseShopeeNum(r.row[biayaCol]) : 0;
    g.pesanan += konvCol ? parseShopeeNum(r.row[konvCol]) : 0;
    g.produkTerjual += produkTerjualCol ? parseShopeeNum(r.row[produkTerjualCol]) : 0;
    g.penjualan += penjualanCol ? parseShopeeNum(r.row[penjualanCol]) : 0;
    g.dilihat += dilihatCol ? parseShopeeNum(r.row[dilihatCol]) : 0;
    g.klik += klikCol ? parseShopeeNum(r.row[klikCol]) : 0;
    sums.set(r.cleanName, g);
  }
  const out = new Map<string, ProdukGroupBase>();
  for (const [name, g] of sums) {
    out.set(name, { category: g.category, series: g.series, vars: deriveVars(g.biaya, g.pesanan, g.produkTerjual, g.penjualan, g.dilihat, g.klik, omzetTotal) });
  }
  return out;
}

export interface ProdukPivotRow {
  cleanName: string;
  category: string;
  series: string;
  metrics: ItemMetricCell[];
}

export const DEFAULT_PRODUK_SELECTIONS: readonly MetricSelection[] = [{ kind: 'builtin', key: 'biaya' }];

// Sorted by |%Change| of the first selected metric descending — surfaces
// whichever products drove the channel-level change the most, first.
export function buildProdukPivot(oldRows: CategorizedRow[], curRows: CategorizedRow[], selections: readonly MetricSelection[] = DEFAULT_PRODUK_SELECTIONS, omzetOld = 0, omzetCur = 0): ProdukPivotRow[] {
  const oldGroups = sumProdukGroups(oldRows, omzetOld);
  const curGroups = sumProdukGroups(curRows, omzetCur);
  const names = new Set([...oldGroups.keys(), ...curGroups.keys()]);
  const rows: ProdukPivotRow[] = [];
  for (const cleanName of names) {
    const gOld = oldGroups.get(cleanName);
    const gCur = curGroups.get(cleanName);
    const category = gCur?.category ?? gOld?.category ?? 'Uncategorized';
    const series = gCur?.series ?? gOld?.series ?? 'Uncategorized';
    const metrics: ItemMetricCell[] = selections.map((sel) => {
      const oldVal = gOld ? resolveMetricValue(gOld.vars, sel) : 0;
      const curVal = gCur ? resolveMetricValue(gCur.vars, sel) : 0;
      return { id: metricSelectionId(sel), label: metricSelectionLabel(sel), fmt: metricSelectionFmt(sel), ...cell(oldVal, curVal, metricSelectionSentiment(sel)) };
    });
    rows.push({ cleanName, category, series, metrics });
  }
  return rows.sort((a, b) => Math.abs(b.metrics[0]?.deltaNum ?? 0) - Math.abs(a.metrics[0]?.deltaNum ?? 0));
}

// ── Per-keyword pivot ("3. Pvt Keyword Iklan Toko" equivalent) ───────────

interface KeywordGroupBase {
  namaIklan: string;
  kataPencarian: string;
  vars: ItemMetricVars;
}

function sumKeywordGroups(rows: SheetRow[], omzetTotal: number): Map<string, KeywordGroupBase> {
  const namaCol = findShopeeCol(rows, 'nama iklan');
  const kataCol = findShopeeCol(rows, 'kata pencarian');
  const biayaCol = findShopeeCol(rows, 'biaya');
  const konvCol = findShopeeCol(rows, 'konversi');
  const produkTerjualCol = findShopeeCol(rows, 'produk terjual');
  const penjualanCol = findShopeeCol(rows, 'omzet penjualan');
  const dilihatCol = findShopeeCol(rows, 'dilihat');
  const klikCol = findShopeeCol(rows, 'jumlah klik');
  const sums = new Map<string, { namaIklan: string; kataPencarian: string; biaya: number; pesanan: number; produkTerjual: number; penjualan: number; dilihat: number; klik: number }>();
  for (const r of rows) {
    const namaIklan = namaCol ? String(r[namaCol] ?? '') : '';
    const kataPencarian = kataCol ? String(r[kataCol] ?? '') : '';
    const key = namaIklan + ' ' + kataPencarian;
    const g = sums.get(key) ?? { namaIklan, kataPencarian, biaya: 0, pesanan: 0, produkTerjual: 0, penjualan: 0, dilihat: 0, klik: 0 };
    g.biaya += biayaCol ? parseShopeeNum(r[biayaCol]) : 0;
    g.pesanan += konvCol ? parseShopeeNum(r[konvCol]) : 0;
    g.produkTerjual += produkTerjualCol ? parseShopeeNum(r[produkTerjualCol]) : 0;
    g.penjualan += penjualanCol ? parseShopeeNum(r[penjualanCol]) : 0;
    g.dilihat += dilihatCol ? parseShopeeNum(r[dilihatCol]) : 0;
    g.klik += klikCol ? parseShopeeNum(r[klikCol]) : 0;
    sums.set(key, g);
  }
  const out = new Map<string, KeywordGroupBase>();
  for (const [key, g] of sums) {
    out.set(key, { namaIklan: g.namaIklan, kataPencarian: g.kataPencarian, vars: deriveVars(g.biaya, g.pesanan, g.produkTerjual, g.penjualan, g.dilihat, g.klik, omzetTotal) });
  }
  return out;
}

export interface DeltaCell {
  old: number;
  cur: number;
  deltaNum: number | null;
  delta: string;
  cls: DeltaClassName;
}

export interface ItemMetricCell extends DeltaCell {
  id: string;
  label: string;
  fmt: PivotFmt;
}

export interface KeywordPivotRow {
  namaIklan: string;
  kataPencarian: string;
  metrics: ItemMetricCell[];
}

function cell(oldVal: number, curVal: number, sentiment: 'higher-better' | 'lower-better' | 'neutral'): DeltaCell {
  const { deltaNum, deltaStr } = computeDelta(oldVal, curVal);
  return { old: oldVal, cur: curVal, deltaNum, delta: formatDeltaID(deltaNum, deltaStr), cls: deltaClassForSentiment(deltaNum, sentiment) };
}

export const DEFAULT_KEYWORD_SELECTIONS: readonly MetricSelection[] = [{ kind: 'builtin', key: 'biaya' }, { kind: 'builtin', key: 'pesanan' }, { kind: 'builtin', key: 'cpp' }];

// Sorted by |%Change| of the first selected metric descending — same "what
// moved the most" default as the per-produk pivot above.
export function buildKeywordPivot(oldRows: SheetRow[], curRows: SheetRow[], selections: readonly MetricSelection[] = DEFAULT_KEYWORD_SELECTIONS, omzetOld = 0, omzetCur = 0): KeywordPivotRow[] {
  const oldGroups = sumKeywordGroups(oldRows, omzetOld);
  const curGroups = sumKeywordGroups(curRows, omzetCur);
  const keys = new Set([...oldGroups.keys(), ...curGroups.keys()]);
  const rows: KeywordPivotRow[] = [];
  for (const key of keys) {
    const gOld = oldGroups.get(key);
    const gCur = curGroups.get(key);
    const namaIklan = gCur?.namaIklan ?? gOld?.namaIklan ?? '';
    const kataPencarian = gCur?.kataPencarian ?? gOld?.kataPencarian ?? '';
    const metrics: ItemMetricCell[] = selections.map((sel) => {
      const oldVal = gOld ? resolveMetricValue(gOld.vars, sel) : 0;
      const curVal = gCur ? resolveMetricValue(gCur.vars, sel) : 0;
      return { id: metricSelectionId(sel), label: metricSelectionLabel(sel), fmt: metricSelectionFmt(sel), ...cell(oldVal, curVal, metricSelectionSentiment(sel)) };
    });
    rows.push({ namaIklan, kataPencarian, metrics });
  }
  return rows.sort((a, b) => Math.abs(b.metrics[0]?.deltaNum ?? 0) - Math.abs(a.metrics[0]?.deltaNum ?? 0));
}
