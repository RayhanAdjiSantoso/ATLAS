// Moves files' bytes still held in Postgres (BYTEA) to Cloudflare R2, one
// row at a time, so Neon stops storing and serving them (migration 051,
// src/services/fileStore.js).
//
//   node scripts/moveFilesToR2.js                 # dry run: what would move
//   node scripts/moveFilesToR2.js --apply         # move everything
//   node scripts/moveFilesToR2.js --apply --limit 5 --table library
//
// Run it only once the code that reads storage_key is deployed AND the R2_*
// variables are set where it runs (Vercel): a moved row is readable only by
// that code.
//
// Per row: upload the bytes, read them back and compare, then set
// storage_key and clear the BYTEA column in one UPDATE that checks the row
// still holds the same bytes (a file replaced meanwhile is left alone and its
// object removed). A crash leaves at most an unreferenced object, never a row
// without its bytes. Re-running skips rows already moved.
//
// Library-imported uploads (public.uploads rows whose bytes duplicate the
// brand library file they were imported from) are not uploaded: their copy is
// simply cleared, since readers fall back to the library row.

import 'dotenv/config';
import pool from '../src/config/db.js';
import * as fileStore from '../src/services/fileStore.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limit = Number(args[args.indexOf('--limit') + 1]) || Infinity;
const only = args.includes('--table') ? args[args.indexOf('--table') + 1] : null;

const TABLES = [
  {
    name: 'library', table: 'ads_reports.brand_library_files', id: 'id', bytes: 'raw_file',
    pick: 'SELECT id, brand_id, original_filename AS name FROM ads_reports.brand_library_files WHERE raw_file IS NOT NULL AND storage_key IS NULL ORDER BY id',
    key: (r) => fileStore.keys.library(r.brand_id, r.name),
  },
  {
    // Copies of library files: cleared, not uploaded.
    name: 'uploads-dup', table: 'public.uploads', id: 'upload_id', bytes: 'raw_file', clearOnly: true,
    pick: `SELECT u.upload_id AS id FROM public.uploads u
           JOIN ads_reports.brand_library_files l ON l.dashboard_upload_id = u.upload_id
           WHERE u.raw_file IS NOT NULL AND u.storage_key IS NULL AND (l.raw_file IS NOT NULL OR l.storage_key IS NOT NULL)
           ORDER BY u.upload_id`,
  },
  {
    name: 'uploads', table: 'public.uploads', id: 'upload_id', bytes: 'raw_file',
    pick: `SELECT u.upload_id AS id, u.original_filename AS name FROM public.uploads u
           WHERE u.raw_file IS NOT NULL AND u.storage_key IS NULL
             AND NOT EXISTS (SELECT 1 FROM ads_reports.brand_library_files l WHERE l.dashboard_upload_id = u.upload_id)
           ORDER BY u.upload_id`,
    key: (r) => fileStore.keys.upload(r.id, r.name),
  },
  {
    name: 'report-runs', table: 'ads_reports.raw_uploads', id: 'id', bytes: 'raw_file',
    pick: 'SELECT id, report_run_id, original_filename AS name FROM ads_reports.raw_uploads WHERE raw_file IS NOT NULL AND storage_key IS NULL ORDER BY id',
    key: (r) => fileStore.keys.reportRun(r.report_run_id, r.name),
  },
  {
    name: 'homepage', table: 'public.homepage_media', id: 'id', bytes: 'data',
    pick: 'SELECT id, mime FROM public.homepage_media WHERE data IS NOT NULL AND storage_key IS NULL ORDER BY id',
    key: (r) => fileStore.keys.homepage(r.mime),
    contentType: (r) => r.mime,
  },
];

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

async function moveTable(t) {
  const { rows } = await pool.query(t.pick);
  const todo = rows.slice(0, limit);
  const { rows: [{ bytes }] } = await pool.query(
    `SELECT COALESCE(sum(octet_length(${t.bytes})), 0)::bigint AS bytes FROM ${t.table} WHERE ${t.id} = ANY($1)`,
    [todo.map((r) => r.id)],
  );
  console.log(`${t.name}: ${todo.length} of ${rows.length} rows, ${mb(Number(bytes))}${t.clearOnly ? ' (duplicates — cleared only)' : ''}`);
  if (!apply) return { moved: 0, bytes: 0 };

  let moved = 0;
  let movedBytes = 0;
  for (const r of todo) {
    const { rows: [row] } = await pool.query(`SELECT ${t.bytes} AS b, md5(${t.bytes}) AS sum FROM ${t.table} WHERE ${t.id} = $1`, [r.id]);
    if (!row?.b) continue;
    let key = null;
    if (!t.clearOnly) {
      key = t.key(r);
      await fileStore.putBytes(key, row.b, t.contentType?.(r) ?? 'application/octet-stream');
      const back = await fileStore.getBytes(key);
      if (!back.equals(row.b)) {
        await fileStore.deleteBytes(key).catch(() => {});
        throw new Error(`${t.name} ${r.id}: R2 copy differs from the original — stopped`);
      }
    }
    const res = await pool.query(
      `UPDATE ${t.table} SET storage_key = $2, ${t.bytes} = NULL
        WHERE ${t.id} = $1 AND storage_key IS NULL AND md5(${t.bytes}) = $3`,
      [r.id, key, row.sum],
    );
    if (!res.rowCount) {
      if (key) await fileStore.deleteBytes(key).catch(() => {});
      console.log(`  skipped ${r.id} (changed meanwhile)`);
      continue;
    }
    moved += 1;
    movedBytes += row.b.length;
    if (moved % 25 === 0) console.log(`  ${t.name}: ${moved}/${todo.length}`);
  }
  console.log(`  ${t.name}: moved ${moved}, ${mb(movedBytes)} out of Postgres`);
  return { moved, bytes: movedBytes };
}

if (!fileStore.isEnabled()) {
  console.error('R2_* is not configured — nothing to move to.');
  process.exit(1);
}
console.log(apply ? 'APPLY — moving bytes to R2' : 'DRY RUN — add --apply to move');
let total = 0;
for (const t of TABLES.filter((x) => !only || x.name === only)) total += (await moveTable(t)).bytes;
if (apply) console.log(`Done: ${mb(total)} moved. Neon frees the space after autovacuum; run VACUUM on these tables to hurry it.`);
await pool.end();
