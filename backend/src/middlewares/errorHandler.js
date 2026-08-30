import { AppError } from '../utils/errors.js';

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

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
