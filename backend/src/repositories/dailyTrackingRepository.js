import pool from '../config/db.js';

// All queries take an optional `db` so the service can pass a checked-out
// client and run a fact upsert + its daily_tracking_ingestion_log row in one
// transaction. Defaults to the shared pool for plain reads. Dates are cast
// `::text` in SELECTs (same reasoning as reportGenerator/reports.js) so a
// DATE column never shifts a day under a timezone-aware driver.

// ---------------------------------------------------------------------
// daily_tracking_channels — custom ("+ Tambah Channel Baru") channels only
// ---------------------------------------------------------------------
export async function listCustomChannels(brandId, kind, db = pool) {
  const { rows } = await db.query(
    `SELECT channel_key, label FROM daily_tracking_channels
     WHERE brand_id = $1 AND kind = $2
     ORDER BY label`,
    [brandId, kind],
  );
  return rows;
}

export async function insertCustomChannel(v, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO daily_tracking_channels (brand_id, kind, channel_key, label, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING channel_key, label`,
    [v.brandId, v.kind, v.channelKey, v.label, v.userId ?? null],
  );
  return rows[0];
}

// ---------------------------------------------------------------------
// daily_channel_sales
// ---------------------------------------------------------------------
export async function listSalesForMonth(brandId, startDate, endDate, db = pool) {
  const { rows } = await db.query(
    `SELECT entry_date::text AS entry_date, channel_key, revenue, qty_sold, transaksi
     FROM daily_channel_sales
     WHERE brand_id = $1 AND entry_date >= $2 AND entry_date <= $3`,
    [brandId, startDate, endDate],
  );
  return rows;
}

export async function upsertSalesEntry(v, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO daily_channel_sales
       (brand_id, entry_date, channel_key, revenue, qty_sold, transaksi, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (brand_id, entry_date, channel_key) DO UPDATE SET
       revenue    = EXCLUDED.revenue,
       qty_sold   = EXCLUDED.qty_sold,
       transaksi  = EXCLUDED.transaksi,
       updated_by = EXCLUDED.updated_by
     RETURNING daily_channel_sale_id AS id, (xmax::text = '0') AS was_insert`,
    [v.brandId, v.entryDate, v.channelKey, v.revenue, v.qtySold, v.transaksi, v.userId],
  );
  return rows[0];
}

// ---------------------------------------------------------------------
// daily_channel_spend
// ---------------------------------------------------------------------
export async function listSpendForMonth(brandId, startDate, endDate, db = pool) {
  const { rows } = await db.query(
    `SELECT entry_date::text AS entry_date, channel_key, amount_spent,
            source, locked_manual, synced_at
     FROM daily_channel_spend
     WHERE brand_id = $1 AND entry_date >= $2 AND entry_date <= $3`,
    [brandId, startDate, endDate],
  );
  return rows;
}

// A human save. Always wins: source='manual', locked_manual=TRUE, regardless
// of whatever a Meta sync last wrote.
export async function upsertManualSpendEntry(v, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO daily_channel_spend
       (brand_id, entry_date, channel_key, amount_spent, source, locked_manual, created_by, updated_by)
     VALUES ($1, $2, $3, $4, 'manual', TRUE, $5, $5)
     ON CONFLICT (brand_id, entry_date, channel_key) DO UPDATE SET
       amount_spent  = EXCLUDED.amount_spent,
       source        = 'manual',
       locked_manual = TRUE,
       updated_by    = EXCLUDED.updated_by
     RETURNING daily_channel_spend_id AS id, (xmax::text = '0') AS was_insert`,
    [v.brandId, v.entryDate, v.channelKey, v.amountSpent, v.userId],
  );
  return rows[0];
}

// A Meta-sync write (scheduled ingest or the manual "Sync Meta Sekarang"
// button). Silently skipped by Postgres if the row is locked_manual — no rows
// come back for a skipped channel, which the service uses to report
// applied vs. skipped per channel.
export async function upsertApiSpendEntry(v, db = pool) {
  const { rows } = await db.query(
    `INSERT INTO daily_channel_spend
       (brand_id, entry_date, channel_key, amount_spent, source, locked_manual, synced_at, created_by, updated_by)
     VALUES ($1, $2, $3, $4, 'meta_api', FALSE, now(), $5, $5)
     ON CONFLICT (brand_id, entry_date, channel_key) DO UPDATE SET
       amount_spent = EXCLUDED.amount_spent,
       source       = 'meta_api',
       synced_at    = now()
     WHERE daily_channel_spend.locked_manual = FALSE
     RETURNING daily_channel_spend_id AS id, channel_key`,
    [v.brandId, v.entryDate, v.channelKey, v.amountSpent, v.userId ?? null],
  );
  return rows[0] ?? null; // null => skipped, row is locked_manual
}

// ---------------------------------------------------------------------
// daily_tracking_ingestion_log
// ---------------------------------------------------------------------
export async function logIngestion(v, db = pool) {
  await db.query(
    `INSERT INTO daily_tracking_ingestion_log
       (brand_id, target_table, entry_date, source, row_count, status, note, pic, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [v.brandId, v.targetTable, v.entryDate ?? null, v.source, v.rowCount, v.status, v.note ?? null, v.pic ?? null, v.performedBy ?? null],
  );
}
