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
         revenue, transaksi, qty_sold, target_sales,
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
       (brand_id, period, revenue, transaksi, qty_sold, target_sales, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (brand_id, period) DO UPDATE SET
       revenue      = EXCLUDED.revenue,
       transaksi    = EXCLUDED.transaksi,
       qty_sold     = EXCLUDED.qty_sold,
       target_sales = EXCLUDED.target_sales
     RETURNING client_monthly_metric_id AS id, (xmax::text = '0') AS was_insert`,
    [v.brandId, v.period, v.revenue, v.transaksi, v.qtySold, v.targetSales, v.userId],
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

export const CPS_COLUMNS = CPS_COLS;
