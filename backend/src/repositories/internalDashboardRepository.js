import pool from '../config/db.js';

// All queries take an optional `db` so the service can pass a checked-out
// client and run the fact-table upsert + its data_ingestion_log row in one
// transaction. Defaults to the shared pool for plain reads.
//
// `period` is stored as a DATE (first of month). Reads return it as
// `to_char(period,'YYYY-MM')` so the API speaks the same "YYYY-MM" the
// month picker uses; writes take a YYYY-MM-01 date string from the service.

// ---------------------------------------------------------------------
// Clients (brands) for the picker — active first, then freeze, off, unset.
// ---------------------------------------------------------------------
export async function listClients(db = pool) {
  const { rows } = await db.query(`
    SELECT brand_id, brand_name, status::text AS status
    FROM brands
    ORDER BY CASE status
               WHEN 'active' THEN 0 WHEN 'freeze' THEN 1 WHEN 'off' THEN 2 ELSE 3
             END,
             brand_name
  `);
  return rows;
}

// Every fact row the brand has for the given periods, across the four fact
// tables, with its provenance — what the sync compares against before it
// writes (overwritten manual values are logged; stale synced rows removed).
export async function brandFactSnapshot(brandId, periods, db = pool) {
  const dates = periods.map((p) => `${p}-01`);
  // Sequential on purpose: `db` is usually one checked-out transaction
  // client, which cannot run queries concurrently.
  const q = (sql) => db.query(sql, [brandId, dates]).then((r) => r.rows);
  const cmm = await q(`SELECT client_monthly_metric_id AS id, to_char(period,'YYYY-MM') AS period, revenue, transaksi, qty_sold,
              is_partial_month, partial_month_reason, source::text AS source
       FROM client_monthly_metrics WHERE brand_id = $1 AND period = ANY($2::date[])`);
  const ccs = await q(`SELECT client_channel_sales_id AS id, to_char(period,'YYYY-MM') AS period, channel::text AS channel, sales,
              source::text AS source
       FROM client_channel_sales_monthly WHERE brand_id = $1 AND period = ANY($2::date[])`);
  const ccso = await q(`SELECT client_channel_sales_other_id AS id, to_char(period,'YYYY-MM') AS period, channel_label, sales_amount AS sales,
              source::text AS source
       FROM client_channel_sales_other WHERE brand_id = $1 AND period = ANY($2::date[])`);
  const cps = await q(`SELECT client_platform_spend_id AS id, to_char(period,'YYYY-MM') AS period, platform::text AS platform,
              ${CPS_COLS.join(', ')}, is_partial_month, partial_month_reason, source::text AS source
       FROM client_platform_spend_monthly WHERE brand_id = $1 AND period = ANY($2::date[])`);
  return { cmm, ccs, ccso, cps };
}

