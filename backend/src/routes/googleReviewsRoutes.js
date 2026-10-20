import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { authenticate, requireModule } from '../middlewares/auth.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as service from '../services/googleReviews/googleReviewsService.js';
import * as csvImport from '../services/googleReviews/csvImportService.js';
import { limits as csvLimits } from '../services/googleReviews/csvSchema.js';

// Google Reviews Analytics. Open to roles with the `google_reviews` module;
// within it, an account limited to some brands sees only the businesses of
// those brands and the ones it added (service.canSee). View-only accounts
// read dashboards but cannot search, add a business, import or start a run
// (authenticate blocks their writes). Source keys and the AI key stay on the
// server — the page only talks to these routes.
const router = Router();
router.use(authenticate, requireModule('google_reviews'));

// CSV upload: in memory (no disk on serverless), one file, .csv only. The
// size cap sits under Vercel's ~4.5 MB request body limit.
const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: csvLimits().maxBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.csv') return cb(new AppError('File harus berekstensi .csv.', 400));
    cb(null, true);
  },
});

router.get('/sources', (req, res) => {
  res.json(service.getSources());
});

// A search costs a request at the source, so it is a POST: view-only
// accounts, which cannot add a business anyway, do not spend it.
router.post('/search', asyncHandler(async (req, res) => {
  res.json({ results: await service.searchBusinesses(req.body?.query, req.user) });
}));

router.get('/businesses', asyncHandler(async (req, res) => {
  res.json({ businesses: await service.listBusinesses(req.user) });
}));

router.post('/businesses', asyncHandler(async (req, res) => {
  res.status(201).json({ business: await service.selectBusiness(req.body?.placeId, req.user) });
}));

router.patch('/businesses/:id/brand', asyncHandler(async (req, res) => {
  res.json({ business: await service.setBusinessBrand(req.params.id, req.body?.brandId ?? null, req.user) });
}));

router.get('/businesses/:id/dashboard', asyncHandler(async (req, res) => {
  res.json(await service.getDashboard(req.params.id, req.user, { method: req.query.method }));
}));

router.get('/businesses/:id/trend', asyncHandler(async (req, res) => {
  res.json(await service.getTrend(req.params.id, req.query, req.user));
}));

router.get('/businesses/:id/reviews', asyncHandler(async (req, res) => {
  res.json(await service.listReviews(req.params.id, req.query, req.user));
}));

router.post('/businesses/:id/runs', asyncHandler(async (req, res) => {
  res.status(201).json({ run: await service.startRun(req.params.id, { mode: req.body?.mode, method: req.body?.method }, req.user) });
}));

// Run Sentiment Analysis with the chosen method (default: code). Reads only
// what that method has not read yet (new, edited, failed, or read by an
// older engine). AI is never chosen on the user's behalf.
router.post('/businesses/:id/analysis', asyncHandler(async (req, res) => {
  const b = await service.getVisibleBusiness(req.params.id, req.user);
  const method = req.body?.method ?? 'code';
  if (!service.METHODS.includes(method)) throw new AppError('Metode analisis tidak dikenal.', 400);
  res.status(201).json({ run: await service.startAnalysis(b.id, req.user.userId, method) });
}));

router.get('/runs/:id', asyncHandler(async (req, res) => {
  res.json({ run: await service.getRun(req.params.id, req.user) });
}));

router.post('/runs/:id/step', asyncHandler(async (req, res) => {
  res.json({ run: await service.stepRun(req.params.id, req.user) });
}));

router.post('/runs/:id/cancel', asyncHandler(async (req, res) => {
  res.json({ run: await service.cancelRun(req.params.id, req.user) });
}));

/* ── CSV import ───────────────────────────────────────────────────────── */

router.get('/imports', asyncHandler(async (req, res) => {
  res.json({ imports: await csvImport.listImports(req.user, { businessId: req.query.businessId || undefined }) });
}));

router.post('/imports/preview', uploadCsv.single('file'), asyncHandler(async (req, res) => {
  res.status(201).json({ import: await csvImport.previewImport(req.user, req.file) });
}));

router.post('/imports/:id/confirm', asyncHandler(async (req, res) => {
  const { businessId, createNew, brandId } = req.body ?? {};
  res.json({ import: await csvImport.confirmImport(req.user, req.params.id, { businessId, createNew: createNew === true, brandId }) });
}));

router.post('/imports/:id/cancel', asyncHandler(async (req, res) => {
  res.json({ import: await csvImport.cancelImport(req.user, req.params.id) });
}));

export default router;
