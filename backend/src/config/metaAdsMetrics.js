// Catalog of the metrics the Meta Ads auto-fetch stores, and the pure
// function that turns one raw Marketing API insights row into a stored row.
// Apps Script (apps-script/MetaAdsMonthly.gs) deliberately stays dumb — it
// requests a fixed field set and forwards each row as-is — so every
// definition below can be changed with an ATLAS deploy alone, no Apps
// Script redeploy.
//
// Raw row shape sent by Apps Script (level=ad, breakdowns age,gender, daily):
//   { date, campaignId, campaignName, adsetId, adsetName, adId, adName,
//     objective, age, gender,
//     spend, impressions, reach, frequency,
//     linkClicks, linkCtr, cpc, cpm, purchaseRoas,
//     results: { indicator, value } | null, costPerResult: { indicator, value } | null,
//     actions: { <action_type>: number }, actionValues: { <action_type>: number },
//     // CPAS accounts only — Meta's "with shared items" figures:
//     catalogActions: { <action_type>: number }, catalogValues: { <action_type>: number },
//     catalogRoas: number | null }
//
// Every metric belongs to one or more SECTIONS. A MAIN account row is
// stored with the Boost, Non-Boost E-commerce and Non-Boost B2B metrics all
// computed (which of those a campaign is gets decided when the file is
// written, from the account's Kata Kunci Boost Post); a CPAS row with the
// CPAS metrics.

export const SECTIONS = [
  { key: 'boost', label: 'Boost Post', accountType: 'MAIN' },
  { key: 'ecom', label: 'Non Boost Post (E-commerce)', accountType: 'MAIN' },
  { key: 'b2b', label: 'Non Boost Post (B2B)', accountType: 'MAIN' },
  { key: 'cpas', label: 'CPAS', accountType: 'CPAS' },
];

// The breakdown every section's file carries, in this order, before the
// metrics.
export const BREAKDOWNS = ['Campaign name', 'Ad set name', 'Ad name', 'Age', 'Gender', 'Objective', 'Day'];

// Named action-type groups. The first type present on a row wins (never a
// sum — pixel and omni_* report the same event, adding them double counts).
// Pixel types come first to match apps-script/Weekly.gs's EVENT_MAP, which
// is what the rest of the Meta Ads Automation module already treats as
// canonical. `lead` is Meta's own all-sources total (pixel + instant form),
// the number Ads Manager's Leads column shows.
const ACTION_TYPES = {
  content_views: ['offsite_conversion.fb_pixel_view_content', 'omni_view_content'],
  add_to_cart: ['offsite_conversion.fb_pixel_add_to_cart', 'omni_add_to_cart'],
  purchase: ['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase'],
  leads: ['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped'],
  // Ads Manager's "Messaging contacts" and "Messaging conversations started".
  messaging_contacts: ['onsite_conversion.total_messaging_connection'],
  messaging_conversations: ['onsite_conversion.messaging_conversation_started_7d'],
  post_reactions: ['post_reaction'],
  post_comments: ['comment'],
  post_saves: ['onsite_conversion.post_save'],
  post_shares: ['post'],
};

// Every action type the fetch must forward — ATLAS hands this list to Apps
// Script when a run starts, and Apps Script drops everything else.
export const REQUIRED_ACTION_TYPES = [...new Set(Object.values(ACTION_TYPES).flat())];

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
const sumPresent = (vals) => (vals.some((v) => v != null) ? vals.reduce((t, v) => t + (v ?? 0), 0) : null);

// ctx = { raw, spend }.
const count = (ctx, group) => pickAction(ctx.raw.actions, group);
const value = (ctx, group) => pickAction(ctx.raw.actionValues, group);
const sharedCount = (ctx, group) => pickAction(ctx.raw.catalogActions, group);
const sharedValue = (ctx, group) => pickAction(ctx.raw.catalogValues, group);

// "Instagram profile visits" is not an action type the Marketing API returns
// (see PROXY_KEYS in Weekly.gs), but a profile-visit campaign's main result
// IS its profile visits (result indicator profile_visit_view), so the visits
// come straight from Results and Cost per Profile Visit = Amount Spent ÷
// visits. Spend ÷ cost per result gives the same number wherever there is
// spend, but loses the rows Meta credits with visits at zero spend (e.g. the
// Unknown/unknown bucket), which Ads Manager does count.
// A result is read as a profile visit when Meta's result indicator says so,
// or when the campaign follows MIL's "… Profile Visit …" naming (its
// optimisation goal is then profile visits whatever the indicator reads).
const PROFILE_VISIT_INDICATOR = /profile/i;
const PROFILE_VISIT_CAMPAIGN = /profile\s*visit/i;
const isProfileVisitResult = (ctx) => {
  const indicator = ctx.raw.results?.indicator ?? ctx.raw.costPerResult?.indicator ?? '';
  if (!indicator && !ctx.raw.results && !ctx.raw.costPerResult) return false;
  return PROFILE_VISIT_INDICATOR.test(indicator) || PROFILE_VISIT_CAMPAIGN.test(ctx.raw.campaignName ?? '');
};
const profileVisits = (ctx) => {
  if (!isProfileVisitResult(ctx)) return null;
  const results = num(ctx.raw.results?.value);
  if (results != null) return results;
  // Rows from an Apps Script that only forwards cost_per_result.
  const visits = ratio(ctx.spend, num(ctx.raw.costPerResult?.value) || null);
  return visits == null ? null : Math.round(visits);
};

