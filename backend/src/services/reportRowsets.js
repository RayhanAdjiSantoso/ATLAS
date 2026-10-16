import zlib from 'node:zlib';
import { randomUUID } from 'node:crypto';
import * as fileStore from './fileStore.js';

// A saved Report Generator report's parsed rows (migration 052): one gzipped
// JSON array of the rows' original values (`extra`) per (report, period,
// channel), in R2 — the database keeps only ads_reports.report_run_rowsets.
// Reports saved before the move still hold their rows in the per-platform
// row tables; readers here return both, in the shape the app has always
// received ({ period_role, channel, extra }, in saved order).

export const ROW_TABLES = {
  shopee: 'ads_reports.shopee_ad_rows',
  meta: 'ads_reports.meta_ad_rows',
  tiktok: 'ads_reports.tiktok_ad_rows',
};
const NO_CHANNEL = 'tiktok'; // TikTok rows have no channel; their set is filed under this name

const pack = (list) => zlib.gzipSync(Buffer.from(JSON.stringify(list), 'utf8'));
const unpack = (buf) => JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
const objectKey = (runId, role, channel) => `report-rows/${runId}/${role}-${String(channel).replace(/[^\w-]+/g, '_')}-${randomUUID()}.json.gz`;

// Group rows by (period, channel), keeping their order within each group;
// `seq` is where a group's first row stood, so the groups read back in the
// order the rows were saved.
export function groupRows(platform, rows) {
  const groups = new Map();
  (rows ?? []).forEach((r, i) => {
    const channel = platform === 'tiktok' ? NO_CHANNEL : r.channel;
    const k = `${r.periodRole}\u0000${channel}`;
    if (!groups.has(k)) groups.set(k, { role: r.periodRole, channel, seq: i, extras: [] });
    groups.get(k).extras.push(r.extra ?? null);
  });
  return [...groups.values()];
}

// Write a report's rows as sets. Returns the new objects' keys (to remove if
// the surrounding transaction rolls back), or null when R2 is off or refused
// a write — the caller then stores the rows the old way.
export async function writeRowsets(client, runId, platform, rows) {
  if (!fileStore.isEnabled()) return null;
  const groups = groupRows(platform, rows);
  const written = [];
  try {
    for (const g of groups) {
      const body = pack(g.extras);
      const key = objectKey(runId, g.role, g.channel);
      await fileStore.putBytes(key, body, 'application/gzip');
      written.push({ ...g, key, size: body.length });
    }
  } catch (err) {
    console.warn(`[reportRowsets] R2 write failed for report ${runId}, keeping rows in Postgres:`, err?.name || err?.message);
    for (const w of written) await fileStore.deleteBytes(w.key).catch(() => {});
    return null;
  }
  for (const w of written) {
    await client.query(
      `INSERT INTO ads_reports.report_run_rowsets (report_run_id, period_role, channel, row_count, byte_size, storage_key, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [runId, w.role, w.channel, w.extras.length, w.size, w.key, w.seq],
    );
  }
  return written.map((w) => w.key);
}

// Remove a report's sets (rows only; returns the object keys to delete once
// the transaction commits).
export async function clearRowsets(client, runId) {
  const { rows } = await client.query('DELETE FROM ads_reports.report_run_rowsets WHERE report_run_id = $1 RETURNING storage_key', [runId]);
  return rows.map((r) => r.storage_key);
}

// A report's rows, optionally one period only: the sets in R2 plus any rows
// still in the old row table, as [{ period_role, channel, extra }].
export async function loadRows(db, runId, platform, role = null) {
  const params = role ? [runId, role] : [runId];
  const roleSql = role ? ' AND period_role = $2' : '';
  const { rows: sets } = await db.query(
    `SELECT period_role, channel, storage_key FROM ads_reports.report_run_rowsets
      WHERE report_run_id = $1${roleSql} ORDER BY seq`,
    params,
  );
  const fromSets = await Promise.all(sets.map(async (s) => {
    const extras = unpack(await fileStore.getBytes(s.storage_key));
    return extras.map((extra) => (platform === 'tiktok'
      ? { period_role: s.period_role, extra }
      : { period_role: s.period_role, channel: s.channel, extra }));
  }));
  const table = ROW_TABLES[platform];
  const legacy = table
    ? (await db.query(
      `SELECT period_role, ${platform === 'tiktok' ? '' : 'channel, '}extra FROM ${table} WHERE report_run_id = $1${roleSql} ORDER BY id`,
      params,
    )).rows
    : [];
  return [...fromSets.flat(), ...legacy];
}

// Row counts per (report, period, channel) for many reports at once.
export async function countRows(db, runIds, platform) {
  const table = ROW_TABLES[platform];
  const legacy = platform === 'tiktok'
    ? `SELECT report_run_id, period_role, '${NO_CHANNEL}'::text AS channel, count(*)::int AS n FROM ${table} WHERE report_run_id = ANY($1) GROUP BY 1, 2`
    : `SELECT report_run_id, period_role, channel, count(*)::int AS n FROM ${table} WHERE report_run_id = ANY($1) GROUP BY 1, 2, 3`;
  const { rows } = await db.query(
    `SELECT report_run_id, period_role, channel, sum(n)::int AS n FROM (
       SELECT report_run_id, period_role, channel, row_count AS n FROM ads_reports.report_run_rowsets WHERE report_run_id = ANY($1)
       UNION ALL ${legacy}
     ) x GROUP BY 1, 2, 3`,
    [runIds],
  );
  return rows;
}

export const __test = { pack, unpack, groupRows };
