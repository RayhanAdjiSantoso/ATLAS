import { AppError } from '../utils/errors.js';
import * as repo from '../repositories/googleAdsDatasetsRepository.js';
import { contentHash } from './googleAdsAnalytics.js';

// Datasets beyond the five daily reports ('core', google_ads_daily). A
// fetcher declares the datasets it can send on GET /ingest/jobs?datasets=,
// the planner says which are due per job, and each arrives through
// POST /ingest/dataset { runId, dataset, rows }. Nothing here is specific
// to Ads Scripts: a Google Ads API fetcher sends the same shapes.
//
// daily     — rows of the run's date range; a successful dataset replaces
//             the range (rows it did not write are deleted), a failed one
//             leaves the older rows untouched.
// snapshot  — the account's configuration as it is now; never deleted by
//             a run (removed campaigns and ads keep their last state).

export const CORE = 'core';
export const DAILY_DATASETS = ['ads', 'conversions', 'competitive'];
export const SNAPSHOT_DATASETS = ['campaign_settings', 'conversion_actions', 'ad_assets'];
export const KNOWN_DATASETS = [CORE, ...DAILY_DATASETS, ...SNAPSHOT_DATASETS];
export const PLANNED_DATASETS = [CORE, ...DAILY_DATASETS];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COMPETITIVE_LEVELS = new Set(['campaign', 'ad_group', 'keyword']);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const text = (v) => (v == null ? '' : String(v).trim());
const textOrNull = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const boolOrNull = (v) => (v == null ? null : v === true || v === 'true' || v === 1);
const dateOrNull = (v) => {
  const s = text(v).slice(0, 10);
  return ISO_DATE.test(s) ? s : null;
};
const list = (v) => (Array.isArray(v) ? v : []);
const strings = (v) => list(v).map(text).filter(Boolean);

// 'customers/123/conversionActions/456' -> '456'; a bare id passes through.
export const idFrom = (v) => text(v).split('/').pop();

// ── daily ───────────────────────────────────────────────────────────
export function normalizeAdRow(raw) {
  if (!raw || !ISO_DATE.test(raw.date) || !text(raw.adGroupId) || !text(raw.adId)) return null;
  return {
    entry_date: raw.date,
    campaign_id: text(raw.campaignId),
    campaign_name: text(raw.campaignName),
    channel_type: text(raw.channelType),
    ad_group_id: text(raw.adGroupId),
    ad_group_name: text(raw.adGroupName),
    ad_id: text(raw.adId),
    ad_type: text(raw.adType),
    ad_status: text(raw.adStatus),
    cost: num(raw.cost),
    impressions: num(raw.impressions),
    clicks: num(raw.clicks),
    conversions: num(raw.conversions),
    conversions_value: num(raw.conversionsValue),
    all_conversions: num(raw.allConversions),
  };
}

export function normalizeConversionRow(raw) {
  const actionId = idFrom(raw?.conversionActionId ?? raw?.conversionAction);
  if (!raw || !ISO_DATE.test(raw.date) || !text(raw.campaignId) || !actionId) return null;
  return {
    entry_date: raw.date,
    campaign_id: text(raw.campaignId),
    campaign_name: text(raw.campaignName),
    conversion_action_id: actionId,
    conversion_action_name: text(raw.conversionActionName),
    conversion_category: text(raw.conversionCategory),
    conversions: num(raw.conversions),
    conversions_value: num(raw.conversionsValue),
    all_conversions: num(raw.allConversions),
    all_conversions_value: num(raw.allConversionsValue),
  };
}

const SHARE_INPUTS = {
  search_impression_share: 'searchImpressionShare',
  search_budget_lost_is: 'searchBudgetLostIs',
  search_rank_lost_is: 'searchRankLostIs',
  search_top_is: 'searchTopIs',
  search_abs_top_is: 'searchAbsTopIs',
  search_budget_lost_top_is: 'searchBudgetLostTopIs',
  search_rank_lost_top_is: 'searchRankLostTopIs',
  search_budget_lost_abs_top_is: 'searchBudgetLostAbsTopIs',
  search_rank_lost_abs_top_is: 'searchRankLostAbsTopIs',
};

