import pool from '../config/db.js';

// Tables of migration 040 — the datasets the Google Ads Script sends beside
// the five daily reports of google_ads_daily (googleAdsRepository.js).
// Bulk writes go through jsonb_to_recordset: one bound parameter however
// many rows, so a 500-row chunk never hits the driver's parameter cap.

// ---------------------------------------------------------------------
// daily datasets
// ---------------------------------------------------------------------
export async function upsertAds({ brandId, customerId, runId, source, runStartedAt, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_ads_daily
       (brand_id, customer_id, entry_date, campaign_id, campaign_name, channel_type, ad_group_id, ad_group_name,
        ad_id, ad_type, ad_status, cost, impressions, clicks, conversions, conversions_value, all_conversions, source, fetch_run_id, fetched_at)
     SELECT $1, $2, r.entry_date, r.campaign_id, r.campaign_name, r.channel_type, r.ad_group_id, r.ad_group_name,
            r.ad_id, r.ad_type, r.ad_status, r.cost, r.impressions, r.clicks, r.conversions, r.conversions_value, r.all_conversions, $5, $4, $6
     FROM jsonb_to_recordset($3::jsonb) AS r(
       entry_date date, campaign_id text, campaign_name text, channel_type text, ad_group_id text, ad_group_name text,
       ad_id text, ad_type text, ad_status text, cost numeric, impressions numeric, clicks numeric,
       conversions numeric, conversions_value numeric, all_conversions numeric)
     ON CONFLICT (customer_id, entry_date, ad_group_id, ad_id) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
       channel_type = EXCLUDED.channel_type, ad_group_name = EXCLUDED.ad_group_name, ad_type = EXCLUDED.ad_type,
       ad_status = EXCLUDED.ad_status, cost = EXCLUDED.cost, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
       conversions = EXCLUDED.conversions, conversions_value = EXCLUDED.conversions_value,
       all_conversions = EXCLUDED.all_conversions, source = EXCLUDED.source,
       fetch_run_id = EXCLUDED.fetch_run_id, fetched_at = EXCLUDED.fetched_at
     WHERE google_ads_ads_daily.fetched_at <= EXCLUDED.fetched_at`,
    [brandId, customerId, JSON.stringify(rows), runId, source, runStartedAt ?? new Date()],
  );
  return rowCount;
}

export async function upsertConversions({ brandId, customerId, runId, source, runStartedAt, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_conversion_daily
       (brand_id, customer_id, entry_date, campaign_id, campaign_name, conversion_action_id, conversion_action_name,
        conversion_category, conversions, conversions_value, all_conversions, all_conversions_value, source, fetch_run_id, fetched_at)
     SELECT $1, $2, r.entry_date, r.campaign_id, r.campaign_name, r.conversion_action_id, r.conversion_action_name,
            r.conversion_category, r.conversions, r.conversions_value, r.all_conversions, r.all_conversions_value, $5, $4, $6
     FROM jsonb_to_recordset($3::jsonb) AS r(
       entry_date date, campaign_id text, campaign_name text, conversion_action_id text, conversion_action_name text,
       conversion_category text, conversions numeric, conversions_value numeric, all_conversions numeric, all_conversions_value numeric)
     ON CONFLICT (customer_id, entry_date, campaign_id, conversion_action_id) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, campaign_name = EXCLUDED.campaign_name,
       conversion_action_name = EXCLUDED.conversion_action_name, conversion_category = EXCLUDED.conversion_category,
       conversions = EXCLUDED.conversions, conversions_value = EXCLUDED.conversions_value,
       all_conversions = EXCLUDED.all_conversions, all_conversions_value = EXCLUDED.all_conversions_value,
       source = EXCLUDED.source, fetch_run_id = EXCLUDED.fetch_run_id, fetched_at = EXCLUDED.fetched_at
     WHERE google_ads_conversion_daily.fetched_at <= EXCLUDED.fetched_at`,
    [brandId, customerId, JSON.stringify(rows), runId, source, runStartedAt ?? new Date()],
  );
  return rowCount;
}

const SHARE_COLUMNS = [
  'search_impression_share', 'search_budget_lost_is', 'search_rank_lost_is', 'search_top_is', 'search_abs_top_is',
  'search_budget_lost_top_is', 'search_rank_lost_top_is', 'search_budget_lost_abs_top_is', 'search_rank_lost_abs_top_is',
];