// Post likes + comments + saves + shares. "Likes" is post_reaction: the API
// has no likes-only count for a post (`like` is Page likes).
const interactions = (ctx) => sumPresent(['post_reactions', 'post_comments', 'post_saves', 'post_shares'].map((g) => count(ctx, g)));

// unit: 'idr' | 'count' | 'pct' | 'ratio' — drives display and the export
// cell type. `header` is the column name in the written file — Ads
// Manager's own wording, so the Report Generator's header matching
// (features/meta/metaReport.ts) reads the file like a manual export. Base
// counts come before the ratios built on them: the generator picks the
// first header that matches.
export const METRICS = [
  // ── Every section ──────────────────────────────────────────────────
  { key: 'amount_spent', header: 'Amount spent (IDR)', unit: 'idr', sections: ['boost', 'ecom', 'b2b', 'cpas'], compute: (c) => c.spend },

  // ── Boost Post ─────────────────────────────────────────────────────
  { key: 'profile_visits', header: 'Instagram profile visits', unit: 'count', sections: ['boost'], compute: profileVisits },
  { key: 'cost_per_profile_visit', header: 'Cost per Instagram profile visit', unit: 'idr', sections: ['boost'], compute: (c) => ratio(c.spend, profileVisits(c) || null) },
  { key: 'profile_visit_rate', header: 'Profile visit rate', unit: 'pct', sections: ['boost'], compute: (c) => pct(profileVisits(c), num(c.raw.impressions)) },

  // ── E-commerce: purchase value up front, as Ads Manager's Sales view has it
  { key: 'purchase_value', header: 'Purchases conversion value', unit: 'idr', sections: ['ecom'], compute: (c) => value(c, 'purchase') },
  { key: 'purchase_roas', header: 'Purchase ROAS (return on ad spend)', unit: 'ratio', sections: ['ecom'], compute: (c) => num(c.raw.purchaseRoas) ?? ratio(value(c, 'purchase'), c.spend) },

  // ── B2B: leads up front
  { key: 'leads', header: 'Leads', unit: 'count', sections: ['b2b'], compute: (c) => count(c, 'leads') },
  { key: 'cost_per_lead', header: 'Cost per lead', unit: 'idr', sections: ['b2b'], compute: (c) => ratio(c.spend, count(c, 'leads')) },

  // ── CPAS: shared-items value up front
  { key: 'shared_purchase_value', header: 'Purchases conversion value for shared items only', unit: 'idr', sections: ['cpas'], compute: (c) => sharedValue(c, 'purchase') },
  {
    key: 'shared_purchase_roas', header: 'Purchase ROAS for shared items only', unit: 'ratio', sections: ['cpas'],
    compute: (c) => num(c.raw.catalogRoas) ?? ratio(sharedValue(c, 'purchase'), c.spend),
  },

  // ── Delivery, every section
  { key: 'impressions', header: 'Impressions', unit: 'count', sections: ['boost', 'ecom', 'b2b', 'cpas'], compute: (c) => num(c.raw.impressions) },
  { key: 'cpm', header: 'CPM (cost per 1,000 impressions)', unit: 'idr', sections: ['boost', 'ecom', 'b2b', 'cpas'], compute: (c) => num(c.raw.cpm) },
  { key: 'link_clicks', header: 'Link clicks', unit: 'count', sections: ['boost', 'ecom', 'b2b', 'cpas'], compute: (c) => num(c.raw.linkClicks) },
  { key: 'cpc', header: 'CPC (cost per link click)', unit: 'idr', sections: ['boost', 'ecom', 'b2b', 'cpas'], compute: (c) => num(c.raw.cpc) },
  { key: 'ctr', header: 'CTR (link click-through rate)', unit: 'pct', sections: ['boost', 'ecom', 'b2b', 'cpas'], compute: (c) => num(c.raw.linkCtr) },

  // ── Boost Post: interactions
  { key: 'interactions', header: 'Post interactions', unit: 'count', sections: ['boost'], compute: interactions },
  { key: 'cost_per_interaction', header: 'Cost per post interaction', unit: 'idr', sections: ['boost'], compute: (c) => ratio(c.spend, interactions(c)) },

  // ── E-commerce funnel
  { key: 'content_views', header: 'Content views', unit: 'count', sections: ['ecom'], compute: (c) => count(c, 'content_views') },
  { key: 'cost_per_content_view', header: 'Cost per content view', unit: 'idr', sections: ['ecom'], compute: (c) => ratio(c.spend, count(c, 'content_views')) },
  { key: 'adds_to_cart', header: 'Adds to cart', unit: 'count', sections: ['ecom'], compute: (c) => count(c, 'add_to_cart') },
  { key: 'cost_per_add_to_cart', header: 'Cost per add to cart', unit: 'idr', sections: ['ecom'], compute: (c) => ratio(c.spend, count(c, 'add_to_cart')) },
  { key: 'add_to_cart_rate', header: 'Add to cart rate', unit: 'pct', sections: ['ecom'], compute: (c) => pct(count(c, 'add_to_cart'), count(c, 'content_views')) },
  { key: 'purchases', header: 'Purchases', unit: 'count', sections: ['ecom'], compute: (c) => count(c, 'purchase') },
  { key: 'cost_per_purchase', header: 'Cost per purchase', unit: 'idr', sections: ['ecom'], compute: (c) => ratio(c.spend, count(c, 'purchase')) },
  { key: 'purchase_rate', header: 'Purchase rate', unit: 'pct', sections: ['ecom'], compute: (c) => pct(count(c, 'purchase'), count(c, 'add_to_cart')) },
  { key: 'conversion_rate', header: 'Conversion rate (purchases ÷ content views)', unit: 'pct', sections: ['ecom'], compute: (c) => pct(count(c, 'purchase'), count(c, 'content_views')) },
  { key: 'average_order_value', header: 'Average order value', unit: 'idr', sections: ['ecom'], compute: (c) => ratio(value(c, 'purchase'), count(c, 'purchase')) },

  // ── B2B
  { key: 'messaging_contacts', header: 'Messaging contacts', unit: 'count', sections: ['b2b'], compute: (c) => count(c, 'messaging_contacts') },
  { key: 'cost_per_messaging_contact', header: 'Cost per messaging contact', unit: 'idr', sections: ['b2b'], compute: (c) => ratio(c.spend, count(c, 'messaging_contacts')) },
  { key: 'messaging_conversations', header: 'Messaging conversations started', unit: 'count', sections: ['b2b'], compute: (c) => count(c, 'messaging_conversations') },
  {
    key: 'cost_per_messaging_conversation', header: 'Cost per messaging conversation started', unit: 'idr', sections: ['b2b'],
    compute: (c) => ratio(c.spend, count(c, 'messaging_conversations')),
  },
  { key: 'lead_conversion_rate', header: 'Lead conversion rate (leads ÷ link clicks)', unit: 'pct', sections: ['b2b'], compute: (c) => pct(count(c, 'leads'), num(c.raw.linkClicks)) },

  // ── CPAS funnel, shared items
  { key: 'shared_content_views', header: 'Content views with shared items', unit: 'count', sections: ['cpas'], compute: (c) => sharedCount(c, 'content_views') },
  { key: 'cost_per_shared_content_view', header: 'Cost per content view with shared items', unit: 'idr', sections: ['cpas'], compute: (c) => ratio(c.spend, sharedCount(c, 'content_views')) },
  { key: 'shared_adds_to_cart', header: 'Adds to cart with shared items', unit: 'count', sections: ['cpas'], compute: (c) => sharedCount(c, 'add_to_cart') },
  { key: 'cost_per_shared_add_to_cart', header: 'Cost per add to cart with shared items', unit: 'idr', sections: ['cpas'], compute: (c) => ratio(c.spend, sharedCount(c, 'add_to_cart')) },
  { key: 'shared_add_to_cart_rate', header: 'Add to cart rate with shared items', unit: 'pct', sections: ['cpas'], compute: (c) => pct(sharedCount(c, 'add_to_cart'), sharedCount(c, 'content_views')) },
  { key: 'shared_purchases', header: 'Purchases with shared items', unit: 'count', sections: ['cpas'], compute: (c) => sharedCount(c, 'purchase') },
  { key: 'cost_per_shared_purchase', header: 'Cost per purchase with shared items', unit: 'idr', sections: ['cpas'], compute: (c) => ratio(c.spend, sharedCount(c, 'purchase')) },
  { key: 'shared_purchase_rate', header: 'Purchase rate with shared items', unit: 'pct', sections: ['cpas'], compute: (c) => pct(sharedCount(c, 'purchase'), sharedCount(c, 'add_to_cart')) },
  { key: 'shared_conversion_rate', header: 'Conversion rate with shared items', unit: 'pct', sections: ['cpas'], compute: (c) => pct(sharedCount(c, 'purchase'), sharedCount(c, 'content_views')) },
  { key: 'shared_average_order_value', header: 'Average order value with shared items', unit: 'idr', sections: ['cpas'], compute: (c) => ratio(sharedValue(c, 'purchase'), sharedCount(c, 'purchase')) },
];

