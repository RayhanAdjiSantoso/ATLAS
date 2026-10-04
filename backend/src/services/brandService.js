import pool from '../config/db.js';

export async function listBrands(allowedBrandId) {
  if (allowedBrandId) {
    const result = await pool.query(
      'SELECT brand_id, brand_name, status::text AS status FROM public.brands WHERE brand_id = $1 ORDER BY brand_name',
      [allowedBrandId],
    );
    return result.rows;
  }
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

/* ── Deleting a brand ──────────────────────────────────────────────────────
   A brand row is referenced from ~45 tables. Most cascade, so a plain DELETE
   would silently take a client's files, daily tracking and ad history with
   it. Deleting is therefore only for a brand that holds no data — a
   duplicate or a mistyped name. Anything that is data blocks it (the user
   is told what, and pointed at "Nonaktif"); a brand's own light settings go
   with it; logs keep their rows with the brand set to NULL. The table list
   is read from the database's foreign keys, so a table added later is
   covered without touching this. */

// Settings that belong to the brand alone and are removed with it.
const LIGHT_TABLES = new Set([
  'public.brand_profiles',
  'public.brand_monthly_targets',
  'public.daily_tracking_channels',
  'public.client_sales_channels',
  'public.brand_sheet_sources',
  'public.meta_ads_fetch_config',
  'public.google_ads_conversion_goal_map',
]);

const REFERENCE_LABELS = [
  [/^ads_reports\.brand_library_files$/, 'File di Data Brand'],
  [/^ads_reports\.report_runs$/, 'Laporan tersimpan (Riwayat Laporan)'],
  [/^ads_reports\.ai_summaries$/, 'AI Consultant Brief'],
  [/^ads_reports\.product_master$/, 'Referensi kategori produk'],
  [/^ads_reports\./, 'Data laporan'],
  [/^public\.brand_minutes$/, 'Catatan meeting (MOM)'],
  [/^public\.brand_ad_accounts$/, 'Ad account Meta Automation'],
  [/^public\.(client_|daily_channel_|daily_tracking_)/, 'Data Daily Tracking'],
  [/^public\.google_ads_/, 'Data Google Ads'],
  [/^public\.meta_ads_/, 'Data Meta Ads auto-fetch'],
  [/^public\.uploads$/, 'Riwayat upload'],
  [/^public\.users$/, 'Akun klien yang terikat ke brand ini'],
  [/^public\.brand_profiles$/, 'Brand context & current direction'],
  [/^public\.brand_monthly_targets$/, 'Target bulanan'],
  [/^shopee\./, 'Data penjualan Shopee (Business Overview)'],
];
const labelFor = (table) => REFERENCE_LABELS.find(([re]) => re.test(table))?.[1] ?? table;

let referenceTables = null;
async function listReferenceTables(db) {
  if (referenceTables) return referenceTables;
  const { rows } = await db.query(`
    SELECT DISTINCT tc.table_schema AS s, tc.table_name AS t, kcu.column_name AS col, rc.delete_rule AS rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_schema = 'public' AND ccu.table_name = 'brands'`);
  referenceTables = rows;
  return rows;
}

// What a brand still has, grouped for people: `blocking` stops a delete,
// `cleared` is removed with the brand.
export async function getBrandReferences(brandId, db = pool) {
  const tables = await listReferenceTables(db);
  const blocking = new Map();
  const cleared = new Map();
  for (const { s, t, col, rule } of tables) {
    if (rule === 'SET NULL') continue;
    const name = `${s}.${t}`;
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM "${s}"."${t}" WHERE "${col}" = $1`, [brandId]);
    if (!rows[0].n) continue;
    const bucket = LIGHT_TABLES.has(name) ? cleared : blocking;
    const label = labelFor(name);
    bucket.set(label, (bucket.get(label) ?? 0) + rows[0].n);
  }
  const list = (m) => [...m].map(([label, count]) => ({ label, count }));
  return { blocking: list(blocking), cleared: list(cleared) };
}

// Deletes the brand only if it still holds no data, checked again inside the
// transaction so a file uploaded a moment ago cannot be swept away.
export async function deleteBrand(brandId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT brand_id, brand_name FROM public.brands WHERE brand_id = $1 FOR UPDATE', [brandId]);
    if (!found.rowCount) {
      await client.query('ROLLBACK');
      return { deleted: false, notFound: true };
    }
    const refs = await getBrandReferences(brandId, client);
    if (refs.blocking.length) {
      await client.query('ROLLBACK');
      return { deleted: false, ...refs };
    }
    await client.query('DELETE FROM public.brands WHERE brand_id = $1', [brandId]);
    await client.query('COMMIT');
    return { deleted: true, brand: found.rows[0], ...refs };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