export async function upsertCompetitive({ brandId, customerId, runId, source, runStartedAt, rows }, db = pool) {
  if (!rows.length) return 0;
  const cols = SHARE_COLUMNS.join(', ');
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_competitive_metrics
       (brand_id, customer_id, level, granularity, start_date, end_date, campaign_id, campaign_name, ad_group_id,
        ad_group_name, criterion_id, keyword, match_type, impressions, ${cols}, source, fetch_run_id, fetched_at)
     SELECT $1, $2, r.level, r.granularity, r.start_date, r.end_date, r.campaign_id, r.campaign_name, r.ad_group_id,
            r.ad_group_name, r.criterion_id, r.keyword, r.match_type, r.impressions,
            ${SHARE_COLUMNS.map((c) => `r.${c}`).join(', ')}, $5, $4, $6
     FROM jsonb_to_recordset($3::jsonb) AS r(
       level text, granularity text, start_date date, end_date date, campaign_id text, campaign_name text,
       ad_group_id text, ad_group_name text, criterion_id text, keyword text, match_type text, impressions numeric,
       ${SHARE_COLUMNS.map((c) => `${c} numeric`).join(', ')})
     ON CONFLICT (customer_id, level, granularity, start_date, end_date, campaign_id, ad_group_id, criterion_id) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, campaign_name = EXCLUDED.campaign_name, ad_group_name = EXCLUDED.ad_group_name,
       keyword = EXCLUDED.keyword, match_type = EXCLUDED.match_type, impressions = EXCLUDED.impressions,
       ${SHARE_COLUMNS.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
       source = EXCLUDED.source, fetch_run_id = EXCLUDED.fetch_run_id, fetched_at = EXCLUDED.fetched_at
     WHERE google_ads_competitive_metrics.fetched_at <= EXCLUDED.fetched_at`,
    [brandId, customerId, JSON.stringify(rows), runId, source, runStartedAt ?? new Date()],
  );
  return rowCount;
}

const METRIC_COLS = 'cost numeric, impressions numeric, clicks numeric, conversions numeric, conversions_value numeric';

export async function upsertDevices({ brandId, customerId, runId, source, runStartedAt, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_device_daily
       (brand_id, customer_id, entry_date, campaign_id, campaign_name, channel_type, device, cost, impressions, clicks,
        conversions, conversions_value, all_conversions, source, fetch_run_id, fetched_at)
     SELECT $1, $2, r.entry_date, r.campaign_id, r.campaign_name, r.channel_type, r.device, r.cost, r.impressions, r.clicks,
            r.conversions, r.conversions_value, r.all_conversions, $5, $4, $6
     FROM jsonb_to_recordset($3::jsonb) AS r(
       entry_date date, campaign_id text, campaign_name text, channel_type text, device text, ${METRIC_COLS}, all_conversions numeric)
     ON CONFLICT (customer_id, entry_date, campaign_id, device) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, campaign_name = EXCLUDED.campaign_name, channel_type = EXCLUDED.channel_type,
       cost = EXCLUDED.cost, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, conversions = EXCLUDED.conversions,
       conversions_value = EXCLUDED.conversions_value, all_conversions = EXCLUDED.all_conversions,
       source = EXCLUDED.source, fetch_run_id = EXCLUDED.fetch_run_id, fetched_at = EXCLUDED.fetched_at
     WHERE google_ads_device_daily.fetched_at <= EXCLUDED.fetched_at`,
    [brandId, customerId, JSON.stringify(rows), runId, source, runStartedAt ?? new Date()],
  );
  return rowCount;
}

export async function upsertHourly({ brandId, customerId, runId, source, runStartedAt, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_hourly
       (brand_id, customer_id, entry_date, hour, campaign_id, campaign_name, cost, impressions, clicks, conversions,
        conversions_value, source, fetch_run_id, fetched_at)
     SELECT $1, $2, r.entry_date, r.hour, r.campaign_id, r.campaign_name, r.cost, r.impressions, r.clicks, r.conversions,
            r.conversions_value, $5, $4, $6
     FROM jsonb_to_recordset($3::jsonb) AS r(entry_date date, hour smallint, campaign_id text, campaign_name text, ${METRIC_COLS})
     ON CONFLICT (customer_id, entry_date, campaign_id, hour) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, campaign_name = EXCLUDED.campaign_name, cost = EXCLUDED.cost,
       impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, conversions = EXCLUDED.conversions,
       conversions_value = EXCLUDED.conversions_value, source = EXCLUDED.source,
       fetch_run_id = EXCLUDED.fetch_run_id, fetched_at = EXCLUDED.fetched_at
     WHERE google_ads_hourly.fetched_at <= EXCLUDED.fetched_at`,
    [brandId, customerId, JSON.stringify(rows), runId, source, runStartedAt ?? new Date()],
  );
  return rowCount;
}

export async function upsertLandingPages({ brandId, customerId, runId, source, runStartedAt, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_landing_pages_daily
       (brand_id, customer_id, entry_date, campaign_id, campaign_name, url, clicks, impressions, cost, conversions,
        conversions_value, speed_score, mobile_friendly_clicks_pct, unavailable, source, fetch_run_id, fetched_at)
     SELECT $1, $2, r.entry_date, r.campaign_id, r.campaign_name, r.url, r.clicks, r.impressions, r.cost, r.conversions,
            r.conversions_value, r.speed_score, r.mobile_friendly_clicks_pct, r.unavailable, $5, $4, $6
     FROM jsonb_to_recordset($3::jsonb) AS r(
       entry_date date, campaign_id text, campaign_name text, url text, clicks numeric, impressions numeric, cost numeric,
       conversions numeric, conversions_value numeric, speed_score numeric, mobile_friendly_clicks_pct numeric, unavailable jsonb)
     ON CONFLICT (customer_id, entry_date, campaign_id, url) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, campaign_name = EXCLUDED.campaign_name, clicks = EXCLUDED.clicks,
       impressions = EXCLUDED.impressions, cost = EXCLUDED.cost, conversions = EXCLUDED.conversions,
       conversions_value = EXCLUDED.conversions_value, speed_score = EXCLUDED.speed_score,
       mobile_friendly_clicks_pct = EXCLUDED.mobile_friendly_clicks_pct, unavailable = EXCLUDED.unavailable,
       source = EXCLUDED.source, fetch_run_id = EXCLUDED.fetch_run_id, fetched_at = EXCLUDED.fetched_at
     WHERE google_ads_landing_pages_daily.fetched_at <= EXCLUDED.fetched_at`,
    [brandId, customerId, JSON.stringify(rows), runId, source, runStartedAt ?? new Date()],
  );
  return rowCount;
}

