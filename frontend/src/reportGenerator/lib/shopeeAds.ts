import * as XLSX from 'xlsx';
import { computeDelta, deltaClassForSentiment } from './delta';
import { emptyParsedPeriod, buildParsedPeriod, parseDateRangeDMY, type ParsedPeriod } from './periodLabel';
import { requireSheet } from './xlsxUtils';
import type { DeltaClassName, Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// SHOPEE PARSING — ported from the original vanilla-JS logic. Fase 1: the
// period is no longer collapsed to "NamaBulan Tahun" (formatShopeePeriod) —
// it keeps its actual start/end dates, so a partial-month export reads as
// "1-18 Jul 2026" instead of the misleading "Jul 2026".
// ══════════════════════════════════════════════════════

// Detects skip rows: find the row index where 'Urutan' or 'Nama Iklan' appears
export function detectShopeeHeaderRow(text: string): number {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes('urutan') || lines[i].toLowerCase().includes('nama iklan')) {
      return i;
    }
  }
  return 7; // fallback
}

export interface ParsedShopeeCSV {
  rows: SheetRow[];
  period: ParsedPeriod;
}

export function parseShopeeCSV(text: string): ParsedShopeeCSV {
  const headerRow = detectShopeeHeaderRow(text);
  const lines = text.split('\n');
  // Extract period from metadata
  let period: ParsedPeriod = emptyParsedPeriod();
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    if (lines[i].toLowerCase().startsWith('periode')) {
      const raw = (lines[i].split(',')[1] || '').trim().replace(/"/g, '');
      const range = parseDateRangeDMY(raw);
      period = range ? buildParsedPeriod(range.start, range.end) : emptyParsedPeriod(raw);
      break;
    }
  }
  // Parse CSV from header row onwards
  const dataLines = lines.slice(headerRow);
  const csvText = dataLines.join('\n');
  const wb = XLSX.read(csvText, { type: 'string' });
  requireSheet(wb);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as SheetRow[];
  return { rows, period };
}

// Parse numeric from Shopee format (may have dots as thousand sep and commas as decimal)
export function parseShopeeNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).trim().replace(/\s/g, '').replace(/,/g, '');
  if (!s || s === '-') return 0;
  if (s.endsWith('%')) return parseFloat(s.slice(0, -1)) || 0;
  return parseFloat(s) || 0;
}

// Exact-match keywords: only match if the column name IS exactly this (case-insensitive)
export const SHOPEE_EXACT_COLS = ['biaya'];

export function findShopeeCol(rows: SheetRow[], keyword: string): string | null {
  if (!rows.length) return null;
  const hs = Object.keys(rows[0]);
  const lk = keyword.toLowerCase().trim();
  // For ambiguous keywords, use exact match first
  if (SHOPEE_EXACT_COLS.includes(lk)) {
    return hs.find((h) => h.toLowerCase().trim() === lk) || null;
  }
  return hs.find((h) => h.toLowerCase().includes(lk)) || null;
}

// Sum a column across rows
export function shopeeSum(rows: SheetRow[], colKeyword: string): number {
  const col = findShopeeCol(rows, colKeyword);
  if (!col) return 0;
  return rows.reduce((s, r) => s + parseShopeeNum(r[col]), 0);
}

// ══════════════════════════════════════════════════════
// SHOPEE METRICS CALCULATION
// ══════════════════════════════════════════════════════
export interface ShopeeMetrics {
  omzetTotal: number;
  kontribusi: number;
  biaya: number;
  dilihat: number;
  cpm: number;
  klik: number;
  ctr: number;
  cpc: number;
  pesanan: number;
  cr: number;
  cpo: number;
  produkTerjual: number;
  penjualanAds: number;
  aov: number;
  aur: number;
  roas: number;
}

