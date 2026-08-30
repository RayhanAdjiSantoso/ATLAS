import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { signToken } from '../utils/jwt.js';

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
    'SELECT user_id, email, password_hash, full_name, role, is_active FROM users WHERE LOWER(email) = LOWER($1)',
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
  });

  return {
    token,
    user: {
      userId: user.user_id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
    },
  };
}

export async function getUserById(userId) {
  const result = await pool.query(
    'SELECT user_id, email, full_name, role, created_at FROM users WHERE user_id = $1 AND is_active = TRUE',
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
  };
}