// Months in which any fact row of the brand came from one of `sources` —
// lets a source revisit a month it wrote before but no longer has data for.
export async function factPeriodsBySource(brandId, sources, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT to_char(period, 'YYYY-MM') AS period FROM (
       SELECT period, source FROM client_monthly_metrics WHERE brand_id = $1
       UNION ALL SELECT period, source FROM client_channel_sales_monthly WHERE brand_id = $1
       UNION ALL SELECT period, source FROM client_channel_sales_other WHERE brand_id = $1
       UNION ALL SELECT period, source FROM client_platform_spend_monthly WHERE brand_id = $1
     ) f WHERE source::text = ANY($2::text[]) ORDER BY 1`,
    [brandId, sources],
  );
  return rows.map((r) => r.period);
}

const FACT_TABLE_PK = {
  client_monthly_metrics: 'client_monthly_metric_id',
  client_channel_sales_monthly: 'client_channel_sales_id',
  client_channel_sales_other: 'client_channel_sales_other_id',
  client_platform_spend_monthly: 'client_platform_spend_id',
};

// Deletes rows an automatic source wrote earlier. The source filter is part
// of the statement and 'manual_form' is refused outright, so a manual row
// can never be removed through this path.
export async function deleteSyncedFactRows(table, ids, sources, db = pool) {
  const pk = FACT_TABLE_PK[table];
  if (!pk) throw new Error(`deleteSyncedFactRows: tabel tidak dikenal ${table}`);
  const allowed = (sources || []).filter((s) => s !== 'manual_form');
  if (!ids.length || !allowed.length) return 0;
  const { rowCount } = await db.query(
    `DELETE FROM ${table} WHERE ${pk} = ANY($1::int[]) AND source::text = ANY($2::text[])`,
    [ids, allowed],
  );
  return rowCount;
}

// ---------------------------------------------------------------------
// ATLAS Daily Tracking (migration 024) — monthly roll-up inputs.
// Per brand x month x channel: sums plus the counts needed to tell
// "nothing entered" (no rows / all NULL) from a real 0, and whether every
// day that sold something also reported qty / transactions.
// ---------------------------------------------------------------------
export async function dailySalesMonthly(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT to_char(date_trunc('month', entry_date), 'YYYY-MM') AS period, channel_key,
            SUM(revenue) AS revenue, count(revenue)::int AS n_revenue,
            SUM(qty_sold) AS qty, count(qty_sold)::int AS n_qty,
            SUM(transaksi) AS trx, count(transaksi)::int AS n_trx,
            count(*) FILTER (WHERE revenue IS NOT NULL AND revenue <> 0 AND qty_sold IS NULL)::int AS sold_without_qty,
            count(*) FILTER (WHERE revenue IS NOT NULL AND revenue <> 0 AND transaksi IS NULL)::int AS sold_without_trx,
            count(DISTINCT entry_date)::int AS days
     FROM daily_channel_sales WHERE brand_id = $1
     GROUP BY 1, 2 ORDER BY 1, 2`,
    [brandId],
  );
  return rows;
}

export async function dailySpendMonthly(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT to_char(date_trunc('month', entry_date), 'YYYY-MM') AS period, channel_key,
            SUM(amount_spent) AS amount, count(amount_spent)::int AS n_amount,
            count(*) FILTER (WHERE source = 'meta_api')::int AS n_meta_api
     FROM daily_channel_spend WHERE brand_id = $1
     GROUP BY 1, 2 ORDER BY 1, 2`,
    [brandId],
  );
  return rows;
}

// Meta Ads insights (Pengaturan Brand > Meta Ads Auto Fetch, migration 025)
// summed per month x account x campaign — campaign name is kept so the
// service can split MAIN accounts into Boost / Non-boost by keyword. Only
// summable columns: reach/frequency are NOT additive across days or
// age/gender rows, so they are not rolled up at all.
export async function metaInsightsMonthly(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT to_char(date_trunc('month', entry_date), 'YYYY-MM') AS period, account_type, ad_account_id, campaign_name,
            SUM(amount_spent) AS spend, SUM(impressions) AS impressions, SUM(link_clicks) AS link_clicks,
            SUM(purchases) AS purchase, SUM(purchase_value) AS purchase_value,
            SUM((metrics->>'profile_visits')::numeric) AS ig_profile_visit,
            SUM((metrics->>'content_views')::numeric) AS view_content,
            SUM((metrics->>'adds_to_cart')::numeric) AS atc,
            SUM((metrics->>'landing_page_views')::numeric) AS lpv
     FROM meta_ads_insights_daily WHERE brand_id = $1
     GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4`,
    [brandId],
  );
  return rows;
}

export async function listBrandAdAccounts(brandId, db = pool) {
  const { rows } = await db.query(
    'SELECT ad_account_id, account_type, boost_keyword FROM brand_ad_accounts WHERE brand_id = $1',
    [brandId],
  );
  return rows;
}

export async function dailyTrackingChannelLabels(brandId, db = pool) {
  const { rows } = await db.query(
    'SELECT kind, channel_key, label FROM daily_tracking_channels WHERE brand_id = $1',
    [brandId],
  );
  return rows;
}