export function calcShopeeMetrics(tokoRows: SheetRow[], produkRows: SheetRow[], omzetTotal: number): ShopeeMetrics {
  const all = [...tokoRows, ...produkRows];
  const biaya = shopeeSum(all, 'biaya');
  const dilihat = shopeeSum(all, 'dilihat');
  const klik = shopeeSum(all, 'jumlah klik');
  const pesanan = shopeeSum(all, 'konversi'); // Konversi = Pesanan
  const produkTerjual = shopeeSum(all, 'produk terjual');
  const penjualanAds = shopeeSum(all, 'omzet penjualan'); // Omzet Penjualan = Penjualan dari Ads

  const cpm = dilihat > 0 ? (biaya / dilihat) * 1000 : 0;
  const ctr = dilihat > 0 ? (klik / dilihat) * 100 : 0;
  const cpc = klik > 0 ? biaya / klik : 0;
  const cr = klik > 0 ? (pesanan / klik) * 100 : 0;
  const cpo = pesanan > 0 ? biaya / pesanan : 0;
  const aov = pesanan > 0 ? penjualanAds / pesanan : 0;
  const aur = produkTerjual > 0 ? penjualanAds / produkTerjual : 0;
  const roas = biaya > 0 ? penjualanAds / biaya : 0;
  const kontribusi = omzetTotal > 0 ? (penjualanAds / omzetTotal) * 100 : 0;

  return {
    omzetTotal,
    kontribusi,
    biaya,
    dilihat,
    cpm,
    klik,
    ctr,
    cpc,
    pesanan,
    cr,
    cpo,
    produkTerjual,
    penjualanAds,
    aov,
    aur,
    roas,
  };
}

// ══════════════════════════════════════════════════════
// SHOPEE REPORT BUILDER
// ══════════════════════════════════════════════════════
export type ShopeeMetricFmt = 'rp' | 'pct' | 'roas' | 'num';

export interface ShopeeMetricDef {
  key: keyof ShopeeMetrics;
  label: string;
  fmt: ShopeeMetricFmt;
  sentiment: Sentiment;
}

export const SHOPEE_METRIC_DEFS: ShopeeMetricDef[] = [
  { key: 'omzetTotal', label: 'Total Omzet', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'kontribusi', label: 'Kontribusi Iklan', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'biaya', label: 'Biaya', fmt: 'rp', sentiment: 'neutral' },
  { key: 'dilihat', label: 'Iklan Dilihat', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cpm', label: 'CPM', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'klik', label: 'Jumlah Klik', fmt: 'num', sentiment: 'higher-better' },
  { key: 'ctr', label: 'Persentase Klik (CTR)', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cpc', label: 'Cost Per Click', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'pesanan', label: 'Pesanan', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cr', label: 'Conversion Rate', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cpo', label: 'Cost Per Purchase', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'produkTerjual', label: 'Produk Terjual', fmt: 'num', sentiment: 'higher-better' },
  { key: 'aov', label: 'Average Order Value (AOV)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'aur', label: 'Average Unit Ritel', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'penjualanAds', label: 'Penjualan dari Ads', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'roas', label: 'ROAS', fmt: 'roas', sentiment: 'higher-better' },
];

const SHOPEE_LABEL_BY_KEY: Record<string, string> = Object.fromEntries(SHOPEE_METRIC_DEFS.map((d) => [d.key, d.label]));
export function shopeeLabelFor(key: string): string {
  return SHOPEE_LABEL_BY_KEY[key] || key;
}

export function fmtShopee(val: number | null | undefined, fmtType: ShopeeMetricFmt): string {
  if (val === null || val === undefined) return '—';
  if (fmtType === 'rp') return 'Rp' + Math.round(val).toLocaleString('id-ID');
  if (fmtType === 'pct') return val.toFixed(2) + '%';
  if (fmtType === 'roas') return val.toFixed(2) + 'x';
  if (fmtType === 'num') return Math.round(val).toLocaleString('id-ID');
  return String(val);
}

export interface ShopeeKpiRow {
  key: string;
  col: string;
  label: string;
  old: string;
  cur: string;
  deltaNum: number | null;
  delta: string;
  cls: DeltaClassName;
  sentiment: Sentiment;
}

export function buildShopeeKPIRows(mOld: ShopeeMetrics, mCur: ShopeeMetrics): ShopeeKpiRow[] {
  return SHOPEE_METRIC_DEFS.map((def) => {
    const vOld = mOld[def.key];
    const vCur = mCur[def.key];
    const { deltaNum, deltaStr } = vOld !== undefined && vCur !== undefined ? computeDelta(vOld, vCur) : { deltaNum: null, deltaStr: '—' };
    const cls = deltaClassForSentiment(deltaNum, def.sentiment);
    return {
      key: def.key,
      col: def.key,
      label: def.label,
      old: fmtShopee(vOld, def.fmt),
      cur: fmtShopee(vCur, def.fmt),
      deltaNum,
      delta: deltaStr,
      cls,
      sentiment: def.sentiment,
    };
  });
}
