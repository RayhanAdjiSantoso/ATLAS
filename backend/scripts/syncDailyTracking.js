/**
 * syncDailyTracking.js — roll ATLAS Daily Tracking data up into the
 * Internal Dashboard's monthly tables from the command line (same code path
 * as the "Sync dari Daily Tracking" buttons).
 *
 *   node scripts/syncDailyTracking.js --all --dry-run      # preview every brand
 *   node scripts/syncDailyTracking.js --brand=45 --dry-run # preview one brand
 *   node scripts/syncDailyTracking.js --all                # write
 *
 * --dry-run runs the full sync inside a transaction and rolls it back:
 * nothing is written, not even the ingestion log.
 */

import dotenv from 'dotenv';

dotenv.config();

const { syncBrandFromDailyTracking, syncAllFromDailyTracking } = await import('../src/services/internalDashboardSync/dailyTrackingSync.js');
const { default: pool } = await import('../src/config/db.js');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const brandArg = args.find((a) => a.startsWith('--brand='));
const verbose = args.includes('--verbose');

function printResult(name, r) {
  console.log(`\n=== ${name} (brand ${r.brandId}) — ${r.status}${r.dryRun ? ' [DRY RUN]' : ''}`);
  console.log(`  bulan: ${r.monthsSynced.join(' ') || '-'} | baris ditulis: ${r.rowsWritten} | warning: ${r.warningCount}`);
  for (const o of r.overwrittenManual) console.log(`  MENIMPA MANUAL ${o.table} ${o.period}${o.key ? ` ${o.key}` : ''}: ${JSON.stringify(o.old)} -> ${JSON.stringify(o.new)}`);
  for (const o of r.replacedRetiredSource) console.log(`  ganti (${o.old_source}) ${o.table} ${o.period}${o.key ? ` ${o.key}` : ''}: ${JSON.stringify(o.old)} -> ${JSON.stringify(o.new)}`);
  for (const d of r.deletedStale) console.log(`  HAPUS (${d.source}) ${d.table} ${d.period} ${d.key}: ${d.value}`);
  for (const k of r.manualRowsKept) console.log(`  manual dipertahankan ${k.table} ${k.period} ${k.key}: ${k.value}`);
  const shown = verbose ? r.warnings : r.warnings.filter((w) => w.severity === 'warning' && w.code !== 'overwrote_manual');
  for (const w of shown) console.log(`  [${w.severity}] ${w.code}${w.period ? ` ${w.period}` : ''}: ${w.message}`);
}

try {
  if (brandArg) {
    printResult('brand', await syncBrandFromDailyTracking(Number(brandArg.split('=')[1]), null, { dryRun }));
  } else if (args.includes('--all')) {
    const s = await syncAllFromDailyTracking(null, { dryRun });
    for (const x of s.results) {
      if (x.ok) printResult(x.brandName, x.result);
      else console.log(`\n=== ${x.brandName} (brand ${x.brandId}) — GAGAL: ${x.error}`);
    }
    console.log(`\nTotal ${s.total}: ${s.succeeded} berhasil, ${s.failed} gagal${dryRun ? ' (dry run — tidak ada yang ditulis)' : ''}.`);
  } else {
    console.log('Pakai --all atau --brand=<id>, opsional --dry-run / --verbose.');
  }
} finally {
  await pool.end();
}
