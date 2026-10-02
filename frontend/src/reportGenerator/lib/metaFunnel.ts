import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
import { agg } from './meta';
import type { PivotFmt } from './shopeeDeepDivePivot';
import type { FunnelTreeRow, FunnelValueRow } from './shopeeFunnel';
import type { SheetRow, Sentiment } from './types';

// ══════════════════════════════════════════════════════
// META ADS — ROOT CAUSE ANALYSIS (funnel decomposition)
//
// Two different trees, because Meta's two jobs are not the same job:
//
//   • Non-Boost Post and CPAS sell. Their tree is the sales funnel the
//     Shopee report already uses — GMV decomposes into Orders × AOV, Orders
//     into Traffic × Conversion Rate, and so on down to Spending and CPM.
//   • Boost Post does not sell; it buys attention. Its tree is rooted in
//     Brand Consideration and splits into three parallel outcomes —
//     Interactions, Profile Visits, Follows — each earned from the same
//     Impressions, which is why Impressions/Spending/CPM appear under all
//     three branches rather than once at the top.
//
// The row shape produced here is Shopee's FunnelTreeRow / FunnelValueRow on
// purpose: SymptomTreePanel and the values table then render Meta with no
// changes at all.
//
// Every rate is derived from its own base counts rather than read from a
// reported rate column. Meta reports per-row rates that cannot be summed
// across campaigns, so a "CTR" column aggregated over a month is not the
// month's CTR. Dividing the totals is.
// ══════════════════════════════════════════════════════

// findCol() in lib/columns matches any header CONTAINING a keyword, which is
// too loose here: asking for "purchases" would happily return "Cost per
// purchase". This one requires every word of a candidate and rejects headers
// carrying an excluded word.
function pickCol(rows: SheetRow[], include: string[], exclude: string[] = []): string | null {
  const headers = Object.keys(rows[0] || {});
  for (const candidate of include) {
    const words = candidate.toLowerCase().split(' ').filter(Boolean);
    const hit = headers.find((h) => {
      const lc = h.toLowerCase();
      return words.every((w) => lc.includes(w)) && !exclude.some((x) => lc.includes(x.toLowerCase()));
    });
    if (hit) return hit;
  }
  return null;
}

const COST_PREFIXES = ['cost per', 'cost/', 'biaya per'];

function total(rows: SheetRow[], include: string[], exclude: string[] = []): number | null {
  if (!rows.length) return null;
  const col = pickCol(rows, include, [...COST_PREFIXES, ...exclude]);
  return col ? agg(rows, col) : null;
}

// A rate only exists when both sides do and the denominator is real. Zero
// denominators return null, not 0 — "no traffic" is not "0% conversion".
function ratio(numerator: number | null, denominator: number | null, scale = 100): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return (numerator / denominator) * scale;
}

// Derive a rate from its own base counts when the export carries them; fall
// back to the rate column Meta already computed when it does not.
//
// Deriving is preferred because Meta's rate cells are per-row and cannot be
// summed across campaigns — a month's CTR is its clicks over its impressions,
// not the mean of its rows. But some exports (the Instagram objective report,
// for one) ship the rate and none of its inputs, and refusing to read it there
// meant telling the user a column was missing while it sat in their file.
// agg() weights such columns rather than averaging them flat.
function rateOr(derived: number | null, rows: SheetRow[], reported: string[], exclude: string[] = []): number | null {
  if (derived !== null) return derived;
  return total(rows, reported, exclude);
}

