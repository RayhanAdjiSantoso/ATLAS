import pool from '../config/db.js';
import { refreshInternalDashboard } from './internalDashboardSync/dailyTrackingSync.js';

export async function createUploadRecord({ uploadId, userId, brandId, fileType, filename, rawFile }) {
  const result = await pool.query(
    `INSERT INTO uploads (upload_id, user_id, brand_id, file_type, original_filename, raw_file, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING *`,
    [uploadId, userId, brandId, fileType, filename, rawFile],
  );
  return result.rows[0];
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
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT stored_path, source, raw_upload_id, brand_id, file_type FROM uploads WHERE upload_id = $1',
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
        await client.query('DELETE FROM ads_reports.raw_uploads WHERE id = $1', [existing.rows[0].raw_upload_id]);
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