// Brands with any Daily Tracking data, and when it last changed — for the
// "sync all" list and S8's "changed since last sync" check.
export async function dailyTrackingBrands(db = pool) {
  const { rows } = await db.query(`
    SELECT b.brand_id, b.brand_name, b.status::text AS status,
           GREATEST(s.last_change, p.last_change, m.last_change) AS last_change,
           GREATEST(s.last_date, p.last_date)::text AS last_entry_date
    FROM brands b
    LEFT JOIN (SELECT brand_id, max(updated_at) last_change, max(entry_date) last_date FROM daily_channel_sales GROUP BY brand_id) s ON s.brand_id = b.brand_id
    LEFT JOIN (SELECT brand_id, max(updated_at) last_change, max(entry_date) last_date FROM daily_channel_spend GROUP BY brand_id) p ON p.brand_id = b.brand_id
    LEFT JOIN (SELECT brand_id, max(fetched_at) last_change, max(entry_date) last_date FROM meta_ads_insights_daily GROUP BY brand_id) m ON m.brand_id = b.brand_id
    WHERE s.brand_id IS NOT NULL OR p.brand_id IS NOT NULL OR m.brand_id IS NOT NULL
    ORDER BY b.brand_name
  `);
  return rows;
}

// ---------------------------------------------------------------------
// §2.3 client_monthly_metrics
// ---------------------------------------------------------------------

// `v.source` defaults to the manual form. `v.keepTargetSales` (sync path)
// leaves an existing target_sales alone — the sheet carries no target, and
// a hand-entered target must not be wiped by a sync.
export async function upsertMonthlyMetric(v, db = pool) {
  const isPartial = v.isPartialMonth ?? false;
  const reason = isPartial ? (v.partialMonthReason ?? 'manual') : null;
  const { rows } = await db.query(
    `INSERT INTO client_monthly_metrics
       (brand_id, period, revenue, transaksi, qty_sold, target_sales, is_partial_month, partial_month_reason,
        created_by, source, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::ingestion_source, $11)
     ON CONFLICT (brand_id, period) DO UPDATE SET
       revenue              = EXCLUDED.revenue,
       transaksi            = EXCLUDED.transaksi,
       qty_sold             = EXCLUDED.qty_sold,
       target_sales         = CASE WHEN $12::boolean THEN client_monthly_metrics.target_sales ELSE EXCLUDED.target_sales END,
       is_partial_month     = EXCLUDED.is_partial_month,
       partial_month_reason = EXCLUDED.partial_month_reason,
       source               = EXCLUDED.source,
       source_ref           = EXCLUDED.source_ref
     RETURNING client_monthly_metric_id AS id, (xmax::text = '0') AS was_insert`,
    [v.brandId, v.period, v.revenue, v.transaksi, v.qtySold, v.targetSales, isPartial, reason, v.userId,
      v.source ?? 'manual_form', v.sourceRef ?? null, v.keepTargetSales ?? false],
  );
  return rows[0];
}

// ---------------------------------------------------------------------
// §2.4 client_channel_sales_monthly
// ---------------------------------------------------------------------

export async function upsertChannelSale(v, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO client_channel_sales_monthly (brand_id, period, channel, sales, created_by, source, source_ref)
     VALUES ($1, $2, $3::sales_channel, $4, $5, $6::ingestion_source, $7)
     ON CONFLICT (brand_id, period, channel) DO UPDATE SET
       sales = EXCLUDED.sales, source = EXCLUDED.source, source_ref = EXCLUDED.source_ref
     RETURNING client_channel_sales_id AS id, (xmax::text = '0') AS was_insert`,
    [v.brandId, v.period, v.channel, v.sales, v.userId, v.source ?? 'manual_form', v.sourceRef ?? null],
  );
  return rows[0];
}

// Free-text channels (migration 010) — e.g. "chat", or a sheet column the
// parser did not recognise, kept under its original label.
export async function upsertChannelSaleOther(v, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO client_channel_sales_other (brand_id, period, channel_label, sales_amount, created_by, source, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6::ingestion_source, $7)
     ON CONFLICT (brand_id, period, channel_label) DO UPDATE SET
       sales_amount = EXCLUDED.sales_amount, source = EXCLUDED.source, source_ref = EXCLUDED.source_ref
     RETURNING client_channel_sales_other_id AS id, (xmax::text = '0') AS was_insert`,
    [v.brandId, v.period, v.channelLabel, v.sales, v.userId, v.source ?? 'manual_form', v.sourceRef ?? null],
  );
  return rows[0];
}