function sum(...parts: (number | null)[]): number | null {
  const present = parts.filter((p): p is number => p !== null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

// Revenue and Spending as the funnel resolves them. Exported so Special
// Moment reads the same columns by the same rules — two places guessing at
// "which column is revenue" is how two numbers in one report stop agreeing.
export function metaRevenueTotal(rows: SheetRow[]): number | null {
  return total(rows, ['purchases conversion value for shared', 'purchases conversion value', 'conversion value']);
}

export function metaSpendTotal(rows: SheetRow[]): number | null {
  return total(rows, ['amount spent', 'spend']);
}

// ── Sales funnel: Non-Boost Post & CPAS ──────────────────────────────────

export interface MetaSalesMetrics {
  gmv: number | null;
  orders: number | null;
  aov: number | null;
  contentViews: number | null;
  impressions: number | null;
  spend: number | null;
  cpm: number | null;
  ctr: number | null;
  conversionRate: number | null;
  visitor: number | null;
  atc: number | null;
  visitToAtcRate: number | null;
  purchase: number | null;
  atcToPurchaseRate: number | null;
}

export function metaSalesMetrics(rows: SheetRow[]): MetaSalesMetrics {
  // CPAS reports its conversions as "… for shared items"; the plain account
  // columns carry the same meaning for Non-Boost. Shared-item variants are
  // listed first so a CPAS file resolves to them.
  const gmv = total(rows, ['purchases conversion value for shared', 'purchases conversion value', 'conversion value']);
  const orders = total(rows, ['purchases with shared', 'purchases'], ['value', 'roas', 'rate']);
  const impressions = total(rows, ['impressions']);
  const spend = total(rows, ['amount spent', 'spend']);
  const contentViews = total(rows, ['content views', 'landing page views', 'link clicks'], ['rate', 'ratio', 'ration']);
  const atc = total(rows, ['adds to cart with shared', 'adds to cart', 'add to cart'], ['value', 'rate', 'roas']);

  return {
    gmv,
    orders,
    aov: rateOr(ratio(gmv, orders, 1), rows, ['average order value']),
    contentViews,
    impressions,
    spend,
    cpm: rateOr(ratio(spend, impressions, 1000), rows, ['cpm']),
    ctr: rateOr(ratio(contentViews, impressions), rows, ['ctr'], ['rate (', 'to atc']),
    conversionRate: rateOr(ratio(orders, contentViews), rows, ['cvr', 'conversion rate']),
    // Meta has no separate "Visitor" column — the visit that a cart follows
    // IS the content view, so the same figure fills that slot rather than
    // leaving the branch blank.
    visitor: contentViews,
    atc,
    visitToAtcRate: rateOr(ratio(atc, contentViews), rows, ['content views to atc rate', 'atc rate']),
    purchase: orders,
    atcToPurchaseRate: rateOr(ratio(orders, atc), rows, ['atc to pur', 'purchase rate']),
  };
}

interface TreeDef<M> {
  key: string;
  metric: keyof M;
  label: string;
  prefix: string;
  depth: number;
  fmt: PivotFmt;
  sentiment: Sentiment;
}

const SALES_TREE: readonly TreeDef<MetaSalesMetrics>[] = [
  { key: 'gmv', metric: 'gmv', label: 'Gross Merchandise Value', prefix: '', depth: 0, fmt: 'rp', sentiment: 'higher-better' },
  { key: 'orders', metric: 'orders', label: 'Orders', prefix: '├─ ', depth: 1, fmt: 'num', sentiment: 'higher-better' },
  { key: 'contentViews', metric: 'contentViews', label: 'Traffic (Content Views)', prefix: '│  ├─ ', depth: 2, fmt: 'num', sentiment: 'higher-better' },
  { key: 'impressions', metric: 'impressions', label: 'Impressions', prefix: '│  │  ├─ ', depth: 3, fmt: 'num', sentiment: 'higher-better' },
  { key: 'spend', metric: 'spend', label: 'Spending', prefix: '│  │  │  ├─ ', depth: 4, fmt: 'rp', sentiment: 'neutral' },
  { key: 'cpm', metric: 'cpm', label: 'CPM', prefix: '│  │  │  └─ ', depth: 4, fmt: 'rp', sentiment: 'lower-better' },
  { key: 'ctr', metric: 'ctr', label: 'Click-Through Rate', prefix: '│  │  └─ ', depth: 3, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cvr', metric: 'conversionRate', label: 'Conversion Rate', prefix: '│  └─ ', depth: 2, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'visitToAtc', metric: 'visitToAtcRate', label: 'Visit → ATC Rate', prefix: '│     ├─ ', depth: 3, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'visitor', metric: 'visitor', label: 'Visitor', prefix: '│     │  ├─ ', depth: 4, fmt: 'num', sentiment: 'higher-better' },
  { key: 'atcUnderVisit', metric: 'atc', label: 'ATC', prefix: '│     │  └─ ', depth: 4, fmt: 'num', sentiment: 'higher-better' },
  { key: 'atcToPurchase', metric: 'atcToPurchaseRate', label: 'ATC → Purchase Rate', prefix: '│     └─ ', depth: 3, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'atcUnderPurchase', metric: 'atc', label: 'ATC', prefix: '│        ├─ ', depth: 4, fmt: 'num', sentiment: 'higher-better' },
  { key: 'purchase', metric: 'purchase', label: 'Purchase', prefix: '│        └─ ', depth: 4, fmt: 'num', sentiment: 'higher-better' },
  { key: 'aov', metric: 'aov', label: 'Average Order Value', prefix: '└─ ', depth: 1, fmt: 'rp', sentiment: 'higher-better' },
];

// ── Brand funnel: Boost Post ─────────────────────────────────────────────

export interface MetaBrandMetrics {
  brandConsideration: number | null;
  interactions: number | null;
  profileVisits: number | null;
  follows: number | null;
  impressions: number | null;
  spend: number | null;
  cpm: number | null;
  interactionRate: number | null;
  profileVisitsRate: number | null;
  followRate: number | null;
}

export function metaBrandMetrics(rows: SheetRow[]): MetaBrandMetrics {
  const impressions = total(rows, ['impressions']);
  const spend = total(rows, ['amount spent', 'spend']);
  // MIL's own Boost template names the column plain "Interaction"; the
  // rate and cost variants are kept out by the exclusions.
  const interactions = total(rows, ['post engagement', 'post interactions', 'engagement', 'interaction'], ['rate']);
  const profileVisits = total(rows, ['profile visits', 'profile visit'], ['rate']);
  const follows = total(rows, ['follows', 'new followers', 'page likes'], ['rate']);

  return {
    // Brand Consideration has no column of its own: it is the three outcomes
    // this channel is bought for, added together. Stated here rather than
    // hidden in a chart so the definition can be argued with.
    brandConsideration: sum(interactions, profileVisits, follows),
    interactions,
    profileVisits,
    follows,
    impressions,
    spend,
    cpm: ratio(spend, impressions, 1000),
    interactionRate: ratio(interactions, impressions),
    profileVisitsRate: ratio(profileVisits, impressions),
    followRate: ratio(follows, impressions),
  };
}

// ── Non-sales objectives: Leads, Engagement (messages), Traffic ──────────
// What a Non-Boost campaign that is not selling is judged on. Rates come from
// each slice's own counts, like the sales set above.

export interface MetaObjectiveMetrics {
  impressions: number | null;
  spend: number | null;
  cpm: number | null;
  linkClicks: number | null;
  ctr: number | null;
  cpc: number | null;
  leads: number | null;
  costPerLead: number | null;
  leadRate: number | null;
  conversations: number | null;
  costPerConversation: number | null;
  conversationRate: number | null;
  interactions: number | null;
  interactionRate: number | null;
  profileVisits: number | null;
  costPerProfileVisit: number | null;
}

export function metaObjectiveMetrics(rows: SheetRow[]): MetaObjectiveMetrics {
  const impressions = total(rows, ['impressions']);
  const spend = total(rows, ['amount spent', 'spend']);
  const linkClicks = total(rows, ['link clicks', 'outbound clicks', 'clicks (all)'], ['rate', 'ctr']);
  const leads = total(rows, ['on-facebook leads', 'leads'], ['rate', 'form']);
  const conversations = total(rows, ['messaging conversations started', 'conversations started'], ['rate']);
  const interactions = total(rows, ['post engagement', 'post interactions', 'engagement', 'interaction'], ['rate']);
  const profileVisits = total(rows, ['profile visits', 'profile visit'], ['rate']);
  return {
    impressions,
    spend,
    cpm: ratio(spend, impressions, 1000),
    linkClicks,
    ctr: rateOr(ratio(linkClicks, impressions), rows, ['ctr'], ['rate (', 'to atc']),
    cpc: ratio(spend, linkClicks, 1),
    leads,
    costPerLead: ratio(spend, leads, 1),
    leadRate: ratio(leads, linkClicks),
    conversations,
    costPerConversation: ratio(spend, conversations, 1),
    conversationRate: ratio(conversations, linkClicks),
    interactions,
    interactionRate: ratio(interactions, impressions),
    profileVisits,
    costPerProfileVisit: ratio(spend, profileVisits, 1),
  };
}

// ── Leads: Non-Boost Post, B2B Leads lane ────────────────────────────────
// The lead is the result. A Send Message campaign has no Leads column — its
// conversations started are the lead there (MIL counts a chat as a lead), so
// the count falls back to them rather than reading as missing.

export interface MetaLeadMetrics {
  leads: number | null;
  linkClicks: number | null;
  impressions: number | null;
  spend: number | null;
  cpm: number | null;
  ctr: number | null;
  leadRate: number | null;
  costPerLead: number | null;
  // True when `leads` is messaging conversations, so labels can say so.
  fromConversations: boolean;
}

export function metaLeadMetrics(rows: SheetRow[]): MetaLeadMetrics {
  const o = metaObjectiveMetrics(rows);
  const fromConversations = o.leads === null && o.conversations !== null;
  const leads = fromConversations ? o.conversations : o.leads;
  return {
    leads,
    linkClicks: o.linkClicks,
    impressions: o.impressions,
    spend: o.spend,
    cpm: o.cpm,
    ctr: o.ctr,
    leadRate: ratio(leads, o.linkClicks),
    costPerLead: ratio(o.spend, leads, 1),
    fromConversations,
  };
}

const LEAD_TREE: readonly TreeDef<MetaLeadMetrics>[] = [
  { key: 'leads', metric: 'leads', label: 'Leads', prefix: '', depth: 0, fmt: 'num', sentiment: 'higher-better' },
  { key: 'clicks', metric: 'linkClicks', label: 'Traffic (Link Clicks)', prefix: '├─ ', depth: 1, fmt: 'num', sentiment: 'higher-better' },
  { key: 'impressions', metric: 'impressions', label: 'Impressions', prefix: '│  ├─ ', depth: 2, fmt: 'num', sentiment: 'higher-better' },
  { key: 'spend', metric: 'spend', label: 'Spending', prefix: '│  │  ├─ ', depth: 3, fmt: 'rp', sentiment: 'neutral' },
  { key: 'cpm', metric: 'cpm', label: 'CPM', prefix: '│  │  └─ ', depth: 3, fmt: 'rp', sentiment: 'lower-better' },
  { key: 'ctr', metric: 'ctr', label: 'Click-Through Rate', prefix: '│  └─ ', depth: 2, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'leadRate', metric: 'leadRate', label: 'Leads Rate (Leads ÷ Link Clicks)', prefix: '├─ ', depth: 1, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cpl', metric: 'costPerLead', label: 'Cost per Lead', prefix: '└─ ', depth: 1, fmt: 'rp', sentiment: 'lower-better' },
];

const BRAND_TREE: readonly TreeDef<MetaBrandMetrics>[] = [
  { key: 'brand', metric: 'brandConsideration', label: 'Brand Consideration', prefix: '', depth: 0, fmt: 'num', sentiment: 'higher-better' },

  { key: 'interactions', metric: 'interactions', label: 'Interactions (like, share, saves, comments)', prefix: '├─ ', depth: 1, fmt: 'num', sentiment: 'higher-better' },
  { key: 'iImpr', metric: 'impressions', label: 'Impressions', prefix: '│  ├─ ', depth: 2, fmt: 'num', sentiment: 'higher-better' },
  { key: 'iSpend', metric: 'spend', label: 'Spending', prefix: '│  │  ├─ ', depth: 3, fmt: 'rp', sentiment: 'neutral' },
  { key: 'iCpm', metric: 'cpm', label: 'CPM', prefix: '│  │  └─ ', depth: 3, fmt: 'rp', sentiment: 'lower-better' },
  { key: 'iRate', metric: 'interactionRate', label: 'Interaction Rate', prefix: '│  └─ ', depth: 2, fmt: 'pct', sentiment: 'higher-better' },

  { key: 'profileVisits', metric: 'profileVisits', label: 'Profile Visits', prefix: '├─ ', depth: 1, fmt: 'num', sentiment: 'higher-better' },
  { key: 'pImpr', metric: 'impressions', label: 'Impressions', prefix: '│  ├─ ', depth: 2, fmt: 'num', sentiment: 'higher-better' },
  { key: 'pSpend', metric: 'spend', label: 'Spending', prefix: '│  │  ├─ ', depth: 3, fmt: 'rp', sentiment: 'neutral' },
  { key: 'pCpm', metric: 'cpm', label: 'CPM', prefix: '│  │  └─ ', depth: 3, fmt: 'rp', sentiment: 'lower-better' },
  { key: 'pRate', metric: 'profileVisitsRate', label: 'Profile Visits Rate', prefix: '│  └─ ', depth: 2, fmt: 'pct', sentiment: 'higher-better' },

  { key: 'follows', metric: 'follows', label: 'Follows', prefix: '└─ ', depth: 1, fmt: 'num', sentiment: 'higher-better' },
  { key: 'fImpr', metric: 'impressions', label: 'Impressions', prefix: '   ├─ ', depth: 2, fmt: 'num', sentiment: 'higher-better' },
  { key: 'fSpend', metric: 'spend', label: 'Spending', prefix: '   │  ├─ ', depth: 3, fmt: 'rp', sentiment: 'neutral' },
  { key: 'fCpm', metric: 'cpm', label: 'CPM', prefix: '   │  └─ ', depth: 3, fmt: 'rp', sentiment: 'lower-better' },
  { key: 'fRate', metric: 'followRate', label: 'Follow Rate', prefix: '   └─ ', depth: 2, fmt: 'pct', sentiment: 'higher-better' },
];

// ── Shared assembly ──────────────────────────────────────────────────────

export interface MetaFunnel {
  values: FunnelValueRow[];
  tree: FunnelTreeRow[];
  // False when not even the root is measurable.
  hasData: boolean;
  // Nodes this export cannot measure, named so the section can say which
  // columns were missing rather than leaving a shorter tree unexplained.
  missing: string[];
}

function assemble<M>(defs: readonly TreeDef<M>[], mOld: M, mCur: M): MetaFunnel {
  // A node this export cannot measure is DROPPED, together with everything
  // beneath it — never drawn as zero. Zero is a real reading ("nobody added
  // to cart"); a missing column is not, and the two must never look alike.
  // Keeping a child whose parent was dropped would leave it dangling off a
  // branch that no longer exists, so the whole subtree goes.
  const missing: string[] = [];
  const rows: FunnelTreeRow[] = [];
  let skipBelow: number | null = null;

  for (const def of defs) {
    if (skipBelow !== null) {
      if (def.depth > skipBelow) continue;
      skipBelow = null;
    }
    const oldNum = (mOld[def.metric] ?? null) as number | null;
    const curNum = (mCur[def.metric] ?? null) as number | null;
    if (oldNum === null && curNum === null) {
      if (!missing.includes(def.label)) missing.push(def.label);
      skipBelow = def.depth;
      continue;
    }
    const o = oldNum ?? 0;
    const c = curNum ?? 0;
    const { deltaNum, deltaStr } = computeDelta(o, c);
    rows.push({
      key: def.key,
      label: def.label,
      prefix: def.prefix,
      depth: def.depth,
      fmt: def.fmt,
      oldNum: o,
      curNum: c,
      deltaNum,
      delta: formatDeltaID(deltaNum, deltaStr),
      cls: deltaClassForSentiment(deltaNum, def.sentiment),
    });
  }

  // The values table drops the repeated branch copies — a table listing
  // "Impressions" three times is noise; the tree is where the repetition
  // carries meaning.
  const seen = new Set<string>();
  const values: FunnelValueRow[] = [];
  for (const r of rows) {
    if (seen.has(r.label)) continue;
    seen.add(r.label);
    values.push({ key: r.key, label: r.label, fmt: r.fmt, oldNum: r.oldNum, curNum: r.curNum, deltaNum: r.deltaNum, delta: r.delta, cls: r.cls });
  }

  return { values, tree: rows, hasData: rows.length > 0, missing };
}

export function buildMetaSalesFunnel(oldRows: SheetRow[], curRows: SheetRow[]): MetaFunnel {
  return assemble(SALES_TREE, metaSalesMetrics(oldRows), metaSalesMetrics(curRows));
}

export function buildMetaBrandFunnel(oldRows: SheetRow[], curRows: SheetRow[]): MetaFunnel {
  return assemble(BRAND_TREE, metaBrandMetrics(oldRows), metaBrandMetrics(curRows));
}

export function buildMetaLeadFunnel(oldRows: SheetRow[], curRows: SheetRow[]): MetaFunnel {
  return assemble(LEAD_TREE, metaLeadMetrics(oldRows), metaLeadMetrics(curRows));
}
