import { MulterError } from 'multer';
import { AppError } from '../utils/errors.js';

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'File terlalu besar untuk diunggah.',
  LIMIT_UNEXPECTED_FILE: 'Field file tidak dikenal.',
  LIMIT_PART_COUNT: 'Terlalu banyak bagian dalam permintaan upload.',
};

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Upload failures are the user's problem to fix (wrong file, too big), not
  // a server fault — they must not read as a 500.
  if (err instanceof MulterError) {
    res.status(400).json({ message: MULTER_MESSAGES[err.code] ?? `Upload ditolak (${err.code}).` });
    return;
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (statusCode >= 500) {
    console.error('[ERROR]', err);
  }

  res.status(statusCode).json({
    message,
    details: err.details ?? undefined,
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ message: 'Endpoint tidak ditemukan' });
}