// A share outside 0..1 is not a share: dropped to null rather than stored.
const share = (v) => {
  const n = numOrNull(v);
  return n == null || n < 0 || n > 1 ? null : n;
};

export function normalizeCompetitiveRow(raw) {
  if (!raw || !COMPETITIVE_LEVELS.has(raw.level)) return null;
  const granularity = raw.granularity === 'day' ? 'day' : raw.granularity === 'range' ? 'range' : null;
  if (!granularity) return null;
  const start = granularity === 'day' ? raw.date : raw.startDate;
  const end = granularity === 'day' ? raw.date : raw.endDate;
  if (!ISO_DATE.test(start ?? '') || !ISO_DATE.test(end ?? '') || start > end) return null;
  // Daily shares are kept for campaigns only; finer levels are range-only.
  if (granularity === 'day' && raw.level !== 'campaign') return null;
  const row = {
    level: raw.level,
    granularity,
    start_date: start,
    end_date: end,
    campaign_id: text(raw.campaignId),
    campaign_name: text(raw.campaignName),
    ad_group_id: text(raw.adGroupId),
    ad_group_name: text(raw.adGroupName),
    criterion_id: text(raw.criterionId),
    keyword: text(raw.keyword),
    match_type: text(raw.matchType),
    impressions: numOrNull(raw.impressions),
  };
  for (const [col, key] of Object.entries(SHARE_INPUTS)) row[col] = share(raw[key]);
  return row;
}

// ── snapshots ───────────────────────────────────────────────────────
export function normalizeCampaignSetting(raw) {
  if (!raw || !text(raw.campaignId)) return null;
  const row = {
    campaign_id: text(raw.campaignId),
    campaign_name: text(raw.campaignName),
    status: textOrNull(raw.status),
    channel_type: textOrNull(raw.channelType),
    channel_sub_type: textOrNull(raw.channelSubType),
    budget_id: textOrNull(raw.budgetId),
    budget_name: textOrNull(raw.budgetName),
    budget_amount: numOrNull(raw.budgetAmount),
    budget_shared: boolOrNull(raw.budgetShared),
    budget_delivery_method: textOrNull(raw.budgetDeliveryMethod),
    bidding_strategy_type: textOrNull(raw.biddingStrategyType),
    bidding_strategy_source: ['CAMPAIGN', 'PORTFOLIO'].includes(raw.biddingStrategySource) ? raw.biddingStrategySource : null,
    bidding_strategy_name: textOrNull(raw.biddingStrategyName),
    // 0 is never a real target: Google leaves an unused target unset, and a
    // fetcher that read "nothing" as 0 must not plant a fake target here.
    target_cpa: numOrNull(raw.targetCpa) || null,
    target_roas: numOrNull(raw.targetRoas) || null,
    target_impression_share: share(raw.targetImpressionShare) || null,
    target_impression_share_location: textOrNull(raw.targetImpressionShareLocation),
    target_is_cpc_ceiling: numOrNull(raw.targetIsCpcCeiling) || null,
    conversion_goals: Array.isArray(raw.conversionGoals)
      ? raw.conversionGoals.map((g) => ({ category: text(g?.category), origin: text(g?.origin), biddable: g?.biddable !== false })).filter((g) => g.category)
      : null,
    network_google_search: boolOrNull(raw.networkGoogleSearch),
    network_search_partners: boolOrNull(raw.networkSearchPartners),
    network_display: boolOrNull(raw.networkDisplay),
    locations_included: Array.isArray(raw.locationsIncluded) ? strings(raw.locationsIncluded).sort() : null,
    locations_excluded: Array.isArray(raw.locationsExcluded) ? strings(raw.locationsExcluded).sort() : null,
    positive_geo_target_type: textOrNull(raw.positiveGeoTargetType),
    negative_geo_target_type: textOrNull(raw.negativeGeoTargetType),
    start_date: dateOrNull(raw.startDate),
    // Google's "no end date" is 2037-12-30.
    end_date: dateOrNull(raw.endDate) && dateOrNull(raw.endDate) < '2037-01-01' ? dateOrNull(raw.endDate) : null,
    unavailable: strings(raw.unavailable).sort(),
  };
  row.settings_hash = contentHash(row);
  return row;
}

