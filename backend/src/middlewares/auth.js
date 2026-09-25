import pool from '../config/db.js';
import { verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/errors.js';
import { hasModule, isAdminRole } from '../services/access/permissions.js';

// The token proves who is asking; what they may do is read from the database.
// A token lives 7 days, so trusting the role, brand and active flag baked into
// it would let a deactivated account keep working for a week, and a demoted
// admin keep admin rights. The account row is re-read at most every 30s per
// instance — deactivation and role changes take effect within that.
const ACCOUNT_CACHE_MS = 30_000;
const accountCache = new Map(); // userId -> { at, row }

async function loadAccount(userId) {
  const hit = accountCache.get(userId);
  if (hit && Date.now() - hit.at < ACCOUNT_CACHE_MS) return hit.row;
  const { rows } = await pool.query(
    `SELECT user_id, email, full_name, role::text AS role, is_active, allowed_brand_id, is_view_only, must_change_password
     FROM users WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0] ?? null;
  accountCache.set(userId, { at: Date.now(), row });
  if (accountCache.size > 2000) accountCache.delete(accountCache.keys().next().value);
  return row;
}

export function forgetAccount(userId) {
  accountCache.delete(Number(userId));
}

// Routes an account that still has to replace its temporary password may use.
const PASSWORD_CHANGE_PATHS = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];

export async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError('Token autentikasi diperlukan', 401));
  }

  let claims;
  try {
    claims = verifyToken(header.slice(7));
  } catch {
    return next(new AppError('Token tidak valid atau kedaluwarsa', 401));
  }

  try {
    const account = await loadAccount(claims.userId);
    if (!account) return next(new AppError('Akun tidak ditemukan', 401));
    if (!account.is_active) return next(new AppError('Akun ini dinonaktifkan. Hubungi admin.', 401));
    req.user = {
      ...claims,
      email: account.email,
      fullName: account.full_name,
      role: account.role,
      allowedBrandId: account.allowed_brand_id,
      isViewOnly: account.is_view_only,
      mustChangePassword: account.must_change_password,
    };
    if (account.must_change_password && !PASSWORD_CHANGE_PATHS.includes(req.originalUrl.split('?')[0])) {
      return next(new AppError('Ganti password sementara Anda terlebih dahulu.', 403));
    }
    next();
  } catch (err) {
    next(err);
  }
}

// Role check. Superadmin passes every role check, and 'admin' includes
// superadmin — a superadmin is an admin with more rights, never fewer.
export function authorize(...roles) {
  return (req, res, next) => {
    const role = req.user?.role;
    const ok = role === 'superadmin' || roles.includes(role) || (roles.includes('admin') && isAdminRole(role));
    if (!ok) return next(new AppError('Akses ditolak', 403));
    next();
  };
}

// Module check against Pengaturan Akses. Passes when the role may open ANY of
// the listed modules — some APIs serve several pages (the brand list feeds
// Pengaturan Brand, Report Generator and Daily Tracking alike).
export function requireModule(...modules) {
  return async (req, res, next) => {
    try {
      const role = req.user?.role;
      for (const m of modules) {
        if (await hasModule(role, m)) return next();
      }
      next(new AppError('Role Anda tidak memiliki akses ke fitur ini', 403));
    } catch (err) {
      next(err);
    }
  };
}