export async function upsertKeywordQuality({ brandId, customerId, runId, source, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_keyword_quality
       (brand_id, customer_id, snapshot_date, campaign_id, campaign_name, ad_group_id, ad_group_name, criterion_id, keyword,
        match_type, status, quality_score, expected_ctr, ad_relevance, landing_page_experience, source, fetch_run_id)
     SELECT $1, $2, r.snapshot_date, r.campaign_id, r.campaign_name, r.ad_group_id, r.ad_group_name, r.criterion_id, r.keyword,
            r.match_type, r.status, r.quality_score, r.expected_ctr, r.ad_relevance, r.landing_page_experience, $5, $4
     FROM jsonb_to_recordset($3::jsonb) AS r(
       snapshot_date date, campaign_id text, campaign_name text, ad_group_id text, ad_group_name text, criterion_id text,
       keyword text, match_type text, status text, quality_score smallint, expected_ctr text, ad_relevance text,
       landing_page_experience text)
     ON CONFLICT (customer_id, snapshot_date, ad_group_id, criterion_id) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
       ad_group_name = EXCLUDED.ad_group_name, keyword = EXCLUDED.keyword, match_type = EXCLUDED.match_type,
       status = EXCLUDED.status, quality_score = EXCLUDED.quality_score, expected_ctr = EXCLUDED.expected_ctr,
       ad_relevance = EXCLUDED.ad_relevance, landing_page_experience = EXCLUDED.landing_page_experience,
       source = EXCLUDED.source, fetch_run_id = EXCLUDED.fetch_run_id, fetched_at = now()`,
    [brandId, customerId, JSON.stringify(rows), runId, source],
  );
  return rowCount;
}

// End of a successful dataset: rows of the run's range it did not write are
// gone from Google. Competitive rows are scoped to the levels that dataset
// actually fetched, so a level Google refused keeps its older rows.
const DAILY_TABLES = {
  ads: { table: 'google_ads_ads_daily', range: 'entry_date BETWEEN $2 AND $3' },
  conversions: { table: 'google_ads_conversion_daily', range: 'entry_date BETWEEN $2 AND $3' },
  competitive: { table: 'google_ads_competitive_metrics', range: 'start_date >= $2 AND end_date <= $3' },
  devices: { table: 'google_ads_device_daily', range: 'entry_date BETWEEN $2 AND $3' },
  hourly: { table: 'google_ads_hourly', range: 'entry_date BETWEEN $2 AND $3' },
  landing_pages: { table: 'google_ads_landing_pages_daily', range: 'entry_date BETWEEN $2 AND $3' },
};

// Only rows older than this run go: a run that started later and already
// wrote its rows keeps them (see googleAdsRepository.upsertRows).
export async function deleteStaleDataset({ dataset, customerId, startDate, endDate, runId, runStartedAt, levels = null }, db = pool) {
  const spec = DAILY_TABLES[dataset];
  if (!spec) return 0;
  const params = [customerId, startDate, endDate, runId, runStartedAt ?? new Date()];
  let extra = '';
  if (dataset === 'competitive' && levels) {
    params.push(levels);
    extra = ' AND level = ANY($6)';
  }
  const { rowCount } = await db.query(
    `DELETE FROM ${spec.table} WHERE customer_id = $1 AND ${spec.range} AND fetch_run_id <> $4 AND fetched_at < $5${extra}`,
    params,
  );
  return rowCount;
}

// ---------------------------------------------------------------------
// snapshots
// ---------------------------------------------------------------------
const SETTING_FIELDS = [
  ['campaign_name', 'text'], ['status', 'text'], ['channel_type', 'text'], ['channel_sub_type', 'text'],
  ['budget_id', 'text'], ['budget_name', 'text'], ['budget_amount', 'numeric'], ['budget_shared', 'boolean'],
  ['budget_delivery_method', 'text'], ['bidding_strategy_type', 'text'], ['bidding_strategy_source', 'text'],
  ['bidding_strategy_name', 'text'], ['target_cpa', 'numeric'], ['target_roas', 'numeric'],
  ['target_impression_share', 'numeric'], ['target_impression_share_location', 'text'], ['target_is_cpc_ceiling', 'numeric'],
  ['conversion_goals', 'jsonb'], ['network_google_search', 'boolean'], ['network_search_partners', 'boolean'],
  ['network_display', 'boolean'], ['locations_included', 'jsonb'], ['locations_excluded', 'jsonb'],
  ['positive_geo_target_type', 'text'], ['negative_geo_target_type', 'text'], ['start_date', 'date'], ['end_date', 'date'],
  ['unavailable', 'jsonb'], ['settings_hash', 'text'],
];

// History, not overwrite: a campaign whose settings hash matches its latest
// row only refreshes last_seen_at; anything else (first sight, or a change —
// including a change back to an older value) gets a new row.
export async function recordCampaignSettings({ brandId, customerId, runId, source, rows }, db = pool) {
  if (!rows.length) return { inserted: 0, unchanged: 0 };
  const names = SETTING_FIELDS.map(([n]) => n);
  const { rows: out } = await db.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($3::jsonb) AS r(campaign_id text, ${SETTING_FIELDS.map(([n, t]) => `${n} ${t}`).join(', ')})
     ),
     latest AS (
       SELECT DISTINCT ON (s.campaign_id) s.google_ads_campaign_setting_id AS id, s.campaign_id, s.settings_hash
       FROM google_ads_campaign_settings s
       WHERE s.customer_id = $2 AND s.campaign_id IN (SELECT campaign_id FROM incoming)
       ORDER BY s.campaign_id, s.valid_from DESC, s.google_ads_campaign_setting_id DESC
     ),
     touched AS (
       UPDATE google_ads_campaign_settings g SET last_seen_at = now(), brand_id = $1
       FROM latest l JOIN incoming i ON i.campaign_id = l.campaign_id AND i.settings_hash = l.settings_hash
       WHERE g.google_ads_campaign_setting_id = l.id
       RETURNING 1
     ),
     inserted AS (
       INSERT INTO google_ads_campaign_settings (brand_id, customer_id, campaign_id, ${names.join(', ')}, source, fetch_run_id)
       SELECT $1, $2, i.campaign_id, ${names.map((n) => `i.${n}`).join(', ')}, $5, $4
       FROM incoming i LEFT JOIN latest l ON l.campaign_id = i.campaign_id
       WHERE l.id IS NULL OR l.settings_hash <> i.settings_hash
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM inserted)::int AS inserted, (SELECT count(*) FROM touched)::int AS unchanged`,
    [brandId, customerId, JSON.stringify(rows), runId, source],
  );
  return out[0];
}

