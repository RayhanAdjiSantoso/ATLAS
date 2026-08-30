import pool from '../config/db.js';

export async function listBrands() {
  const result = await pool.query(
    'SELECT brand_id, brand_name FROM brands ORDER BY brand_name',
  );
  return result.rows;
}

export async function findBrandByName(brandName) {
  const result = await pool.query(
    'SELECT brand_id, brand_name FROM brands WHERE LOWER(brand_name) = LOWER($1)',
    [brandName.trim()],
  );
  return result.rows[0] ?? null;
}

export async function createBrand(brandName) {
  const result = await pool.query(
    'INSERT INTO brands (brand_name) VALUES ($1) RETURNING brand_id, brand_name',
    [brandName.trim()],
  );
  return result.rows[0];
}

export async function getBrandById(brandId) {
  const result = await pool.query(
    'SELECT brand_id, brand_name FROM brands WHERE brand_id = $1',
    [brandId],
  );
  return result.rows[0] ?? null;
}
