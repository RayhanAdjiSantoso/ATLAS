import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
import { agg, resolveConceptCount } from './meta';
import { LEAD_RESULT, leadResultKind, type LeadResultKind } from './metaFunnel';
import type { DeltaClassName, Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// META ADS — DEFAULT OVERVIEW METRICS
//
// The rows every Meta Overview card opens with, as MIL's brief lists them:
//   • Boost Post                    — profile visits, interactions, delivery;
// Frequency is left out on purpose: the Day-breakdown export Special Moment
// needs cannot sum reach, so it would read "—" on every card.
//   • Non-Boost Post & CPAS, E-commerce — the full sales funnel, content view
//                                     → add to cart → purchase;
//   • Non-Boost Post, B2B           — leads and delivery.
//
// A Meta export carries only some of these as columns (Cost per Content View,
// Content View Rate, Purchase Rate, AOV… usually are not), so every row is
// computed from base counts — spend, impressions, clicks, content views, adds
// to cart, purchases — resolved the same way everywhere. A rate or cost is
// then always "this count over that count" for the period, never an average
// of Meta's per-row cells. A row whose inputs the file lacks shows "—".
// ══════════════════════════════════════════════════════

type Fmt = 'rp' | 'num' | 'pct' | 'x' | 'dec';

interface Base {
  spend: number | null;
  impressions: number | null;
  frequency: number | null;
  linkClicks: number | null;
  profileVisits: number | null;
  interactions: number | null;
  contentViews: number | null;
  atc: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  leads: number | null;
  conversations: number | null;
  messagingContacts: number | null;
}

const NOISE = ['cost per', 'cost/', 'rate', 'ratio', 'roas', 'cpc', 'cpm', 'ctr', 'per ', 'value'];

// First column (in keyword priority order) whose name holds every word of a
// keyword and none of the cost/rate words — so "purchases" never lands on
// "Cost per purchase" or "Purchase ROAS". `allow` lifts a noise word a
// keyword itself needs ("conversion value" is not a count, but it is wanted).
function pick(rows: SheetRow[], keywords: string[], allow: string[] = []): string | null {
  const headers = Object.keys(rows[0] || {});
  for (const k of keywords) {
    const words = k.toLowerCase().split(' ');
    const hit = headers.find((h) => {
      const lc = h.toLowerCase();
      return words.every((w) => lc.includes(w)) && !NOISE.filter((n) => !allow.includes(n)).some((n) => lc.includes(n));
    });
    if (hit) return hit;
  }
  return null;
}

function sumOf(rows: SheetRow[], keywords: string[], concept?: string, allow?: string[]): number | null {
  if (!rows.length) return null;
  const col = pick(rows, keywords, allow);
  if (col) return agg(rows, col);
  return concept ? resolveConceptCount(rows, concept) : null;
}

// Where each base count is read from: header keywords in priority order, the
// concept fallback for files that name it differently, and noise words the
// keyword itself needs (see pick()).
type BaseKey = Exclude<keyof Base, 'frequency'>;
const BASE_PICK: Record<BaseKey, { kw: string[]; concept?: string; allow?: string[] }> = {
  spend: { kw: ['amount spent', 'spend'] },
  impressions: { kw: ['impressions'] },
  linkClicks: { kw: ['link clicks', 'outbound clicks'], concept: 'link click' },
  profileVisits: { kw: ['instagram profile visits', 'profile visits', 'profile visit'] },
  interactions: { kw: ['post engagement', 'post interactions', 'interactions', 'interaction'] },
  contentViews: { kw: ['content views with shared', 'content views', 'content view'], concept: 'content view' },
  atc: { kw: ['adds to cart with shared', 'adds to cart', 'add to cart'], concept: 'adds to cart' },
  purchases: { kw: ['purchases with shared', 'purchases', 'purchase'], concept: 'purchase' },
  purchaseValue: { kw: ['purchases conversion value for shared', 'purchases conversion value', 'conversion value'], allow: ['value'] },
  leads: { kw: ['on-facebook leads', 'leads', 'lead'] },
  conversations: { kw: ['messaging conversations started', 'conversations started'] },
  messagingContacts: { kw: ['messaging contacts'] },
};
const sumBase = (rows: SheetRow[], key: BaseKey) => sumOf(rows, BASE_PICK[key].kw, BASE_PICK[key].concept, BASE_PICK[key].allow);

function base(rows: SheetRow[], allowReach: boolean): Base {
  const impressions = sumBase(rows, 'impressions');
  const reach = allowReach ? sumOf(rows, ['reach']) : null;
  const freqCol = allowReach ? Object.keys(rows[0] || {}).find((h) => h.toLowerCase().includes('frequency')) : undefined;
  return {
    spend: sumBase(rows, 'spend'),
    impressions,
    // Frequency is impressions over reach; Meta's own column is the fallback.
    frequency: impressions !== null && reach ? impressions / reach : freqCol && rows.length ? agg(rows, freqCol) : null,
    linkClicks: sumBase(rows, 'linkClicks'),
    profileVisits: sumBase(rows, 'profileVisits'),
    interactions: sumBase(rows, 'interactions'),
    contentViews: sumBase(rows, 'contentViews'),
    atc: sumBase(rows, 'atc'),
    purchases: sumBase(rows, 'purchases'),
    purchaseValue: sumBase(rows, 'purchaseValue'),
    leads: sumBase(rows, 'leads'),
    conversations: sumBase(rows, 'conversations'),
    messagingContacts: sumBase(rows, 'messagingContacts'),
  };
}

const div = (a: number | null, b: number | null, scale = 1): number | null => (a === null || b === null || b <= 0 ? null : (a / b) * scale);

// The default rows per campaign type, in the order MIL's brief lists them.
//
// A row is named exactly as the file's own column for that metric
// ("Purchases conversion value", "CPC (cost per link click)"…); `label` is
// only the fallback for a file that has no such column. `from` / `same` find that column, and also keep
// it out of "+ Tambah metrik" so the metric is not offered twice:
//   from — a base count: the exact column base() sums it from;
//   same — a ratio: the column whose name holds every `same` phrase and no
//          `not` phrase (Ads Manager's "Cost per purchase", the ATLAS fetch's
//          "Add to cart rate", their "… with shared items" CPAS variants).
// The VALUE of a ratio is still worked out from the period's summed counts:
// a file's ratio cells are per row (one ad × age × gender × day), and the
// period's CPC is total spend ÷ total clicks, not an average of those cells.
interface Spec {
  key: string;
  label: string;
  fmt: Fmt;
  sentiment: Sentiment;
  value: (b: Base) => number | null;
  from?: BaseKey;
  same?: string[];
  not?: string[];
}

const SPEND: Spec = { key: 'spend', label: 'Amount spent', fmt: 'rp', sentiment: 'neutral', value: (b) => b.spend, from: 'spend' };
const IMPRESSIONS: Spec = { key: 'impressions', label: 'Impressions', fmt: 'num', sentiment: 'higher-better', value: (b) => b.impressions, from: 'impressions' };
const CPM: Spec = { key: 'cpm', label: 'CPM (cost per 1,000 impressions)', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.impressions, 1000), same: ['cpm'] };
const LINK_CLICKS: Spec = { key: 'link_clicks', label: 'Link clicks', fmt: 'num', sentiment: 'higher-better', value: (b) => b.linkClicks, from: 'linkClicks' };
const CTR: Spec = { key: 'ctr', label: 'CTR (link click-through rate)', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.linkClicks, b.impressions, 100), same: ['ctr', 'link'] };
const CPC: Spec = { key: 'cpc', label: 'CPC (cost per link click)', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.linkClicks), same: ['cpc', 'link'] };
const DELIVERY = [IMPRESSIONS, CPM, LINK_CLICKS, CPC, CTR];

