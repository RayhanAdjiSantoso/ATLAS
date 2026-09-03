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

// ---------------------------------------------------------------------
// §2.3 client_monthly_metrics
// ---------------------------------------------------------------------
const CMM_SELECT = `
  SELECT client_monthly_metric_id AS id, brand_id,
         to_char(period, 'YYYY-MM') AS period,
         revenue, transaksi, qty_sold, target_sales, is_partial_month,
         created_by, created_at, updated_at
  FROM client_monthly_metrics
`;

export async function listMonthlyMetrics(brandId, db = pool) {
  const { rows } = await db.query(`${CMM_SELECT} WHERE brand_id = $1 ORDER BY period DESC`, [brandId]);
  return rows;
}

export async function upsertMonthlyMetric(v, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO client_monthly_metrics
       (brand_id, period, revenue, transaksi, qty_sold, target_sales, is_partial_month, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (brand_id, period) DO UPDATE SET
       revenue          = EXCLUDED.revenue,
       transaksi        = EXCLUDED.transaksi,
       qty_sold         = EXCLUDED.qty_sold,
       target_sales     = EXCLUDED.target_sales,
       is_partial_month = EXCLUDED.is_partial_month
     RETURNING client_monthly_metric_id AS id, (xmax::text = '0') AS was_insert`,
    [v.brandId, v.period, v.revenue, v.transaksi, v.qtySold, v.targetSales, v.isPartialMonth ?? false, v.userId],
  );
  return rows[0];
}

export async function deleteMonthlyMetric(id, db = pool) {
  const { rows } = await db.query(
    `DELETE FROM client_monthly_metrics WHERE client_monthly_metric_id = $1
     RETURNING client_monthly_metric_id AS id, brand_id, to_char(period,'YYYY-MM') AS period`,
    [id],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------
// §2.4 client_channel_sales_monthly
// ---------------------------------------------------------------------
const CCS_SELECT = `
  SELECT client_channel_sales_id AS id, brand_id,
         to_char(period, 'YYYY-MM') AS period,
         channel::text AS channel, sales,
         created_by, created_at, updated_at
  FROM client_channel_sales_monthly
`;

export async function listChannelSales(brandId, db = pool) {
  const { rows } = await db.query(
    `${CCS_SELECT} WHERE brand_id = $1 ORDER BY period DESC, channel`,
    [brandId],
  );
  return rows;
}

export async function upsertChannelSale(v, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO client_channel_sales_monthly (brand_id, period, channel, sales, created_by)
     VALUES ($1, $2, $3::sales_channel, $4, $5)
     ON CONFLICT (brand_id, period, channel) DO UPDATE SET sales = EXCLUDED.sales
     RETURNING client_channel_sales_id AS id, (xmax::text = '0') AS was_insert`,
    [v.brandId, v.period, v.channel, v.sales, v.userId],
  );
  return rows[0];
}

