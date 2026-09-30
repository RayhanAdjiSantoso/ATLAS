/**
 * purgeNonAtlasData.js — deletes every Internal Dashboard row that did NOT
 * come from ATLAS itself.
 *
 * User decision 2026-09-30: the Internal Dashboard shows only data from
 * ATLAS (Daily Tracking, Pengaturan Brand's Meta Ads Auto Fetch and Meta
 * Ads Automation). Rows typed into the removed "Input Data" tab, loaded by
 * one-shot scripts, or written by the retired Google Sheets sync go:
 *
 *   client_monthly_metrics / client_channel_sales_monthly /
 *   client_channel_sales_other / client_platform_spend_monthly
 *       -> every row whose source <> 'atlas_daily_tracking'
 *   client_sales_channels  -> all rows (typed in / derived from the roster
 *                             sheet; channel usage is now read from sales data)
 *   brand_ad_accounts      -> rows not copied from Meta Ads Automation
 *                             (synced_at IS NULL)
 *
 * data_ingestion_log is kept (audit trail). brands master data (status,
 * industry, sub-industry, PIC, BM ID, join date) is NOT touched — see the
 * report printed at the end.
 *
 *   node scripts/purgeNonAtlasData.js            # report only (dry run)
 *   node scripts/purgeNonAtlasData.js --commit   # delete
 */

import dotenv from 'dotenv';

dotenv.config();

const { default: pool } = await import('../src/config/db.js');

const COMMIT = process.argv.includes('--commit');

const STEPS = [
  { table: 'client_monthly_metrics', where: "source::text <> 'atlas_daily_tracking'" },
  { table: 'client_channel_sales_monthly', where: "source::text <> 'atlas_daily_tracking'" },
  { table: 'client_channel_sales_other', where: "source::text <> 'atlas_daily_tracking'" },
  { table: 'client_platform_spend_monthly', where: "source::text <> 'atlas_daily_tracking'" },
  { table: 'client_sales_channels', where: 'TRUE' },
  { table: 'brand_ad_accounts', where: 'synced_at IS NULL' },
];

const client = await pool.connect();
try {
  await client.query('BEGIN');
  console.log(COMMIT ? 'Menghapus data non-ATLAS…\n' : 'DRY RUN — yang akan dihapus:\n');
  for (const step of STEPS) {
    const hasSource = step.where.startsWith('source');
    const { rows } = await client.query(
      `SELECT b.brand_name, ${hasSource ? 'f.source::text' : "'-'"} AS source, count(*)::int AS n
       FROM ${step.table} f JOIN brands b USING (brand_id)
       WHERE ${step.where.replace(/^source/, 'f.source').replace('synced_at', 'f.synced_at')}
       GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    const total = rows.reduce((s, r) => s + r.n, 0);
    console.log(`${step.table}: ${total} baris`);
    if (rows.length > 15) console.log(`    (${rows.length} brand)`);
    else for (const r of rows) console.log(`    ${r.brand_name.padEnd(24)} ${r.source.padEnd(14)} ${r.n}`);
    if (COMMIT && total) await client.query(`DELETE FROM ${step.table} WHERE ${step.where}`);
  }

  const { rows: [master] } = await client.query(
    `SELECT count(*) FILTER (WHERE industry IS NOT NULL OR sub_industry IS NOT NULL)::int AS with_industry,
            count(*) FILTER (WHERE bm_id IS NOT NULL)::int AS with_bm, count(*) FILTER (WHERE pic IS NOT NULL)::int AS with_pic,
            count(*) FILTER (WHERE join_date IS NOT NULL)::int AS with_join
     FROM brands`,
  );
  console.log(`\nTidak dihapus — master brand (asal: migrasi sekali dari roster "Client info"): industry/sub-industry ${master.with_industry}, BM ID ${master.with_bm}, PIC ${master.with_pic}, join_date ${master.with_join} brand.`);

  await client.query(COMMIT ? 'COMMIT' : 'ROLLBACK');
  console.log(COMMIT
    ? '\nSelesai. Jalankan scripts/refreshMetaAccounts.js lalu scripts/syncDailyTracking.js --all untuk mengisi ulang dari ATLAS.'
    : '\nDry run — tidak ada yang diubah. Tambahkan --commit untuk menghapus.');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
  await pool.end();
}
