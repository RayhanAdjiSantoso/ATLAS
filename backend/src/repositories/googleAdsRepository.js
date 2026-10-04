import pool from '../config/db.js';

// ---------------------------------------------------------------------
// google_ads_accounts
// ---------------------------------------------------------------------
const ACCOUNT_COLUMNS = `
  google_ads_account_id AS id, brand_id, customer_id, label, account_name, currency_code, time_zone,
  is_active, to_char(backfill_from, 'YYYY-MM-DD') AS backfill_from,
  to_char(resync_from, 'YYYY-MM-DD') AS resync_from, to_char(resync_to, 'YYYY-MM-DD') AS resync_to,
  resync_requested_at, last_synced_at, last_sync_status, last_sync_error, created_at`;

export async function listAccounts(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_COLUMNS} FROM google_ads_accounts WHERE brand_id = $1 ORDER BY created_at`,
    [brandId],
  );
  return rows;
}

export async function listActiveAccounts(db = pool) {
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_COLUMNS} FROM google_ads_accounts WHERE is_active ORDER BY brand_id, created_at`,
  );
  return rows;
}

export async function getAccount(id, db = pool) {
  const { rows } = await db.query(`SELECT ${ACCOUNT_COLUMNS} FROM google_ads_accounts WHERE google_ads_account_id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getAccountByCustomerId(customerId, db = pool) {
  const { rows } = await db.query(`SELECT ${ACCOUNT_COLUMNS} FROM google_ads_accounts WHERE customer_id = $1`, [customerId]);
  return rows[0] ?? null;
}

export async function insertAccount({ brandId, customerId, label, backfillFrom, userId }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO google_ads_accounts (brand_id, customer_id, label, backfill_from, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING google_ads_account_id AS id`,
    [brandId, customerId, label, backfillFrom, userId],
  );
  return rows[0].id;
}

export async function updateAccount(id, { label, isActive, backfillFrom }, db = pool) {
  await db.query(
    `UPDATE google_ads_accounts SET
       label = COALESCE($2, label),
       is_active = COALESCE($3, is_active),
       backfill_from = COALESCE($4, backfill_from),
       updated_at = now()
     WHERE google_ads_account_id = $1`,
    [id, label, isActive, backfillFrom],
  );
}

export async function deleteAccount(id, db = pool) {
  await db.query('DELETE FROM google_ads_accounts WHERE google_ads_account_id = $1', [id]);
}

export async function requestResync(id, { from, to }, db = pool) {
  await db.query(
    `UPDATE google_ads_accounts SET resync_from = $2, resync_to = $3, resync_requested_at = now(), updated_at = now()
     WHERE google_ads_account_id = $1`,
    [id, from, to],
  );
}

export async function clearResync(id, db = pool) {
  await db.query(
    `UPDATE google_ads_accounts SET resync_from = NULL, resync_to = NULL, resync_requested_at = NULL, updated_at = now()
     WHERE google_ads_account_id = $1`,
    [id],
  );
}

// What Google says about the account, refreshed on every run's start.
export async function updateAccountMeta(customerId, { accountName, currencyCode, timeZone }, db = pool) {
  await db.query(
    `UPDATE google_ads_accounts SET
       account_name  = COALESCE($2, account_name),
       currency_code = COALESCE($3, currency_code),
       time_zone     = COALESCE($4, time_zone),
       updated_at = now()
     WHERE customer_id = $1`,
    [customerId, accountName, currencyCode, timeZone],
  );
}

export async function recordSyncResult(customerId, { status, error }, db = pool) {
  await db.query(
    `UPDATE google_ads_accounts SET
       last_synced_at = now(), last_sync_status = $2, last_sync_error = $3, updated_at = now()
     WHERE customer_id = $1`,
    [customerId, status, error],
  );
}