const BOOST: Spec[] = [
  SPEND,
  { key: 'profile_visits', label: 'Profile visits', fmt: 'num', sentiment: 'higher-better', value: (b) => b.profileVisits, from: 'profileVisits' },
  { key: 'cost_per_profile_visit', label: 'Cost per profile visit', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.profileVisits), same: ['cost per', 'profile visit'] },
  { key: 'profile_visit_rate', label: 'Profile visit rate', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.profileVisits, b.impressions, 100), same: ['profile visit rate'] },
  ...DELIVERY,
  { key: 'interactions', label: 'Interactions', fmt: 'num', sentiment: 'higher-better', value: (b) => b.interactions, from: 'interactions' },
  { key: 'cost_per_interaction', label: 'Cost per interaction', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.interactions), same: ['cost per', 'interaction'] },
];

// Non-Boost E-commerce and CPAS: on a CPAS file the counts resolve to the
// "with shared items" columns (BASE_PICK lists those first).
const ECOMMERCE: Spec[] = [
  SPEND,
  { key: 'purchase_value', label: 'Purchases conversion value', fmt: 'rp', sentiment: 'higher-better', value: (b) => b.purchaseValue, from: 'purchaseValue' },
  { key: 'roas', label: 'Purchase ROAS', fmt: 'x', sentiment: 'higher-better', value: (b) => div(b.purchaseValue, b.spend), same: ['purchase roas'] },
  ...DELIVERY,
  { key: 'content_views', label: 'Content views', fmt: 'num', sentiment: 'higher-better', value: (b) => b.contentViews, from: 'contentViews' },
  { key: 'cost_per_content_view', label: 'Cost per content view', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.contentViews), same: ['cost per content view'] },
  { key: 'adds_to_cart', label: 'Adds to cart', fmt: 'num', sentiment: 'higher-better', value: (b) => b.atc, from: 'atc' },
  { key: 'cost_per_add_to_cart', label: 'Cost per add to cart', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.atc), same: ['cost per add to cart'] },
  { key: 'add_to_cart_rate', label: 'Add to cart rate', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.atc, b.contentViews, 100), same: ['add to cart rate'] },
  { key: 'purchases', label: 'Purchases', fmt: 'num', sentiment: 'higher-better', value: (b) => b.purchases, from: 'purchases' },
  { key: 'cost_per_purchase', label: 'Cost per purchase', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.purchases), same: ['cost per purchase'] },
  { key: 'purchase_rate', label: 'Purchase rate', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.purchases, b.atc, 100), same: ['purchase rate'] },
  { key: 'conversion_rate', label: 'Conversion rate', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.purchases, b.contentViews, 100), same: ['conversion rate'], not: ['lead'] },
  { key: 'aov', label: 'Average order value', fmt: 'rp', sentiment: 'higher-better', value: (b) => div(b.purchaseValue, b.purchases), same: ['average order value'] },
];

