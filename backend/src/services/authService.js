import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { signToken } from '../utils/jwt.js';
import { modulesFor } from './access/permissions.js';

export async function registerUser({ email, password, fullName, role = 'user' }) {
  const existing = await pool.query('SELECT user_id FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  if (existing.rows.length > 0) {
    throw new AppError('Email sudah terdaftar', 409);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING user_id, email, full_name, role, created_at`,
    [email.toLowerCase(), passwordHash, fullName, role],
  );
  return result.rows[0];
}

const ACCOUNT_COLUMNS = `u.user_id, u.email, u.full_name, u.role::text AS role, u.is_active, u.is_view_only,
  u.must_change_password, u.tours_seen,
  ARRAY(SELECT a.brand_id FROM user_brand_access a WHERE a.user_id = u.user_id ORDER BY a.brand_id) AS allowed_brand_ids`;

// The account as the app sees it. allowedBrandIds is the brand list (null =
// every brand); allowedBrandId is set only when that list is a single brand,
// which is what pins a page to one brand. toursSeen is null for accounts
// older than auto-playing tours, which never auto-play.
async function publicAccount(user) {
  const brandIds = (user.allowed_brand_ids ?? []).map(Number);
  return {
    userId: user.user_id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    allowedBrandIds: brandIds.length ? brandIds : null,
    allowedBrandId: brandIds.length === 1 ? brandIds[0] : null,
    isViewOnly: user.is_view_only,
    mustChangePassword: user.must_change_password,
    toursSeen: user.tours_seen,
    modules: await modulesFor(user.role),
  };
}

export async function loginUser({ email, password }) {
  const result = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS}, u.password_hash FROM users u WHERE LOWER(u.email) = LOWER($1)`,
    [email],
  );

  if (result.rows.length === 0) {
    throw new AppError('Email atau password salah', 401);
  }

  const user = result.rows[0];
  if (!user.is_active) {
    throw new AppError('Akun dinonaktifkan', 403);
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AppError('Email atau password salah', 401);
  }

  const token = signToken({
    userId: user.user_id,
    email: user.email,
    role: user.role,
    fullName: user.full_name,
    isViewOnly: user.is_view_only,
  });
  await pool.query('UPDATE users SET last_login_at = now() WHERE user_id = $1', [user.user_id]);

  return { token, user: await publicAccount(user) };
}

// The account replaces its temporary (or current) password. The current one
// must be given, so a session left open on someone else's screen cannot be
// used to take the account over.
export async function changePassword(userId, currentPassword, newPassword) {
  const pw = String(newPassword || '');
  if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    throw new AppError('Password baru minimal 10 karakter dan berisi huruf serta angka.', 400);
  }
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE user_id = $1 AND is_active = TRUE', [userId]);
  if (!rows.length) throw new AppError('Akun tidak ditemukan', 404);
  if (!(await bcrypt.compare(String(currentPassword || ''), rows[0].password_hash))) {
    throw new AppError('Password saat ini salah.', 400);
  }
  if (await bcrypt.compare(pw, rows[0].password_hash)) {
    throw new AppError('Password baru harus berbeda dari password saat ini.', 400);
  }
  const hash = await bcrypt.hash(pw, 12);
  await pool.query('UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = now() WHERE user_id = $2', [hash, userId]);
}

export async function getUserById(userId) {
  const result = await pool.query(`SELECT ${ACCOUNT_COLUMNS} FROM users u WHERE u.user_id = $1 AND u.is_active = TRUE`, [userId]);
  if (result.rows.length === 0) return null;
  return publicAccount(result.rows[0]);
}

// A page tour has been shown to this account; it will not play by itself
// again. Accounts older than auto-play (tours_seen NULL) stay NULL.
export async function markTourSeen(userId, tourId) {
  const id = String(tourId || '').trim();
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new AppError('Panduan tidak dikenal.', 400);
  const { rows } = await pool.query(
    `UPDATE users SET tours_seen = CASE WHEN $2 = ANY(tours_seen) THEN tours_seen ELSE array_append(tours_seen, $2) END
     WHERE user_id = $1 AND tours_seen IS NOT NULL
     RETURNING tours_seen`,
    [userId, id],
  );
  return rows[0]?.tours_seen ?? null;
}