// ---------------------------------------------------------------------
// google_ads_daily
// ---------------------------------------------------------------------
// Bulk upsert through jsonb_to_recordset: one bound parameter however many
// rows, so a 500-row chunk never hits the driver's parameter cap.
export async function upsertRows({ brandId, customerId, runId, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_daily
       (brand_id, customer_id, entry_date, level, campaign_id, campaign_name, channel_type,
        ad_group_id, ad_group_name, item, match_type, budget_amount, cost, impressions, clicks,
        conversions, conversions_value, all_conversions, abs_top_impression_pct, search_lost_top_is_rank, fetch_run_id)
     SELECT $1, $2, r.entry_date, r.level, r.campaign_id, r.campaign_name, r.channel_type,
            r.ad_group_id, r.ad_group_name, r.item, r.match_type, r.budget_amount, r.cost, r.impressions, r.clicks,
            r.conversions, r.conversions_value, r.all_conversions, r.abs_top_impression_pct, r.search_lost_top_is_rank, $4
     FROM jsonb_to_recordset($3::jsonb) AS r(
       entry_date date, level text, campaign_id text, campaign_name text, channel_type text,
       ad_group_id text, ad_group_name text, item text, match_type text, budget_amount numeric,
       cost numeric, impressions numeric, clicks numeric, conversions numeric, conversions_value numeric,
       all_conversions numeric, abs_top_impression_pct numeric, search_lost_top_is_rank numeric)
     ON CONFLICT (customer_id, entry_date, level, campaign_id, ad_group_id, item, match_type) DO UPDATE SET
       brand_id          = EXCLUDED.brand_id,
       campaign_name     = EXCLUDED.campaign_name,
       channel_type      = EXCLUDED.channel_type,
       ad_group_name     = EXCLUDED.ad_group_name,
       budget_amount     = EXCLUDED.budget_amount,
       cost              = EXCLUDED.cost,
       impressions       = EXCLUDED.impressions,
       clicks            = EXCLUDED.clicks,
       conversions       = EXCLUDED.conversions,
       conversions_value = EXCLUDED.conversions_value,
       all_conversions   = EXCLUDED.all_conversions,
       abs_top_impression_pct  = EXCLUDED.abs_top_impression_pct,
       search_lost_top_is_rank = EXCLUDED.search_lost_top_is_rank,
       fetch_run_id      = EXCLUDED.fetch_run_id,
       fetched_at        = now()`,
    [brandId, customerId, JSON.stringify(rows), runId],
  );
  return rowCount;
}

// End of a successful run: what it did not write inside its own range is no
// longer in Google's numbers (a paused keyword's day that got corrected away).
export async function deleteStaleRows({ customerId, startDate, endDate, runId }, db = pool) {
  const { rowCount } = await db.query(
    `DELETE FROM google_ads_daily
     WHERE customer_id = $1 AND entry_date BETWEEN $2 AND $3 AND fetch_run_id <> $4`,
    [customerId, startDate, endDate, runId],
  );
  return rowCount;
}

export async function deleteCustomerRows(customerId, db = pool) {
  await db.query('DELETE FROM google_ads_daily WHERE customer_id = $1', [customerId]);
}

// Which days each of a brand's accounts holds, for the coverage line in
// Pengaturan Brand and the period hint in the Report Generator.
export async function coverage(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id,
            to_char(min(entry_date), 'YYYY-MM-DD') AS first_date,
            to_char(max(entry_date), 'YYYY-MM-DD') AS last_date,
            count(DISTINCT entry_date)::int AS days
     FROM google_ads_daily WHERE brand_id = $1 AND level = 'campaign'
     GROUP BY customer_id`,
    [brandId],
  );
  return rows;
}