export async function upsertConversionActions({ brandId, customerId, source, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_conversion_actions
       (brand_id, customer_id, conversion_action_id, name, category, status, type, origin, primary_for_goal,
        include_in_conversions, counting_type, attribution_model, click_through_window_days, view_through_window_days,
        unavailable, source)
     SELECT $1, $2, r.conversion_action_id, r.name, r.category, r.status, r.type, r.origin, r.primary_for_goal,
            r.include_in_conversions, r.counting_type, r.attribution_model, r.click_through_window_days,
            r.view_through_window_days, r.unavailable, $4
     FROM jsonb_to_recordset($3::jsonb) AS r(
       conversion_action_id text, name text, category text, status text, type text, origin text, primary_for_goal boolean,
       include_in_conversions boolean, counting_type text, attribution_model text, click_through_window_days integer,
       view_through_window_days integer, unavailable jsonb)
     ON CONFLICT (customer_id, conversion_action_id) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, name = EXCLUDED.name, category = EXCLUDED.category, status = EXCLUDED.status,
       type = EXCLUDED.type, origin = EXCLUDED.origin, primary_for_goal = EXCLUDED.primary_for_goal,
       include_in_conversions = EXCLUDED.include_in_conversions, counting_type = EXCLUDED.counting_type,
       attribution_model = EXCLUDED.attribution_model, click_through_window_days = EXCLUDED.click_through_window_days,
       view_through_window_days = EXCLUDED.view_through_window_days, unavailable = EXCLUDED.unavailable,
       source = EXCLUDED.source, last_seen_at = now()`,
    [brandId, customerId, JSON.stringify(rows), source],
  );
  return rowCount;
}

export async function upsertAdAssets({ brandId, customerId, source, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_ad_assets
       (brand_id, customer_id, campaign_id, campaign_name, ad_group_id, ad_group_name, ad_id, ad_type, ad_status,
        ad_strength, final_urls, headlines, descriptions, path1, path2, unavailable, content_hash, source)
     SELECT $1, $2, r.campaign_id, r.campaign_name, r.ad_group_id, r.ad_group_name, r.ad_id, r.ad_type, r.ad_status,
            r.ad_strength, r.final_urls, r.headlines, r.descriptions, r.path1, r.path2, r.unavailable, r.content_hash, $4
     FROM jsonb_to_recordset($3::jsonb) AS r(
       campaign_id text, campaign_name text, ad_group_id text, ad_group_name text, ad_id text, ad_type text,
       ad_status text, ad_strength text, final_urls jsonb, headlines jsonb, descriptions jsonb, path1 text, path2 text,
       unavailable jsonb, content_hash text)
     ON CONFLICT (customer_id, ad_group_id, ad_id) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, campaign_id = EXCLUDED.campaign_id, campaign_name = EXCLUDED.campaign_name,
       ad_group_name = EXCLUDED.ad_group_name, ad_type = EXCLUDED.ad_type, ad_status = EXCLUDED.ad_status,
       ad_strength = EXCLUDED.ad_strength, final_urls = EXCLUDED.final_urls, headlines = EXCLUDED.headlines,
       descriptions = EXCLUDED.descriptions, path1 = EXCLUDED.path1, path2 = EXCLUDED.path2,
       unavailable = EXCLUDED.unavailable,
       content_changed_at = CASE WHEN google_ads_ad_assets.content_hash <> EXCLUDED.content_hash
                                 THEN now() ELSE google_ads_ad_assets.content_changed_at END,
       content_hash = EXCLUDED.content_hash, source = EXCLUDED.source, last_seen_at = now()`,
    [brandId, customerId, JSON.stringify(rows), source],
  );
  return rowCount;
}

