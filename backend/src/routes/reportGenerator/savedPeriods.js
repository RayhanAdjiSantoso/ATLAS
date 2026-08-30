import { Router } from 'express';
import pool from '../../config/db.js';

// Ported from the standalone report generator (src/routes/savedPeriods.ts).
// Logic unchanged — TypeScript types stripped, shared ATLAS pool used, and
// the report_runs period columns are cast to ::text for the same reason
// reports.js casts them (see that file's header comment).
export const savedPeriodsRouter = Router();

const PLATFORMS = ['meta', 'shopee', 'tiktok'];

// Fact table + whether it carries a `channel` column, per platform. Values
// are literals from this map only — never request input — so interpolating
// them into the SQL below is safe.
const FACT_TABLE = {
  shopee: { table: 'ads_reports.shopee_ad_rows', hasChannel: true },
  meta: { table: 'ads_reports.meta_ad_rows', hasChannel: true },
  tiktok: { table: 'ads_reports.tiktok_ad_rows', hasChannel: false },
};

// GET /api/report-generator/saved-periods?client_id=<id>&platform=<meta|shopee|tiktok>
//
// Every distinct period this client has stored for the platform, derived
// from report_runs (each run contributes its `old` and its `cur` side) plus
// a per-channel row-count summary from the fact table. Scoped to the client
// (never leaks another brand's data), newest save first. Not de-duplicated
// by date range on purpose — the same calendar month can be stored more
// than once with different channel coverage, and the picker shows every
// instance so the user can pick the richest one.
savedPeriodsRouter.get('/', async (req, res) => {
  const clientId = req.query.client_id ? Number(req.query.client_id) : null;
  const platform = typeof req.query.platform === 'string' ? req.query.platform : null;
  if (!clientId || !Number.isFinite(clientId)) {
    res.status(400).json({ error: 'client_id is required' });
    return;
  }
  if (!platform || !PLATFORMS.includes(platform)) {
    res.status(400).json({ error: 'platform must be one of: meta, shopee, tiktok' });
    return;
  }

  const runs = await pool.query(
    `SELECT id,
            period_old_start::text AS period_old_start, period_old_end::text AS period_old_end, period_old_label,
            period_cur_start::text AS period_cur_start, period_cur_end::text AS period_cur_end, period_cur_label,
            updated_at
     FROM ads_reports.report_runs
     WHERE brand_id = $1 AND platform = $2::ads_reports.platform_enum
     ORDER BY updated_at DESC`,
    [clientId, platform],
  );
  if (!runs.rows.length) {
    res.json([]);
    return;
  }

  const ids = runs.rows.map((r) => r.id);
  const { table, hasChannel } = FACT_TABLE[platform];
  const coverage = await pool.query(
    hasChannel
      ? `SELECT report_run_id, period_role, channel, count(*)::int AS n
         FROM ${table} WHERE report_run_id = ANY($1) GROUP BY report_run_id, period_role, channel`
      : `SELECT report_run_id, period_role, 'tiktok'::text AS channel, count(*)::int AS n
         FROM ${table} WHERE report_run_id = ANY($1) GROUP BY report_run_id, period_role`,
    [ids],
  );

  const covByRunRole = new Map();
  for (const c of coverage.rows) {
    const key = `${c.report_run_id}:${c.period_role}`;
    const map = covByRunRole.get(key) ?? {};
    map[c.channel] = c.n;
    covByRunRole.set(key, map);
  }

  const roles = ['old', 'cur'];
  const out = [];
  for (const r of runs.rows) {
    for (const role of roles) {
      const channels = covByRunRole.get(`${r.id}:${role}`) ?? {};
      const totalRows = Object.values(channels).reduce((a, b) => a + b, 0);
      if (!totalRows) continue; // this run never stored anything for this side
      out.push({
        runId: r.id,
        role,
        label: role === 'old' ? r.period_old_label : r.period_cur_label,
        start: role === 'old' ? r.period_old_start : r.period_cur_start,
        end: role === 'old' ? r.period_old_end : r.period_cur_end,
        savedAt: r.updated_at,
        sourceComparison: `${r.period_cur_label ?? '—'} vs ${r.period_old_label ?? '—'}`,
        channels,
        totalRows,
      });
    }
  }
  res.json(out);
});
