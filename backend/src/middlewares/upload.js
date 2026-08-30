import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

const ALLOWED_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const uploadId = req.uploadId || uuidv4();
    req.uploadId = uploadId;
    const dir = path.join(config.uploadDir, uploadId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safe);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!['.xlsx', '.xls'].includes(ext) && !ALLOWED_MIME.includes(file.mimetype)) {
    return cb(new AppError('Hanya file Excel (.xlsx, .xls) yang diperbolehkan', 400));
  }
  cb(null, true);
}

export const uploadExcel = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});
