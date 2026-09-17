import { AppError } from '../utils/errors.js';

// Wraps a route with a brand check for accounts locked to one brand
// (req.user.allowedBrandId). Unrestricted accounts (allowedBrandId falsy)
// pass straight through. getBrandId returning null/undefined means the
// route's own validation is responsible for "brandId wajib diisi" — this
// only rejects a MISMATCH, never a missing value.
export function requireBrandAccess(getBrandId) {
  return (req, res, next) => {
    const allowed = req.user?.allowedBrandId;
    if (!allowed) return next();

    const requested = getBrandId(req);
    if (requested == null) return next();

    if (Number(requested) !== Number(allowed)) {
      return next(new AppError('Akses ditolak untuk brand ini', 403));
    }
    next();
  };
}

// Accounts flagged is_view_only can read but never write, regardless of brand.
export function blockWriteIfViewOnly(req, res, next) {
  if (req.user?.isViewOnly && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next(new AppError('Akun ini hanya dapat melihat data', 403));
  }
  next();
}
