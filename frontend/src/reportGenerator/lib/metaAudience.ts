import { isAllValue } from './meta';
import { LEAD_RESULT, leadResultKind, metaBrandMetrics, metaLeadMetrics, metaObjectiveMetrics, metaSalesMetrics, type LeadResultKind, type MetaBrandMetrics, type MetaLeadMetrics, type MetaObjectiveMetrics, type MetaSalesMetrics } from './metaFunnel';
import type { MetaObjectiveKey } from './meta';
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

export function buildObjectiveAudience(rows: SheetRow[], dimCol: string): AudienceSlice<MetaObjectiveMetrics>[] {
  return sliceRows(rows, dimCol).map((g) => ({ ...g, metrics: metaObjectiveMetrics(g.rows) }));
}

// Every slice reads the same result (picked from all the rows), so one age
// group is never in leads while the next is in chats.
export function buildLeadAudience(rows: SheetRow[], dimCol: string, kind: LeadResultKind = leadResultKind(rows)): AudienceSlice<MetaLeadMetrics>[] {
  return sliceRows(rows, dimCol).map((g) => ({ ...g, metrics: metaLeadMetrics(g.rows, kind) }));
}

// A lead / B2B menu relabelled for the result actually read ("Leads Rate" →
// "Conversation Rate" for a messaging campaign).
export function leadMenuFor<M>(menu: readonly AudienceMetricDef<M>[], kind: LeadResultKind): AudienceMetricDef<M>[] {
  if (kind === 'leads') return [...menu];
  const names = LEAD_RESULT[kind];
  const rateShort = names.rate.replace(/\s*\(.*\)$/, '');
  return menu.map((m) => {
    const key = String(m.key);
    if (key === 'leads') return { ...m, label: names.label };
    if (key === 'leadRate') return { ...m, label: m.label.startsWith('Click') ? `Click → ${names.label} Rate` : rateShort };
    if (key === 'costPerLead') return { ...m, label: names.cost };
    return m;
  });
}

// Non-Boost B2B Leads, read on the architecture sheet's own purchase-funnel
// menus: wherever a lead campaign has no purchase event, the lead stands in
// for the purchase (a chat or a form lead IS that campaign's conversion), so
// Conversion Rate is leads over clicks. Counts the file really carries
// (content views, adds to cart, purchases) are used as they are.
export interface MetaB2bMetrics extends MetaSalesMetrics {
  leads: number | null;
  leadRate: number | null;
  linkClicks: number | null;
  costPerLead: number | null;
}

export function metaB2bMetrics(rows: SheetRow[], leadKind?: LeadResultKind): MetaB2bMetrics {
  const s = metaSalesMetrics(rows);
  const l = metaLeadMetrics(rows, leadKind);
  return {
    ...s,
    purchase: s.purchase ?? l.leads,
    conversionRate: s.conversionRate ?? l.leadRate,
    leads: l.leads,
    leadRate: l.leadRate,
    linkClicks: l.linkClicks,
    costPerLead: l.costPerLead,
  };
}

export function buildB2bAudience(rows: SheetRow[], dimCol: string, leadKind: LeadResultKind = leadResultKind(rows)): AudienceSlice<MetaB2bMetrics>[] {
  return sliceRows(rows, dimCol).map((g) => ({ ...g, metrics: metaB2bMetrics(g.rows, leadKind) }));
}

// The metric family a section reads, by the job the ads were bought for.
export type MetaMetricKind = 'sales' | 'brand' | 'objective' | 'lead' | 'b2b';

export function metricsFor(kind: MetaMetricKind, rows: SheetRow[], leadKind?: LeadResultKind): Record<string, unknown> {
  if (kind === 'brand') return metaBrandMetrics(rows) as unknown as Record<string, unknown>;
  if (kind === 'objective') return metaObjectiveMetrics(rows) as unknown as Record<string, unknown>;
  if (kind === 'lead') return metaLeadMetrics(rows, leadKind) as unknown as Record<string, unknown>;
  if (kind === 'b2b') return metaB2bMetrics(rows, leadKind) as unknown as Record<string, unknown>;
  return metaSalesMetrics(rows) as unknown as Record<string, unknown>;
}

// ── New Visitor / Re-Marketing ───────────────────────────────────────────
// MIL names every campaign by the audience it buys: "NV | …" prospects new
// people, "RM | …" re-targets people who already visited. A campaign named
// for both ("NV RM | Send Message | B2B") runs one budget across the two and
// cannot be split, so it is its own group rather than guessed into one.

