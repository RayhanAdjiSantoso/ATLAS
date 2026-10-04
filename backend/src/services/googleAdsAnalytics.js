import crypto from 'crypto';

// Google Ads numbers the report, the exports and the AI Consultant all read.
// Pure functions over rows the repository returns — no database, no React —
// so every consumer computes a metric the same way and tests can pin it.
//
// Rules that hold everywhere below:
//   - a ratio over a period is total numerator / total denominator, never an
//     average of daily ratios;
//   - a missing value stays null (shown as N/A), it never becomes 0, and a
//     division by zero is null, never Infinity;
//   - cost is only ever added within one level (see google_ads_daily); the
//     other datasets explain the spend, they do not add to it.

export const safeDiv = (num, den) => {
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
};

const ADDITIVE = ['cost', 'impressions', 'clicks', 'conversions', 'conversions_value', 'all_conversions'];

// The ratios the report shows, from summed metrics. CTR/CVR stay fractions
// (0.05 = 5%); the UI formats them.
export function withRatios(row) {
  const r = { ...row };
  for (const k of ADDITIVE) r[k] = Number(r[k] ?? 0);
  r.ctr = safeDiv(r.clicks, r.impressions);
  r.avg_cpc = safeDiv(r.cost, r.clicks);
  const cpm = safeDiv(r.cost, r.impressions);
  r.avg_cpm = cpm == null ? null : cpm * 1000;
  r.cost_per_conv = safeDiv(r.cost, r.conversions);
  r.cvr = safeDiv(r.conversions, r.clicks);
  r.roas = safeDiv(r.conversions_value, r.cost);
  return r;
}

// (cur - prev) / prev. A previous value of 0 has no meaningful growth rate:
// null, with `fromZero` so the UI can say "baru" instead of "+∞%".
export function pctChange(prev, cur) {
  if (prev == null || cur == null) return { value: null, fromZero: false };
  if (Number(prev) === 0) return { value: null, fromZero: Number(cur) !== 0 };
  return { value: (Number(cur) - Number(prev)) / Math.abs(Number(prev)), fromZero: false };
}

// Shares (impression share, CTR) compare better in percentage points.
export const ppChange = (prev, cur) => (prev == null || cur == null ? null : (Number(cur) - Number(prev)) * 100);

// ── Business goals ──────────────────────────────────────────────────
export const GOALS = ['purchase', 'lead', 'micro', 'other', 'ignore'];

// Google's conversion_action.category → the goal it most likely serves.
// Only a default: the brand's own mapping (google_ads_conversion_goal_map)
// wins, and the report flags a default as needing verification.
const CATEGORY_GOAL = {
  PURCHASE: 'purchase', STORE_SALE: 'purchase',
  SUBMIT_LEAD_FORM: 'lead', CONTACT: 'lead', BOOK_APPOINTMENT: 'lead', REQUEST_QUOTE: 'lead', SIGNUP: 'lead',
  IMPORTED_LEAD: 'lead', QUALIFIED_LEAD: 'lead', CONVERTED_LEAD: 'lead', PHONE_CALL_LEAD: 'lead', LEAD: 'lead',
  ADD_TO_CART: 'micro', BEGIN_CHECKOUT: 'micro', PAGE_VIEW: 'micro', ENGAGEMENT: 'micro', GET_DIRECTIONS: 'micro',
  OUTBOUND_CLICK: 'micro', STORE_VISIT: 'micro', SUBSCRIBE_PAID: 'purchase',
};

// Google reports some built-in actions without a usable category — message
// leads ("Conversation started") arrive as UNKNOWN. For those only, the name
// decides; it is still a default the brand is asked to verify.
const UNCATEGORISED = new Set(['', 'UNKNOWN', 'UNSPECIFIED', 'DEFAULT']);
const MESSAGE_LEAD = /conversation|message|messaging|chat|whatsapp|pesan|percakapan/i;

export function defaultGoal(category, name = '') {
  const c = String(category ?? '').toUpperCase();
  if (CATEGORY_GOAL[c]) return CATEGORY_GOAL[c];
  if (UNCATEGORISED.has(c) && MESSAGE_LEAD.test(String(name ?? ''))) return 'lead';
  return 'other';
}