// Removing an account removes everything fetched for it (same rule as
// google_ads_daily). The brand's goal mapping goes too: it names actions
// of an account that no longer feeds the brand.
export async function deleteCustomerDatasets(customerId, db = pool) {
  for (const table of [
    'google_ads_ads_daily', 'google_ads_conversion_daily', 'google_ads_competitive_metrics', 'google_ads_campaign_settings',
    'google_ads_conversion_actions', 'google_ads_ad_assets', 'google_ads_conversion_goal_map',
    'google_ads_device_daily', 'google_ads_hourly', 'google_ads_landing_pages_daily', 'google_ads_keyword_quality',
  ]) {
    await db.query(`DELETE FROM ${table} WHERE customer_id = $1`, [customerId]);
  }
}

// ---------------------------------------------------------------------
// conversion goal mapping (Pengaturan Brand)
// ---------------------------------------------------------------------
export async function listGoalMap(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id, conversion_action_id, goal, updated_by, updated_at
     FROM google_ads_conversion_goal_map WHERE brand_id = $1`,
    [brandId],
  );
  return rows;
}

export async function setGoal({ brandId, customerId, conversionActionId, goal, userId }, db = pool) {
  await db.query(
    `INSERT INTO google_ads_conversion_goal_map (brand_id, customer_id, conversion_action_id, goal, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (customer_id, conversion_action_id) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, goal = EXCLUDED.goal, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [brandId, customerId, conversionActionId, goal, userId],
  );
}

export async function clearGoal({ customerId, conversionActionId }, db = pool) {
  await db.query(
    'DELETE FROM google_ads_conversion_goal_map WHERE customer_id = $1 AND conversion_action_id = $2',
    [customerId, conversionActionId],
  );
}

// ---------------------------------------------------------------------
// report reads
// ---------------------------------------------------------------------
const SCOPE = 'brand_id = $1 AND entry_date BETWEEN $2 AND $3';

export async function listConversionActions(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id, conversion_action_id, name, category, status, type, origin, primary_for_goal,
            include_in_conversions, counting_type, attribution_model, click_through_window_days,
            view_through_window_days, unavailable, source, last_seen_at
     FROM google_ads_conversion_actions WHERE brand_id = $1 ORDER BY name`,
    [brandId],
  );
  return rows;
}

// Every action that has conversion rows, listed in Google's metadata or not.
export async function listSeenConversionActions(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id, conversion_action_id, max(conversion_action_name) AS name, max(conversion_category) AS category
     FROM google_ads_conversion_daily WHERE brand_id = $1
     GROUP BY customer_id, conversion_action_id`,
    [brandId],
  );
  return rows;
}

