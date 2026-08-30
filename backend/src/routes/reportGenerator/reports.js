import { Router } from 'express';
import multer from 'multer';
import pool from '../../config/db.js';
import { buildBulkInsert } from '../../utils/sqlHelpers.js';

// Ported from the standalone report generator (src/routes/reports.ts).
// Logic is unchanged from the original — see git history of the standalone
// repo for how this evolved — except:
//   1. TypeScript types stripped (plain JS here).
//   2. Uses ATLAS's shared `pool` (src/config/db.js) instead of its own —
//      same Postgres instance now, no reason for a second pool.
//   3. DATE columns read back out of ads_reports.report_runs are now cast
//      to ::text in SQL instead of relying on a process-wide
//      `pg.types.setTypeParser(1082, ...)` override (which the standalone
//      app had in its db.ts). That override is process-global — safe when
//      this was the only app in the process, but here it would silently
//      change how ATLAS's OWN date columns (shopee.*, uploads.period_*)
//      serialize too. Casting per-query is exactly the pattern ATLAS's own
//      dashboardRepository.js already uses for the same DATE-shift problem
//      (e.g. `report_date::text`), so this keeps the fix local instead of
//      reaching into shared runtime state.
export const reportsRouter = Router();

// fieldSize defaults to 1MB in multer, which the JSON `payload` field can
// exceed on large uploads (e.g. a Meta "Day" breakdown export has one row
// per campaign x age x gender x calendar day — thousands of rows, each kept
// verbatim in `extra` — easily well past 1MB once stringified).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, fieldSize: 25 * 1024 * 1024 } });

const PLATFORMS = ['meta', 'shopee', 'tiktok'];

const SHOPEE_COLUMNS = [
  'report_run_id',
  'period_role',
  'channel',
  'nama_iklan_raw',
  'nama_iklan_clean',
  'kode_produk',
  'category',
  'series',
  'kata_pencarian',
  'tanggal_mulai',
  'tanggal_selesai',
  'dilihat',
  'jumlah_klik',
  'ctr',
  'konversi',
  'konversi_langsung',
  'produk_terjual',
  'terjual_langsung',
  'omzet_penjualan',
  'penjualan_langsung',
  'biaya',
  'roas',
  'acos',
  'extra',
];

const META_COLUMNS = [
  'report_run_id',
  'period_role',
  'channel',
  'campaign_name',
  'month',
  'age',
  'gender',
  'amount_spent',
  'impressions',
  'clicks',
  'ctr',
  'purchases',
  'purchases_conversion_value',
  'roas',
  'extra',
];

const TIKTOK_COLUMNS = ['report_run_id', 'period_role', 'campaign_name', 'cost', 'sku_orders', 'gross_revenue', 'extra'];

function toJsonb(v) {
  return v ? JSON.stringify(v) : null;
}

