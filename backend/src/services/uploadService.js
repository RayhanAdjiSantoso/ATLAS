import pool from '../config/db.js';
import * as fileStore from './fileStore.js';
import { refreshInternalDashboard } from './internalDashboardSync/dailyTrackingSync.js';

// `rawFile` is kept (in R2 when configured, else in the row) for reading the
// month back later (monthlyShopStats). A file imported from the brand library
// passes null: the library row already holds those bytes.
export async function createUploadRecord({ uploadId, userId, brandId, fileType, filename, rawFile }) {
  const stored = await fileStore.storeBytes(fileStore.keys.upload(uploadId, filename), rawFile ?? null);
  try {
    const result = await pool.query(
      `INSERT INTO uploads (upload_id, user_id, brand_id, file_type, original_filename, raw_file, storage_key, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING upload_id, user_id, brand_id, file_type, original_filename, status, storage_key`,
      [uploadId, userId, brandId, fileType, filename, stored.rawFile, stored.storageKey],
    );
    return result.rows[0];
  } catch (err) {
    await fileStore.deleteBytes(stored.storageKey).catch(() => {});
    throw err;
  }
}

const FACT_TABLES_WITH_UPLOAD_ID = [
  'shopee.orders',
  'shopee.daily_order_performance',
  'shopee.product_performance_summary',
  'shopee.daily_channel_performance',
  'shopee.channel_product_contribution',
  'shopee.product_variant_performance',
];

export async function deleteUpload(uploadId) {
  const client = await pool.connect();
  let archivedKey = null; // a Report Generator file's object in R2
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT stored_path, source, raw_upload_id, brand_id, file_type, storage_key FROM uploads WHERE upload_id = $1',
      [uploadId],
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    if (existing.rows[0].source === 'report_generator') {
      // Delete just this one file's archive (ads_reports.raw_uploads), not
      // the whole saved report -- "Riwayat Laporan" inside Report
      // Generator is the place to delete an entire comparison. The
      // uploads row itself is then gone too via ON DELETE CASCADE (see
      // 007_uploads_report_generator_source.sql); no separate DELETE FROM
      // uploads needed or possible here.
      if (existing.rows[0].raw_upload_id) {
        const gone = await client.query('DELETE FROM ads_reports.raw_uploads WHERE id = $1 RETURNING storage_key', [existing.rows[0].raw_upload_id]);
        archivedKey = gone.rows[0]?.storage_key ?? null;
      } else {
        await client.query('DELETE FROM uploads WHERE upload_id = $1', [uploadId]);
      }
    } else {
      for (const table of FACT_TABLES_WITH_UPLOAD_ID) {
        await client.query(`DELETE FROM ${table} WHERE upload_id = $1`, [uploadId]);
      }
      await client.query('DELETE FROM uploads WHERE upload_id = $1', [uploadId]);
    }

    await client.query('COMMIT');
    for (const key of [existing.rows[0].storage_key, archivedKey]) if (key) await fileStore.deleteBytes(key).catch(() => {});
    // Performance Overview feeds the Internal Dashboard's Shopee Ads funnel.
    if (existing.rows[0].file_type === 'performance_overview' && existing.rows[0].brand_id) {
      await refreshInternalDashboard(existing.rows[0].brand_id);
    }
    return existing.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