// Whether an action counted in the Conversions column, read from the numbers
// rather than the account setting: an action primary for the account still
// counts 0 in a campaign whose goals leave it out. Only without any numbers
// does the account setting answer.
export function countedAsPrimary(conversions, allConversions, accountPrimary = null) {
  if (Number(conversions) > 0) return true;
  if (Number(allConversions) > 0) return false;
  return accountPrimary ?? null;
}

const actionKey = (customerId, actionId) => `${customerId}|${actionId}`;

// Per conversion action over a period, with its goal and whether that goal
// is the brand's own (manual) or derived from Google's category (default).
// `primary` = counted in Conversions in this period (countedAsPrimary);
// `account_primary` is the account-level setting, null when Google did not
// list the action's metadata (some built-in actions are not listed).
export function classifyActions(actionRows, metaRows = [], mapRows = []) {
  const meta = new Map(metaRows.map((m) => [actionKey(m.customer_id, m.conversion_action_id), m]));
  const map = new Map(mapRows.map((m) => [actionKey(m.customer_id, m.conversion_action_id), m.goal]));
  return actionRows.map((r) => {
    const key = actionKey(r.customer_id, r.conversion_action_id);
    const m = meta.get(key);
    const category = m?.category ?? r.conversion_category ?? null;
    const name = m?.name || r.conversion_action_name;
    const manual = map.get(key);
    return {
      ...r,
      name,
      category,
      status: m?.status ?? null,
      account_primary: m?.include_in_conversions ?? null,
      primary: countedAsPrimary(r.conversions, r.all_conversions, m?.include_in_conversions),
      goal: manual ?? defaultGoal(category, name),
      goal_source: manual ? 'manual' : 'default',
    };
  });
}

// Goal totals. `conversions` is what the Conversions column counts (primary
// actions); `all_conversions` adds the secondary ones. A goal whose actions
// are all secondary has conversions 0 but all_conversions > 0 — the UI says
// so instead of showing a zero as the result.
export function goalTotals(classified) {
  const out = Object.fromEntries(GOALS.map((g) => [g, {
    goal: g, conversions: 0, conversions_value: 0, all_conversions: 0, all_conversions_value: 0, actions: 0, unverified: 0,
  }]));
  for (const r of classified) {
    const t = out[r.goal] ?? out.other;
    t.conversions += Number(r.conversions) || 0;
    t.conversions_value += Number(r.conversions_value) || 0;
    t.all_conversions += Number(r.all_conversions) || 0;
    t.all_conversions_value += Number(r.all_conversions_value) || 0;
    t.actions += 1;
    if (r.goal_source !== 'manual') t.unverified += 1;
  }
  return out;
}

// Which goal each campaign works for. First what the campaign bids toward
// (its biddable conversion goals in the settings snapshot), else the goal
// with most primary conversions in the period, else unknown. Ties and
// campaigns bidding toward both purchase and lead are 'mixed'.
export function campaignGoals(classified, settingsRows = []) {
  const out = new Map();
  for (const s of settingsRows) {
    const biddable = (s.conversion_goals ?? []).filter((g) => g.biddable !== false).map((g) => defaultGoal(g.category));
    const set = new Set(biddable.filter((g) => g === 'purchase' || g === 'lead'));
    if (set.size) out.set(`${s.customer_id}|${s.campaign_id}`, { goal: set.size > 1 ? 'mixed' : [...set][0], source: 'bidding' });
  }
  const tally = new Map();
  for (const r of classified) {
    if (r.goal !== 'purchase' && r.goal !== 'lead') continue;
    const key = `${r.customer_id}|${r.campaign_id}`;
    if (out.has(key)) continue;
    const t = tally.get(key) ?? { purchase: 0, lead: 0 };
    t[r.goal] += Number(r.conversions) || 0;
    tally.set(key, t);
  }
  for (const [key, t] of tally) {
    if (!t.purchase && !t.lead) continue;
    out.set(key, { goal: t.purchase === t.lead ? 'mixed' : t.purchase > t.lead ? 'purchase' : 'lead', source: 'conversions' });
  }
  return out;
}

