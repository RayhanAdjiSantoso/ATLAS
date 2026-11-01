import crypto from 'crypto';
import pool from '../config/db.js';
import * as fileStore from './fileStore.js';
import { canAccessBrand } from '../middlewares/brandAccess.js';

// Presentation Report drafts (migration 062). A draft belongs to its brand's team,
// like saved report_runs: one person often handles Meta and another Shopee on the
// same deck. A client account is the exception. It can be given this module, but
// sees only drafts it made itself, because the rest is unfinished internal wording.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_ASSETS_PER_REPORT = 30;

const LIST_COLUMNS = `
  p.id, p.brand_id, p.name, p.channels, p.template_version, p.revision, p.created_by, p.created_at, p.updated_at,
  p.period_old_start::text AS period_old_start, p.period_old_end::text AS period_old_end,
  p.period_cur_start::text AS period_cur_start, p.period_cur_end::text AS period_cur_end,
  u.full_name AS created_by_name, e.full_name AS updated_by_name`;
const FROM = `FROM ads_reports.presentation_reports p
  LEFT JOIN public.users u ON u.user_id = p.created_by
  LEFT JOIN public.users e ON e.user_id = p.updated_by`;

export function canOpenDraft(user, row) {
  if (!row || !canAccessBrand(user, row.brand_id)) return false;
  return user?.role !== 'client' || row.created_by === user?.userId;
}

// Period dates arrive from the client; a malformed one is dropped rather than
// failing the save over a column that only serves the draft list.
const dateOrNull = (v) => (typeof v === 'string' && DATE.test(v) ? v : null);

function fieldsOf(body) {
  const config = body.document?.config ?? {};
  const period = config.period ?? {};
  return {
    name: String(body.name ?? '').trim().slice(0, 200),
    periodOldStart: dateOrNull(period.oldStart),
    periodOldEnd: dateOrNull(period.oldEnd),
    periodCurStart: dateOrNull(period.curStart),
    periodCurEnd: dateOrNull(period.curEnd),
    channels: Object.entries(config.channels ?? {}).filter(([, c]) => c?.enabled).map(([k]) => String(k)),
    templateVersion: Number.isInteger(body.document?.templateVersion) ? body.document.templateVersion : 1,
  };
}

export function validateDraftBody(body) {
  if (!body?.document || typeof body.document !== 'object' || Array.isArray(body.document)) return 'document wajib diisi';
  if (!String(body.name ?? '').trim()) return 'Nama presentasi wajib diisi';
  if (body.snapshot != null && typeof body.snapshot !== 'object') return 'snapshot tidak valid';
  return null;
}

export async function listDrafts(user, brandId) {
  const own = user?.role === 'client' ? user?.userId ?? -1 : null;
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS} ${FROM}
      WHERE p.brand_id = $1 AND ($2::int IS NULL OR p.created_by = $2)
      ORDER BY p.updated_at DESC`,
    [brandId, own],
  );
  return rows;
}

export async function getDraft(id) {
  const { rows } = await pool.query(`SELECT ${LIST_COLUMNS}, p.document, p.snapshot ${FROM} WHERE p.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createDraft(brandId, body, userId) {
  const f = fieldsOf(body);
  const { rows } = await pool.query(
    `INSERT INTO ads_reports.presentation_reports
       (brand_id, name, period_old_start, period_old_end, period_cur_start, period_cur_end, channels, template_version, document, snapshot, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $11)
     RETURNING id, revision, updated_at`,
    [brandId, f.name, f.periodOldStart, f.periodOldEnd, f.periodCurStart, f.periodCurEnd, f.channels, f.templateVersion,
      JSON.stringify(body.document), body.snapshot ? JSON.stringify(body.snapshot) : null, userId ?? null],
  );
  return rows[0];
}

