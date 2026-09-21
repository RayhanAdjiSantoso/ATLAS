import { validationResult } from 'express-validator';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as service from '../services/metaAdsInsightsService.js';

function validate(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new AppError('Validasi gagal', 400, errors.array());
}

// GET /api/meta-ads-insights/overview?brandId=
export const getOverview = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getOverview(Number(req.query.brandId)));
});

// GET /api/meta-ads-insights/accounts?brandId=   (slow: asks Apps Script)
export const listAccounts = asyncHandler(async (req, res) => {
  validate(req);
  res.json({ accounts: await service.listEligibleAccounts(Number(req.query.brandId)) });
});

// PUT /api/meta-ads-insights/config  { brandId, accountType, extraMetrics }
export const saveConfig = asyncHandler(async (req, res) => {
  validate(req);
  const saved = await service.saveConfig({
    brandId: Number(req.body.brandId),
    accountType: req.body.accountType,
    extraMetrics: req.body.extraMetrics,
    userId: req.user.userId,
  });
  res.json(saved);
});

// POST /api/meta-ads-insights/fetch  { brandId, accountType, month }
export const fetchNow = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.requestFetch({
    brandId: Number(req.body.brandId),
    accountType: req.body.accountType,
    month: req.body.month,
  });
  res.status(202).json(result);
});

// POST /api/meta-ads-insights/library  { brandId, accountType, month }
// Rebuilds the Data & file library copy of an already-fetched month.
export const syncLibrary = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.syncLibraryFile({
    brandId: Number(req.body.brandId),
    accountType: req.body.accountType,
    month: req.body.month,
    userId: req.user.userId,
  });
  res.json(result);
});

// DELETE /api/meta-ads-insights/months?brandId=&accountType=&month=
export const deleteMonth = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.deleteMonth({
    brandId: Number(req.query.brandId),
    accountType: req.query.accountType,
    month: req.query.month,
  });
  res.json(result);
});

// ── ingest (Apps Script; no req.user — see dailyTrackingIngestAuth.js) ──
// POST /api/meta-ads-insights/ingest/start
export const startRun = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.startRun({
    brandId: Number(req.body.brandId),
    accountType: req.body.accountType,
    adAccountId: req.body.adAccountId,
    month: req.body.month,
    trigger: req.body.trigger,
  });
  res.json({ ok: true, ...result });
});

// POST /api/meta-ads-insights/ingest/rows
export const ingestRows = asyncHandler(async (req, res) => {
  validate(req);
  res.json({ ok: true, ...(await service.ingestRows({ runId: req.body.runId, rows: req.body.rows })) });
});

// POST /api/meta-ads-insights/ingest/finish
export const finishRun = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.finishRun({
    runId: req.body.runId,
    status: req.body.status,
    rowCount: Number(req.body.rowCount),
    note: req.body.note,
  });
  res.json({ ok: true, ...result });
});

// POST /api/meta-ads-insights/ingest/library  { runId }
export const syncLibraryFromRun = asyncHandler(async (req, res) => {
  validate(req);
  res.json({ ok: true, ...(await service.syncLibraryFromRun(req.body.runId)) });
});
