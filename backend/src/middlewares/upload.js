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