// ---------------------------------------------------------------------
// google_ads_fetch_log
// ---------------------------------------------------------------------
// `datasets` NULL = a fetcher from before migration 040: core rows only.
export async function insertRun({ brandId, customerId, startDate, endDate, source, runId, datasets = null }, db = pool) {
  await db.query(
    `INSERT INTO google_ads_fetch_log (brand_id, customer_id, start_date, end_date, source, fetch_run_id, datasets)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [brandId, customerId, startDate, endDate, source, runId, datasets],
  );
}

export async function getRun(runId, db = pool) {
  const { rows } = await db.query(
    `SELECT fetch_run_id, brand_id, customer_id, status, source, datasets,
            to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date
     FROM google_ads_fetch_log WHERE fetch_run_id = $1`,
    [runId],
  );
  return rows[0] ?? null;
}

export async function finishRun({ runId, status, rowCount, note, datasetResults = {} }, db = pool) {
  await db.query(
    `UPDATE google_ads_fetch_log SET status = $2, row_count = $3, note = $4, dataset_results = $5, finished_at = now()
     WHERE fetch_run_id = $1`,
    [runId, status, rowCount, note, JSON.stringify(datasetResults)],
  );
}

export async function listRecentRuns(brandId, limit = 20, db = pool) {
  const { rows } = await db.query(
    `SELECT fetch_run_id AS "runId", customer_id AS "customerId", source, status, row_count AS "rowCount", note,
            to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(end_date, 'YYYY-MM-DD') AS "endDate",
            started_at AS "startedAt", finished_at AS "finishedAt", datasets, dataset_results AS "datasetResults"
     FROM google_ads_fetch_log WHERE brand_id = $1
     ORDER BY started_at DESC LIMIT $2`,
    [brandId, limit],
  );
  return rows;
}

// Successful runs of the active accounts — the fetch planner works out from
// these which ranges are still missing.
export async function listSuccessfulRuns(customerIds, db = pool) {
  if (!customerIds.length) return [];
  const { rows } = await db.query(
    `SELECT customer_id, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date,
            started_at, datasets, dataset_results
     FROM google_ads_fetch_log
     WHERE customer_id = ANY($1) AND status = 'success'`,
    [customerIds],
  );
  return rows;
}

// ---------------------------------------------------------------------
// Report reads
// ---------------------------------------------------------------------
// The additive metrics every table sums, plus the derived ratios computed by
// the caller. Kept as one SQL fragment so every grouping sums alike.
const SUMS = `
  sum(cost)::float AS cost, sum(impressions)::float AS impressions, sum(clicks)::float AS clicks,
  sum(conversions)::float AS conversions, sum(conversions_value)::float AS conversions_value,
  sum(all_conversions)::float AS all_conversions`;

const SCOPE = 'brand_id = $1 AND entry_date BETWEEN $2 AND $3';

export async function reportTotals(brandId, start, end, db = pool) {
  const { rows } = await db.query(`SELECT ${SUMS} FROM google_ads_daily WHERE ${SCOPE} AND level = 'campaign'`, [brandId, start, end]);
  return rows[0];
}

export async function reportDaily(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT to_char(entry_date, 'YYYY-MM-DD') AS date, ${SUMS}
     FROM google_ads_daily WHERE ${SCOPE} AND level = 'campaign'
     GROUP BY entry_date ORDER BY entry_date`,
    [brandId, start, end],
  );
  return rows;
}

// Budget is the daily budget on the last day the campaign ran in the period —
// what the Looker table shows (it reads the campaign's current setting).
export async function reportCampaigns(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id, campaign_id, max(campaign_name) AS campaign_name, max(channel_type) AS channel_type,
            (array_agg(budget_amount ORDER BY entry_date DESC) FILTER (WHERE budget_amount IS NOT NULL))[1]::float AS budget,
            ${SUMS}
     FROM google_ads_daily WHERE ${SCOPE} AND level = 'campaign'
     GROUP BY customer_id, campaign_id`,
    [brandId, start, end],
  );
  return rows;
}

export async function reportAdGroups(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT ad_group_id, max(ad_group_name) AS ad_group_name, max(campaign_name) AS campaign_name,
            max(channel_type) AS channel_type, ${SUMS}
     FROM google_ads_daily WHERE ${SCOPE} AND level = 'ad_group'
     GROUP BY customer_id, campaign_id, ad_group_id`,
    [brandId, start, end],
  );
  return rows;
}