export type AudienceType = 'NV' | 'RM' | 'NV+RM';

const hasToken = (v: string, k: string) => new RegExp('(^|[\\s|\\-_/])' + k + '([\\s|\\-_/]|$)', 'i').test(v);

export function audienceTypeOf(campaign: unknown): AudienceType | null {
  const v = String(campaign ?? '');
  const nv = hasToken(v, 'nv');
  const rm = hasToken(v, 'rm');
  if (nv && rm) return 'NV+RM';
  if (nv) return 'NV';
  if (rm) return 'RM';
  return null;
}

export const AUDIENCE_TYPE_LABEL: Record<AudienceType | 'other', string> = {
  NV: 'NV · New Visitor',
  RM: 'RM · Re-Marketing',
  'NV+RM': 'NV + RM',
  other: 'Tanpa label NV/RM',
};

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

// ── Architecture sheet menus (Audience & Creative Analysis) ──────────────
// CPAS and Non-Boost Retail sell; they are read on the sales funnel.
export const SALES_AGE_METRICS: readonly AudienceMetricDef<MetaSalesMetrics>[] = [
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
  { key: 'conversionRate', label: 'Conversion Rate', fmt: 'pct', additive: false },
  { key: 'aov', label: 'Average Order Value', fmt: 'rp', additive: false },
];
export const SALES_TRAFFIC_METRICS: readonly AudienceMetricDef<MetaSalesMetrics>[] = [
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
];
// Exactly the two metrics the sheet lists under each chart, in its order.
export const SALES_CONVERSION_METRICS: readonly AudienceMetricDef<MetaSalesMetrics>[] = [
  { key: 'contentViews', label: 'Content Views', fmt: 'num', additive: true },
  { key: 'purchase', label: 'Purchase', fmt: 'num', additive: true },
];
export const SALES_CLICK_ATC_METRICS: readonly AudienceMetricDef<MetaSalesMetrics>[] = [
  { key: 'contentViews', label: 'Content Views', fmt: 'num', additive: true },
  { key: 'visitToAtcRate', label: 'ATC Rate', fmt: 'pct', additive: false },
];
export const SALES_ATC_PURCHASE_METRICS: readonly AudienceMetricDef<MetaSalesMetrics>[] = [
  { key: 'atc', label: 'ATC', fmt: 'num', additive: true },
  { key: 'atcToPurchaseRate', label: 'Purchase Rate', fmt: 'pct', additive: false },
];
export const SALES_CREATIVE_CONVERSION_METRICS: readonly AudienceMetricDef<MetaSalesMetrics>[] = [
  { key: 'visitToAtcRate', label: 'Visit → ATC Rate', fmt: 'pct', additive: false },
  { key: 'atcToPurchaseRate', label: 'ATC → Purchase Rate', fmt: 'pct', additive: false },
];

// Non-Boost B2B Leads: the purchase steps do not exist; the lead is the
// conversion, so each sales chart has its lead equivalent.
export const LEAD_AGE_METRICS: readonly AudienceMetricDef<MetaLeadMetrics>[] = [
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
  { key: 'leadRate', label: 'Leads Rate', fmt: 'pct', additive: false },
];
export const LEAD_GENDER_METRICS: readonly AudienceMetricDef<MetaLeadMetrics>[] = [
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
  { key: 'leadRate', label: 'Leads Rate', fmt: 'pct', additive: false },
];
export const LEAD_TRAFFIC_METRICS: readonly AudienceMetricDef<MetaLeadMetrics>[] = [
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
];
export const LEAD_CONVERSION_METRICS: readonly AudienceMetricDef<MetaLeadMetrics>[] = [
  { key: 'leadRate', label: 'Leads Rate', fmt: 'pct', additive: false },
  { key: 'linkClicks', label: 'Link Clicks', fmt: 'num', additive: true },
  { key: 'leads', label: 'Leads', fmt: 'num', additive: true },
  { key: 'costPerLead', label: 'Cost per Lead', fmt: 'rp', additive: false },
];
export const LEAD_CREATIVE_CONVERSION_METRICS: readonly AudienceMetricDef<MetaLeadMetrics>[] = [
  { key: 'leadRate', label: 'Click → Lead Rate', fmt: 'pct', additive: false },
  { key: 'leads', label: 'Leads', fmt: 'num', additive: true },
  { key: 'costPerLead', label: 'Cost per Lead', fmt: 'rp', additive: false },
];

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

