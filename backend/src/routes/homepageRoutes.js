import { Router } from 'express';
import multer from 'multer';
import pool from '../config/db.js';
import { authenticate, requireModule } from '../middlewares/auth.js';
import { AppError } from '../utils/errors.js';

// The public homepage (before login) and the controls that manage it.
//
//   GET /api/public/homepage            — everything the page draws: photo and
//                                         logo lists, editable copy, the live
//                                         count of active clients. No auth.
//   GET /api/public/homepage/media/:id  — one image, long-cached by ETag.
//   /api/homepage/*                     — manage photos, logos and copy;
//                                         module `homepage_content` (admin by
//                                         default, widened in Pengaturan Akses).
//
// Only what is meant to be public leaves the public routes: images the team
// uploaded for the homepage, its copy, and a count — never a brand name or
// any client data.

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const IMAGE_MIME = ['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml', 'image/avif'];
// Images arrive already compressed in the browser; the cap only stops a raw
// camera file from slipping through when compression is unavailable.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (IMAGE_MIME.includes(file.mimetype) ? cb(null, true) : cb(new AppError('Hanya gambar (WebP, PNG, JPG, SVG) yang bisa diunggah', 400))),
});

// The copy fields the page reads, with the text it shows until someone
// edits them. Kept to facts the product already states.
const SETTING_DEFAULTS = {
  headline: 'Your ads, all in one place.',
  lede:
    "ATLAS is MIL Digital's analytics workspace. Meta, Shopee, TikTok and Google data from every client, turned into clear analysis and reports that are ready to send.",
  about:
    'MIL Digital runs performance marketing for brands across Meta Ads, Shopee Ads, TikTok GMV Max and Google Ads — from daily campaign execution to monthly client reporting.',
};
const SETTING_KEYS = Object.keys(SETTING_DEFAULTS);

const publicMedia = (r) => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  caption: r.caption,
  width: r.width,
  height: r.height,
  isActive: r.is_active,
  sortOrder: r.sort_order,
  version: new Date(r.updated_at).getTime(),
});

async function readSettings() {
  const { rows } = await pool.query('SELECT key, value FROM homepage_settings');
  const out = { ...SETTING_DEFAULTS };
  for (const r of rows) if (SETTING_KEYS.includes(r.key)) out[r.key] = r.value;
  return out;
}

export const publicHomepageRouter = Router();

publicHomepageRouter.get(
  '/',
  wrap(async (req, res) => {
    const [media, settings, clients] = await Promise.all([
      pool.query('SELECT id, kind, title, caption, width, height, is_active, sort_order, updated_at FROM homepage_media WHERE is_active ORDER BY kind, sort_order, id'),
      readSettings(),
      pool.query("SELECT count(*)::int AS n FROM public.brands WHERE status = 'active'").catch(() => ({ rows: [{ n: null }] })),
    ]);
    // Revalidated every time: the list is small, and an edit in the manage
    // panel must show on the next load. The images themselves cache for days.
    res.set('Cache-Control', 'no-cache');
    res.json({
      photos: media.rows.filter((r) => r.kind === 'photo').map(publicMedia),
      logos: media.rows.filter((r) => r.kind === 'logo').map(publicMedia),
      settings,
      stats: { activeClients: clients.rows[0]?.n ?? null },
    });
  }),
);

publicHomepageRouter.get(
  '/media/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw new AppError('Gambar tidak ditemukan', 404);
    const { rows } = await pool.query('SELECT mime, data, updated_at FROM homepage_media WHERE id = $1', [id]);
    const row = rows[0];
    // Hidden items still load (the manage panel previews them); they are only
    // left out of the public list above.
    if (!row) throw new AppError('Gambar tidak ditemukan', 404);
    const etag = `"${id}-${new Date(row.updated_at).getTime()}"`;
    res.set('ETag', etag);
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    // SVG uploads are served as images only, never as a document that could
    // run script in this origin.
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.type(row.mime).send(row.data);
  }),
);