// B2B's conversion rate is its result over link clicks — and that result is
// whichever of leads / messaging conversations started / messaging contacts
// the campaign produced (metaFunnel.leadResultKind, the same pick the Root
// Cause Analysis makes), named in the row when it is not leads.
const B2B_RESULT: Record<LeadResultKind, (b: Base) => number | null> = {
  leads: (b) => b.leads,
  conversations: (b) => b.conversations,
  contacts: (b) => b.messagingContacts,
};

const b2bSpecs = (kind: LeadResultKind): Spec[] => [
  SPEND,
  { key: 'leads', label: 'Leads', fmt: 'num', sentiment: 'higher-better', value: (b) => b.leads, from: 'leads' },
  { key: 'cost_per_lead', label: 'Cost per lead', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.leads), same: ['cost per lead'] },
  { key: 'messaging_contacts', label: 'Messaging contacts', fmt: 'num', sentiment: 'higher-better', value: (b) => b.messagingContacts, from: 'messagingContacts' },
  { key: 'cost_per_messaging_contact', label: 'Cost per messaging contact', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.messagingContacts), same: ['cost per messaging contact'] },
  { key: 'messaging_conversations', label: 'Messaging conversations started', fmt: 'num', sentiment: 'higher-better', value: (b) => b.conversations, from: 'conversations' },
  { key: 'cost_per_messaging_conversation', label: 'Cost per messaging conversation started', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.conversations), same: ['cost per messaging conversation'] },
  ...DELIVERY,
  kind === 'leads'
    ? { key: 'lead_conversion_rate', label: 'Conversion rate', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.leads, b.linkClicks, 100), same: ['lead conversion rate'] }
    : {
      key: 'lead_conversion_rate', label: `Conversion rate (${LEAD_RESULT[kind].label.toLowerCase()} ÷ link clicks)`, fmt: 'pct', sentiment: 'higher-better',
      value: (b) => div(B2B_RESULT[kind](b), b.linkClicks, 100),
    },
];