// Saves only when `baseRevision` is still current. `snapshot` is optional: the
// autosave leaves it out unless the figures were refreshed, keeping a typing
// save small. Returns null when the draft moved on since `baseRevision`.
export async function updateDraft(id, body, userId) {
  const f = fieldsOf(body);
  const hasSnapshot = body.snapshot !== undefined;
  const { rows } = await pool.query(
    `UPDATE ads_reports.presentation_reports SET
        name = $2, period_old_start = $3, period_old_end = $4, period_cur_start = $5, period_cur_end = $6,
        channels = $7, template_version = $8, document = $9::jsonb,
        snapshot = CASE WHEN $10::boolean THEN $11::jsonb ELSE snapshot END,
        revision = revision + 1, updated_by = $12, updated_at = now()
      WHERE id = $1 AND revision = $13
      RETURNING id, revision, updated_at`,
    [id, f.name, f.periodOldStart, f.periodOldEnd, f.periodCurStart, f.periodCurEnd, f.channels, f.templateVersion,
      JSON.stringify(body.document), hasSnapshot, hasSnapshot && body.snapshot ? JSON.stringify(body.snapshot) : null, userId ?? null, body.baseRevision],
  );
  return rows[0] ?? null;
}

export async function deleteDraft(id) {
  const { rows } = await pool.query(`SELECT storage_key FROM ads_reports.presentation_assets WHERE report_id = $1 AND storage_key IS NOT NULL`, [id]);
  await pool.query(`DELETE FROM ads_reports.presentation_reports WHERE id = $1`, [id]);
  // The rows are gone by cascade; the objects are not rows. A failed removal
  // leaves an orphan object, never a broken draft.
  await Promise.all(rows.map((r) => fileStore.deleteBytes(r.storage_key).catch(() => {})));
}

// Rewrites `assetId` references wherever they sit in the document.
export function remapAssetIds(node, idMap) {
  if (Array.isArray(node)) return node.map((n) => remapAssetIds(n, idMap));
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).map(([k, v]) => (k === 'assetId' && idMap[v] ? [k, idMap[v]] : [k, remapAssetIds(v, idMap)])));
}

// The image type from its first bytes, not the client's claim. SVG is left out
// on purpose: it can carry script and is served from this origin.
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

async function insertAsset(reportId, bytes, mime, userId) {
  const key = `presentation-assets/${reportId}/${crypto.randomUUID()}`;
  const { storageKey, rawFile } = await fileStore.storeBytes(key, bytes, mime);
  const { rows } = await pool.query(
    `INSERT INTO ads_reports.presentation_assets (report_id, mime, size_bytes, storage_key, raw_bytes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [reportId, mime, bytes.length, storageKey, rawFile, userId ?? null],
  );
  return rows[0].id;
}

export async function addAsset(reportId, bytes, mime, userId) {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ads_reports.presentation_assets WHERE report_id = $1`, [reportId]);
  if (rows[0].n >= MAX_ASSETS_PER_REPORT) return null;
  return insertAsset(reportId, bytes, mime, userId);
}

export async function readAsset(reportId, assetId) {
  const { rows } = await pool.query(`SELECT mime, storage_key, raw_bytes FROM ads_reports.presentation_assets WHERE id = $1 AND report_id = $2`, [assetId, reportId]);
  if (!rows[0]) return null;
  const bytes = await fileStore.readBytes({ rawFile: rows[0].raw_bytes, storageKey: rows[0].storage_key });
  return bytes ? { mime: rows[0].mime, bytes } : null;
}

// Same bytes as the source, under a new owner: the copy must keep working when
// the original draft (and its images) is deleted.
export async function duplicateDraft(source, userId) {
  const copy = await createDraft(source.brand_id, { name: `${source.name} (salinan)`, document: source.document, snapshot: source.snapshot }, userId);
  const { rows: assets } = await pool.query(`SELECT id, mime, storage_key, raw_bytes FROM ads_reports.presentation_assets WHERE report_id = $1`, [source.id]);
  const idMap = {};
  for (const a of assets) {
    const bytes = await fileStore.readBytes({ rawFile: a.raw_bytes, storageKey: a.storage_key });
    if (bytes) idMap[a.id] = await insertAsset(copy.id, bytes, a.mime, userId);
  }
  if (Object.keys(idMap).length) {
    await pool.query(`UPDATE ads_reports.presentation_reports SET document = $2::jsonb WHERE id = $1`, [copy.id, JSON.stringify(remapAssetIds(source.document, idMap))]);
  }
  return copy;
}
