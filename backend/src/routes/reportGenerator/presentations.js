import { Router } from 'express';
import multer from 'multer';
import * as drafts from '../../services/presentationReportService.js';
import * as presentationAi from '../../services/presentationAiService.js';
import * as brandService from '../../services/brandService.js';
import { canAccessBrand } from '../../middlewares/brandAccess.js';
import { AiSummaryError } from '../../services/aiSummaryService.js';

// Presentation Report Builder — drafts, their images, and narrative drafting.
// The analytic figures are computed in the browser by the same builders the
// Performance Report uses; this router stores them and never recalculates.
// `authenticate`, the report_generator module check and the view-only write
// block come from reportGeneratorRoutes.js.
export const presentationsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: drafts.MAX_ASSET_BYTES, files: 1 } });

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

// Loads the draft named in the URL and applies the access rule. Someone who may
// not open a draft gets the same 404 as a missing one, so ids reveal nothing.
async function loadDraft(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    fail(res, 400, 'id tidak valid');
    return null;
  }
  const row = await drafts.getDraft(id);
  if (!drafts.canOpenDraft(req.user, row)) {
    fail(res, 404, 'Presentasi tidak ditemukan');
    return null;
  }
  return row;
}

presentationsRouter.get('/', async (req, res) => {
  const brandId = Number(req.query.client_id);
  if (!Number.isInteger(brandId)) return fail(res, 400, 'client_id wajib diisi');
  if (!canAccessBrand(req.user, brandId)) return fail(res, 403, 'Akses ditolak untuk brand ini.');
  res.json({ drafts: await drafts.listDrafts(req.user, brandId) });
});

// Declared before /:id so "ai" is never read as an id.
presentationsRouter.get('/ai/status', (req, res) => {
  res.json(presentationAi.status());
});

presentationsRouter.post('/ai/generate', async (req, res) => {
  const brandId = Number(req.body?.client_id);
  if (!Number.isInteger(brandId)) return fail(res, 400, 'client_id wajib diisi');
  if (!canAccessBrand(req.user, brandId)) return fail(res, 403, 'Akses ditolak untuk brand ini.');
  const problem = presentationAi.validateRequest(req.body);
  if (problem) return fail(res, 400, problem);
  const brand = await brandService.getBrandById(brandId);
  if (!brand) return fail(res, 404, 'Brand tidak ditemukan');
  try {
    res.json(await presentationAi.generateNarrative({ ...req.body, brandId, brandName: brand.brand_name }));
  } catch (err) {
    // Failing AI must never look like a failing draft: the builder shows this
    // beside the button and everything manual keeps working.
    if (err instanceof AiSummaryError) return fail(res, err.statusCode, err.message);
    throw err;
  }
});

presentationsRouter.post('/', async (req, res) => {
  const brandId = Number(req.body?.client_id);
  if (!Number.isInteger(brandId)) return fail(res, 400, 'client_id wajib diisi');
  if (!canAccessBrand(req.user, brandId)) return fail(res, 403, 'Akses ditolak untuk brand ini.');
  const problem = drafts.validateDraftBody(req.body);
  if (problem) return fail(res, 400, problem);
  const brand = await brandService.getBrandById(brandId);
  if (!brand) return fail(res, 404, 'Brand tidak ditemukan');
  res.status(201).json(await drafts.createDraft(brandId, req.body, req.user?.userId));
});

presentationsRouter.get('/:id', async (req, res) => {
  const row = await loadDraft(req, res);
  if (row) res.json(row);
});

presentationsRouter.put('/:id', async (req, res) => {
  const row = await loadDraft(req, res);
  if (!row) return;
  const problem = drafts.validateDraftBody(req.body);
  if (problem) return fail(res, 400, problem);
  if (!Number.isInteger(req.body.baseRevision)) return fail(res, 400, 'baseRevision wajib diisi');
  const saved = await drafts.updateDraft(row.id, req.body, req.user?.userId);
  if (!saved) return res.status(409).json({ error: 'Draft ini sudah berubah di tempat lain.', revision: (await drafts.getDraft(row.id))?.revision ?? null });
  res.json(saved);
});

presentationsRouter.delete('/:id', async (req, res) => {
  const row = await loadDraft(req, res);
  if (!row) return;
  await drafts.deleteDraft(row.id);
  res.status(204).end();
});

presentationsRouter.post('/:id/duplicate', async (req, res) => {
  const row = await loadDraft(req, res);
  if (!row) return;
  res.status(201).json(await drafts.duplicateDraft(row, req.user?.userId));
});

presentationsRouter.post('/:id/assets', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return fail(res, 413, 'Ukuran gambar maksimal 5 MB.');
    if (err) return next(err);
    next();
  });
}, async (req, res) => {
  const row = await loadDraft(req, res);
  if (!row) return;
  if (!req.file) return fail(res, 400, 'File gambar wajib diisi');
  const mime = drafts.sniffImage(req.file.buffer);
  if (!mime) return fail(res, 415, 'Hanya gambar PNG, JPG, atau WebP yang didukung.');
  const assetId = await drafts.addAsset(row.id, req.file.buffer, mime, req.user?.userId);
  if (!assetId) return fail(res, 409, `Satu presentasi menampung maksimal ${drafts.MAX_ASSETS_PER_REPORT} gambar.`);
  res.status(201).json({ assetId, mime });
});

presentationsRouter.get('/:id/assets/:assetId', async (req, res) => {
  const row = await loadDraft(req, res);
  if (!row) return;
  const assetId = Number(req.params.assetId);
  if (!Number.isInteger(assetId)) return fail(res, 400, 'assetId tidak valid');
  const asset = await drafts.readAsset(row.id, assetId);
  if (!asset) return fail(res, 404, 'Gambar tidak ditemukan');
  res.set({ 'Content-Type': asset.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=3600' });
  res.send(asset.bytes);
});
