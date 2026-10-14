import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../../config/db.js';
import { AppError } from '../../utils/errors.js';
import { ROLES } from './permissions.js';

// Account management behind Pengaturan Akses.
//
// Who may touch whom:
//   • superadmin — any account, any role, including other superadmins;
//   • admin      — only user and client accounts, and may not hand out admin,
//                  superadmin or reviewer (that would let an admin promote
//                  itself, or open modules its own role was closed out of);
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

// allowed_brand_ids / allowed_brand_names: the account's brand list
// (user_brand_access), empty for an account that may open every brand.
const ACCOUNT_COLUMNS = `
  u.user_id, u.email, u.full_name, u.role::text AS role, u.is_active,
  ARRAY(SELECT a.brand_id FROM user_brand_access a JOIN brands b ON b.brand_id = a.brand_id
        WHERE a.user_id = u.user_id ORDER BY lower(b.brand_name)) AS allowed_brand_ids,
  ARRAY(SELECT b.brand_name FROM user_brand_access a JOIN brands b ON b.brand_id = a.brand_id
        WHERE a.user_id = u.user_id ORDER BY lower(b.brand_name)) AS allowed_brand_names,
  u.is_view_only, u.must_change_password,
  u.created_at, u.last_login_at, c.full_name AS created_by_name`;

export async function listAccounts() {
  const { rows } = await pool.query(`
    SELECT ${ACCOUNT_COLUMNS}
    FROM users u
    LEFT JOIN users c ON c.user_id = u.created_by
    ORDER BY CASE u.role::text WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 WHEN 'reviewer' THEN 2 WHEN 'user' THEN 3 ELSE 4 END, lower(u.full_name)`);
  return rows;
}

async function getAccount(client, id) {
  const { rows } = await client.query(
    `SELECT u.user_id, u.email, u.role::text AS role, u.is_active, u.is_view_only,
            ARRAY(SELECT a.brand_id FROM user_brand_access a WHERE a.user_id = u.user_id ORDER BY a.brand_id) AS allowed_brand_ids
     FROM users u WHERE u.user_id = $1`,
    [id],
  );
  if (!rows.length) throw new AppError('Akun tidak ditemukan', 404);
  return { ...rows[0], allowed_brand_ids: rows[0].allowed_brand_ids.map(Number) };
}

// The brand list from a request: allowedBrandIds (an array), or the older
// single allowedBrandId. undefined = not sent (leave as is); [] = every brand.
function readBrandIds(body) {
  if (body.allowedBrandIds !== undefined) {
    if (body.allowedBrandIds !== null && !Array.isArray(body.allowedBrandIds)) throw new AppError('Daftar brand tidak valid.', 400);
    const ids = (body.allowedBrandIds ?? []).map(Number);
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new AppError('Daftar brand tidak valid.', 400);
    return [...new Set(ids)].sort((a, b) => a - b);
  }
  if (body.allowedBrandId !== undefined) return body.allowedBrandId ? [Number(body.allowedBrandId)] : [];
  return undefined;
}

function validateBrandRule(role, brandIds) {
  // A client account without a brand would see every brand — the exact leak
  // this page exists to prevent. One client account is one brand's; an
  // internal user may be given several (one person often handles more than
  // one brand).
  if (role === 'client' && brandIds.length !== 1) throw new AppError('Akun client wajib dibatasi ke tepat satu brand.', 400);
}

async function setBrandIds(client, userId, brandIds) {
  if (brandIds.length) {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM brands WHERE brand_id = ANY($1::int[])', [brandIds]);
    if (rows[0].n !== brandIds.length) throw new AppError('Ada brand yang tidak ditemukan.', 400);
  }
  await client.query('DELETE FROM user_brand_access WHERE user_id = $1', [userId]);
  if (brandIds.length) {
    await client.query(
      'INSERT INTO user_brand_access (user_id, brand_id) SELECT $1, unnest($2::int[])',
      [userId, brandIds],
    );
  }
}

const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

export async function createAccount(actor, body) {
  const { email, fullName, role, isViewOnly } = body;
  const cleanEmail = String(email || '').trim().toLowerCase();
  const name = String(fullName || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new AppError('Format email tidak valid.', 400);
  if (!name) throw new AppError('Nama lengkap wajib diisi.', 400);
  if (!ROLES.includes(role)) throw new AppError('Role tidak dikenal.', 400);
  if (!canManage(actor, role)) throw new AppError('Anda tidak berwenang membuat akun dengan role ini.', 403);
  const brandIds = readBrandIds(body) ?? [];
  validateBrandRule(role, brandIds);

  const tempPassword = generateTempPassword();
  const hash = await bcrypt.hash(tempPassword, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [cleanEmail]);
    if (exists.rowCount) throw new AppError('Email ini sudah dipakai akun lain.', 409);
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, is_view_only, must_change_password, created_by)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING user_id`,
      [cleanEmail, hash, name, role, Boolean(isViewOnly), actor.userId],
    );
    const id = rows[0].user_id;
    await setBrandIds(client, id, brandIds);
    await audit(client, actor.userId, id, 'create', { email: cleanEmail, role, allowedBrandIds: brandIds, isViewOnly: Boolean(isViewOnly) });
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
    const brandIds = readBrandIds(changes);
    validateBrandRule(next.role ?? target.role, brandIds ?? target.allowed_brand_ids);

    const sets = [];
    const values = [];
    const diff = {};
    for (const [col, val] of Object.entries(next)) {
      if (val === undefined) continue;
      values.push(val);
      sets.push(`${col} = $${values.length}`);
      diff[col] = val;
    }
    const brandsChanged = brandIds !== undefined && !sameIds(brandIds, target.allowed_brand_ids);
    if (brandsChanged) diff.allowed_brand_ids = brandIds;
    if (!sets.length && !brandsChanged) {
      await client.query('ROLLBACK');
      return;
    }
    if (brandsChanged) await setBrandIds(client, id, brandIds);
    values.push(id);
    await client.query(`UPDATE users SET ${sets.length ? `${sets.join(', ')}, ` : ''}updated_at = now() WHERE user_id = $${values.length}`, values);
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
