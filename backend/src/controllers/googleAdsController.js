import { validationResult } from 'express-validator';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as service from '../services/googleAdsService.js';

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

// GET /api/google-ads/report?brandId=&oldStart=&oldEnd=&curStart=&curEnd=
export const getReport = asyncHandler(async (req, res) => {
  validate(req);
  const { oldStart, oldEnd, curStart, curEnd } = req.query;
  res.json(await service.getReport({ brandId: Number(req.query.brandId), oldStart, oldEnd, curStart, curEnd }));
});

// ── ingest (no req.user — see dailyTrackingIngestAuth.js) ─────────────
// GET /api/google-ads/ingest/jobs
export const getJobs = asyncHandler(async (req, res) => {
  res.json(await service.getJobs());
});

// POST /api/google-ads/ingest/start
export const startRun = asyncHandler(async (req, res) => {
  validate(req);
  const { customerId, startDate, endDate, source, account } = req.body;
  res.json({ ok: true, ...(await service.startRun({ customerId, startDate, endDate, source, account })) });
});

// POST /api/google-ads/ingest/rows
export const ingestRows = asyncHandler(async (req, res) => {
  validate(req);
  res.json({ ok: true, ...(await service.ingestRows({ runId: req.body.runId, rows: req.body.rows })) });
});

// POST /api/google-ads/ingest/finish
export const finishRun = asyncHandler(async (req, res) => {
  validate(req);
  const { runId, status, rowCount, note } = req.body;
  res.json({ ok: true, ...(await service.finishRun({ runId, status, rowCount: Number(rowCount), note })) });
});