// Cost per result for one goal, two ways, both labelled:
//   blended  — all cost / the goal's conversions (what the account paid per result overall)
//   focused  — cost of campaigns working for that goal / their conversions of it
export function costPerGoal(goal, campaigns, classified, goalsByCampaign) {
  const focusKeys = new Set([...goalsByCampaign].filter(([, v]) => v.goal === goal).map(([k]) => k));
  let totalCost = 0;
  let focusCost = 0;
  for (const c of campaigns) {
    totalCost += Number(c.cost) || 0;
    if (focusKeys.has(`${c.customer_id}|${c.campaign_id}`)) focusCost += Number(c.cost) || 0;
  }
  let results = 0;
  let focusResults = 0;
  let value = 0;
  let focusValue = 0;
  for (const r of classified) {
    if (r.goal !== goal) continue;
    results += Number(r.conversions) || 0;
    value += Number(r.conversions_value) || 0;
    if (focusKeys.has(`${r.customer_id}|${r.campaign_id}`)) {
      focusResults += Number(r.conversions) || 0;
      focusValue += Number(r.conversions_value) || 0;
    }
  }
  return {
    goal,
    results,
    value,
    blended_cost_per_result: safeDiv(totalCost, results),
    blended_roas: goal === 'purchase' ? safeDiv(value, totalCost) : null,
    focus_campaigns: focusKeys.size,
    focus_cost: focusCost,
    focus_results: focusResults,
    focus_cost_per_result: safeDiv(focusCost, focusResults),
    focus_roas: goal === 'purchase' ? safeDiv(focusValue, focusCost) : null,
  };
}

// ── Impression share ────────────────────────────────────────────────
export const SHARE_FIELDS = [
  'search_impression_share', 'search_budget_lost_is', 'search_rank_lost_is', 'search_top_is', 'search_abs_top_is',
  'search_budget_lost_top_is', 'search_rank_lost_top_is', 'search_budget_lost_abs_top_is', 'search_rank_lost_abs_top_is',
];

// One campaign's shares for a period. Google's own value for exactly that
// range wins ('range'). Otherwise daily values are combined over the
// eligible impressions each day implies (impressions / impression share) —
// the right weight for shares of eligible traffic — and labelled
// 'daily_estimate': Google rounds the ends ("< 10%" arrives as 0.0999), so
// the result is close to, not equal to, what Google shows for the range.
export function periodShares({ rangeRow, dayRows = [] }) {
  if (rangeRow) {
    return { granularity: 'range', days: null, ...Object.fromEntries(SHARE_FIELDS.map((f) => [f, numOrNull(rangeRow[f])])) };
  }
  const usable = dayRows
    .map((d) => ({ d, eligible: safeDiv(d.impressions, d.search_impression_share) }))
    .filter((x) => x.eligible != null && x.eligible > 0);
  if (!usable.length) return { granularity: 'unavailable', days: 0, ...Object.fromEntries(SHARE_FIELDS.map((f) => [f, null])) };
  const out = { granularity: 'daily_estimate', days: usable.length };
  for (const f of SHARE_FIELDS) {
    let num = 0;
    let den = 0;
    for (const { d, eligible } of usable) {
      const v = numOrNull(d[f]);
      if (v == null) continue;
      num += v * eligible;
      den += eligible;
    }
    out[f] = den ? num / den : null;
  }
  return out;
}

const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── Snapshots ───────────────────────────────────────────────────────
// Stable hash of a snapshot's content: key order does not matter, the
// listed volatile fields (timestamps, run ids) are left out.
export function contentHash(obj, omit = []) {
  const skip = new Set(omit);
  const canon = (v) => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).filter((k) => !skip.has(k)).sort().map((k) => [k, canon(v[k])]));
    }
    return v === undefined ? null : v;
  };
  return crypto.createHash('sha256').update(JSON.stringify(canon(obj))).digest('hex').slice(0, 32);
}
