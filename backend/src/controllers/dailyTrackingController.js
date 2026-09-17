import { validationResult } from 'express-validator';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as service from '../services/dailyTrackingService.js';

function validate(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError('Validasi gagal', 400, errors.array());
  }
}

// GET /api/daily-tracking/channels?brandId=
export const listChannels = asyncHandler(async (req, res) => {
  validate(req);
  const channels = await service.listChannels(Number(req.query.brandId));
  res.json(channels);
});

// POST /api/daily-tracking/channels  { brandId, kind, label }
export const addChannel = asyncHandler(async (req, res) => {
  validate(req);
  const channel = await service.addCustomChannel({
    brandId: Number(req.body.brandId),
    kind: req.body.kind,
    label: req.body.label,
    userId: req.user.userId,
  });
  res.status(201).json({ channel });
});

// GET /api/daily-tracking/entries?brandId=&month=YYYY-MM
export const listEntries = asyncHandler(async (req, res) => {
  validate(req);
  const entries = await service.getMonthEntries(Number(req.query.brandId), req.query.month);
  res.json(entries);
});

// PUT /api/daily-tracking/entries  { brandId, entryDate, sales?, spend? }
export const upsertEntries = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.upsertEntries({
    brandId: Number(req.body.brandId),
    entryDate: req.body.entryDate,
    sales: req.body.sales,
    spend: req.body.spend,
    userId: req.user.userId,
  });
  res.json(result);
});

// POST /api/daily-tracking/meta-sync  { brandId, trackingConfigId }
export const runMetaSync = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.runMetaSyncNow({
    brandId: Number(req.body.brandId),
    trackingConfigId: req.body.trackingConfigId,
    userId: req.user.userId,
  });
  res.json(result);
});

// POST /api/daily-tracking/import  multipart: file, brandId
export const importFile = asyncHandler(async (req, res) => {
  validate(req);
  if (!req.file) throw new AppError('File wajib diunggah', 400);
  const result = await service.importFromFile({
    brandId: Number(req.body.brandId),
    buffer: req.file.buffer,
    filename: req.file.originalname,
    userId: req.user.userId,
  });
  res.json(result);
});

// POST /api/daily-tracking/ingest  { brandId, entryDate, entries }
// Called by Apps Script's scheduled 1am WIB run — no req.user (see
// middlewares/dailyTrackingIngestAuth.js).
export const ingestFromAppsScript = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.ingestFromAppsScript({
    brandId: Number(req.body.brandId),
    entryDate: req.body.entryDate,
    entries: req.body.entries,
  });
  res.json({ ok: true, ...result });
});