// ---------------------------------------------------------------------
// §2.5 client_platform_spend_monthly
// ---------------------------------------------------------------------
const CPS_COLS = [
  'amount_spent', 'impressions', 'link_clicks', 'purchase', 'purchase_value',
  'reach', 'frequency', 'view_content', 'atc', 'lpv', 'ig_profile_visit',
  'cpm', 'cpc', 'ctr', 'cost_per_vc', 'cost_per_atc', 'cost_per_purchase', 'roas',
];

export async function upsertPlatformSpend(v, db = pool) {
  // v.metrics is an object keyed by the CPS_COLS names (missing/blank => null).
  // v.isPartialMonth undefined (manual form — it has no partial toggle) keeps
  // the row's existing flag; the sync always passes an explicit value.
  const n = CPS_COLS.length;
  const values = [
    v.brandId, v.period, v.platform, v.userId, ...CPS_COLS.map((c) => v.metrics[c] ?? null),
    v.source ?? 'manual_form', v.sourceRef ?? null,
    v.isPartialMonth ?? null, v.isPartialMonth ? (v.partialMonthReason ?? 'manual') : null,
  ];
  const colPlaceholders = CPS_COLS.map((_, i) => `$${5 + i}`);
  const [pSource, pRef, pPartial, pReason] = [5 + n, 6 + n, 7 + n, 8 + n];
  const updateSet = CPS_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(',\n       ');
  const { rows } = await db.query(
    `INSERT INTO client_platform_spend_monthly
       (brand_id, period, platform, created_by, ${CPS_COLS.join(', ')},
        source, source_ref, is_partial_month, partial_month_reason)
     VALUES ($1, $2, $3::ad_platform, $4, ${colPlaceholders.join(', ')},
        $${pSource}::ingestion_source, $${pRef}, COALESCE($${pPartial}::boolean, false), $${pReason})
     ON CONFLICT (brand_id, period, platform) DO UPDATE SET
       ${updateSet},
       source = EXCLUDED.source,
       source_ref = EXCLUDED.source_ref,
       is_partial_month = COALESCE($${pPartial}::boolean, client_platform_spend_monthly.is_partial_month),
       partial_month_reason = CASE WHEN $${pPartial}::boolean IS NULL
                                   THEN client_platform_spend_monthly.partial_month_reason
                                   ELSE EXCLUDED.partial_month_reason END
     RETURNING client_platform_spend_id AS id, (xmax::text = '0') AS was_insert`,
    values,
  );
  return rows[0];
}

// ---------------------------------------------------------------------
// §2.7 data_ingestion_log
// ---------------------------------------------------------------------
// Run-level fields (runId … details) are set by the Sheets sync; the manual
// forms leave them NULL.
export async function logIngestion(v, db = pool) {
  await db.query(
    `INSERT INTO data_ingestion_log
       (brand_id, target_table, period, source, method, row_count, status, note, pic, performed_by,
        run_id, started_at, finished_at, rows_read, rows_written, rows_skipped, warning_count, details)
     VALUES ($1, $2, $3, $4::ingestion_source, $5, $6, $7::ingestion_status, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18)`,
    [v.brandId, v.targetTable, v.period ?? null, v.source ?? 'manual_form', v.method, v.rowCount, v.status, v.note ?? null, v.pic ?? null, v.userId ?? null,
      v.runId ?? null, v.startedAt ?? null, v.finishedAt ?? null, v.rowsRead ?? null, v.rowsWritten ?? null,
      v.rowsSkipped ?? null, v.warningCount ?? null, v.details ? JSON.stringify(v.details) : null],
  );
}