// Non-Boost Post read per objective. Sales keeps the sales-funnel menus above;
// the others are judged on what they were bought for.
// Listed in order of preference; the section shows the first four the file
// can actually compute (see MetaBreakdownSection), so a Leads or Engagement
// export without its own result column still gets the click metrics.
const LEADS_METRICS: readonly AudienceMetricDef<MetaObjectiveMetrics>[] = [
  { key: 'leads', label: 'Leads', fmt: 'num', additive: true },
  { key: 'costPerLead', label: 'Cost per Lead', fmt: 'rp', additive: false },
  { key: 'leadRate', label: 'Lead Rate', fmt: 'pct', additive: false },
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
  { key: 'linkClicks', label: 'Link Clicks', fmt: 'num', additive: true },
  { key: 'cpc', label: 'Cost per Click', fmt: 'rp', additive: false },
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
];
const ENGAGEMENT_METRICS: readonly AudienceMetricDef<MetaObjectiveMetrics>[] = [
  { key: 'conversations', label: 'Messaging Conversations', fmt: 'num', additive: true },
  { key: 'costPerConversation', label: 'Cost per Conversation', fmt: 'rp', additive: false },
  { key: 'interactionRate', label: 'Interaction Rate', fmt: 'pct', additive: false },
  { key: 'linkClicks', label: 'Link Clicks', fmt: 'num', additive: true },
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
  { key: 'cpc', label: 'Cost per Click', fmt: 'rp', additive: false },
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
];
const TRAFFIC_METRICS: readonly AudienceMetricDef<MetaObjectiveMetrics>[] = [
  { key: 'linkClicks', label: 'Link Clicks', fmt: 'num', additive: true },
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
  { key: 'cpc', label: 'Cost per Click', fmt: 'rp', additive: false },
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
];
const REACH_METRICS: readonly AudienceMetricDef<MetaObjectiveMetrics>[] = [
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
  { key: 'cpm', label: 'CPM', fmt: 'rp', additive: false },
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
];

export function objectiveAudienceMetrics(key: MetaObjectiveKey): readonly AudienceMetricDef<MetaObjectiveMetrics>[] {
  if (key === 'leads') return LEADS_METRICS;
  if (key === 'engagement') return ENGAGEMENT_METRICS;
  if (key === 'traffic') return TRAFFIC_METRICS;
  return REACH_METRICS;
}

// B2B Leads, on the sheet's menus (see metaB2bMetrics). Age is the one place
// the sheet itself swaps in Leads Rate.
type B2bDef = AudienceMetricDef<MetaB2bMetrics>;
export const B2B_AGE_METRICS: readonly B2bDef[] = [
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
  { key: 'leadRate', label: 'Leads Rate', fmt: 'pct', additive: false },
];
export const B2B_GENDER_METRICS: readonly B2bDef[] = [
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
  { key: 'ctr', label: 'Click-Through Rate', fmt: 'pct', additive: false },
  { key: 'conversionRate', label: 'Conversion Rate', fmt: 'pct', additive: false },
  { key: 'aov', label: 'Average Order Value', fmt: 'rp', additive: false },
];
export const B2B_TRAFFIC_METRICS: readonly B2bDef[] = [
  { key: 'impressions', label: 'Impressions', fmt: 'num', additive: true },
  { key: 'ctr', label: 'CTR', fmt: 'pct', additive: false },
];
export const B2B_CONVERSION_METRICS: readonly B2bDef[] = [
  { key: 'contentViews', label: 'Content Views', fmt: 'num', additive: true },
  { key: 'purchase', label: 'Purchase / Leads', fmt: 'num', additive: true },
];
export const B2B_CLICK_ATC_METRICS: readonly B2bDef[] = [
  { key: 'contentViews', label: 'Content Views', fmt: 'num', additive: true },
  { key: 'visitToAtcRate', label: 'ATC Rate', fmt: 'pct', additive: false },
];
export const B2B_ATC_PURCHASE_METRICS: readonly B2bDef[] = [
  { key: 'atc', label: 'ATC', fmt: 'num', additive: true },
  { key: 'atcToPurchaseRate', label: 'Purchase Rate', fmt: 'pct', additive: false },
];
export const B2B_CREATIVE_CONVERSION_METRICS: readonly B2bDef[] = [
  { key: 'visitToAtcRate', label: 'Visit → ATC Rate', fmt: 'pct', additive: false },
  { key: 'atcToPurchaseRate', label: 'ATC → Purchase Rate', fmt: 'pct', additive: false },
  { key: 'leadRate', label: 'Click → Lead Rate', fmt: 'pct', additive: false },
];
