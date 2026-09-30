import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
import { agg, resolveConceptCount } from './meta';
import type { DeltaClassName, Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// META ADS — DEFAULT OVERVIEW METRICS
//
// The rows every Meta Overview card opens with, as MIL's brief lists them:
//   • Boost Post                    — profile visits, interactions, delivery;
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

function base(rows: SheetRow[], allowReach: boolean): Base {
  const impressions = sumOf(rows, ['impressions']);
  const reach = allowReach ? sumOf(rows, ['reach']) : null;
  const freqCol = allowReach ? Object.keys(rows[0] || {}).find((h) => h.toLowerCase().includes('frequency')) : undefined;
  return {
    spend: sumOf(rows, ['amount spent', 'spend']),
    impressions,
    // Frequency is impressions over reach; Meta's own column is the fallback.
    frequency: impressions !== null && reach ? impressions / reach : freqCol && rows.length ? agg(rows, freqCol) : null,
    linkClicks: sumOf(rows, ['link clicks', 'outbound clicks'], 'link click'),
    profileVisits: sumOf(rows, ['instagram profile visits', 'profile visits', 'profile visit']),
    interactions: sumOf(rows, ['post engagement', 'post interactions', 'interactions', 'interaction']),
    contentViews: sumOf(rows, ['content views with shared', 'content views', 'content view'], 'content view'),
    atc: sumOf(rows, ['adds to cart with shared', 'adds to cart', 'add to cart'], 'adds to cart'),
    purchases: sumOf(rows, ['purchases with shared', 'purchases', 'purchase'], 'purchase'),
    purchaseValue: sumOf(rows, ['purchases conversion value for shared', 'purchases conversion value', 'conversion value'], undefined, ['value']),
    leads: sumOf(rows, ['on-facebook leads', 'leads', 'lead']),
    conversations: sumOf(rows, ['messaging conversations started', 'conversations started']),
  };
}

const div = (a: number | null, b: number | null, scale = 1): number | null => (a === null || b === null || b <= 0 ? null : (a / b) * scale);

interface Spec {
  label: string;
  fmt: Fmt;
  sentiment: Sentiment;
  value: (b: Base) => number | null;
}

const SPEND: Spec = { label: 'Amount Spent', fmt: 'rp', sentiment: 'neutral', value: (b) => b.spend };
const FREQUENCY: Spec = { label: 'Frequency', fmt: 'dec', sentiment: 'neutral', value: (b) => b.frequency };
const IMPRESSIONS: Spec = { label: 'Impressions', fmt: 'num', sentiment: 'higher-better', value: (b) => b.impressions };
const CPM: Spec = { label: 'Cost per Mille (CPM)', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.impressions, 1000) };
const LINK_CLICKS: Spec = { label: 'Link Clicks', fmt: 'num', sentiment: 'higher-better', value: (b) => b.linkClicks };
const CTR: Spec = { label: 'CTR (Link Click-Through Rate)', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.linkClicks, b.impressions, 100) };
const CPC: Spec = { label: 'CPC (Cost per Link Click)', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.linkClicks) };

const BOOST: Spec[] = [
  SPEND,
  { label: 'Profile Visits', fmt: 'num', sentiment: 'higher-better', value: (b) => b.profileVisits },
  { label: 'Cost per Profile Visit', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.profileVisits) },
  { label: 'Profile Visit Rate', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.profileVisits, b.impressions, 100) },
  FREQUENCY,
  IMPRESSIONS,
  CPM,
  LINK_CLICKS,
  CTR,
  CPC,
  { label: 'Interactions', fmt: 'num', sentiment: 'higher-better', value: (b) => b.interactions },
  { label: 'Cost per Interaction', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.interactions) },
];

const ECOMMERCE: Spec[] = [
  SPEND,
  { label: 'Purchase Value', fmt: 'rp', sentiment: 'higher-better', value: (b) => b.purchaseValue },
  { label: 'ROAS', fmt: 'x', sentiment: 'higher-better', value: (b) => div(b.purchaseValue, b.spend) },
  IMPRESSIONS,
  FREQUENCY,
  CPM,
  LINK_CLICKS,
  CTR,
  CPC,
  { label: 'Content Views', fmt: 'num', sentiment: 'higher-better', value: (b) => b.contentViews },
  { label: 'Cost per Content View', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.contentViews) },
  { label: 'Content View Rate', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.contentViews, b.linkClicks, 100) },
  { label: 'Add to Cart', fmt: 'num', sentiment: 'higher-better', value: (b) => b.atc },
  { label: 'Cost per Add to Cart', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.atc) },
  { label: 'ATC Rate', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.atc, b.contentViews, 100) },
  { label: 'Purchases', fmt: 'num', sentiment: 'higher-better', value: (b) => b.purchases },
  { label: 'Cost per Purchase', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, b.purchases) },
  { label: 'Purchase Rate', fmt: 'pct', sentiment: 'higher-better', value: (b) => div(b.purchases, b.atc, 100) },
  { label: 'Average Order Value', fmt: 'rp', sentiment: 'higher-better', value: (b) => div(b.purchaseValue, b.purchases) },
];

// B2B's result is the lead. A messaging campaign (Send Message) has no Leads
// column — its conversations are the lead there, and are named as such rather
// than passed off as form leads.
function b2bSpecs(sample: Base[]): Spec[] {
  const hasLeads = sample.some((b) => b.leads !== null);
  const hasConv = sample.some((b) => b.conversations !== null);
  const useConv = !hasLeads && hasConv;
  const count = (b: Base) => (useConv ? b.conversations : b.leads);
  return [
    SPEND,
    { label: useConv ? 'Leads (Messaging Conversations)' : 'Leads', fmt: 'num', sentiment: 'higher-better', value: count },
    { label: useConv ? 'Cost per Lead (per Conversation)' : 'Cost per Lead', fmt: 'rp', sentiment: 'lower-better', value: (b) => div(b.spend, count(b)) },
    FREQUENCY,
    IMPRESSIONS,
    CPM,
    LINK_CLICKS,
    CTR,
    CPC,
  ];
}

export type MetaOverviewKind = 'boost' | 'ecommerce' | 'b2b';

export interface MetaOverviewRow {
  label: string;
  old: string;
  cur: string;
  delta: string;
  deltaNum: number | null;
  cls: DeltaClassName;
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
export function buildMetaOverviewRows(kind: MetaOverviewKind, old: SheetRow[], cur: SheetRow[], allowReach = true): MetaOverviewRow[] {
  const bo = base(old, allowReach);
  const bc = base(cur, allowReach);
  const specs = kind === 'boost' ? BOOST : kind === 'ecommerce' ? ECOMMERCE : b2bSpecs([bo, bc]);
  return specs.map((s) => {
    const v1 = s.value(bo);
    const v2 = s.value(bc);
    const { deltaNum, deltaStr } = v1 !== null && v2 !== null && Number.isFinite(v1) && Number.isFinite(v2) ? computeDelta(v1, v2) : { deltaNum: null, deltaStr: '—' };
    return { label: s.label, old: format(v1, s.fmt), cur: format(v2, s.fmt), delta: formatDeltaID(deltaNum, deltaStr), deltaNum, cls: deltaClassForSentiment(deltaNum, s.sentiment) };
  });
}