// Campaign × action: the grain campaignGoals and costPerGoal need.
export async function conversionsByCampaignAction(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id, campaign_id, max(campaign_name) AS campaign_name, conversion_action_id,
            max(conversion_action_name) AS conversion_action_name, max(conversion_category) AS conversion_category,
            sum(conversions)::float AS conversions, sum(conversions_value)::float AS conversions_value,
            sum(all_conversions)::float AS all_conversions, sum(all_conversions_value)::float AS all_conversions_value
     FROM google_ads_conversion_daily WHERE ${SCOPE}
     GROUP BY customer_id, campaign_id, conversion_action_id`,
    [brandId, start, end],
  );
  return rows;
}

export async function adsReport(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT d.customer_id, d.campaign_id, max(d.campaign_name) AS campaign_name, d.ad_group_id,
            max(d.ad_group_name) AS ad_group_name, d.ad_id, max(d.ad_type) AS ad_type,
            (array_agg(d.ad_status ORDER BY d.entry_date DESC))[1] AS ad_status,
            sum(d.cost)::float AS cost, sum(d.impressions)::float AS impressions, sum(d.clicks)::float AS clicks,
            sum(d.conversions)::float AS conversions, sum(d.conversions_value)::float AS conversions_value,
            sum(d.all_conversions)::float AS all_conversions,
            max(a.ad_strength) AS ad_strength, max(a.final_urls::text)::jsonb AS final_urls,
            max(a.headlines::text)::jsonb AS headlines, max(a.descriptions::text)::jsonb AS descriptions,
            max(a.path1) AS path1, max(a.path2) AS path2, max(a.unavailable::text)::jsonb AS asset_unavailable
     FROM google_ads_ads_daily d
     LEFT JOIN google_ads_ad_assets a ON a.customer_id = d.customer_id AND a.ad_group_id = d.ad_group_id AND a.ad_id = d.ad_id
     WHERE d.brand_id = $1 AND d.entry_date BETWEEN $2 AND $3
     GROUP BY d.customer_id, d.campaign_id, d.ad_group_id, d.ad_id`,
    [brandId, start, end],
  );
  return rows;
}

const SHARES_SELECT = SHARE_COLUMNS.map((c) => `${c}::float AS ${c}`).join(', ');

// Range rows whose range is exactly the period: Google's own figure.
export async function competitiveRange(brandId, level, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id, campaign_id, campaign_name, ad_group_id, ad_group_name, criterion_id, keyword, match_type,
            impressions::float AS impressions, ${SHARES_SELECT}
     FROM google_ads_competitive_metrics
     WHERE brand_id = $1 AND level = $2 AND granularity = 'range' AND start_date = $3 AND end_date = $4`,
    [brandId, level, start, end],
  );
  return rows;
}

export async function competitiveDays(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id, campaign_id, campaign_name, to_char(start_date, 'YYYY-MM-DD') AS date,
            impressions::float AS impressions, ${SHARES_SELECT}
     FROM google_ads_competitive_metrics
     WHERE brand_id = $1 AND level = 'campaign' AND granularity = 'day' AND start_date BETWEEN $2 AND $3`,
    [brandId, start, end],
  );
  return rows;
}

const SETTINGS_SELECT = `customer_id, campaign_id, campaign_name, status, channel_type, channel_sub_type, budget_id, budget_name,
  budget_amount::float AS budget_amount, budget_shared, budget_delivery_method, bidding_strategy_type, bidding_strategy_source,
  bidding_strategy_name, target_cpa::float AS target_cpa, target_roas::float AS target_roas,
  target_impression_share::float AS target_impression_share, target_impression_share_location,
  target_is_cpc_ceiling::float AS target_is_cpc_ceiling, conversion_goals, network_google_search, network_search_partners,
  network_display, locations_included, locations_excluded, positive_geo_target_type, negative_geo_target_type,
  to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, unavailable,
  valid_from, last_seen_at, source`;