export function normalizeConversionAction(raw) {
  const id = idFrom(raw?.conversionActionId ?? raw?.id);
  if (!raw || !id) return null;
  const window = (v) => {
    const n = numOrNull(v);
    return n == null ? null : Math.round(n);
  };
  return {
    conversion_action_id: id,
    name: text(raw.name),
    category: textOrNull(raw.category),
    status: textOrNull(raw.status),
    type: textOrNull(raw.type),
    origin: textOrNull(raw.origin),
    primary_for_goal: boolOrNull(raw.primaryForGoal),
    include_in_conversions: boolOrNull(raw.includeInConversions),
    counting_type: textOrNull(raw.countingType),
    attribution_model: textOrNull(raw.attributionModel),
    click_through_window_days: window(raw.clickThroughWindowDays),
    view_through_window_days: window(raw.viewThroughWindowDays),
    unavailable: strings(raw.unavailable).sort(),
  };
}

const assetText = (a) => ({
  text: text(a?.text),
  pinned: textOrNull(a?.pinned),
  label: textOrNull(a?.label),
});

export function normalizeAdAsset(raw) {
  if (!raw || !text(raw.adGroupId) || !text(raw.adId)) return null;
  const row = {
    campaign_id: text(raw.campaignId),
    campaign_name: text(raw.campaignName),
    ad_group_id: text(raw.adGroupId),
    ad_group_name: text(raw.adGroupName),
    ad_id: text(raw.adId),
    ad_type: textOrNull(raw.adType),
    ad_status: textOrNull(raw.adStatus),
    ad_strength: textOrNull(raw.adStrength),
    final_urls: strings(raw.finalUrls),
    headlines: list(raw.headlines).map(assetText).filter((a) => a.text).slice(0, 15),
    descriptions: list(raw.descriptions).map(assetText).filter((a) => a.text).slice(0, 4),
    path1: textOrNull(raw.path1),
    path2: textOrNull(raw.path2),
    unavailable: strings(raw.unavailable).sort(),
  };
  // Performance labels move without the ad changing; they stay out of the
  // hash so content_changed_at marks real copy edits only.
  row.content_hash = contentHash({ ...row, headlines: row.headlines.map((h) => [h.text, h.pinned]), descriptions: row.descriptions.map((d) => [d.text, d.pinned]) }, ['campaign_name', 'ad_group_name', 'ad_status', 'ad_strength', 'unavailable']);
  return row;
}

// ── ingest ──────────────────────────────────────────────────────────
// Rows outside the run's range are dropped, not trusted (a stray date
// would land in a range whose stale-row cleanup this run never owns), and a
// key repeated in one chunk keeps its last copy (one INSERT ... ON CONFLICT
// cannot touch the same key twice).
function dedupe(rows, keyOf) {
  const byKey = new Map();
  for (const r of rows) byKey.set(keyOf(r), r);
  return [...byKey.values()];
}

const inRange = (run, d) => d >= run.start_date && d <= run.end_date;

