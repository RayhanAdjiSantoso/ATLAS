import { isAllValue } from './meta';
import { metaBrandMetrics, metaSalesMetrics, type MetaBrandMetrics, type MetaSalesMetrics } from './metaFunnel';
import type { PivotFmt } from './shopeeDeepDivePivot';
import type { SheetRow } from './types';

// ══════════════════════════════════════════════════════
// META ADS — AUDIENCE & CREATIVE BREAKDOWNS
//
// One row set, split by a dimension (Age, Gender, Ad), with each slice run
// through the SAME metric functions the root-cause trees use. That sharing is
// the point: a CTR on the Age chart and a CTR in the funnel tree are then the
// same calculation over the same columns, and cannot drift apart.
//
// Rates are derived per slice from that slice's own base counts. Averaging
// Meta's reported per-row rates across a slice would give a number that is
// not any real rate — the 45-54 bracket's CTR is its clicks over its
// impressions, not the mean of its rows' CTR cells.
// ══════════════════════════════════════════════════════

export interface AudienceSlice<M> {
  key: string;
  label: string;
  rows: SheetRow[];
  metrics: M;
}

// Splits on a dimension column, dropping Meta's "All"/blank rollup rows —
// those are the collapsed total, not a slice, and would double every chart.
function sliceRows(rows: SheetRow[], dimCol: string): { key: string; label: string; rows: SheetRow[] }[] {
  const groups = new Map<string, SheetRow[]>();
  for (const r of rows) {
    const raw = r[dimCol];
    if (isAllValue(raw)) continue;
    const label = String(raw ?? '').trim();
    if (!label) continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(r);
  }
  return [...groups.entries()].map(([label, rs]) => ({ key: label, label, rows: rs })).sort((a, b) => a.label.localeCompare(b.label, 'id'));
}

export function buildSalesAudience(rows: SheetRow[], dimCol: string): AudienceSlice<MetaSalesMetrics>[] {
  return sliceRows(rows, dimCol).map((g) => ({ ...g, metrics: metaSalesMetrics(g.rows) }));
}

export function buildBrandAudience(rows: SheetRow[], dimCol: string): AudienceSlice<MetaBrandMetrics>[] {
  return sliceRows(rows, dimCol).map((g) => ({ ...g, metrics: metaBrandMetrics(g.rows) }));
}

// ── Metric menus ─────────────────────────────────────────────────────────
// Exactly the metrics the architecture sheet lists under each visual.

export interface AudienceMetricDef<M> {
  key: keyof M;
  label: string;
  fmt: PivotFmt;
  // True when slices sum to a meaningful whole. A pie of Impressions says
  // "this share of reach went to women"; a pie of CTR says nothing at all —
  // rates do not add up, so their slices would be shares of a sum that does
  // not exist. Charts read this to pick pie vs bar.
  additive: boolean;
}

export const SALES_AUDIENCE_METRICS: readonly AudienceMetricDef<MetaSalesMetrics>[] = [
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
  { key: 'conversionRate', label: 'Conversion Rate', fmt: 'pct', additive: false },
  { key: 'aov', label: 'Average Order Value', fmt: 'rp', additive: false },
];

export const BRAND_AUDIENCE_METRICS: readonly AudienceMetricDef<MetaBrandMetrics>[] = [
  { key: 'interactionRate', label: 'Interaction Rate', fmt: 'pct', additive: false },
  { key: 'profileVisitsRate', label: 'Profile Visits Rate', fmt: 'pct', additive: false },
  { key: 'followRate', label: 'Follow Rate', fmt: 'pct', additive: false },
];

// Creative analysis reads the same two questions the funnel asks of traffic
// and of conversion, one materi iklan at a time.
export const SALES_CREATIVE_METRICS: readonly AudienceMetricDef<MetaSalesMetrics>[] = [
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
  { key: 'ctr', label: 'CTR', fmt: 'pct', additive: false },
  { key: 'visitToAtcRate', label: 'Visit → ATC Rate', fmt: 'pct', additive: false },
  { key: 'atcToPurchaseRate', label: 'ATC → Purchase Rate', fmt: 'pct', additive: false },
];

export const BRAND_CREATIVE_METRICS = BRAND_AUDIENCE_METRICS;

// The column a creative breakdown needs. Meta names it "Ad name" in a
// Formatted data table export and "Ad ID" in the API pull.
export function findAdCol(rows: SheetRow[]): string | null {
  const headers = Object.keys(rows[0] || {});
  return (
    headers.find((h) => /\bad name\b/i.test(h)) ??
    headers.find((h) => /\bad id\b/i.test(h)) ??
    headers.find((h) => /^ad$/i.test(h.trim())) ??
    null
  );
}