const BY_KEY = new Map(METRICS.map((m) => [m.key, m]));
const sectionsOf = (accountType) => SECTIONS.filter((s) => s.accountType === accountType).map((s) => s.key);

// Stored on every row whatever its account type: the Internal Dashboard's
// Meta funnel (internalDashboardRepository.metaInsightsMonthly) sums these
// for CPAS accounts too, as it did before the per-section catalog.
const ALWAYS_STORED = ['purchases', 'purchase_value', 'content_views', 'adds_to_cart'];

// Metric keys stored for an account type: the union of its sections.
export function metricKeysFor(accountType) {
  const sections = new Set(sectionsOf(accountType));
  const keys = METRICS.filter((m) => m.sections.some((s) => sections.has(s))).map((m) => m.key);
  return [...new Set([...keys, ...ALWAYS_STORED])];
}

// What the UI needs to show the fixed metric list per section.
export function metricCatalog() {
  return SECTIONS.map((s) => ({
    key: s.key, label: s.label, accountType: s.accountType,
    metrics: METRICS.filter((m) => m.sections.includes(s.key)).map(({ key, header, unit }) => ({ key, label: header, unit })),
  }));
}

// Columns of one written file. `sections` is one section, or several whose
// metrics are merged (the Non Boost Post file carries E-commerce and B2B),
// in catalog order with no duplicates.
export function exportColumns(sections) {
  const wanted = new Set(sections);
  return METRICS.filter((m) => m.sections.some((s) => wanted.has(s))).map(({ key, header, unit }) => ({ key, header, unit }));
}