export async function deleteChannelSale(id, db = pool) {
  const { rows } = await db.query(
    `DELETE FROM client_channel_sales_monthly WHERE client_channel_sales_id = $1
     RETURNING client_channel_sales_id AS id, brand_id, to_char(period,'YYYY-MM') AS period, channel::text AS channel`,
    [id],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------
// §2.5 client_platform_spend_monthly
// ---------------------------------------------------------------------
const CPS_COLS = [
  'amount_spent', 'impressions', 'link_clicks', 'purchase', 'purchase_value',
  'reach', 'frequency', 'view_content', 'atc', 'lpv', 'ig_profile_visit',
  'cpm', 'cpc', 'ctr', 'cost_per_vc', 'cost_per_atc', 'cost_per_purchase', 'roas',
];

const CPS_SELECT = `
  SELECT client_platform_spend_id AS id, brand_id,
         to_char(period, 'YYYY-MM') AS period,
         platform::text AS platform,
         ${CPS_COLS.join(', ')},
         created_by, created_at, updated_at
  FROM client_platform_spend_monthly
`;

export async function listPlatformSpend(brandId, db = pool) {
  const { rows } = await db.query(
    `${CPS_SELECT} WHERE brand_id = $1 ORDER BY period DESC, platform`,
    [brandId],
  );
  return rows;
}

export async function upsertPlatformSpend(v, db = pool) {
  // v.metrics is an object keyed by the CPS_COLS names (missing/blank => null).
  const values = [v.brandId, v.period, v.platform, v.userId, ...CPS_COLS.map((c) => v.metrics[c] ?? null)];
  const colPlaceholders = CPS_COLS.map((_, i) => `$${5 + i}`);
  const updateSet = CPS_COLS.map((c) => `${c} = EXCLUDED.${c}`).join(',\n       ');
  const { rows } = await db.query(
    `INSERT INTO client_platform_spend_monthly
       (brand_id, period, platform, created_by, ${CPS_COLS.join(', ')})
     VALUES ($1, $2, $3::ad_platform, $4, ${colPlaceholders.join(', ')})
     ON CONFLICT (brand_id, period, platform) DO UPDATE SET
       ${updateSet}
     RETURNING client_platform_spend_id AS id, (xmax::text = '0') AS was_insert`,
    values,
  );
  return rows[0];
}

export async function deletePlatformSpend(id, db = pool) {
  const { rows } = await db.query(
    `DELETE FROM client_platform_spend_monthly WHERE client_platform_spend_id = $1
     RETURNING client_platform_spend_id AS id, brand_id, to_char(period,'YYYY-MM') AS period, platform::text AS platform`,
    [id],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------
// §2.7 data_ingestion_log
// ---------------------------------------------------------------------
export async function logIngestion(v, db = pool) {
  await db.query(
    `INSERT INTO data_ingestion_log
       (brand_id, target_table, period, source, method, row_count, status, note, pic, performed_by)
     VALUES ($1, $2, $3, 'manual_form', $4, $5, $6::ingestion_status, $7, $8, $9)`,
    [v.brandId, v.targetTable, v.period ?? null, v.method, v.rowCount, v.status, v.note ?? null, v.pic ?? null, v.userId ?? null],
  );
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
            d.performed_by, u.full_name AS performed_by_name, d.created_at
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
    `SELECT brand_id, brand_name, industry, sub_industry, kategori_besar,
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
    `SELECT brand_id, to_char(period, 'YYYY-MM') AS period, revenue, target_sales, is_partial_month
     FROM client_monthly_metrics
     WHERE brand_id = ANY($1::int[]) AND period BETWEEN $2::date AND $3::date`,
    [brandIds, `${startPeriod}-01`, `${endPeriod}-01`],
  );
  return rows;
}

export async function monthlySpendByBrand(brandIds, startPeriod, endPeriod, db = pool) {
  const { rows } = await db.query(
    `SELECT brand_id, to_char(period, 'YYYY-MM') AS period, SUM(amount_spent) AS spend
     FROM client_platform_spend_monthly
     WHERE brand_id = ANY($1::int[]) AND period BETWEEN $2::date AND $3::date
     GROUP BY brand_id, period`,
    [brandIds, `${startPeriod}-01`, `${endPeriod}-01`],
  );
  return rows;
}

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
            cmm.revenue,
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

export async function allClientSalesChannels(db = pool) {
  const { rows } = await db.query(
    'SELECT brand_id, channel::text AS channel, is_used, source FROM client_sales_channels',
  );
  return rows;
}

// Brands whose Meta spend can't be traced to an ad account: they have
// meta_* platform spend somewhere but zero brand_ad_accounts rows.
export async function metaSpendWithoutAdAccounts(db = pool) {
  const { rows } = await db.query(
    `SELECT b.brand_id, b.brand_name, b.bm_id,
            SUM(cps.amount_spent) AS meta_spend_total,
            count(DISTINCT cps.period) AS months
     FROM client_platform_spend_monthly cps
     JOIN brands b ON b.brand_id = cps.brand_id
     WHERE cps.platform::text LIKE 'meta\\_%'
       AND NOT EXISTS (SELECT 1 FROM brand_ad_accounts a WHERE a.brand_id = b.brand_id)
     GROUP BY b.brand_id, b.brand_name, b.bm_id
     ORDER BY meta_spend_total DESC`,
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
