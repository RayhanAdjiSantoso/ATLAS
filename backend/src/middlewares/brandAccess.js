import { AppError } from '../utils/errors.js';

// Brand restriction (Pengaturan Akses). req.user.allowedBrandIds lists the
// brands an account may open — one for a client, one or more for an internal
// user — and is null for an unrestricted account, which may open any brand.
export function canAccessBrand(user, brandId) {
  const allowed = user?.allowedBrandIds;
  if (!allowed?.length) return true;
  return allowed.includes(Number(brandId));
}

// The brand ids a list query must stay within, or null for "all brands".
export function brandScope(user) {
  return user?.allowedBrandIds?.length ? user.allowedBrandIds : null;
}

// Wraps a route with a brand check for restricted accounts. Unrestricted
// accounts pass straight through. getBrandId returning null/undefined means
// the route's own validation is responsible for "brandId wajib diisi" — this
// only rejects a brand outside the account's list, never a missing value.
export function requireBrandAccess(getBrandId) {
  return (req, res, next) => {
    if (!brandScope(req.user)) return next();

    const requested = getBrandId(req);
    if (requested == null) return next();

    if (!canAccessBrand(req.user, requested)) {
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