export async function latestCampaignSettings(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (customer_id, campaign_id) ${SETTINGS_SELECT}
     FROM google_ads_campaign_settings WHERE brand_id = $1
     ORDER BY customer_id, campaign_id, valid_from DESC, google_ads_campaign_setting_id DESC`,
    [brandId],
  );
  return rows;
}

// Every settings version that took effect inside the period, with the one
// it replaced, so the report can say what changed.
export async function campaignSettingChanges(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `WITH versions AS (
       SELECT ${SETTINGS_SELECT},
              lag(settings_hash) OVER w AS prev_hash,
              lag(to_jsonb(s)) OVER w AS prev
       FROM google_ads_campaign_settings s WHERE brand_id = $1
       WINDOW w AS (PARTITION BY customer_id, campaign_id ORDER BY valid_from, google_ads_campaign_setting_id)
     )
     SELECT * FROM versions
     WHERE prev_hash IS NOT NULL AND valid_from >= $2::date AND valid_from < ($3::date + 1)
     ORDER BY valid_from DESC`,
    [brandId, start, end],
  );
  return rows;
}

// First/last day (or snapshot time) each dataset holds for the brand —
// what the report shows as data freshness and coverage.
export async function availability(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT 'ads' AS dataset, to_char(min(entry_date), 'YYYY-MM-DD') AS first_date, to_char(max(entry_date), 'YYYY-MM-DD') AS last_date, max(fetched_at) AS fetched_at
       FROM google_ads_ads_daily WHERE brand_id = $1
     UNION ALL
     SELECT 'conversions', to_char(min(entry_date), 'YYYY-MM-DD'), to_char(max(entry_date), 'YYYY-MM-DD'), max(fetched_at)
       FROM google_ads_conversion_daily WHERE brand_id = $1
     UNION ALL
     SELECT 'competitive', to_char(min(start_date), 'YYYY-MM-DD'), to_char(max(end_date), 'YYYY-MM-DD'), max(fetched_at)
       FROM google_ads_competitive_metrics WHERE brand_id = $1
     UNION ALL
     SELECT 'campaign_settings', NULL, NULL, max(last_seen_at) FROM google_ads_campaign_settings WHERE brand_id = $1
     UNION ALL
     SELECT 'conversion_actions', NULL, NULL, max(last_seen_at) FROM google_ads_conversion_actions WHERE brand_id = $1
     UNION ALL
     SELECT 'ad_assets', NULL, NULL, max(last_seen_at) FROM google_ads_ad_assets WHERE brand_id = $1
     UNION ALL
     SELECT 'devices', to_char(min(entry_date), 'YYYY-MM-DD'), to_char(max(entry_date), 'YYYY-MM-DD'), max(fetched_at)
       FROM google_ads_device_daily WHERE brand_id = $1
     UNION ALL
     SELECT 'hourly', to_char(min(entry_date), 'YYYY-MM-DD'), to_char(max(entry_date), 'YYYY-MM-DD'), max(fetched_at)
       FROM google_ads_hourly WHERE brand_id = $1
     UNION ALL
     SELECT 'landing_pages', to_char(min(entry_date), 'YYYY-MM-DD'), to_char(max(entry_date), 'YYYY-MM-DD'), max(fetched_at)
       FROM google_ads_landing_pages_daily WHERE brand_id = $1
     UNION ALL
     SELECT 'keyword_quality', to_char(min(snapshot_date), 'YYYY-MM-DD'), to_char(max(snapshot_date), 'YYYY-MM-DD'), max(fetched_at)
       FROM google_ads_keyword_quality WHERE brand_id = $1`,
    [brandId],
  );
  return rows;
}

// ---------------------------------------------------------------------
// report reads — migration 041
// ---------------------------------------------------------------------
const PERF_SUMS = `sum(cost)::float AS cost, sum(impressions)::float AS impressions, sum(clicks)::float AS clicks,
  sum(conversions)::float AS conversions, sum(conversions_value)::float AS conversions_value`;

export async function devicesByCampaign(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id, campaign_id, max(campaign_name) AS campaign_name, max(channel_type) AS channel_type, device,
            ${PERF_SUMS}, sum(all_conversions)::float AS all_conversions
     FROM google_ads_device_daily WHERE ${SCOPE}
     GROUP BY customer_id, campaign_id, device`,
    [brandId, start, end],
  );
  return rows;
}

// Day of week (ISO: 1 = Monday) × hour, summed over the period, with the
// number of days each cell had traffic.
export async function hourlyGrid(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT extract(isodow FROM entry_date)::int AS dow, hour, ${PERF_SUMS}, count(DISTINCT entry_date)::int AS days
     FROM google_ads_hourly WHERE ${SCOPE}
     GROUP BY 1, 2`,
    [brandId, start, end],
  );
  return rows;
}

// A metric Google refused is NULL in every row: its sum stays NULL.
// Pages are grouped without query string, fragment or trailing slash:
// Shopping sends one URL per product variant and UTM set, and
// "site.com" / "site.com/" are the same page. `variants` counts the raw URLs.
const PAGE_URL = `rtrim(split_part(split_part(url, '#', 1), '?', 1), '/')`;

