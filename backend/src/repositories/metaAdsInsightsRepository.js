import pool from '../config/db.js';

// Every query takes an optional `db` (a checked-out client) so a rows upsert
// and its log update can share one transaction. Dates are cast `::text` in
// SELECTs, same reasoning as dailyTrackingRepository.

// ---------------------------------------------------------------------
// meta_ads_fetch_config
// ---------------------------------------------------------------------
export async function listConfigs(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT account_type, extra_metrics, updated_at
     FROM meta_ads_fetch_config WHERE brand_id = $1`,
    [brandId],
  );
  return rows;
}

export async function getExtraMetrics(brandId, accountType, db = pool) {
  const { rows } = await db.query(
    'SELECT extra_metrics FROM meta_ads_fetch_config WHERE brand_id = $1 AND account_type = $2',
    [brandId, accountType],
  );
  return rows[0]?.extra_metrics ?? [];
}

export async function upsertConfig({ brandId, accountType, extraMetrics, userId }, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO meta_ads_fetch_config (brand_id, account_type, extra_metrics, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (brand_id, account_type) DO UPDATE SET
       extra_metrics = EXCLUDED.extra_metrics,
       updated_by    = EXCLUDED.updated_by,
       updated_at    = now()
     RETURNING account_type, extra_metrics, updated_at`,
    [brandId, accountType, extraMetrics, userId ?? null],
  );
  return rows[0];
}

// ---------------------------------------------------------------------
// meta_ads_insights_daily
// ---------------------------------------------------------------------
// Bulk upsert through jsonb_to_recordset: one bound parameter no matter how
// many rows, so a 500-row chunk never runs into the driver's parameter cap.
export async function upsertInsightRows({ brandId, accountType, adAccountId, runId, rows }, db = pool) {
  if (!rows.length) return 0;
  const { rowCount } = await db.query(
    `INSERT INTO meta_ads_insights_daily
       (brand_id, account_type, ad_account_id, entry_date, campaign_id, campaign_name, age, gender,
        objective, amount_spent, impressions, reach, link_clicks, purchases, purchase_value, metrics, fetch_run_id)
     SELECT $1, $2, $3, r.entry_date, r.campaign_id, r.campaign_name, r.age, r.gender,
            r.objective, r.amount_spent, r.impressions, r.reach, r.link_clicks, r.purchases, r.purchase_value,
            COALESCE(r.metrics, '{}'::jsonb), $5
     FROM jsonb_to_recordset($4::jsonb) AS r(
       entry_date date, campaign_id text, campaign_name text, age text, gender text,
       objective text, amount_spent numeric, impressions numeric, reach numeric,
       link_clicks numeric, purchases numeric, purchase_value numeric, metrics jsonb)
     ON CONFLICT (brand_id, account_type, entry_date, campaign_id, age, gender) DO UPDATE SET
       ad_account_id  = EXCLUDED.ad_account_id,
       campaign_name  = EXCLUDED.campaign_name,
       objective      = EXCLUDED.objective,
       amount_spent   = EXCLUDED.amount_spent,
       impressions    = EXCLUDED.impressions,
       reach          = EXCLUDED.reach,
       link_clicks    = EXCLUDED.link_clicks,
       purchases      = EXCLUDED.purchases,
       purchase_value = EXCLUDED.purchase_value,
       metrics        = EXCLUDED.metrics,
       fetch_run_id   = EXCLUDED.fetch_run_id,
       fetched_at     = now()`,
    [brandId, accountType, adAccountId, JSON.stringify(rows), runId],
  );
  return rowCount;
}

// End of a successful run: whatever of that month this run did not write is
// stale (a campaign/day that no longer exists in Meta's numbers).
export async function deleteStaleRows({ brandId, accountType, adAccountId, startDate, endDate, runId }, db = pool) {
  const { rowCount } = await db.query(
    `DELETE FROM meta_ads_insights_daily
     WHERE brand_id = $1 AND account_type = $2 AND ad_account_id = $3
       AND entry_date >= $4 AND entry_date <= $5 AND fetch_run_id <> $6`,
    [brandId, accountType, adAccountId, startDate, endDate, runId],
  );
  return rowCount;
}

export async function deleteMonthRows({ brandId, accountType, startDate, endDate }, db = pool) {
  const { rowCount } = await db.query(
    `DELETE FROM meta_ads_insights_daily
     WHERE brand_id = $1 AND account_type = $2 AND entry_date >= $3 AND entry_date <= $4`,
    [brandId, accountType, startDate, endDate],
  );
  return rowCount;
}

// Every stored row of one month, oldest first — the source for the library file.
export async function listRowsForMonth({ brandId, accountType, startDate, endDate }, db = pool) {
  const { rows } = await db.query(
    `SELECT entry_date::text AS entry_date, campaign_name, age, gender, objective,
            amount_spent, impressions, reach, link_clicks, purchases, purchase_value, metrics
     FROM meta_ads_insights_daily
     WHERE brand_id = $1 AND account_type = $2 AND entry_date >= $3 AND entry_date <= $4
     ORDER BY entry_date, campaign_name, age, gender`,
    [brandId, accountType, startDate, endDate],
  );
  return rows;
}

// Per account type × month: what is actually stored.
export async function summariseMonths(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT account_type,
            to_char(date_trunc('month', entry_date), 'YYYY-MM') AS month,
            COUNT(*)::int                      AS row_count,
            COUNT(DISTINCT entry_date)::int    AS day_count,
            COUNT(DISTINCT campaign_id)::int   AS campaign_count,
            COALESCE(SUM(amount_spent), 0)     AS amount_spent,
            MAX(fetched_at)                    AS fetched_at
     FROM meta_ads_insights_daily
     WHERE brand_id = $1
     GROUP BY account_type, date_trunc('month', entry_date)
     ORDER BY month DESC, account_type`,
    [brandId],
  );
  return rows;
}

// ---------------------------------------------------------------------
// meta_ads_fetch_log
// ---------------------------------------------------------------------
export async function insertRun({ brandId, accountType, adAccountId, month, trigger, runId }, db = pool) {
  await db.query(
    `INSERT INTO meta_ads_fetch_log (brand_id, account_type, ad_account_id, month, trigger, fetch_run_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [brandId, accountType, adAccountId, month, trigger, runId],
  );
}

export async function getRun(runId, db = pool) {
  const { rows } = await db.query(
    `SELECT brand_id, account_type, ad_account_id, month::text AS month, status
     FROM meta_ads_fetch_log WHERE fetch_run_id = $1`,
    [runId],
  );
  return rows[0] ?? null;
}

export async function finishRun({ runId, status, rowCount, note }, db = pool) {
  await db.query(
    `UPDATE meta_ads_fetch_log
     SET status = $2, row_count = $3, note = $4, finished_at = now()
     WHERE fetch_run_id = $1`,
    [runId, status, rowCount, note ?? null],
  );
}

export async function listRecentRuns(brandId, limit = 30, db = pool) {
  const { rows } = await db.query(
    `SELECT account_type, to_char(month, 'YYYY-MM') AS month, trigger, status, row_count, note,
            started_at, finished_at
     FROM meta_ads_fetch_log
     WHERE brand_id = $1
     ORDER BY started_at DESC
     LIMIT $2`,
    [brandId, limit],
  );
  return rows;
}
