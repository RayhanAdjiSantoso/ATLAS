// Catalog of the metrics the monthly Meta Ads auto-fetch can store, and the
// pure function that turns one raw Marketing API insights row into a stored
// row. Apps Script (apps-script/MetaAdsMonthly.gs) deliberately stays dumb —
// it requests a fixed field set and forwards each row as-is — so every
// definition below can be changed with an ATLAS deploy alone, no Apps
// Script redeploy.
//
// Raw row shape sent by Apps Script:
//   { date, campaignId, campaignName, objective, age, gender,
//     spend, impressions, reach, frequency,
//     linkClicks, linkCtr, cpc, cpm, purchaseRoas,
//     actions: { <action_type>: number }, actionValues: { <action_type>: number } }

// Named action-type groups. The first type present on a row wins (never a
// sum — pixel and omni_* report the same event, adding them double counts).
// Pixel types come first to match apps-script/Weekly.gs's EVENT_MAP, which
// is what the rest of the Meta Ads Automation module already treats as
// canonical.
const ACTION_TYPES = {
  // The Marketing API does not return "Instagram profile visits" (see
  // PROXY_KEYS in Weekly.gs, measured across attribution windows), so link
  // clicks stand in for it. Consistently 3–8% below Ads Manager.
  profile_visits: ['link_click'],
  content_views: ['offsite_conversion.fb_pixel_view_content', 'omni_view_content'],
  add_to_cart: ['offsite_conversion.fb_pixel_add_to_cart', 'omni_add_to_cart'],
  initiate_checkout: ['offsite_conversion.fb_pixel_initiate_checkout', 'omni_initiated_checkout'],
  purchase: ['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase'],
  messages: ['onsite_conversion.messaging_conversation_started_7d'],
  landing_page_views: ['landing_page_view'],
  leads: ['offsite_conversion.fb_pixel_lead', 'lead'],
  post_engagement: ['post_engagement'],
  post_reactions: ['post_reaction'],
  post_comments: ['comment'],
  post_shares: ['post'],
  post_saves: ['onsite_conversion.post_save'],
  video_plays: ['video_view'],
};

const pickAction = (map, group) => {
  if (!map) return null;
  for (const type of ACTION_TYPES[group]) {
    if (map[type] != null && Number.isFinite(Number(map[type]))) return Number(map[type]);
  }
  return null;
};

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const ratio = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
const pct = (a, b) => { const r = ratio(a, b); return r == null ? null : r * 100; };

// ctx = { raw, spend }. `count(group)` / `value(group)` read the action
// counts / conversion values with the group's first-present-type rule.
const count = (ctx, group) => pickAction(ctx.raw.actions, group);
const value = (ctx, group) => pickAction(ctx.raw.actionValues, group);
const costPer = (ctx, group) => ratio(ctx.spend, count(ctx, group));

