// Moves saved Report Generator rows still in meta_ad_rows / shopee_ad_rows /
// tiktok_ad_rows into R2 row sets (migration 052, src/services/reportRowsets.js).
//
//   node scripts/moveReportRowsToR2.js                    # dry run
//   node scripts/moveReportRowsToR2.js --apply            # move every report
//   node scripts/moveReportRowsToR2.js --apply --limit 3  # the first three
//
// Run it only once the code that reads report_run_rowsets is deployed.
//
// One report at a time, inside a transaction that locks its report_runs row
// (a save of the same report waits, and a report saved meanwhile is skipped):
// write each (period, channel) set, read it back and compare it with the
// rows, record the sets, delete the rows. Any mismatch or error rolls the
// report back and removes the objects it wrote; nothing is deleted before
// its copy has been read back identical.

import 'dotenv/config';
import pool from '../src/config/db.js';
import * as fileStore from '../src/services/fileStore.js';
import * as rowsets from '../src/services/reportRowsets.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity;

if (!fileStore.isEnabled()) {
  console.error('R2_* is not configured — nothing to move to.');
  process.exit(1);
}

const { rows: runs } = await pool.query(`
  SELECT rr.id, rr.platform::text AS platform FROM ads_reports.report_runs rr
  WHERE EXISTS (SELECT 1 FROM ads_reports.meta_ad_rows x WHERE x.report_run_id = rr.id)
     OR EXISTS (SELECT 1 FROM ads_reports.shopee_ad_rows x WHERE x.report_run_id = rr.id)
     OR EXISTS (SELECT 1 FROM ads_reports.tiktok_ad_rows x WHERE x.report_run_id = rr.id)
  ORDER BY rr.id`);
const todo = runs.slice(0, limit);
console.log(`${apply ? 'APPLY' : 'DRY RUN'} — ${todo.length} of ${runs.length} reports hold rows in Postgres`);
if (!apply) { await pool.end(); process.exit(0); }

let moved = 0;
let movedRows = 0;
for (const run of todo) {
  const table = rowsets.ROW_TABLES[run.platform];
  const client = await pool.connect();
  const written = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM ads_reports.report_runs WHERE id = $1 FOR UPDATE', [run.id]);
    const { rows } = await client.query(
      `SELECT period_role, ${run.platform === 'tiktok' ? '' : 'channel, '}extra FROM ${table} WHERE report_run_id = $1 ORDER BY id`,
      [run.id],
    );
    if (!rows.length) { await client.query('ROLLBACK'); continue; }
    const groups = rowsets.groupRows(run.platform, rows.map((r) => ({ periodRole: r.period_role, channel: r.channel, extra: r.extra })));
    for (const g of groups) {
      const body = rowsets.__test.pack(g.extras);
      const key = `report-rows/${run.id}/${g.role}-${String(g.channel).replace(/[^\w-]+/g, '_')}-${crypto.randomUUID()}.json.gz`;
      await fileStore.putBytes(key, body, 'application/gzip');
      written.push(key);
      const back = rowsets.__test.unpack(await fileStore.getBytes(key));
      if (JSON.stringify(back) !== JSON.stringify(g.extras)) throw new Error(`set ${g.role}/${g.channel} read back different`);
      await client.query(
        `INSERT INTO ads_reports.report_run_rowsets (report_run_id, period_role, channel, row_count, byte_size, storage_key, seq)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [run.id, g.role, g.channel, g.extras.length, body.length, key, g.seq],
      );
    }
    const del = await client.query(`DELETE FROM ${table} WHERE report_run_id = $1`, [run.id]);
    if (del.rowCount !== rows.length) throw new Error(`expected to delete ${rows.length} rows, found ${del.rowCount}`);
    await client.query('COMMIT');
    moved += 1;
    movedRows += rows.length;
    console.log(`  report ${run.id} (${run.platform}): ${rows.length} rows → ${groups.length} sets`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    for (const key of written) await fileStore.deleteBytes(key).catch(() => {});
    console.error(`  report ${run.id}: left as it was — ${err.message}`);
  } finally {
    client.release();
  }
}
console.log(`Done: ${moved} reports, ${movedRows} rows moved to R2.`);
await pool.end();
