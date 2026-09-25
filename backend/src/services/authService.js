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

export async function loginUser({ email, password }) {
  const result = await pool.query(
    'SELECT user_id, email, password_hash, full_name, role::text AS role, is_active, allowed_brand_id, is_view_only, must_change_password FROM users WHERE LOWER(email) = LOWER($1)',
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
    allowedBrandId: user.allowed_brand_id,
    isViewOnly: user.is_view_only,
  });
  await pool.query('UPDATE users SET last_login_at = now() WHERE user_id = $1', [user.user_id]);

  return {
    token,
    user: {
      userId: user.user_id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      allowedBrandId: user.allowed_brand_id,
      isViewOnly: user.is_view_only,
      mustChangePassword: user.must_change_password,
      modules: await modulesFor(user.role),
    },
  };
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
  const result = await pool.query(
    'SELECT user_id, email, full_name, role::text AS role, created_at, allowed_brand_id, is_view_only, must_change_password FROM users WHERE user_id = $1 AND is_active = TRUE',
    [userId],
  );
  if (result.rows.length === 0) return null;
  const user = result.rows[0];
  return {
    userId: user.user_id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    createdAt: user.created_at,
    allowedBrandId: user.allowed_brand_id,
    isViewOnly: user.is_view_only,
    mustChangePassword: user.must_change_password,
    modules: await modulesFor(user.role),
  };
}
