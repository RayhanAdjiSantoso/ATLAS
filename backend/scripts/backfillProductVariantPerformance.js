// One-off backfill: run the new variant-level loader
// (loadProductVariantPerformance) against every already-uploaded
// product_performance file, since that data was never imported before this
// loader existed. Safe to re-run (INSERT ... ON CONFLICT DO NOTHING).
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../src/config/db.js';
import { LookupResolver } from '../src/services/import/lookupResolver.js';
import { loadProductVariantPerformance, resolvePeriodId } from '../src/services/import/loaders/productPerformance.js';

const backendDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function main() {
  const { rows: uploads } = await pool.query(
    `SELECT upload_id, brand_id, stored_path FROM public.uploads
     WHERE file_type = 'product_performance' AND status = 'success'`,
  );

  console.log(`Found ${uploads.length} product_performance upload(s) to backfill.`);

  for (const upload of uploads) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET search_path TO shopee, public');

      const resolver = new LookupResolver(client);
      const filepath = path.join(backendDir, upload.stored_path);
      const periodId = await resolvePeriodId(client, resolver, filepath, upload.brand_id);

      if (!periodId) {
        console.warn(`  brand ${upload.brand_id}: could not resolve period_id, skipping.`);
        await client.query('ROLLBACK');
        continue;
      }

      const inserted = await loadProductVariantPerformance(
        client, resolver, filepath, upload.brand_id, upload.upload_id, periodId,
      );

      await client.query('COMMIT');
      console.log(`  brand ${upload.brand_id}: ${inserted} variant-performance rows inserted (period_id=${periodId}).`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  brand ${upload.brand_id}: FAILED - ${err.message}`);
    } finally {
      client.release();
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