// Keywords are grouped by their text alone, the way the Looker table lists
// them. The two impression-share ratios cannot be summed over days; they are
// weighted by each day's impressions instead, which is close to — but not
// exactly — what Google reports for the whole range.
export async function reportKeywords(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT lower(item) AS keyword, ${SUMS},
            (sum(abs_top_impression_pct * impressions) / NULLIF(sum(impressions) FILTER (WHERE abs_top_impression_pct IS NOT NULL), 0))::float AS abs_top_impression_pct,
            (sum(search_lost_top_is_rank * impressions) / NULLIF(sum(impressions) FILTER (WHERE search_lost_top_is_rank IS NOT NULL), 0))::float AS search_lost_top_is_rank
     FROM google_ads_daily WHERE ${SCOPE} AND level = 'keyword'
     GROUP BY lower(item)`,
    [brandId, start, end],
  );
  return rows;
}

// `months` ('YYYY-MM') narrows the rows to those months — the ones an
// uploaded Search terms report does not replace.
export async function reportSearchTerms(brandId, start, end, months = null, db = pool) {
  const { rows } = await db.query(
    `SELECT item AS search_term, match_type, ${SUMS}
     FROM google_ads_daily WHERE ${SCOPE} AND level = 'search_term'
       AND ($4::text[] IS NULL OR to_char(entry_date, 'YYYY-MM') = ANY($4))
     GROUP BY item, match_type`,
    [brandId, start, end, months],
  );
  return rows;
}

export async function reportCities(brandId, start, end, channelType, db = pool) {
  const { rows } = await db.query(
    `SELECT item AS city, ${SUMS}
     FROM google_ads_daily WHERE ${SCOPE} AND level = 'city' AND channel_type = $4
     GROUP BY item`,
    [brandId, start, end, channelType],
  );
  return rows;
}

// ---------------------------------------------------------------------
// google_ads_change_events (036)
// ---------------------------------------------------------------------
export async function upsertChangeEvents({ brandId, customerId, runId, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO google_ads_change_events
       (brand_id, customer_id, event_key, changed_at, change_date, user_email, client_type, resource_type,
        operation, campaign_name, ad_group_name, changes, fetch_run_id)
     SELECT $1, $2, r.event_key, r.changed_at, r.changed_at::date, r.user_email, r.client_type, r.resource_type,
            r.operation, r.campaign_name, r.ad_group_name, r.changes, $4
     FROM jsonb_to_recordset($3::jsonb) AS r(
       event_key text, changed_at timestamp, user_email text, client_type text, resource_type text,
       operation text, campaign_name text, ad_group_name text, changes text)
     ON CONFLICT (customer_id, event_key) DO UPDATE SET
       brand_id = EXCLUDED.brand_id, changed_at = EXCLUDED.changed_at, change_date = EXCLUDED.change_date,
       user_email = EXCLUDED.user_email, client_type = EXCLUDED.client_type, resource_type = EXCLUDED.resource_type,
       operation = EXCLUDED.operation, campaign_name = EXCLUDED.campaign_name, ad_group_name = EXCLUDED.ad_group_name,
       changes = EXCLUDED.changes, fetch_run_id = EXCLUDED.fetch_run_id, fetched_at = now()`,
    [brandId, customerId, JSON.stringify(rows), runId],
  );
  return rowCount;
}

export async function deleteCustomerChangeEvents(customerId, db = pool) {
  await db.query('DELETE FROM google_ads_change_events WHERE customer_id = $1', [customerId]);
}

export async function listChangeEvents(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT to_char(changed_at, 'YYYY-MM-DD HH24:MI') AS changed_at, user_email, client_type, resource_type,
            operation, campaign_name, ad_group_name, changes
     FROM google_ads_change_events
     WHERE brand_id = $1 AND change_date BETWEEN $2 AND $3
     ORDER BY changed_at DESC`,
    [brandId, start, end],
  );
  return rows;
}

// One month of search terms the way the UI's Search terms report lists
// them: per term × match type × campaign × ad group, days summed.
export async function searchTermsForFile(brandId, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT item AS search_term, match_type, max(campaign_name) AS campaign_name, max(ad_group_name) AS ad_group_name, ${SUMS}
     FROM google_ads_daily WHERE ${SCOPE} AND level = 'search_term'
     GROUP BY item, match_type, customer_id, campaign_id, ad_group_id
     ORDER BY sum(cost) DESC`,
    [brandId, start, end],
  );
  return rows;
}
