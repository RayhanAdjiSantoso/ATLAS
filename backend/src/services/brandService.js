import pool from '../config/db.js';

export async function listBrands() {
  const result = await pool.query(
    'SELECT brand_id, brand_name, status::text AS status FROM public.brands ORDER BY brand_name',
  );
  return result.rows;
}

export async function findBrandByName(brandName) {
  const result = await pool.query(
    'SELECT brand_id, brand_name, status::text AS status FROM public.brands WHERE LOWER(TRIM(brand_name)) = LOWER($1)',
    [brandName.trim()],
  );
  return result.rows[0] ?? null;
}

export async function createBrand(brandName) {
  // Serialize creation so two simultaneous case variants cannot bypass the
  // name check. Existing case-sensitive DB uniqueness remains a final guard.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(847201)");
    const existing = await client.query('SELECT brand_id FROM public.brands WHERE LOWER(TRIM(brand_name)) = LOWER($1)', [brandName.trim()]);
    if (existing.rowCount) {
      const error = new Error('Brand sudah terdaftar');
      error.code = '23505';
      throw error;
    }
    const result = await client.query(
      "INSERT INTO public.brands (brand_name, status) VALUES ($1, 'active') RETURNING brand_id, brand_name, status::text AS status",
      [brandName.trim()],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

export async function updateBrandStatus(brandId, status) {
  const result = await pool.query(
    'UPDATE public.brands SET status = $2::public.brand_status WHERE brand_id = $1 RETURNING brand_id, brand_name, status::text AS status',
    [brandId, status],
  );
  return result.rows[0] ?? null;
}

export async function getBrandById(brandId) {
  const result = await pool.query(
    'SELECT brand_id, brand_name, status::text AS status FROM public.brands WHERE brand_id = $1',
    [brandId],
  );
  return result.rows[0] ?? null;
}