export type MetaOverviewKind = 'boost' | 'ecommerce' | 'b2b';

export interface MetaOverviewRow {
  key: string;
  label: string;
  old: string;
  cur: string;
  delta: string;
  deltaNum: number | null;
  cls: DeltaClassName;
  // The file's own columns that hold this same metric (see Spec.from/same);
  // OverviewDetailedCard keeps them out of "+ Tambah metrik".
  sameCols: string[];
}

function sameColumns(s: Spec, rows: SheetRow[]): string[] {
  if (s.from) {
    const p = BASE_PICK[s.from];
    const col = pick(rows, p.kw, p.allow);
    return col ? [col] : [];
  }
  if (!s.same) return [];
  return Object.keys(rows[0] || {}).filter((h) => {
    const lc = h.toLowerCase();
    return s.same!.every((phrase) => lc.includes(phrase)) && !(s.not ?? []).some((phrase) => lc.includes(phrase));
  });
}

function format(v: number | null, f: Fmt): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const dec = (n: number) => n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (f === 'rp') return 'Rp' + Math.round(v).toLocaleString('id-ID');
  if (f === 'pct') return dec(v) + '%';
  if (f === 'x') return dec(v) + 'x';
  if (f === 'dec') return dec(v);
  return Math.round(v).toLocaleString('id-ID');
}

// `allowReach` is false for a multi-day Day-breakdown selection, whose reach
// cannot be summed (see buildMetaReport's reachWarning) — Frequency then
// shows "—" instead of an inflated figure.
// `leadKind` picks the B2B result (leads / conversations / contacts); the
// default is metaFunnel.leadResultKind's automatic pick.
export function buildMetaOverviewRows(kind: MetaOverviewKind, old: SheetRow[], cur: SheetRow[], allowReach = true, leadKind?: LeadResultKind): MetaOverviewRow[] {
  const bo = base(old, allowReach);
  const bc = base(cur, allowReach);
  const specs = kind === 'boost' ? BOOST : kind === 'ecommerce' ? ECOMMERCE : b2bSpecs(leadKind ?? leadResultKind(old, cur));
  const sample = old.length ? old : cur;
  return specs.map((s) => {
    const v1 = s.value(bo);
    const v2 = s.value(bc);
    const { deltaNum, deltaStr } = v1 !== null && v2 !== null && Number.isFinite(v1) && Number.isFinite(v2) ? computeDelta(v1, v2) : { deltaNum: null, deltaStr: '—' };
    const cols = sameColumns(s, sample);
    return {
      key: s.key,
      label: cols.length ? cols[0] : s.label,
      old: format(v1, s.fmt), cur: format(v2, s.fmt), delta: formatDeltaID(deltaNum, deltaStr), deltaNum,
      cls: deltaClassForSentiment(deltaNum, s.sentiment),
      // A computed row that came out empty does not stand in for the column:
      // the raw figure stays on offer then.
      sameCols: v1 !== null || v2 !== null ? cols : [],
    };
  });
}