// Shopee's Product Overview export writes its date column as "DD-MM-YYYY"
// text (same format lib/shopeeDeepDiveInsights.ts's tanggalDay() reads).
// Rows without a parseable date (e.g. a trailing total row) return null and
// are skipped.
function overviewDateToIso(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function shopeeRowValues(runId, r) {
  return [
    runId,
    r.periodRole,
    r.channel,
    r.namaIklanRaw,
    r.namaIklanClean,
    r.kodeProduk,
    r.category,
    r.series,
    r.kataPencarian,
    r.tanggalMulai,
    r.tanggalSelesai,
    r.dilihat,
    r.jumlahKlik,
    r.ctr,
    r.konversi,
    r.konversiLangsung,
    r.produkTerjual,
    r.terjualLangsung,
    r.omzetPenjualan,
    r.penjualanLangsung,
    r.biaya,
    r.roas,
    r.acos,
    toJsonb(r.extra),
  ];
}

function metaRowValues(runId, r) {
  return [
    runId,
    r.periodRole,
    r.channel,
    r.campaignName,
    r.month,
    r.age,
    r.gender,
    r.amountSpent,
    r.impressions,
    r.clicks,
    r.ctr,
    r.purchases,
    r.purchasesConversionValue,
    r.roas,
    toJsonb(r.extra),
  ];
}

function tiktokRowValues(runId, r) {
  return [runId, r.periodRole, r.campaignName, r.cost, r.skuOrders, r.grossRevenue, toJsonb(r.extra)];
}

const PLATFORM_LABEL = { meta: 'Meta Ads', shopee: 'Shopee Ads', tiktok: 'TikTok GMV Max' };

// Human label for the new History Upload "Sumber" column (public.uploads.
// report_channel) — e.g. "Meta Ads · boost", "Shopee Ads · produk". TikTok
// rows have no channel of their own (campaign-level only), so just the
// platform name.
function reportChannelLabel(platform, channel) {
  const label = PLATFORM_LABEL[platform] ?? platform;
  return channel && platform !== 'tiktok' ? `${label} · ${channel}` : label;
}

// Best-effort count of parsed rows this specific uploaded file contributed,
// for public.uploads.rows_inserted — matched by platform + channel +
// period_role, the same scope raw_uploads itself is keyed by. TikTok rows
// have no `channel` field (campaign-level only), and Shopee's Product
// Overview sheet isn't part of payload.rows.shopee at all (its own
// payload.rows.shopeeOverview, with neither channel nor periodRole).
function countRowsForFile(payload, meta) {
  if (payload.platform === 'shopee' && meta.channel === 'overview') {
    return (payload.rows.shopeeOverview ?? []).length;
  }
  const rows = payload.rows[payload.platform] ?? [];
  if (payload.platform === 'tiktok') {
    return rows.filter((r) => r.periodRole === meta.periodRole).length;
  }
  return rows.filter((r) => r.channel === meta.channel && r.periodRole === meta.periodRole).length;
}

function isValidPayload(body) {
  if (!body || typeof body !== 'object') return false;
  if (typeof body.brandId !== 'number') return false;
  if (typeof body.platform !== 'string' || !PLATFORMS.includes(body.platform)) return false;
  if (!body.period || typeof body.period !== 'object') return false;
  if (!body.rows || typeof body.rows !== 'object') return false;
  return true;
}

reportsRouter.post('/', upload.array('files'), async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.payload ?? '');
  } catch {
    res.status(400).json({ error: 'Invalid or missing "payload" field (must be JSON).' });
    return;
  }
  if (!isValidPayload(payload)) {
    res.status(400).json({ error: 'Payload missing required fields: brandId, platform, period, rows.' });
    return;
  }

  let fileMeta = [];
  if (req.body.fileMeta) {
    try {
      fileMeta = JSON.parse(req.body.fileMeta);
    } catch {
      res.status(400).json({ error: 'Invalid "fileMeta" field (must be JSON array).' });
      return;
    }
  }
  const files = req.files ?? [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const upsert = await client.query(
      `INSERT INTO ads_reports.report_runs
         (brand_id, platform, period_old_start, period_old_end, period_cur_start, period_cur_end, period_old_label, period_cur_label, report_config, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT ON CONSTRAINT ux_report_runs_scope
       DO UPDATE SET
         period_old_label = EXCLUDED.period_old_label,
         period_cur_label = EXCLUDED.period_cur_label,
         report_config = EXCLUDED.report_config,
         updated_at = now()
       RETURNING id`,
      [
        payload.brandId,
        payload.platform,
        payload.period.oldStart,
        payload.period.oldEnd,
        payload.period.curStart,
        payload.period.curEnd,
        payload.period.oldLabel,
        payload.period.curLabel,
        toJsonb(payload.reportConfig),
        req.user.userId,
      ],
    );
    const runId = upsert.rows[0].id;

    if (payload.platform === 'shopee') {
      await client.query('DELETE FROM ads_reports.shopee_ad_rows WHERE report_run_id = $1', [runId]);
      const insert = buildBulkInsert('ads_reports.shopee_ad_rows', SHOPEE_COLUMNS, (payload.rows.shopee ?? []).map((r) => shopeeRowValues(runId, r)));
      if (insert) await client.query(insert.text, insert.values);

      // Product Overview daily rows — brand-scoped, upserted by date (not
      // deleted-then-reinserted like the run-scoped tables above), so the
      // client's overview history accumulates across every report.
      for (const row of payload.rows.shopeeOverview ?? []) {
        const iso = overviewDateToIso(row.Tanggal);
        if (!iso) continue;
        await client.query(
          `INSERT INTO ads_reports.shopee_store_overview_daily (brand_id, tanggal, extra)
           VALUES ($1, $2, $3)
           ON CONFLICT ON CONSTRAINT ux_shopee_store_overview_daily
           DO UPDATE SET extra = EXCLUDED.extra`,
          [payload.brandId, iso, toJsonb(row)],
        );
      }
    } else if (payload.platform === 'meta') {
      await client.query('DELETE FROM ads_reports.meta_ad_rows WHERE report_run_id = $1', [runId]);
      const insert = buildBulkInsert('ads_reports.meta_ad_rows', META_COLUMNS, (payload.rows.meta ?? []).map((r) => metaRowValues(runId, r)));
      if (insert) await client.query(insert.text, insert.values);
    } else if (payload.platform === 'tiktok') {
      await client.query('DELETE FROM ads_reports.tiktok_ad_rows WHERE report_run_id = $1', [runId]);
      const insert = buildBulkInsert('ads_reports.tiktok_ad_rows', TIKTOK_COLUMNS, (payload.rows.tiktok ?? []).map((r) => tiktokRowValues(runId, r)));
      if (insert) await client.query(insert.text, insert.values);
    }

    // Deleting these cascades (ON DELETE CASCADE) into any public.uploads
    // rows a previous save of this same report already created — see
    // 007_uploads_report_generator_source.sql — so re-saving never leaves
    // stale/duplicate History Upload entries behind.
    await client.query('DELETE FROM ads_reports.raw_uploads WHERE report_run_id = $1', [runId]);
    for (let i = 0; i < files.length; i++) {
      const meta = fileMeta[i];
      if (!meta) continue;
      const rawUpload = await client.query(
        `INSERT INTO ads_reports.raw_uploads (report_run_id, channel, period_role, original_filename, raw_file)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [runId, meta.channel, meta.periodRole, meta.originalFilename, files[i].buffer],
      );

      // Mirror into public.uploads so this file also shows up in History
      // Upload, tagged source='report_generator' and linked back to the
      // BYTEA row above via raw_upload_id (Download/Delete read through
      // that link — see uploadService.js).
      const periodStart = meta.periodRole === 'old' ? payload.period.oldStart : payload.period.curStart;
      const periodEnd = meta.periodRole === 'old' ? payload.period.oldEnd : payload.period.curEnd;
      await client.query(
        `INSERT INTO public.uploads
           (user_id, brand_id, source, report_channel, original_filename, period_start, period_end, status, rows_inserted, completed_at, raw_upload_id)
         VALUES ($1, $2, 'report_generator', $3, $4, $5, $6, 'success', $7, now(), $8)`,
        [
          req.user.userId,
          payload.brandId,
          reportChannelLabel(payload.platform, meta.channel),
          // original_filename is NOT NULL on public.uploads — RawFileMeta
          // types this optimistically as `string | null`, so fall back
          // rather than let a stray null abort the whole report save.
          meta.originalFilename || 'File tanpa nama',
          periodStart,
          periodEnd,
          countRowsForFile(payload, meta),
          rawUpload.rows[0].id,
        ],
      );
    }

    await client.query('COMMIT');
    res.json({ id: runId });
  } catch (err) {
    await client.query('ROLLBACK');
    const pgErr = err;
    if (pgErr.code === '23503') {
      res.status(400).json({ error: 'brandId does not reference an existing brand.' });
      return;
    }
    throw err;
  } finally {
    client.release();
  }
});

reportsRouter.get('/', async (req, res) => {
  const clientId = req.query.client_id ? Number(req.query.client_id) : null;
  const platform = typeof req.query.platform === 'string' && req.query.platform ? req.query.platform : null;
  if (!clientId || !Number.isFinite(clientId)) {
    res.status(400).json({ error: 'client_id is required' });
    return;
  }
  const { rows } = await pool.query(
    `SELECT id, platform, period_old_label, period_cur_label,
            period_old_start::text AS period_old_start, period_old_end::text AS period_old_end,
            period_cur_start::text AS period_cur_start, period_cur_end::text AS period_cur_end,
            created_at
     FROM ads_reports.report_runs
     WHERE brand_id = $1 AND ($2::ads_reports.platform_enum IS NULL OR platform = $2::ads_reports.platform_enum)
     ORDER BY created_at DESC`,
    [clientId, platform],
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      periodOldLabel: r.period_old_label,
      periodCurLabel: r.period_cur_label,
      periodOldStart: r.period_old_start,
      periodOldEnd: r.period_old_end,
      periodCurStart: r.period_cur_start,
      periodCurEnd: r.period_cur_end,
      createdAt: r.created_at,
    })),
  );
});

// Explicit column list (not SELECT *) so the DATE columns can be cast to
// ::text — see the file-level comment on why this can't be a process-wide
// pg.types override anymore now that ATLAS shares this process.
const REPORT_RUN_COLUMNS = `
  id, brand_id, platform, period_old_label, period_cur_label,
  period_old_start::text AS period_old_start, period_old_end::text AS period_old_end,
  period_cur_start::text AS period_cur_start, period_cur_end::text AS period_cur_end,
  report_config, created_at, updated_at
`;

// One saved period on its own, independent of whichever comparison it was
// first saved in — powers the "Pilih dari data tersimpan" picker. Returns
// the same `extra` blobs (the verbatim original parsed rows) that
// reconstruct.ts feeds back through buildXReport(), grouped by channel, so
// the caller can drop them straight into a tab's per-slot state. Registered
// before '/:id' — the paths don't collide (three segments vs one), this is
// just where it reads best.
reportsRouter.get('/:id/period/:role', async (req, res) => {
  const id = Number(req.params.id);
  const role = req.params.role;
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  if (role !== 'old' && role !== 'cur') {
    res.status(400).json({ error: 'role must be "old" or "cur"' });
    return;
  }
  const runResult = await pool.query(`SELECT ${REPORT_RUN_COLUMNS} FROM ads_reports.report_runs WHERE id = $1`, [id]);
  const run = runResult.rows[0];
  if (!run) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  let table = null;
  if (run.platform === 'shopee') table = 'ads_reports.shopee_ad_rows';
  else if (run.platform === 'meta') table = 'ads_reports.meta_ad_rows';
  else if (run.platform === 'tiktok') table = 'ads_reports.tiktok_ad_rows';
  const rowsResult = table
    ? await pool.query(`SELECT * FROM ${table} WHERE report_run_id = $1 AND period_role = $2 ORDER BY id`, [id, role])
    : { rows: [] };

  // TikTok's fact table has no `channel` column (campaign-level only) — bucket
  // it under a single synthetic key so the response shape stays uniform.
  const channels = {};
  for (const row of rowsResult.rows) {
    const ch = run.platform === 'tiktok' ? 'tiktok' : row.channel ?? 'unknown';
    (channels[ch] ??= []).push(row.extra ?? {});
  }

  const pStart = role === 'old' ? run.period_old_start : run.period_cur_start;
  const pEnd = role === 'old' ? run.period_old_end : run.period_cur_end;

  // Shopee Product Overview for this period's date range — brand-scoped
  // daily data, so it comes back even if the file was uploaded under a
  // different comparison. (Product Performance has no date column and is
  // not persisted — the tab still asks for it manually.)
  const overview =
    run.platform === 'shopee' && pStart && pEnd
      ? (await pool.query('SELECT extra FROM ads_reports.shopee_store_overview_daily WHERE brand_id = $1 AND tanggal BETWEEN $2 AND $3 ORDER BY tanggal', [run.brand_id, pStart, pEnd])).rows.map((x) => x.extra)
      : [];

  res.json({
    platform: run.platform,
    reportConfig: run.report_config,
    period: {
      label: role === 'old' ? run.period_old_label : run.period_cur_label,
      start: pStart,
      end: pEnd,
    },
    channels,
    overview,
  });
});

reportsRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  const runResult = await pool.query(`SELECT ${REPORT_RUN_COLUMNS} FROM ads_reports.report_runs WHERE id = $1`, [id]);
  const run = runResult.rows[0];
  if (!run) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  let table = null;
  if (run.platform === 'shopee') table = 'ads_reports.shopee_ad_rows';
  else if (run.platform === 'meta') table = 'ads_reports.meta_ad_rows';
  else if (run.platform === 'tiktok') table = 'ads_reports.tiktok_ad_rows';

  const rowsResult = table ? await pool.query(`SELECT * FROM ${table} WHERE report_run_id = $1 ORDER BY id`, [id]) : { rows: [] };

  // Shopee Product Overview is brand-scoped daily data — pull the rows
  // falling inside each of this run's two periods so reconstruct.ts can
  // rebuild the Product Overview + Tren Harian sections without the file.
  const overviewInRange = async (start, end) => {
    if (run.platform !== 'shopee' || !start || !end) return [];
    const r = await pool.query('SELECT extra FROM ads_reports.shopee_store_overview_daily WHERE brand_id = $1 AND tanggal BETWEEN $2 AND $3 ORDER BY tanggal', [run.brand_id, start, end]);
    return r.rows.map((x) => x.extra);
  };
  const [overviewOld, overviewCur] = await Promise.all([
    overviewInRange(run.period_old_start, run.period_old_end),
    overviewInRange(run.period_cur_start, run.period_cur_end),
  ]);

  res.json({
    report: {
      id: run.id,
      brandId: run.brand_id,
      platform: run.platform,
      periodOldLabel: run.period_old_label,
      periodCurLabel: run.period_cur_label,
      periodOldStart: run.period_old_start,
      periodOldEnd: run.period_old_end,
      periodCurStart: run.period_cur_start,
      periodCurEnd: run.period_cur_end,
      reportConfig: run.report_config,
      createdAt: run.created_at,
    },
    rows: rowsResult.rows,
    overviewOld,
    overviewCur,
  });
});

reportsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }
  // Child tables (raw_uploads/shopee_ad_rows/meta_ad_rows/tiktok_ad_rows) all
  // reference report_runs with ON DELETE CASCADE — see 004_ads_reports_schema.sql.
  const result = await pool.query('DELETE FROM ads_reports.report_runs WHERE id = $1', [id]);
  if (result.rowCount === 0) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.status(204).end();
});