export async function landingPages(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT ${PAGE_URL} AS url, count(DISTINCT url)::int AS variants, ${PERF_SUMS},
            array_remove(array_agg(DISTINCT NULLIF(campaign_name, '')), NULL) AS campaigns,
            (array_agg(speed_score ORDER BY entry_date DESC) FILTER (WHERE speed_score IS NOT NULL))[1]::float AS speed_score,
            (sum(mobile_friendly_clicks_pct * clicks) / NULLIF(sum(clicks) FILTER (WHERE mobile_friendly_clicks_pct IS NOT NULL), 0))::float AS mobile_friendly_clicks_pct,
            array_agg(DISTINCT unavailable::text) AS unavailable_sets
     FROM google_ads_landing_pages_daily WHERE ${SCOPE}
     GROUP BY 1`,
    [brandId, start, end],
  );
  return rows.map(({ unavailable_sets: sets, ...r }) => ({
    ...r,
    unavailable: [...new Set((sets ?? []).flatMap((s) => { try { return JSON.parse(s); } catch { return []; } }))].sort(),
  }));
}

// Keywords per ad group × match type (finer than the Looker table), with
// the newest Quality Score snapshot of the matching criterion. The snapshot
// date comes along: Quality Score is today's rating, not the period's.
export async function keywordDetail(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `WITH kw AS (
       SELECT customer_id, campaign_id, max(campaign_name) AS campaign_name, ad_group_id, max(ad_group_name) AS ad_group_name,
              item AS keyword, match_type, sum(cost)::float AS cost, sum(impressions)::float AS impressions,
              sum(clicks)::float AS clicks, sum(conversions)::float AS conversions,
              sum(conversions_value)::float AS conversions_value, sum(all_conversions)::float AS all_conversions,
              (sum(search_lost_top_is_rank * impressions) / NULLIF(sum(impressions) FILTER (WHERE search_lost_top_is_rank IS NOT NULL), 0))::float AS search_lost_top_is_rank
       FROM google_ads_daily WHERE ${SCOPE} AND level = 'keyword'
       GROUP BY customer_id, campaign_id, ad_group_id, item, match_type
     ),
     q AS (
       SELECT DISTINCT ON (customer_id, ad_group_id, criterion_id)
              customer_id, ad_group_id, criterion_id, lower(keyword) AS kw, match_type, status, quality_score,
              expected_ctr, ad_relevance, landing_page_experience, to_char(snapshot_date, 'YYYY-MM-DD') AS quality_date
       FROM google_ads_keyword_quality WHERE brand_id = $1
       ORDER BY customer_id, ad_group_id, criterion_id, snapshot_date DESC
     )
     SELECT kw.*, q.criterion_id, q.status, q.quality_score, q.expected_ctr, q.ad_relevance, q.landing_page_experience, q.quality_date
     FROM kw LEFT JOIN q ON q.customer_id = kw.customer_id AND q.ad_group_id = kw.ad_group_id
                        AND q.kw = lower(kw.keyword) AND q.match_type = kw.match_type`,
    [brandId, start, end],
  );
  return rows;
}

// Search terms with their campaign and ad group (the legacy table merges
// them). `months` limits to the months no uploaded report replaces.
export async function searchTermDetail(brandId, start, end, months = null, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id, campaign_id, max(campaign_name) AS campaign_name, ad_group_id, max(ad_group_name) AS ad_group_name,
            item AS search_term, match_type, sum(cost)::float AS cost, sum(impressions)::float AS impressions,
            sum(clicks)::float AS clicks, sum(conversions)::float AS conversions,
            sum(conversions_value)::float AS conversions_value, sum(all_conversions)::float AS all_conversions
     FROM google_ads_daily WHERE ${SCOPE} AND level = 'search_term'
       AND ($4::text[] IS NULL OR to_char(entry_date, 'YYYY-MM') = ANY($4))
     GROUP BY customer_id, campaign_id, ad_group_id, item, match_type`,
    [brandId, start, end, months],
  );
  return rows;
}

// ---------------------------------------------------------------------
// Performance Database monthly archives (googleAdsService.syncLibraryMonth)
// ---------------------------------------------------------------------
// One calendar month each, at the grain the file shows. The report keeps
// reading the tables themselves; these only feed the archive copies.
export async function archiveCompetitive(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT level, granularity, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date,
            customer_id, campaign_name, ad_group_name, keyword, match_type, impressions::float AS impressions, ${SHARES_SELECT}
     FROM google_ads_competitive_metrics
     WHERE brand_id = $1 AND start_date >= $2 AND end_date <= $3
     ORDER BY granularity DESC, level, start_date, campaign_name, ad_group_name, keyword`,
    [brandId, start, end],
  );
  return rows;
}

export async function archiveHourly(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT to_char(entry_date, 'YYYY-MM-DD') AS date, hour, max(campaign_name) AS campaign_name, ${PERF_SUMS}
     FROM google_ads_hourly WHERE ${SCOPE}
     GROUP BY entry_date, hour, customer_id, campaign_id
     ORDER BY entry_date, hour, campaign_name`,
    [brandId, start, end],
  );
  return rows;
}

// Raw URLs (with their parameters) as Google reports them, per campaign:
// the report groups them, the archive keeps them as they came.
export async function archiveLandingPages(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT url, max(campaign_name) AS campaign_name, ${PERF_SUMS}
     FROM google_ads_landing_pages_daily WHERE ${SCOPE}
     GROUP BY url, customer_id, campaign_id
     ORDER BY sum(clicks) DESC NULLS LAST`,
    [brandId, start, end],
  );
  return rows;
}

// The newest snapshot of each keyword taken inside the month.
export async function archiveKeywordQuality(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (customer_id, ad_group_id, criterion_id)
            to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_date, campaign_name, ad_group_name, keyword, match_type, status,
            quality_score, expected_ctr, ad_relevance, landing_page_experience
     FROM google_ads_keyword_quality
     WHERE brand_id = $1 AND snapshot_date BETWEEN $2 AND $3
     ORDER BY customer_id, ad_group_id, criterion_id, snapshot_date DESC`,
    [brandId, start, end],
  );
  return rows;
}

// Every settings version that was in force at some point of the month.
export async function archiveCampaignSettings(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT ${SETTINGS_SELECT}
     FROM google_ads_campaign_settings
     WHERE brand_id = $1 AND valid_from < ($3::date + 1) AND last_seen_at >= $2::date
     ORDER BY campaign_name, valid_from`,
    [brandId, start, end],
  );
  return rows;
}
