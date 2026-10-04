import { validationResult } from 'express-validator';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as service from '../services/googleAdsService.js';
import * as optimization from '../services/googleAdsOptimization.js';

function validate(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new AppError('Validasi gagal', 400, errors.array());
}

// GET /api/google-ads/overview?brandId=
export const getOverview = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getOverview(Number(req.query.brandId)));
});

// POST /api/google-ads/accounts  { brandId, customerId, label?, backfillFrom? }
export const addAccount = asyncHandler(async (req, res) => {
  validate(req);
  res.status(201).json(await service.addAccount({
    brandId: Number(req.body.brandId),
    customerId: req.body.customerId,
    label: req.body.label,
    backfillFrom: req.body.backfillFrom,
    userId: req.user.userId,
  }));
});

// PATCH /api/google-ads/accounts/:accountId  { brandId, label?, isActive?, backfillFrom? }
export const updateAccount = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.updateAccount({
    brandId: Number(req.body.brandId),
    accountId: Number(req.params.accountId),
    label: req.body.label,
    isActive: req.body.isActive,
    backfillFrom: req.body.backfillFrom,
  }));
});

// DELETE /api/google-ads/accounts/:accountId?brandId=
export const removeAccount = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.removeAccount({ brandId: Number(req.query.brandId), accountId: Number(req.params.accountId) }));
});

// POST /api/google-ads/accounts/:accountId/resync  { brandId, from, to }
export const requestResync = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.requestResync({
    brandId: Number(req.body.brandId),
    accountId: Number(req.params.accountId),
    from: req.body.from,
    to: req.body.to,
  }));
});

// GET /api/google-ads/conversion-goals?brandId=
export const getConversionGoals = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getConversionGoals(Number(req.query.brandId)));
});

// PUT /api/google-ads/conversion-goals  { brandId, customerId, conversionActionId, goal | null }
export const setConversionGoal = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.setConversionGoal({
    brandId: Number(req.body.brandId),
    customerId: req.body.customerId,
    conversionActionId: req.body.conversionActionId,
    goal: req.body.goal ?? null,
    userId: req.user.userId,
  }));
});

// ── optimisation (googleAdsOptimization.js) ───────────────────────────
const brandOf = (req) => Number(req.body?.brandId ?? req.query.brandId);
const idOf = (req) => Number(req.params.id);

// GET /api/google-ads/recommendations?brandId=
export const listRecommendations = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await optimization.listRecommendations(brandOf(req)));
});

// POST /api/google-ads/recommendations/generate  { brandId, oldStart, oldEnd, curStart, curEnd }
export const generateRecommendations = asyncHandler(async (req, res) => {
  validate(req);
  const { oldStart, oldEnd, curStart, curEnd } = req.body;
  res.json(await optimization.generateRecommendations({ brandId: brandOf(req), oldStart, oldEnd, curStart, curEnd, userId: req.user.userId }));
});

// PATCH /api/google-ads/recommendations/:id  { brandId, status?, notes? }
export const updateRecommendation = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await optimization.updateRecommendation({ brandId: brandOf(req), id: idOf(req), status: req.body.status, notes: req.body.notes, userId: req.user.userId }));
});

// POST /api/google-ads/recommendations/:id/task  { brandId, pic }
export const recommendationToTask = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await optimization.recommendationToTask({ brandId: brandOf(req), id: idOf(req), pic: req.body.pic, userId: req.user.userId }));
});

// GET /api/google-ads/experiments?brandId=
export const listExperiments = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await optimization.listExperiments(brandOf(req)));
});

// POST /api/google-ads/experiments  { brandId, ...experiment }
export const createExperiment = asyncHandler(async (req, res) => {
  validate(req);
  const { brandId: _b, ...input } = req.body;
  res.status(201).json(await optimization.createExperiment({ brandId: brandOf(req), input, userId: req.user.userId }));
});

// PATCH /api/google-ads/experiments/:id  { brandId, ...patch }
export const updateExperiment = asyncHandler(async (req, res) => {
  validate(req);
  const { brandId: _b, ...input } = req.body;
  res.json(await optimization.updateExperiment({ brandId: brandOf(req), id: idOf(req), input }));
});

// DELETE /api/google-ads/experiments/:id?brandId=
export const deleteExperiment = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await optimization.deleteExperiment({ brandId: brandOf(req), id: idOf(req) }));
});

// POST /api/google-ads/experiments/:id/evaluate  { brandId }
export const evaluateExperiment = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await optimization.evaluateExperiment({ brandId: brandOf(req), id: idOf(req), userId: req.user.userId }));
});

// GET /api/google-ads/alerts?brandId=&all=1
export const listAlerts = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await optimization.listAlerts({ brandId: brandOf(req), includeResolved: req.query.all === '1' }));
});

// PATCH /api/google-ads/alerts/:id  { brandId, status }
export const setAlertStatus = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await optimization.setAlertStatus({ brandId: brandOf(req), id: idOf(req), status: req.body.status, userId: req.user.userId }));
});

// GET /api/google-ads/report?brandId=&oldStart=&oldEnd=&curStart=&curEnd=
export const getReport = asyncHandler(async (req, res) => {
  validate(req);
  const { oldStart, oldEnd, curStart, curEnd } = req.query;
  res.json(await service.getReport({ brandId: Number(req.query.brandId), oldStart, oldEnd, curStart, curEnd }));
});

// ── ingest (no req.user — see dailyTrackingIngestAuth.js) ─────────────
// GET /api/google-ads/ingest/jobs[?datasets=core,ads,...]
export const getJobs = asyncHandler(async (req, res) => {
  res.json(await service.getJobs({ datasets: req.query.datasets }));
});

// POST /api/google-ads/ingest/start
export const startRun = asyncHandler(async (req, res) => {
  validate(req);
  const { customerId, startDate, endDate, source, account, datasets } = req.body;
  res.json({ ok: true, ...(await service.startRun({ customerId, startDate, endDate, source, account, datasets })) });
});

// POST /api/google-ads/ingest/rows
export const ingestRows = asyncHandler(async (req, res) => {
  validate(req);
  res.json({ ok: true, ...(await service.ingestRows({ runId: req.body.runId, rows: req.body.rows })) });
});

// POST /api/google-ads/ingest/changes
export const ingestChanges = asyncHandler(async (req, res) => {
  validate(req);
  res.json({ ok: true, ...(await service.ingestChanges({ runId: req.body.runId, rows: req.body.rows })) });
});

// POST /api/google-ads/ingest/dataset  { runId, dataset, rows }
export const ingestDataset = asyncHandler(async (req, res) => {
  validate(req);
  const { runId, dataset, rows } = req.body;
  res.json({ ok: true, ...(await service.ingestDataset({ runId, dataset, rows })) });
});

// POST /api/google-ads/ingest/finish  { runId, status, rowCount, note?, datasets? }
export const finishRun = asyncHandler(async (req, res) => {
  validate(req);
  const { runId, status, rowCount, note, datasets } = req.body;
  res.json({ ok: true, ...(await service.finishRun({ runId, status, rowCount: Number(rowCount), note, datasets })) });
});