// Latest run summary row per brand for one run target ('daily_tracking_sync_run'
// or 'sheet_sync_run') — S8 reads its status, warnings and reconciliation.
// Dry runs are rolled back, so they never appear here.
export async function latestSyncRuns(runTarget = 'daily_tracking_sync_run', db = pool) {
  const { rows } = await db.query(`
    SELECT DISTINCT ON (brand_id) brand_id, status::text AS status, run_id, started_at, finished_at,
           rows_written, rows_skipped, warning_count, details
    FROM data_ingestion_log
    WHERE target_table = $1
    ORDER BY brand_id, created_at DESC
  `, [runTarget]);
  return rows;
}

export async function listIngestionLog({ brandId, target, limit = 50 }, db = pool) {
  const where = [];
  const params = [];
  if (brandId) { params.push(brandId); where.push(`d.brand_id = $${params.length}`); }
  if (target) { params.push(target); where.push(`d.target_table = $${params.length}`); }
  params.push(limit);
  const { rows } = await db.query(
    `SELECT d.data_ingestion_log_id AS id, d.brand_id, b.brand_name,
            d.target_table, to_char(d.period, 'YYYY-MM') AS period,
            d.source::text AS source, d.method, d.row_count,
            d.status::text AS status, d.note, d.pic,
            d.performed_by, u.full_name AS performed_by_name, d.created_at,
            d.run_id, d.rows_written, d.rows_skipped, d.warning_count
     FROM data_ingestion_log d
     LEFT JOIN brands b ON b.brand_id = d.brand_id
     LEFT JOIN users u ON u.user_id = d.performed_by
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY d.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

// ---------------------------------------------------------------------
// S1 Executive Overview
// ---------------------------------------------------------------------
// The overview endpoint pulls a compact per-brand / per-month grid for a
// 13-month window and does the shaping in JS (max ~141 brands x 13 months
// ~= 1.8k rows). Rollup ratios (ROAS) are recomputed in the service from
// these raw sums — the stored ratio columns are never read here.

export async function listBrandsForOverview({ status, kategoriBesar }, db = pool) {
  // status IS NOT NULL excludes the handful of pre-migration report-generator
  // brand rows that never went through the "Client info" import.
  const { rows } = await db.query(
    `SELECT brand_id, brand_name, industry, sub_industry, kategori_besar, pic,
            status::text AS status, join_date::text AS join_date
     FROM brands_with_category
     WHERE status IS NOT NULL
       AND ($1::text = 'all' OR status = 'active')
       AND ($2::text IS NULL OR kategori_besar = $2)
     ORDER BY brand_name`,
    [status, kategoriBesar],
  );
  return rows;
}

export async function monthlyRevenueByBrand(brandIds, startPeriod, endPeriod, db = pool) {
  const { rows } = await db.query(
    `SELECT brand_id, to_char(period, 'YYYY-MM') AS period, revenue, transaksi, target_sales, is_partial_month
     FROM client_monthly_metrics
     WHERE brand_id = ANY($1::int[]) AND period BETWEEN $2::date AND $3::date`,
    [brandIds, `${startPeriod}-01`, `${endPeriod}-01`],
  );
  return rows;
}

// (monthlySpendByBrand removed — loadMonthlyGrid now uses
// monthlyAdTotalsByBrand so S3/S4 can recompute per-client CPM/CTR.)

// S6 — per-channel sales grid (one row per brand/month/channel).
export async function channelSalesGrid(brandIds, startPeriod, endPeriod, db = pool) {
  const { rows } = await db.query(
    `SELECT brand_id, to_char(period, 'YYYY-MM') AS period, channel::text AS channel, sales
     FROM client_channel_sales_monthly
     WHERE brand_id = ANY($1::int[]) AND period BETWEEN $2::date AND $3::date`,
    [brandIds, `${startPeriod}-01`, `${endPeriod}-01`],
  );
  return rows;
}

// S6 — free-text ("other") channels not in the sales_channel enum (§ migration 010).
export async function channelSalesOtherGrid(brandIds, startPeriod, endPeriod, db = pool) {
  const { rows } = await db.query(
    `SELECT brand_id, to_char(period, 'YYYY-MM') AS period, channel_label, sales_amount AS sales
     FROM client_channel_sales_other
     WHERE brand_id = ANY($1::int[]) AND period BETWEEN $2::date AND $3::date`,
    [brandIds, `${startPeriod}-01`, `${endPeriod}-01`],
  );
  return rows;
}

// S5 — per-brand / per-month ad totals (summed across all platforms). Raw
// columns only; every ratio (CPM/CPC/CTR/ROAS/CPP/ad-cost-ratio) is
// recomputed in the service from these sums.
export async function monthlyAdTotalsByBrand(brandIds, startPeriod, endPeriod, db = pool) {
  const { rows } = await db.query(
    `SELECT brand_id, to_char(period, 'YYYY-MM') AS period,
            SUM(amount_spent) AS spend, SUM(impressions) AS impressions,
            SUM(link_clicks) AS link_clicks, SUM(purchase) AS purchase,
            SUM(purchase_value) AS purchase_value,
            SUM(view_content) AS view_content, SUM(atc) AS atc,
            bool_or(is_partial_month) AS any_partial_spend
     FROM client_platform_spend_monthly
     WHERE brand_id = ANY($1::int[]) AND period BETWEEN $2::date AND $3::date
     GROUP BY brand_id, period`,
    [brandIds, `${startPeriod}-01`, `${endPeriod}-01`],
  );
  return rows;
}

// S6 — per-platform ad metrics grid (RAW summable columns only; ratios are
// recomputed in the service from these sums, never read from storage).
export async function platformMetricsGrid(brandIds, startPeriod, endPeriod, db = pool) {
  const { rows } = await db.query(
    `SELECT brand_id, to_char(period, 'YYYY-MM') AS period, platform::text AS platform,
            amount_spent, impressions, link_clicks, purchase, purchase_value, ig_profile_visit
     FROM client_platform_spend_monthly
     WHERE brand_id = ANY($1::int[]) AND period BETWEEN $2::date AND $3::date`,
    [brandIds, `${startPeriod}-01`, `${endPeriod}-01`],
  );
  return rows;
}

// S7 — profile bits.
export async function getBrandProfile(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT b.brand_id, b.brand_name, b.status::text AS status, b.industry, b.sub_industry,
            b.bm_id, b.pic, b.migration_review_note, bwc.kategori_besar,
            (SELECT count(*)::int FROM brand_ad_accounts a WHERE a.brand_id = b.brand_id) AS ad_account_count
     FROM brands b
     LEFT JOIN brands_with_category bwc ON bwc.brand_id = b.brand_id
     WHERE b.brand_id = $1`,
    [brandId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------
// S8 — Data Quality
// ---------------------------------------------------------------------

// Per migrated brand: does it have a row in each fact table for `period`,
// plus its channel-sales total (canonical + other) and platform-spend
// total. One query, LEFT JOINs on the period.
export async function dataQualitySnapshot(period, db = pool) {
  const p = `${period}-01`;
  const { rows } = await db.query(
    `SELECT b.brand_id, b.brand_name, b.status::text AS status,
            bwc.kategori_besar, b.bm_id, b.join_date::text AS join_date,
            (cmm.brand_id IS NOT NULL)                       AS has_monthly_metrics,
            cmm.revenue, cmm.is_partial_month, cmm.partial_month_reason, cmm.source::text AS revenue_source,
            COALESCE(ccs.total, 0) + COALESCE(cco.total, 0)  AS channel_sales_total,
            (ccs.brand_id IS NOT NULL OR cco.brand_id IS NOT NULL) AS has_channel_sales,
            COALESCE(cps.spend, 0)                           AS platform_spend_total,
            (cps.brand_id IS NOT NULL)                       AS has_platform_spend,
            cps.meta_platforms
     FROM brands b
     LEFT JOIN brands_with_category bwc ON bwc.brand_id = b.brand_id
     LEFT JOIN client_monthly_metrics cmm ON cmm.brand_id = b.brand_id AND cmm.period = $1::date
     LEFT JOIN (SELECT brand_id, SUM(sales) total FROM client_channel_sales_monthly WHERE period = $1::date GROUP BY brand_id) ccs ON ccs.brand_id = b.brand_id
     LEFT JOIN (SELECT brand_id, SUM(sales_amount) total FROM client_channel_sales_other WHERE period = $1::date GROUP BY brand_id) cco ON cco.brand_id = b.brand_id
     LEFT JOIN (SELECT brand_id, SUM(amount_spent) spend,
                       bool_or(platform::text LIKE 'meta\\_%') AS meta_platforms
                FROM client_platform_spend_monthly WHERE period = $1::date GROUP BY brand_id) cps ON cps.brand_id = b.brand_id
     WHERE b.status IS NOT NULL
     ORDER BY b.brand_name`,
    [p],
  );
  return rows;
}

// Which canonical channels each brand has ever recorded sales on (S8
// matrix). Derived from the data, since channel usage is no longer typed in.
export async function brandChannelUsage(db = pool) {
  const { rows } = await db.query(
    `SELECT brand_id, channel::text AS channel, to_char(max(period), 'YYYY-MM') AS last_period
     FROM client_channel_sales_monthly GROUP BY brand_id, channel`,
  );
  return rows;
}

// Brands with Meta spend but incomplete ad-account mapping. Two tiers:
//   hard — no bm_id at all: spend not tied to any Business Manager.
//   soft — has a bm_id, but no brand_ad_accounts rows yet (everyone, for
//          now — brand_ad_accounts is unpopulated; the sheet has only an
//          ad-account COUNT, never the act_ IDs).
export async function metaSpendAdAccountGaps(db = pool) {
  const { rows } = await db.query(
    `SELECT b.brand_id, b.brand_name, b.bm_id,
            SUM(cps.amount_spent) AS meta_spend_total,
            count(DISTINCT cps.period) AS months,
            (b.bm_id IS NULL) AS hard
     FROM client_platform_spend_monthly cps
     JOIN brands b ON b.brand_id = cps.brand_id
     WHERE cps.platform::text LIKE 'meta\\_%'
       AND NOT EXISTS (SELECT 1 FROM brand_ad_accounts a WHERE a.brand_id = b.brand_id)
     GROUP BY b.brand_id, b.brand_name, b.bm_id
     ORDER BY (b.bm_id IS NULL) DESC, meta_spend_total DESC`,
  );
  return rows;
}

// Channel-sales vs revenue reconciliation for `period`.
export async function channelReconciliation(period, db = pool) {
  const p = `${period}-01`;
  const { rows } = await db.query(
    `SELECT b.brand_id, b.brand_name, cmm.revenue,
            COALESCE(ccs.total, 0) + COALESCE(cco.total, 0) AS channel_total,
            COALESCE(ccs.n, 0) + COALESCE(cco.n, 0) AS channel_rows
     FROM client_monthly_metrics cmm
     JOIN brands b ON b.brand_id = cmm.brand_id
     LEFT JOIN (SELECT brand_id, SUM(sales) total, count(*) n FROM client_channel_sales_monthly WHERE period = $1::date GROUP BY brand_id) ccs ON ccs.brand_id = b.brand_id
     LEFT JOIN (SELECT brand_id, SUM(sales_amount) total, count(*) n FROM client_channel_sales_other WHERE period = $1::date GROUP BY brand_id) cco ON cco.brand_id = b.brand_id
     WHERE cmm.period = $1::date
     ORDER BY b.brand_name`,
    [p],
  );
  return rows;
}

export const CPS_COLUMNS = CPS_COLS;
