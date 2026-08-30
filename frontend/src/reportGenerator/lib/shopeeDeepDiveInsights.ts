import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
import { evaluateFormula } from './formula';
import { findShopeeCol } from './shopeeAds';
import type { PivotFmt } from './shopeeDeepDivePivot';
import { parseOverviewNum } from './shopeeOverview';
import type { DeltaClassName, Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// FASE 3 — SHOPEE DEEP-DIVE: insight tambahan, independen dari perbandingan
// 2 periode (Product Performance ranking + Product Overview daily trend).
// ══════════════════════════════════════════════════════

// ── Product Performance: "Produk dengan Performa Terbaik" ────────────────

export interface VariantPerformanceRow {
  kodeProduk: string;
  produk: string;
  kodeVariasi: string;
  namaVariasi: string;
  penjualanSiapDikirim: number;
}

// The sheet mixes product-level aggregate rows (Kode Variasi === "-") with
// one row per real variant — only the variant rows are meaningful for a
// per-variant "what's selling" ranking, so the aggregate rows are dropped
// here rather than double-counting a product alongside its own variants.
export function rankVariantsBySiapDikirim(rows: SheetRow[]): VariantPerformanceRow[] {
  return rows
    .filter((r) => {
      const kv = String(r['Kode Variasi'] ?? '').trim();
      return kv !== '' && kv !== '-';
    })
    .map((r) => ({
      kodeProduk: String(r['Kode Produk'] ?? '').trim(),
      produk: String(r['Produk'] ?? ''),
      kodeVariasi: String(r['Kode Variasi'] ?? '').trim(),
      namaVariasi: String(r['Nama Variasi'] ?? ''),
      penjualanSiapDikirim: parseOverviewNum(r['Penjualan (Pesanan Siap Dikirim) (IDR)']),
    }))
    .sort((a, b) => b.penjualanSiapDikirim - a.penjualanSiapDikirim);
}

// Collects every "Kode Produk" value seen across whichever channel row-sets
// are passed in. In practice, of Shopee's own export formats, only "Iklan
// Produk" (and "Iklan Produk Otomatis", merged into it) actually carries a
// Kode Produk column — Iklan Toko, Iklan Toko - Keyword, and Iklan Live
// exports have no product-code column at all (verified against the real
// exports), so today this only ever finds codes from the Produk channel.
// Written generically (scans each row-set for whichever column matches,
// rather than hardcoding "only look at the Produk row-set") so it keeps
// working without changes if Shopee ever adds Kode Produk to another
// channel's export.
export function collectAdvertisedProductCodes(...rowSets: SheetRow[][]): Set<string> {
  const codes = new Set<string>();
  for (const rows of rowSets) {
    if (!rows.length) continue;
    const col = findShopeeCol(rows, 'kode produk');
    if (!col) continue;
    for (const r of rows) {
      const v = String(r[col] ?? '').trim();
      if (v && v !== '-') codes.add(v);
    }
  }
  return codes;
}

// The headline insight: variants that are genuinely selling (present in
// Product Performance) but never appear in any advertised Kode Produk —
// i.e. selling on its own / via organic search, with zero ad spend behind
// it. Kept in the same "highest Penjualan Siap Dikirim first" order as the
// input ranking.
export function findUnadvertisedVariants(rankedVariants: VariantPerformanceRow[], advertisedCodes: Set<string>): VariantPerformanceRow[] {
  return rankedVariants.filter((v) => v.kodeProduk && !advertisedCodes.has(v.kodeProduk));
}

// ── Product Overview: tren harian ─────────────────────────────────────────
//
// Shown as a single side-by-side pivot (old period vs cur period as column
// pairs per metric, same shape as the per-produk/per-keyword pivots) rather
// than two separate day-by-day tables — rows are aligned by day-of-month
// (Shopee's daily export always starts at day 1 of the chosen range), not by
// literal calendar date, since the two periods are usually different
// months. A day that only exists in one period (e.g. day 31 when the other
// period is a 30-day month) renders as an empty cell on the missing side,
// per the user's own spec, rather than defaulting to 0.

export interface DailyTrendVars {
  pengunjung: number;
  halamanDilihat: number;
  produkDikunjungi: number;
  pengunjungTanpaMembeli: number;
  klikPencarian: number;
  suka: number;
  pengunjungAtc: number;
  produkAtc: number;
  pembeliDibuat: number;
  produkDibuat: number;
  produkDipesan: number;
  penjualanDibuat: number;
  pembeliSiapDikirim: number;
  produkSiapDikirim: number;
  penjualanSiapDikirim: number;
}

export const DAILY_TREND_BUILTIN_METRICS: readonly { key: keyof DailyTrendVars; label: string; fmt: PivotFmt; sentiment: Sentiment }[] = [
  { key: 'pengunjung', label: 'Pengunjung', fmt: 'num', sentiment: 'higher-better' },
  { key: 'halamanDilihat', label: 'Halaman Dilihat', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkDikunjungi', label: 'Produk Dikunjungi', fmt: 'num', sentiment: 'higher-better' },
  { key: 'pengunjungTanpaMembeli', label: 'Pengunjung Tanpa Membeli', fmt: 'num', sentiment: 'lower-better' },
  { key: 'klikPencarian', label: 'Klik Pencarian', fmt: 'num', sentiment: 'higher-better' },
  { key: 'suka', label: 'Suka', fmt: 'num', sentiment: 'higher-better' },
  { key: 'pengunjungAtc', label: 'Pengunjung ATC', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkAtc', label: 'Produk Ditambah Keranjang', fmt: 'num', sentiment: 'higher-better' },
  { key: 'pembeliDibuat', label: 'Total Pembeli (Pesanan Dibuat)', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkDibuat', label: 'Produk (Pesanan Dibuat)', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkDipesan', label: 'Produk Dipesan', fmt: 'num', sentiment: 'higher-better' },
  { key: 'penjualanDibuat', label: 'Penjualan (Pesanan Dibuat)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'pembeliSiapDikirim', label: 'Total Pembeli (Siap Dikirim)', fmt: 'num', sentiment: 'higher-better' },
  { key: 'produkSiapDikirim', label: 'Produk (Siap Dikirim)', fmt: 'num', sentiment: 'higher-better' },
  { key: 'penjualanSiapDikirim', label: 'Penjualan (Siap Dikirim)', fmt: 'rp', sentiment: 'higher-better' },
];

export type DailyTrendMetricSelection = { kind: 'builtin'; key: keyof DailyTrendVars } | { kind: 'formula'; id: string; label: string; formula: string; fmt: PivotFmt };

export function dailyTrendSelectionId(sel: DailyTrendMetricSelection): string {
  return sel.kind === 'builtin' ? sel.key : sel.id;
}

export function dailyTrendSelectionLabel(sel: DailyTrendMetricSelection): string {
  if (sel.kind === 'formula') return sel.label;
  return DAILY_TREND_BUILTIN_METRICS.find((m) => m.key === sel.key)?.label ?? sel.key;
}

export function dailyTrendSelectionFmt(sel: DailyTrendMetricSelection): PivotFmt {
  if (sel.kind === 'formula') return sel.fmt;
  return DAILY_TREND_BUILTIN_METRICS.find((m) => m.key === sel.key)?.fmt ?? 'num';
}

function dailyTrendSelectionSentiment(sel: DailyTrendMetricSelection): Sentiment {
  if (sel.kind === 'formula') return 'neutral';
  return DAILY_TREND_BUILTIN_METRICS.find((m) => m.key === sel.key)?.sentiment ?? 'neutral';
}

function resolveDailyTrendMetric(vars: DailyTrendVars, sel: DailyTrendMetricSelection): number {
  if (sel.kind === 'builtin') return vars[sel.key];
  try {
    return evaluateFormula(sel.formula, vars as unknown as Record<string, number>);
  } catch {
    return 0; // formulas are validated at creation time; this only guards a stale/corrupt selection
  }
}

function parseDailyTrendVars(row: SheetRow): DailyTrendVars {
  return {
    pengunjung: parseOverviewNum(row['Pengunjung Produk (Kunjungan)']),
    halamanDilihat: parseOverviewNum(row['Halaman Produk Dilihat']),
    produkDikunjungi: parseOverviewNum(row['Produk Dikunjungi']),
    pengunjungTanpaMembeli: parseOverviewNum(row['Pengunjung Melihat Tanpa Membeli']),
    klikPencarian: parseOverviewNum(row['Klik Pencarian']),
    suka: parseOverviewNum(row['Suka']),
    pengunjungAtc: parseOverviewNum(row['Pengunjung Produk (Menambahkan Produk ke Keranjang)']),
    produkAtc: parseOverviewNum(row['Dimasukkan ke Keranjang (Produk)']),
    pembeliDibuat: parseOverviewNum(row['Total Pembeli (Pesanan Dibuat)']),
    produkDibuat: parseOverviewNum(row['Produk (Pesanan Dibuat)']),
    produkDipesan: parseOverviewNum(row['Produk Dipesan']),
    penjualanDibuat: parseOverviewNum(row['Total Penjualan (Pesanan Dibuat) (IDR)']),
    pembeliSiapDikirim: parseOverviewNum(row['Total Pembeli (Pesanan Siap Dikirim)']),
    produkSiapDikirim: parseOverviewNum(row['Produk (Pesanan Siap Dikirim)']),
    penjualanSiapDikirim: parseOverviewNum(row['Penjualan (Pesanan Siap Dikirim) (IDR)']),
  };
}

// Day-of-month extracted from the export's own "DD-MM-YYYY" text — the
// alignment key between the two periods (see the section comment above).
function tanggalDay(s: string): number | null {
  const m = s.match(/^(\d{2})-\d{2}-\d{4}$/);
  return m ? parseInt(m[1], 10) : null;
}

function buildDailyTrendByDay(rows: SheetRow[]): Map<number, DailyTrendVars> {
  const map = new Map<number, DailyTrendVars>();
  for (const r of rows) {
    const day = tanggalDay(String(r['Tanggal'] ?? ''));
    if (day !== null) map.set(day, parseDailyTrendVars(r));
  }
  return map;
}

export interface DailyTrendMetricCell {
  id: string;
  label: string;
  fmt: PivotFmt;
  old: number | null;
  cur: number | null;
  deltaNum: number | null;
  delta: string;
  cls: DeltaClassName;
}

function dailyCell(oldVal: number | null, curVal: number | null, sentiment: Sentiment, id: string, label: string, fmt: PivotFmt): DailyTrendMetricCell {
  if (oldVal === null || curVal === null) {
    return { id, label, fmt, old: oldVal, cur: curVal, deltaNum: null, delta: '—', cls: 'delta-neutral' };
  }
  const { deltaNum, deltaStr } = computeDelta(oldVal, curVal);
  return { id, label, fmt, old: oldVal, cur: curVal, deltaNum, delta: formatDeltaID(deltaNum, deltaStr), cls: deltaClassForSentiment(deltaNum, sentiment) };
}

export interface DailyTrendPivotRow {
  day: number;
  metrics: DailyTrendMetricCell[];
}

export const DEFAULT_DAILY_TREND_SELECTIONS: readonly DailyTrendMetricSelection[] = [
  { kind: 'builtin', key: 'pengunjung' },
  { kind: 'builtin', key: 'penjualanDibuat' },
];

// Sorted by day-of-month ascending (1, 2, 3, ...) — a day present in only
// one period still gets a row, with the other period's cells left null.
export function buildDailyTrendPivot(oldRows: SheetRow[], curRows: SheetRow[], selections: readonly DailyTrendMetricSelection[] = DEFAULT_DAILY_TREND_SELECTIONS): DailyTrendPivotRow[] {
  const oldByDay = buildDailyTrendByDay(oldRows);
  const curByDay = buildDailyTrendByDay(curRows);
  const days = [...new Set([...oldByDay.keys(), ...curByDay.keys()])].sort((a, b) => a - b);
  return days.map((day) => {
    const oldVars = oldByDay.get(day) ?? null;
    const curVars = curByDay.get(day) ?? null;
    const metrics = selections.map((sel) =>
      dailyCell(
        oldVars ? resolveDailyTrendMetric(oldVars, sel) : null,
        curVars ? resolveDailyTrendMetric(curVars, sel) : null,
        dailyTrendSelectionSentiment(sel),
        dailyTrendSelectionId(sel),
        dailyTrendSelectionLabel(sel),
        dailyTrendSelectionFmt(sel),
      ),
    );
    return { day, metrics };
  });
}
