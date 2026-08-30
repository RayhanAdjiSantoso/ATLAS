import * as XLSX from 'xlsx';
import { computeDelta, deltaClassForSentiment } from './delta';
import { buildParsedPeriod, emptyParsedPeriod, type ParsedPeriod } from './periodLabel';
import { requireSheet } from './xlsxUtils';
import type { DeltaClassName, Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// TIKTOK PARSING — ported 1:1 from the original vanilla-JS logic.
// ══════════════════════════════════════════════════════

export function parseTiktokXLSX(buffer: ArrayBuffer): SheetRow[] {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  requireSheet(wb);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: 0 }) as SheetRow[];
  return rows.filter((r) => {
    // Filter out rows with no cost and no orders (inactive campaigns)
    const cost = parseFloat(String(r['Cost'] || r['cost'] || 0).toString().replace(/,/g, '')) || 0;
    const orders = parseFloat(String(r['SKU orders'] || r['SKU Orders'] || 0).toString().replace(/,/g, '')) || 0;
    return cost > 0 || orders > 0;
  });
}

// Derives a period from the TikTok export's filename — tries a "start_-_end"
// range pattern first, then falls back to any two (or one) ISO dates found
// anywhere in the name. Fase 1: returns the real date range (so a partial
// period reads as "1-18 Jul 2026", not collapsed to "Jul 2026") instead of a
// bare label string.
export function periodFromTiktokFilename(filename: string): ParsedPeriod {
  // Pattern 1: "2026-06-15_-_2026-06-21" or "2026-06-15 - 2026-06-21"
  const m1 = filename.match(/(\d{4})-(\d{2})-(\d{2})[_ ]-[_ ](\d{4})-(\d{2})-(\d{2})/);
  if (m1) {
    const start = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
    const end = new Date(Number(m1[4]), Number(m1[5]) - 1, Number(m1[6]));
    return buildParsedPeriod(start, end);
  }
  // Pattern 2: any 2 (or 1) dates in filename
  const m2 = [...filename.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)];
  if (m2.length >= 2) {
    const s = m2[0];
    const e = m2[m2.length - 1];
    const start = new Date(Number(s[1]), Number(s[2]) - 1, Number(s[3]));
    const end = new Date(Number(e[1]), Number(e[2]) - 1, Number(e[3]));
    return buildParsedPeriod(start, end);
  } else if (m2.length === 1) {
    const d = new Date(Number(m2[0][1]), Number(m2[0][2]) - 1, Number(m2[0][3]));
    return buildParsedPeriod(d, d);
  }
  return emptyParsedPeriod();
}

export function tiktokNum(row: SheetRow, ...keys: string[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') {
      const n = parseFloat(String(v).replace(/,/g, ''));
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

export interface TiktokMetrics {
  cost: number;
  orders: number;
  cpo: number;
  revenue: number;
  aov: number;
  roi: number;
}

export function calcTiktokMetrics(rows: SheetRow[]): TiktokMetrics {
  const cost = rows.reduce((s, r) => s + tiktokNum(r, 'Cost', 'cost'), 0);
  const orders = rows.reduce((s, r) => s + tiktokNum(r, 'SKU orders', 'SKU Orders', 'sku orders'), 0);
  const revenue = rows.reduce((s, r) => s + tiktokNum(r, 'Gross revenue', 'Gross Revenue', 'gross revenue'), 0);
  const cpo = orders > 0 ? cost / orders : 0;
  const aov = orders > 0 ? revenue / orders : 0;
  const roi = cost > 0 ? revenue / cost : 0;
  return { cost, orders, cpo, revenue, aov, roi };
}

export type TiktokMetricFmt = 'rp' | 'num' | 'roi';

export interface TiktokMetricDef {
  key: keyof TiktokMetrics;
  label: string;
  fmt: TiktokMetricFmt;
  sentiment: Sentiment;
}

export const TIKTOK_METRIC_DEFS: TiktokMetricDef[] = [
  { key: 'cost', label: 'Cost', fmt: 'rp', sentiment: 'neutral' },
  { key: 'orders', label: 'Order', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cpo', label: 'Cost per Order', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'revenue', label: 'Gross Revenue', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'aov', label: 'AOV', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'roi', label: 'ROI', fmt: 'roi', sentiment: 'higher-better' },
];

export function fmtTiktok(val: number | null | undefined, fmtType: TiktokMetricFmt): string {
  if (val === null || val === undefined) return '—';
  if (fmtType === 'rp') return 'Rp' + Math.round(val).toLocaleString('id-ID');
  if (fmtType === 'num') return Math.round(val).toLocaleString('id-ID');
  if (fmtType === 'roi') return val.toFixed(2);
  return String(val);
}

export interface TiktokKpiRow {
  key: string;
  label: string;
  old: string;
  cur: string;
  deltaNum: number | null;
  delta: string;
  cls: DeltaClassName;
  sentiment: Sentiment;
}

export function buildTiktokKPIRows(mOld: TiktokMetrics, mCur: TiktokMetrics): TiktokKpiRow[] {
  return TIKTOK_METRIC_DEFS.map((def) => {
    const vOld = mOld[def.key];
    const vCur = mCur[def.key];
    const { deltaNum, deltaStr } = vOld !== undefined && vCur !== undefined ? computeDelta(vOld, vCur) : { deltaNum: null, deltaStr: '—' };
    const cls = deltaClassForSentiment(deltaNum, def.sentiment);
    return { key: def.key, label: def.label, old: fmtTiktok(vOld, def.fmt), cur: fmtTiktok(vCur, def.fmt), deltaNum, delta: deltaStr, cls, sentiment: def.sentiment };
  });
}