// unit: 'idr' | 'count' | 'pct' | 'ratio' | 'text' — drives display only.
// actionGroups: which ACTION_TYPES groups compute() reads, so the exact
// action types to request/forward can be derived from the selected metrics.
export const METRICS = [
  // ── Default: always fetched ───────────────────────────────────────
  { key: 'objective', label: 'Objective', group: 'default', unit: 'text', compute: (c) => c.raw.objective ?? null },
  { key: 'amount_spent', label: 'Amount Spent', group: 'default', unit: 'idr', compute: (c) => c.spend },
  { key: 'impressions', label: 'Impressions', group: 'default', unit: 'count', compute: (c) => num(c.raw.impressions) },
  { key: 'reach', label: 'Reach', group: 'default', unit: 'count', compute: (c) => num(c.raw.reach) },
  { key: 'frequency', label: 'Frequency', group: 'default', unit: 'ratio', compute: (c) => num(c.raw.frequency) },
  { key: 'ctr', label: 'CTR (link click-through rate)', group: 'default', unit: 'pct', compute: (c) => num(c.raw.linkCtr) },
  { key: 'link_clicks', label: 'Link clicks', group: 'default', unit: 'count', compute: (c) => num(c.raw.linkClicks) },
  { key: 'cpc', label: 'CPC (cost per link click)', group: 'default', unit: 'idr', compute: (c) => num(c.raw.cpc) },
  { key: 'cpm', label: 'CPM (cost per 1,000 impressions)', group: 'default', unit: 'idr', compute: (c) => num(c.raw.cpm) },
  {
    key: 'profile_visits', label: 'Instagram profile visits', group: 'default', unit: 'count',
    note: 'Pendekatan: memakai link clicks (API Meta tidak menyediakan profile visits), sekitar 3–8% di bawah Ads Manager.',
    actionGroups: ['profile_visits'], compute: (c) => count(c, 'profile_visits'),
  },
  { key: 'cost_per_profile_visit', label: 'Cost per Profile Visits', group: 'default', unit: 'idr', actionGroups: ['profile_visits'], compute: (c) => costPer(c, 'profile_visits') },
  { key: 'content_views', label: 'Content views', group: 'default', unit: 'count', actionGroups: ['content_views'], compute: (c) => count(c, 'content_views') },
  { key: 'cost_per_content_view', label: 'Cost per content view', group: 'default', unit: 'idr', actionGroups: ['content_views'], compute: (c) => costPer(c, 'content_views') },
  {
    key: 'vc_to_atc_ratio', label: 'View Content to ATC Ratio', group: 'default', unit: 'pct',
    actionGroups: ['content_views', 'add_to_cart'], compute: (c) => pct(count(c, 'add_to_cart'), count(c, 'content_views')),
  },
  { key: 'cost_per_atc', label: 'Cost per ATC', group: 'default', unit: 'idr', actionGroups: ['add_to_cart'], compute: (c) => costPer(c, 'add_to_cart') },
  {
    key: 'atc_to_purchase_ratio', label: 'ATC to Purchase Ratio', group: 'default', unit: 'pct',
    actionGroups: ['add_to_cart', 'purchase'], compute: (c) => pct(count(c, 'purchase'), count(c, 'add_to_cart')),
  },
  { key: 'purchases', label: 'Purchases', group: 'default', unit: 'count', actionGroups: ['purchase'], compute: (c) => count(c, 'purchase') },
  { key: 'purchase_value', label: 'Purchase conversion value', group: 'default', unit: 'idr', actionGroups: ['purchase'], compute: (c) => value(c, 'purchase') },
  { key: 'cost_per_purchase', label: 'Cost per purchase', group: 'default', unit: 'idr', actionGroups: ['purchase'], compute: (c) => costPer(c, 'purchase') },
  {
    key: 'results_roas', label: 'Results ROAS', group: 'default', unit: 'ratio', actionGroups: ['purchase'],
    // purchase_roas is Meta's own figure; fall back to value ÷ spend when the
    // API leaves it out for a row.
    compute: (c) => num(c.raw.purchaseRoas) ?? ratio(value(c, 'purchase'), c.spend),
  },

  // ── Optional: ticked per brand in Data & file ─────────────────────
  { key: 'total_messages', label: 'Total messages', group: 'optional', unit: 'count', actionGroups: ['messages'], compute: (c) => count(c, 'messages') },
  { key: 'cost_per_message', label: 'Cost per Total Messages', group: 'optional', unit: 'idr', actionGroups: ['messages'], compute: (c) => costPer(c, 'messages') },
  { key: 'adds_to_cart', label: 'Adds to cart', group: 'optional', unit: 'count', actionGroups: ['add_to_cart'], compute: (c) => count(c, 'add_to_cart') },
  { key: 'adds_to_cart_value', label: 'Adds to cart conversion value', group: 'optional', unit: 'idr', actionGroups: ['add_to_cart'], compute: (c) => value(c, 'add_to_cart') },
  { key: 'checkouts_initiated', label: 'Checkouts initiated', group: 'optional', unit: 'count', actionGroups: ['initiate_checkout'], compute: (c) => count(c, 'initiate_checkout') },
  { key: 'cost_per_checkout', label: 'Cost per checkout initiated', group: 'optional', unit: 'idr', actionGroups: ['initiate_checkout'], compute: (c) => costPer(c, 'initiate_checkout') },
  { key: 'landing_page_views', label: 'Landing page views', group: 'optional', unit: 'count', actionGroups: ['landing_page_views'], compute: (c) => count(c, 'landing_page_views') },
  { key: 'cost_per_landing_page_view', label: 'Cost per landing page view', group: 'optional', unit: 'idr', actionGroups: ['landing_page_views'], compute: (c) => costPer(c, 'landing_page_views') },
  { key: 'leads', label: 'Leads', group: 'optional', unit: 'count', actionGroups: ['leads'], compute: (c) => count(c, 'leads') },
  { key: 'cost_per_lead', label: 'Cost per lead', group: 'optional', unit: 'idr', actionGroups: ['leads'], compute: (c) => costPer(c, 'leads') },
  { key: 'post_engagements', label: 'Post engagements', group: 'optional', unit: 'count', actionGroups: ['post_engagement'], compute: (c) => count(c, 'post_engagement') },
  { key: 'post_reactions', label: 'Post reactions', group: 'optional', unit: 'count', actionGroups: ['post_reactions'], compute: (c) => count(c, 'post_reactions') },
  { key: 'post_comments', label: 'Post comments', group: 'optional', unit: 'count', actionGroups: ['post_comments'], compute: (c) => count(c, 'post_comments') },
  { key: 'post_shares', label: 'Post shares', group: 'optional', unit: 'count', actionGroups: ['post_shares'], compute: (c) => count(c, 'post_shares') },
  { key: 'post_saves', label: 'Post saves', group: 'optional', unit: 'count', actionGroups: ['post_saves'], compute: (c) => count(c, 'post_saves') },
  { key: 'video_plays', label: 'Video plays', group: 'optional', unit: 'count', actionGroups: ['video_plays'], compute: (c) => count(c, 'video_plays') },
];

const BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
export const DEFAULT_METRIC_KEYS = METRICS.filter((m) => m.group === 'default').map((m) => m.key);
export const OPTIONAL_METRIC_KEYS = METRICS.filter((m) => m.group === 'optional').map((m) => m.key);

// What the UI needs to draw the picker (no compute functions).
export function metricCatalog() {
  return METRICS.map(({ key, label, group, unit, note }) => ({ key, label, group, unit, note: note ?? null }));
}

// Silently drops unknown/default keys so a stale or tampered selection can
// never reach compute().
export function sanitizeExtraMetrics(keys) {
  if (!Array.isArray(keys)) return [];
  const wanted = new Set(keys);
  return OPTIONAL_METRIC_KEYS.filter((k) => wanted.has(k));
}

export function selectedMetricKeys(extraMetrics) {
  return [...DEFAULT_METRIC_KEYS, ...sanitizeExtraMetrics(extraMetrics)];
}

// The exact action_type strings Apps Script should keep on each row for this
// selection — everything else is dropped before the POST to keep the payload
// small.
export function requiredActionTypes(extraMetrics) {
  const groups = new Set();
  for (const key of selectedMetricKeys(extraMetrics)) {
    for (const g of BY_KEY.get(key).actionGroups ?? []) groups.add(g);
  }
  return [...new Set([...groups].flatMap((g) => ACTION_TYPES[g]))];
}

// Column headers used when the stored data is written back out as an Ads
// Manager-style file (services/metaAdsLibraryExport.js). Same wording as a
// real Ads Manager export so the Report Generator's header matching
// (features/meta/metaReport.ts) treats the file like a manual upload; only
// the two headers that differ from the catalog label are listed.
const EXPORT_LABELS = {
  amount_spent: 'Amount spent (IDR)',
  purchase_value: 'Purchases conversion value',
};

export function exportColumns(extraMetrics) {
  return selectedMetricKeys(extraMetrics).map((key) => ({ key, header: EXPORT_LABELS[key] ?? BY_KEY.get(key).label }));
}

// Typed columns for the additive core metrics; every other selected metric
// goes into the `metrics` JSONB.
export const TYPED_KEYS = new Set(['objective', 'amount_spent', 'impressions', 'reach', 'link_clicks', 'purchases', 'purchase_value']);

// One raw Marketing API row -> the row stored in meta_ads_insights_daily.
// Returns null for a row that cannot be keyed (missing date/campaign).
export function normalizeInsightRow(raw, extraMetrics) {
  if (!raw?.date || !raw?.campaignId) return null;
  const ctx = { raw, spend: num(raw.spend) };

  const typed = {};
  const metrics = {};
  for (const key of selectedMetricKeys(extraMetrics)) {
    const result = BY_KEY.get(key).compute(ctx);
    if (TYPED_KEYS.has(key)) typed[key] = result;
    else if (result != null) metrics[key] = result;
  }

  return {
    entry_date: raw.date,
    campaign_id: String(raw.campaignId),
    campaign_name: raw.campaignName ?? '',
    age: raw.age || 'Unknown',
    gender: raw.gender || 'unknown',
    objective: typed.objective ?? null,
    amount_spent: typed.amount_spent ?? null,
    impressions: typed.impressions ?? null,
    reach: typed.reach ?? null,
    link_clicks: typed.link_clicks ?? null,
    purchases: typed.purchases ?? null,
    purchase_value: typed.purchase_value ?? null,
    metrics,
  };
}