export const homepageAdminRouter = Router();
homepageAdminRouter.use(authenticate, requireModule('homepage_content'));

// Everything, including hidden items and sizes, for the manage panel.
homepageAdminRouter.get(
  '/media',
  wrap(async (req, res) => {
    const { rows } = await pool.query('SELECT id, kind, title, caption, width, height, is_active, sort_order, byte_size, updated_at FROM homepage_media ORDER BY kind, sort_order, id');
    const total = rows.reduce((s, r) => s + r.byte_size, 0);
    res.json({ media: rows.map((r) => ({ ...publicMedia(r), byteSize: r.byte_size })), totalBytes: total, settings: await readSettings() });
  }),
);

homepageAdminRouter.post(
  '/media',
  upload.single('file'),
  wrap(async (req, res) => {
    const kind = req.body.kind;
    if (!['photo', 'logo'].includes(kind)) throw new AppError('Jenis gambar tidak dikenal', 400);
    if (!req.file) throw new AppError('Pilih gambar terlebih dahulu', 400);
    const width = Number(req.body.width) || null;
    const height = Number(req.body.height) || null;
    const { rows: order } = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM homepage_media WHERE kind = $1', [kind]);
    const { rows } = await pool.query(
      `INSERT INTO homepage_media (kind, title, caption, mime, data, byte_size, width, height, sort_order, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, kind, title, caption, width, height, is_active, sort_order, byte_size, updated_at`,
      [kind, (req.body.title || '').slice(0, 120) || null, (req.body.caption || '').slice(0, 240) || null, req.file.mimetype, req.file.buffer, req.file.size, width, height, order[0].next, req.user.userId],
    );
    res.status(201).json({ ...publicMedia(rows[0]), byteSize: rows[0].byte_size });
  }),
);

homepageAdminRouter.patch(
  '/media/:id',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const fields = [];
    const values = [];
    for (const [key, col, max] of [['title', 'title', 120], ['caption', 'caption', 240]]) {
      if (key in req.body) {
        values.push(String(req.body[key] ?? '').slice(0, max) || null);
        fields.push(`${col} = $${values.length}`);
      }
    }
    if ('isActive' in req.body) {
      values.push(Boolean(req.body.isActive));
      fields.push(`is_active = $${values.length}`);
    }
    if (!fields.length) throw new AppError('Tidak ada perubahan', 400);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE homepage_media SET ${fields.join(', ')}, updated_at = now() WHERE id = $${values.length}
       RETURNING id, kind, title, caption, width, height, is_active, sort_order, byte_size, updated_at`,
      values,
    );
    if (!rows[0]) throw new AppError('Gambar tidak ditemukan', 404);
    res.json({ ...publicMedia(rows[0]), byteSize: rows[0].byte_size });
  }),
);

homepageAdminRouter.put(
  '/media/order',
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
    if (!ids.length) throw new AppError('Urutan kosong', 400);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ids.length; i++) await client.query('UPDATE homepage_media SET sort_order = $1 WHERE id = $2', [i + 1, ids[i]]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  }),
);

homepageAdminRouter.delete(
  '/media/:id',
  wrap(async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM homepage_media WHERE id = $1', [Number(req.params.id)]);
    if (!rowCount) throw new AppError('Gambar tidak ditemukan', 404);
    res.json({ ok: true });
  }),
);

homepageAdminRouter.put(
  '/settings',
  wrap(async (req, res) => {
    const entries = Object.entries(req.body || {}).filter(([k]) => SETTING_KEYS.includes(k));
    if (!entries.length) throw new AppError('Tidak ada perubahan', 400);
    for (const [k, v] of entries) {
      const value = String(v ?? '').trim().slice(0, 600);
      if (!value) await pool.query('DELETE FROM homepage_settings WHERE key = $1', [k]);
      else
        await pool.query(
          `INSERT INTO homepage_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
          [k, value, req.user.userId],
        );
    }
    res.json({ settings: await readSettings() });
  }),
);

