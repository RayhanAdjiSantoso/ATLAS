import pool from '../config/db.js';

const UPLOAD_LIST_QUERY = `
  SELECT
    u.upload_id,
    u.brand_id,
    b.brand_name,
    u.original_filename,
    u.file_type,
    u.period_start,
    u.period_end,
    u.uploaded_at,
    u.completed_at,
    u.status,
    u.error_message,
    u.rows_inserted,
    usr.user_id,
    usr.full_name AS uploaded_by,
    usr.email AS uploader_email
  FROM uploads u
  JOIN brands b ON b.brand_id = u.brand_id
  JOIN users usr ON usr.user_id = u.user_id
`;

export async function listUploads({ userId, role, filters = {} }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (role !== 'admin') {
    conditions.push(`u.user_id = $${idx++}`);
    params.push(userId);
  }

  if (filters.brand?.length > 0) {
    conditions.push(`b.brand_name = ANY($${idx++})`);
    params.push(filters.brand);
  }

  if (filters.fileType?.length > 0) {
    conditions.push(`u.file_type = ANY($${idx++})`);
    params.push(filters.fileType);
  }

  if (filters.userId?.length > 0 && role === 'admin') {
    conditions.push(`u.user_id = ANY($${idx++})`);
    params.push(filters.userId.map(Number));
  }

  if (filters.periodStart) {
    conditions.push(`u.period_start >= $${idx++}`);
    params.push(filters.periodStart);
  }

  if (filters.periodEnd) {
    conditions.push(`u.period_end <= $${idx++}`);
    params.push(filters.periodEnd);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query(
    `${UPLOAD_LIST_QUERY} ${where} ORDER BY u.uploaded_at DESC LIMIT 200`,
    params,
  );

  return result.rows;
}

export async function getUploadById(uploadId) {
  const result = await pool.query(
    `${UPLOAD_LIST_QUERY} WHERE u.upload_id = $1`,
    [uploadId],
  );
  return result.rows[0] ?? null;
}

// Separate from getUploadById/UPLOAD_LIST_QUERY on purpose -- stored_path is
// a server filesystem path and must never be exposed through the regular
// upload-list/detail responses, only used server-side to stream the file.
export async function getUploadFileById(uploadId) {
  const result = await pool.query(
    `SELECT upload_id, user_id, original_filename, stored_path
     FROM uploads
     WHERE upload_id = $1`,
    [uploadId],
  );
  return result.rows[0] ?? null;
}

export async function createUploadRecord({ uploadId, userId, brandId, fileType, filename, storedPath }) {
  const result = await pool.query(
    `INSERT INTO uploads (upload_id, user_id, brand_id, file_type, original_filename, stored_path, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING *`,
    [uploadId, userId, brandId, fileType, filename, storedPath],
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
      'SELECT stored_path FROM uploads WHERE upload_id = $1',
      [uploadId],
    );
    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    for (const table of FACT_TABLES_WITH_UPLOAD_ID) {
      await client.query(`DELETE FROM ${table} WHERE upload_id = $1`, [uploadId]);
    }

    await client.query('DELETE FROM uploads WHERE upload_id = $1', [uploadId]);

    await client.query('COMMIT');
    return existing.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listUsersForFilter() {
  const result = await pool.query(
    `SELECT user_id, full_name, email FROM users WHERE is_active = TRUE ORDER BY full_name`,
  );
  return result.rows;
}

export async function listBrandsForFilter() {
  const result = await pool.query(
    'SELECT DISTINCT brand_name FROM brands ORDER BY brand_name',
  );
  return result.rows.map((r) => r.brand_name);
}
