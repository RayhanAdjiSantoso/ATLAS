import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { isAdminRole } from './access/permissions.js';

// Website Annotation & Feedback: comments left on a part of a page.
//
// Everyone who holds the `annotations` module (reviewer, admin and superadmin
// by default) sees every comment, replies to it and moves its status. A
// comment is deleted only by whoever wrote it, or by an admin.

export const STATUSES = ['open', 'in_progress', 'resolved'];

const MAX_BODY = 4000;
const MAX_ANCHOR_BYTES = 8000;

const SELECT = `
  SELECT a.annotation_id AS id, a.page_path, a.anchor, a.element_label, a.body, a.status,
         a.viewport_width, a.viewport_height,
         a.created_by, cu.full_name AS created_by_name, a.created_at, a.updated_at,
         su.full_name AS status_changed_by_name, a.status_changed_at,
         COALESCE(r.replies, '[]'::json) AS replies
  FROM annotations a
  LEFT JOIN users cu ON cu.user_id = a.created_by
  LEFT JOIN users su ON su.user_id = a.status_changed_by
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object(
             'id', x.reply_id, 'body', x.body, 'createdBy', x.created_by,
             'createdByName', xu.full_name, 'createdAt', x.created_at
           ) ORDER BY x.created_at, x.reply_id) AS replies
    FROM annotation_replies x
    LEFT JOIN users xu ON xu.user_id = x.created_by
    WHERE x.annotation_id = a.annotation_id
  ) r ON true`;

const shape = (row) => ({
  id: row.id,
  pagePath: row.page_path,
  anchor: row.anchor,
  elementLabel: row.element_label,
  body: row.body,
  status: row.status,
  viewport: row.viewport_width ? { width: row.viewport_width, height: row.viewport_height } : null,
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  statusChangedByName: row.status_changed_by_name,
  statusChangedAt: row.status_changed_at,
  replies: row.replies,
});

function cleanBody(value) {
  const body = String(value ?? '').trim();
  if (!body) throw new AppError('Komentar tidak boleh kosong.', 400);
  if (body.length > MAX_BODY) throw new AppError(`Komentar maksimal ${MAX_BODY} karakter.`, 400);
  return body;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Anotasi tidak ditemukan', 404);
  return id;
}

async function getOne(id) {
  const { rows } = await pool.query(`${SELECT} WHERE a.annotation_id = $1`, [id]);
  if (!rows.length) throw new AppError('Anotasi tidak ditemukan', 404);
  return shape(rows[0]);
}

// Newest first. The layer filters by page itself, so one request feeds both
// the pins on the open page and the list of everything.
export async function listAnnotations() {
  const { rows } = await pool.query(`${SELECT} ORDER BY a.created_at DESC, a.annotation_id DESC LIMIT 1000`);
  return rows.map(shape);
}

export async function createAnnotation(actor, { pagePath, anchor, elementLabel, body, viewport }) {
  const path = String(pagePath ?? '').trim();
  if (!path.startsWith('/') || path.length > 300) throw new AppError('Halaman anotasi tidak valid.', 400);
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) throw new AppError('Elemen anotasi tidak valid.', 400);
  const anchorJson = JSON.stringify(anchor);
  if (anchorJson.length > MAX_ANCHOR_BYTES) throw new AppError('Elemen anotasi tidak valid.', 400);
  const size = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);

  const { rows } = await pool.query(
    `INSERT INTO annotations (page_path, anchor, element_label, body, viewport_width, viewport_height, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING annotation_id`,
    [path, anchorJson, String(elementLabel ?? '').trim().slice(0, 200) || null, cleanBody(body), size(viewport?.width), size(viewport?.height), actor.userId],
  );
  return getOne(rows[0].annotation_id);
}

export async function setStatus(actor, rawId, status) {
  const id = parseId(rawId);
  if (!STATUSES.includes(status)) throw new AppError('Status tidak dikenal.', 400);
  const { rowCount } = await pool.query(
    `UPDATE annotations
     SET status = $2, status_changed_by = $3, status_changed_at = now(), updated_at = now()
     WHERE annotation_id = $1`,
    [id, status, actor.userId],
  );
  if (!rowCount) throw new AppError('Anotasi tidak ditemukan', 404);
  return getOne(id);
}

export async function addReply(actor, rawId, body) {
  const id = parseId(rawId);
  const text = cleanBody(body);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query('UPDATE annotations SET updated_at = now() WHERE annotation_id = $1', [id]);
    if (!rowCount) throw new AppError('Anotasi tidak ditemukan', 404);
    await client.query('INSERT INTO annotation_replies (annotation_id, body, created_by) VALUES ($1, $2, $3)', [id, text, actor.userId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return getOne(id);
}

export async function deleteAnnotation(actor, rawId) {
  const id = parseId(rawId);
  const { rows } = await pool.query('SELECT created_by FROM annotations WHERE annotation_id = $1', [id]);
  if (!rows.length) throw new AppError('Anotasi tidak ditemukan', 404);
  if (rows[0].created_by !== actor.userId && !isAdminRole(actor.role)) {
    throw new AppError('Hanya pembuat komentar atau admin yang bisa menghapusnya.', 403);
  }
  await pool.query('DELETE FROM annotations WHERE annotation_id = $1', [id]);
}
