import { verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/errors.js';

export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError('Token autentikasi diperlukan', 401));
  }

  try {
    const token = header.slice(7);
    req.user = verifyToken(token);
    next();
  } catch {
    next(new AppError('Token tidak valid atau kedaluwarsa', 401));
  }
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('Akses ditolak', 403));
    }
    next();
  };
}
