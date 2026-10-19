import { Router } from 'express';
import multer from 'multer';
import * as fileStore from '../services/fileStore.js';
import * as brandService from '../services/brandService.js';
import { AppError } from '../utils/errors.js';

// A brand's logo (migration 053).
//
//   PUT    /api/brands/:brandId/logo   — upload or replace (multipart `file`)
//   DELETE /api/brands/:brandId/logo   — back to the brand's initials
//     (mounted in brandRoutes: signed in, brand access, module brand_settings,
//     not view-only)
//   GET    /api/public/brand-logo/:brandId — the image itself. Public, like the
//     homepage's client logos, because an <img> cannot send the session token;
//     the URL carries ?v=<logo_version> so a replaced logo is a new URL and
//     the old one can be cached for long.

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const IMAGE_MIME = ['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml', 'image/avif'];

// The browser shrinks logos before sending (utils/compressImage.js); the cap
// only stops a raw file from slipping through.
export const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (IMAGE_MIME.includes(file.mimetype) ? cb(null, true) : cb(new AppError('Logo harus berupa gambar (PNG, JPG, WebP, atau SVG)', 400))),
});

const brandIdOf = (req) => {
  const id = Number(req.params.brandId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Brand tidak valid', 400);
  return id;
};

export const uploadLogo = wrap(async (req, res) => {
  if (!req.file) throw new AppError('Pilih file logo terlebih dahulu', 400);
  try {
    const brand = await brandService.setBrandLogo(brandIdOf(req), req.file.buffer, req.file.mimetype);
    if (!brand) throw new AppError('Brand tidak ditemukan', 404);
    res.json({ brand });
  } catch (err) {
    if (err.message === 'FILE_STORE_OFF') throw new AppError('Penyimpanan file belum dikonfigurasi di server', 503);
    throw err;
  }
});

export const deleteLogo = wrap(async (req, res) => {
  const brand = await brandService.removeBrandLogo(brandIdOf(req));
  if (!brand) throw new AppError('Brand tidak ditemukan', 404);
  res.json({ brand });
});

export const publicBrandLogoRouter = Router();
publicBrandLogoRouter.get('/:brandId', wrap(async (req, res) => {
  const logo = await brandService.getBrandLogo(brandIdOf(req));
  if (!logo) throw new AppError('Logo tidak ditemukan', 404);
  const etag = `"brand-logo-${req.params.brandId}-${new Date(logo.logo_updated_at).getTime()}"`;
  res.set('ETag', etag);
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  // SVG is served as an image only, never as a document that could run script.
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  const bytes = await fileStore.readBytes({ storageKey: logo.logo_key });
  if (!bytes) throw new AppError('Logo tidak ditemukan', 404);
  res.type(logo.logo_mime).send(bytes);
}));