const HANDLERS = {
  ads: (run, raws) => {
    const rows = dedupe(raws.map(normalizeAdRow).filter((r) => r && inRange(run, r.entry_date)),
      (r) => [r.entry_date, r.ad_group_id, r.ad_id].join('|'));
    return repo.upsertAds({ ...ctx(run), rows });
  },
  conversions: (run, raws) => {
    const rows = dedupe(raws.map(normalizeConversionRow).filter((r) => r && inRange(run, r.entry_date)),
      (r) => [r.entry_date, r.campaign_id, r.conversion_action_id].join('|'));
    return repo.upsertConversions({ ...ctx(run), rows });
  },
  competitive: (run, raws) => {
    const rows = dedupe(raws.map(normalizeCompetitiveRow).filter((r) => r && inRange(run, r.start_date) && inRange(run, r.end_date)),
      (r) => [r.level, r.granularity, r.start_date, r.end_date, r.campaign_id, r.ad_group_id, r.criterion_id].join('|'));
    return repo.upsertCompetitive({ ...ctx(run), rows });
  },
  campaign_settings: async (run, raws) => {
    const rows = dedupe(raws.map(normalizeCampaignSetting).filter(Boolean), (r) => r.campaign_id);
    const res = await repo.recordCampaignSettings({ ...ctx(run), rows });
    return res.inserted + res.unchanged;
  },
  conversion_actions: (run, raws) => {
    const rows = dedupe(raws.map(normalizeConversionAction).filter(Boolean), (r) => r.conversion_action_id);
    return repo.upsertConversionActions({ ...ctx(run), rows });
  },
  ad_assets: (run, raws) => {
    const rows = dedupe(raws.map(normalizeAdAsset).filter(Boolean), (r) => `${r.ad_group_id}|${r.ad_id}`);
    return repo.upsertAdAssets({ ...ctx(run), rows });
  },
};

const ctx = (run) => ({ brandId: run.brand_id, customerId: run.customer_id, runId: run.fetch_run_id, source: run.source });

export async function ingestDataset(run, dataset, rows) {
  const handler = HANDLERS[dataset];
  if (!handler) throw new AppError(`Dataset tidak dikenal: ${dataset}`, 400);
  if (!run.datasets?.includes(dataset)) throw new AppError(`Dataset ${dataset} tidak dideklarasikan saat start`, 409);
  const written = await handler(run, rows);
  return { dataset, received: rows.length, written };
}

// What a fetcher reports per dataset at finish, cleaned: unknown datasets
// and statuses are dropped so a malformed report cannot mark anything done.
const RESULT_STATUSES = new Set(['success', 'failed', 'skipped']);
export function normalizeDatasetResults(raw, declared) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, r] of Object.entries(raw)) {
    if (!declared.includes(name) || !r || !RESULT_STATUSES.has(r.status)) continue;
    out[name] = {
      status: r.status,
      rowCount: Math.max(0, Math.round(num(r.rowCount))),
      note: textOrNull(r.note)?.slice(0, 300) ?? null,
      ...(Array.isArray(r.levels) ? { levels: r.levels.filter((l) => COMPETITIVE_LEVELS.has(l)) } : {}),
    };
  }
  return out;
}

// Stale rows of each daily dataset that finished well. Zero rows on a
// "success" is read as "Google returned nothing", not as proof the range is
// empty — the same rule as the core rows.
export async function deleteStaleDatasets(run, results, db) {
  const removed = {};
  for (const dataset of DAILY_DATASETS) {
    const r = results[dataset];
    if (r?.status !== 'success' || !r.rowCount) continue;
    removed[dataset] = await repo.deleteStaleDataset({
      dataset, customerId: run.customer_id, startDate: run.start_date, endDate: run.end_date, runId: run.fetch_run_id,
      levels: dataset === 'competitive' ? (r.levels?.length ? r.levels : null) : null,
    }, db);
  }
  return removed;
}

// "ads 1.204 baris · competitive gagal: ..." for the run's note.
export function describeResults(results) {
  return Object.entries(results)
    .filter(([name]) => name !== CORE)
    .map(([name, r]) => (r.status === 'success'
      ? `${name} ${r.rowCount.toLocaleString('id-ID')} baris`
      : `${name} ${r.status === 'skipped' ? 'dilewati' : 'gagal'}${r.note ? `: ${r.note}` : ''}`))
    .join(' · ');
}
