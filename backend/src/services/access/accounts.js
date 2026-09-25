import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../../config/db.js';
import { AppError } from '../../utils/errors.js';
import { ROLES } from './permissions.js';

// Account management behind Pengaturan Akses.
//
// Who may touch whom:
//   • superadmin — any account, any role, including other superadmins;
//   • admin      — only user and client accounts, and may not hand out admin
//                  or superadmin (that would let an admin promote itself);
//   • nobody deactivates, demotes or un-admins their own account, so the last
//     person with access can never lock themselves out by a misclick.
//
// Passwords are never chosen by the admin. The system generates one, shows it
// once, and the account must replace it at first login, so the password in
// use is known only to its owner.

const ADMIN_MANAGEABLE = new Set(['user', 'client']);

export function canManage(actor, targetRole) {
  if (actor.role === 'superadmin') return true;
  if (actor.role === 'admin') return ADMIN_MANAGEABLE.has(targetRole);
  return false;
}

// 14 characters from an alphabet without look-alikes (0/O, 1/l/I), with at
// least one of each class so it passes any password rule.
export function generateTempPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%*?'];
  const all = sets.join('');
  const pick = (s) => s[crypto.randomInt(s.length)];
  const chars = sets.map(pick);
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function audit(client, actorId, targetId, action, detail) {
  await client.query(
    'INSERT INTO access_audit_log (actor_user_id, target_user_id, action, detail) VALUES ($1, $2, $3, $4)',
    [actorId, targetId, action, detail ? JSON.stringify(detail) : null],
  );
}

const ACCOUNT_COLUMNS = `
  u.user_id, u.email, u.full_name, u.role::text AS role, u.is_active, u.allowed_brand_id,
  b.brand_name AS allowed_brand_name, u.is_view_only, u.must_change_password,
  u.created_at, u.last_login_at, c.full_name AS created_by_name`;

export async function listAccounts() {
  const { rows } = await pool.query(`
    SELECT ${ACCOUNT_COLUMNS}
    FROM users u
    LEFT JOIN brands b ON b.brand_id = u.allowed_brand_id
    LEFT JOIN users c ON c.user_id = u.created_by
    ORDER BY CASE u.role::text WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 WHEN 'user' THEN 2 ELSE 3 END, lower(u.full_name)`);
  return rows;
}

async function getAccount(client, id) {
  const { rows } = await client.query(`SELECT user_id, email, role::text AS role, is_active, allowed_brand_id, is_view_only FROM users WHERE user_id = $1`, [id]);
  if (!rows.length) throw new AppError('Akun tidak ditemukan', 404);
  return rows[0];
}

function validateBrandRule(role, allowedBrandId) {
  // A client account without a brand would see every brand — the exact leak
  // this page exists to prevent.
  if (role === 'client' && !allowedBrandId) throw new AppError('Akun client wajib dibatasi ke satu brand.', 400);
}

export async function createAccount(actor, { email, fullName, role, allowedBrandId, isViewOnly }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const name = String(fullName || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new AppError('Format email tidak valid.', 400);
  if (!name) throw new AppError('Nama lengkap wajib diisi.', 400);
  if (!ROLES.includes(role)) throw new AppError('Role tidak dikenal.', 400);
  if (!canManage(actor, role)) throw new AppError('Anda tidak berwenang membuat akun dengan role ini.', 403);
  const brandId = allowedBrandId ? Number(allowedBrandId) : null;
  validateBrandRule(role, brandId);

  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [cleanEmail]);
    if (exists.rowCount) throw new AppError('Email ini sudah dipakai akun lain.', 409);
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, allowed_brand_id, is_view_only, must_change_password, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7) RETURNING user_id`,
      [cleanEmail, hash, name, role, brandId, Boolean(isViewOnly), actor.userId],
    );
    const id = rows[0].user_id;
    await audit(client, actor.userId, id, 'create', { email: cleanEmail, role, allowedBrandId: brandId, isViewOnly: Boolean(isViewOnly) });
    await client.query('COMMIT');
    return { userId: id, tempPassword };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateAccount(actor, id, changes) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await getAccount(client, id);
    if (!canManage(actor, target.role)) throw new AppError('Anda tidak berwenang mengubah akun ini.', 403);

    const next = {
      full_name: changes.fullName !== undefined ? String(changes.fullName).trim() : undefined,
      role: changes.role,
      allowed_brand_id: changes.allowedBrandId !== undefined ? (changes.allowedBrandId ? Number(changes.allowedBrandId) : null) : undefined,
      is_view_only: changes.isViewOnly !== undefined ? Boolean(changes.isViewOnly) : undefined,
      is_active: changes.isActive !== undefined ? Boolean(changes.isActive) : undefined,
    };
    if (next.role !== undefined) {
      if (!ROLES.includes(next.role)) throw new AppError('Role tidak dikenal.', 400);
      if (!canManage(actor, next.role)) throw new AppError('Anda tidak berwenang memberi role ini.', 403);
    }
    const self = Number(id) === Number(actor.userId);
    if (self && next.is_active === false) throw new AppError('Anda tidak bisa menonaktifkan akun sendiri.', 400);
    if (self && next.role !== undefined && next.role !== target.role) throw new AppError('Anda tidak bisa mengubah role akun sendiri.', 400);
    if (next.full_name === '') throw new AppError('Nama lengkap wajib diisi.', 400);
    validateBrandRule(next.role ?? target.role, next.allowed_brand_id !== undefined ? next.allowed_brand_id : target.allowed_brand_id);

    const sets = [];
    const values = [];
    const diff = {};
    for (const [col, val] of Object.entries(next)) {
      if (val === undefined) continue;
      values.push(val);
      sets.push(`${col} = $${values.length}`);
      diff[col] = val;
    }
    if (!sets.length) {
      await client.query('ROLLBACK');
      return;
    }
    values.push(id);
    await client.query(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $${values.length}`, values);
    await audit(client, actor.userId, id, 'update', diff);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function resetPassword(actor, id) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const target = await getAccount(client, id);
    if (!canManage(actor, target.role)) throw new AppError('Anda tidak berwenang mereset password akun ini.', 403);
    const tempPassword = generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);
    await client.query('UPDATE users SET password_hash = $1, must_change_password = TRUE, updated_at = now() WHERE user_id = $2', [hash, id]);
    await audit(client, actor.userId, id, 'reset_password', null);
    await client.query('COMMIT');
    return { tempPassword };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function recordPermissionChange(actorId, detail) {
  const client = await pool.connect();
  try {
    await audit(client, actorId, null, 'permission', detail);
  } finally {
    client.release();
  }
}

export async function listAudit(limit = 100) {
  const { rows } = await pool.query(
    `SELECT l.id, l.action, l.detail, l.created_at,
            a.full_name AS actor_name, a.email AS actor_email,
            t.full_name AS target_name, t.email AS target_email
     FROM access_audit_log l
     LEFT JOIN users a ON a.user_id = l.actor_user_id
     LEFT JOIN users t ON t.user_id = l.target_user_id
     ORDER BY l.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}
