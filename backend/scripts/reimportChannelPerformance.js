// One-off repair: rebuild shopee.daily_channel_performance with the fixed
// "Asal Penjualan" reader (loaders/performanceOverview.js).
//
// The old reader filed the "Live & Video Affiliate" section under Video
// Penjual and read the Iklan Shopee section with Halaman Produk's column
// order (orders landed in products_clicked, ad spend in products_ordered,
// ROAS in click_percentage). Every other channel was read correctly; the
// dry run confirms those rows come out identical.
//
// Per upload, in its own transaction:
//  - raw file stored  -> delete that upload's rows, re-run the loader on it.
//  - no raw file      -> remap the stored rows in place (every misplaced
//                        value is still there, just in the wrong column).
//
// Dry run by default; pass --apply to write.
import pool from '../src/config/db.js';
import { LookupResolver } from '../src/services/import/lookupResolver.js';
import { loadDailyChannelPerformance, parseDailyChannelRows } from '../src/services/import/loaders/performanceOverview.js';

const APPLY = process.argv.includes('--apply');

const AFFILIATE_SUBS = ['Live & Video Affiliate', 'Video Affiliate', 'Live Affiliate'];

async function remapInPlace(client, uploadId) {
  const affiliate = await client.query(`
    UPDATE daily_channel_performance d
    SET channel_id = (SELECT channel_id FROM traffic_channels WHERE channel_name = 'Affiliate'),
        sub_source_id = CASE WHEN s.sub_source_name = 'Live & Video Affiliate'
          THEN (SELECT sub_source_id FROM traffic_sub_sources WHERE sub_source_name = 'Semua')
          ELSE d.sub_source_id END
    FROM traffic_sub_sources s, traffic_channels c
    WHERE d.upload_id = $1
      AND s.sub_source_id = d.sub_source_id
      AND c.channel_id = d.channel_id AND c.channel_name = 'Video Penjual'
      AND s.sub_source_name = ANY($2)
  `, [uploadId, AFFILIATE_SUBS]);

  // Right-hand sides read the OLD values, so the swap happens in one pass.
  const ads = await client.query(`
    UPDATE daily_channel_performance d
    SET total_orders = d.products_clicked,
        products_clicked = 0,
        ad_spend_idr = NULLIF(d.products_ordered, 0),
        products_ordered = 0,
        roas = CASE WHEN d.click_percentage IS NOT NULL THEN d.click_percentage * 100 END,
        click_percentage = NULL,
        conversion_rate = CASE WHEN d.products_viewed > 0
          THEN ROUND(d.products_clicked::numeric / d.products_viewed, 4) END
    FROM traffic_channels c
    WHERE d.upload_id = $1
      AND c.channel_id = d.channel_id AND c.channel_name = 'Iklan Shopee'
      AND d.ad_spend_idr IS NULL AND d.roas IS NULL
  `, [uploadId]);

  return { affiliate: affiliate.rowCount, ads: ads.rowCount };
}

async function main() {
  const { rows: uploads } = await pool.query(`
    SELECT d.upload_id, d.brand_id, count(*)::int AS rows,
           COALESCE(u.raw_file, l.raw_file) AS raw_file
    FROM (SELECT upload_id, brand_id FROM shopee.daily_channel_performance) d
    JOIN public.uploads u ON u.upload_id = d.upload_id
    LEFT JOIN ads_reports.brand_library_files l ON l.dashboard_upload_id = u.upload_id
    GROUP BY d.upload_id, d.brand_id, u.raw_file, l.raw_file
    ORDER BY d.brand_id
  `);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${uploads.length} upload(s) with channel rows.`);

  for (const up of uploads) {
    const label = `brand ${up.brand_id} upload ${String(up.upload_id).slice(0, 8)}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET search_path TO shopee, public');

      if (up.raw_file) {
        const parsed = parseDailyChannelRows(up.raw_file);
        if (parsed.length === 0) throw new Error('file tidak berisi baris Asal Penjualan');
        const del = await client.query('DELETE FROM daily_channel_performance WHERE upload_id = $1', [up.upload_id]);
        const inserted = await loadDailyChannelPerformance(client, new LookupResolver(client), up.raw_file, up.brand_id, up.upload_id);
        console.log(`  ${label}: re-import dari file — hapus ${del.rowCount}, isi ${inserted} (hasil parse ${parsed.length})`);
      } else {
        const r = await remapInPlace(client, up.upload_id);
        console.log(`  ${label}: file asli tidak ada — remap di tempat: affiliate ${r.affiliate}, iklan ${r.ads}`);
      }

      await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ${label}: GAGAL — ${err.message}`);
      process.exitCode = 1;
    } finally {
      client.release();
    }
  }
  await pool.end();
}

main();