// Typed columns for the additive core metrics (what the Internal Dashboard
// SUMs); every other metric goes into the `metrics` JSONB. reach is kept in
// its column for continuity but is no longer exported.
export const TYPED_KEYS = new Set(['amount_spent', 'impressions', 'link_clicks', 'purchases', 'purchase_value']);

// One raw Marketing API row -> the row stored in meta_ads_insights_daily.
// Returns null for a row that cannot be keyed (missing date/campaign).
export function normalizeInsightRow(raw, accountType) {
  if (!raw?.date || !raw?.campaignId) return null;
  const ctx = { raw, spend: num(raw.spend) };

  const typed = {};
  const metrics = {};
  for (const key of metricKeysFor(accountType)) {
    const result = BY_KEY.get(key).compute(ctx);
    if (TYPED_KEYS.has(key)) typed[key] = result;
    else if (result != null) metrics[key] = result;
  }

  return {
    entry_date: raw.date,
    campaign_id: String(raw.campaignId),
    campaign_name: raw.campaignName ?? '',
    adset_id: raw.adsetId ? String(raw.adsetId) : '',
    adset_name: raw.adsetName ?? '',
    ad_id: raw.adId ? String(raw.adId) : '',
    ad_name: raw.adName ?? '',
    age: raw.age || 'Unknown',
    gender: raw.gender || 'unknown',
    objective: raw.objective ?? null,
    amount_spent: typed.amount_spent ?? null,
    impressions: typed.impressions ?? null,
    reach: num(raw.reach),
    link_clicks: typed.link_clicks ?? null,
    purchases: typed.purchases ?? null,
    purchase_value: typed.purchase_value ?? null,
    metrics,
  };
}

// The value of one metric on a stored row (typed column or JSONB).
export function storedValue(row, key) {
  return TYPED_KEYS.has(key) ? row[key] : row.metrics?.[key];
}

// Boost or Non-Boost for a MAIN campaign. With a Kata Kunci Boost Post (set
// per account in Meta Ads Automation) the keyword decides — the same rule
// the Internal Dashboard split uses (dailyTrackingSync.metaFunnelByMonth).
// Without one, the Report Generator's campaign-name rule
// (features/meta/metaReport.ts isBoostRow) is used, so an account that has
// no keyword yet still files somewhere sensible.
export function isBoostCampaign(campaignName, keyword) {
  const name = String(campaignName ?? '').toLowerCase();
  if (keyword) return name.includes(String(keyword).toLowerCase());
  return isBoostByName(name);
}

export function isBoostByName(campaignName) {
  const v = String(campaignName ?? '').toLowerCase();
  return v.includes('profile visit') || v.includes('instagram post') || /\bpv\b/.test(v) || /\bpost\b/.test(v);
}
