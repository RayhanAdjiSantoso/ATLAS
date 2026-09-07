import multer from 'multer';
import path from 'path';
import { AppError } from '../utils/errors.js';

const ALLOWED_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.xlsx', '.xls'].includes(ext) && !ALLOWED_MIME.includes(file.mimetype)) {
    return cb(new AppError('Hanya file Excel (.xlsx, .xls) yang diperbolehkan', 400));
  }
  cb(null, true);
}

// Memory storage: the raw bytes are archived in public.uploads.raw_file
// (BYTEA) and parsed straight from the buffer — no disk, so this works on
// serverless. Vercel caps the request body at ~4.5 MB; keep the limit just
// under that so an oversized file fails fast with a clear error.
export const uploadExcel = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 4 * 1024 * 1024 },
});

// Pengaturan Brand's library accepts the same Excel exports plus CSV — the
// TikTok Seller Center and some Shopee Ads exports come out as .csv, and
// the library stores bytes verbatim (parsing only reads dates), so there is
// no reason to reject them here the way the Dashboard importer must.
function dataFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(ext) && ![...ALLOWED_MIME, 'text/csv'].includes(file.mimetype)) {
    return cb(new AppError('Hanya file Excel (.xlsx, .xls) atau CSV yang diperbolehkan', 400));
  }
  cb(null, true);
}

// 25 MB, matching routes/reportGenerator/reports.js — these are the same
// exports that page already accepts, and a month of Shopee orders is
// routinely past the Dashboard importer's 4 MB. Note for deploys: Vercel
// caps a request body near 4.5 MB, so a host with no such cap is required
// for the larger files (the Report Generator route has the same
// constraint today).
export const uploadDataFile = multer({
  storage: multer.memoryStorage(),
  fileFilter: dataFileFilter,
  limits: { fileSize: 25 * 1024 * 1024 },
});
