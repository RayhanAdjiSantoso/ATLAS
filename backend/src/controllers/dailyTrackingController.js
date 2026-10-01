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

// DELETE /api/daily-tracking/entries?brandId=&month=YYYY-MM
export const deleteMonthEntries = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.deleteMonthEntries({
    brandId: Number(req.query.brandId),
    month: req.query.month,
    userId: req.user.userId,
  });
  res.json(result);
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

// POST /api/daily-tracking/meta-sync  { brandId, trackingConfigId } OR { brandId, accountClient, accountType }
export const runMetaSync = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.runMetaSyncNow({
    brandId: Number(req.body.brandId),
    trackingConfigId: req.body.trackingConfigId,
    accountClient: req.body.accountClient,
    accountType: req.body.accountType,
    userId: req.user.userId,
  });
  res.json(result);
});

// POST /api/daily-tracking/import  multipart: file, brandId
export const importFile = asyncHandler(async (req, res) => {
  validate(req);
  if (!req.file) throw new AppError('File wajib diunggah', 400);
  // `selected` arrives as a JSON string inside the multipart form.
  let selected;
  if (req.body.selected !== undefined) {
    try {
      selected = JSON.parse(req.body.selected);
    } catch {
      throw new AppError('selected harus JSON array id kolom', 400);
    }
    if (!Array.isArray(selected)) throw new AppError('selected harus JSON array id kolom', 400);
  }
  const result = await service.importFromFile({
    brandId: Number(req.body.brandId),
    buffer: req.file.buffer,
    filename: req.file.originalname,
    userId: req.user.userId,
    selected,
  });
  res.json(result);
});

// POST /api/daily-tracking/import/preview  (multipart: brandId, file) — stores nothing
export const previewImport = asyncHandler(async (req, res) => {
  validate(req);
  if (!req.file) throw new AppError('File wajib diunggah', 400);
  const result = await service.previewImport({
    brandId: Number(req.body.brandId),
    buffer: req.file.buffer,
    filename: req.file.originalname,
  });
  res.json(result);
});

// DELETE /api/daily-tracking/channels?brandId=&kind=&key=
export const deleteChannel = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.deleteCustomChannel({
    brandId: Number(req.query.brandId),
    kind: req.query.kind,
    channelKey: req.query.key,
    userId: req.user.userId,
  });
  res.json(result);
});

// POST /api/daily-tracking/channels/move  { brandId, kind, key } — kind = current section
export const moveChannel = asyncHandler(async (req, res) => {
  validate(req);
  const result = await service.moveCustomChannel({
    brandId: Number(req.body.brandId),
    kind: req.body.kind,
    channelKey: req.body.key,
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
