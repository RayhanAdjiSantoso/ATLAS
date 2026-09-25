import { Router } from 'express';
import { authenticate, authorize, requireModule } from '../middlewares/auth.js';
import { requireBrandAccess } from '../middlewares/brandAccess.js';
import { AppError } from '../utils/errors.js';
import { verifyIngestKey } from '../middlewares/dailyTrackingIngestAuth.js';
import { uploadDataFile } from '../middlewares/upload.js';
import * as ctrl from '../controllers/dailyTrackingController.js';
import {
  channelsQueryValidation,
  addChannelBodyValidation,
  entriesQueryValidation,
  upsertEntriesBodyValidation,
  importFileBodyValidation,
  metaSyncBodyValidation,
  ingestBodyValidation,
} from '../validators/dailyTrackingValidators.js';

// Daily Tracking — unlike every other brand-scoped router, client accounts
// (view-only or not) MUST be able to write here, but only their own brand's
// daily revenue. Ad spend is the team's number: a client may read it, never
// enter, import, delete or add a channel for it (clientRevenueOnly).
// requireBrandAccess keeps a brand-locked account inside its own brand.
// Middleware is attached per-route (not via one router.use(...)) because one
// route (POST /ingest) is a machine-to-machine call authenticated by a shared
// secret instead of a user JWT.
const router = Router();
const dailyTracking = requireModule('daily_tracking');

// What a client may change: revenue rows and revenue channels. Import and
// month deletion touch spend too, so they stay with the team.
function clientRevenueOnly(req, res, next) {
  if (req.user?.role !== 'client') return next();
  const touchesSpend =
    req.method === 'DELETE'
    || req.path === '/import'
    || (req.path === '/channels' && req.body?.kind !== 'sales')
    || (req.path === '/entries' && Array.isArray(req.body?.spend) && req.body.spend.length > 0);
  if (touchesSpend) return next(new AppError('Akun client hanya dapat mengisi data revenue', 403));
  next();
}

router.get(
  '/channels',
  authenticate, dailyTracking, requireBrandAccess((req) => req.query.brandId),
  channelsQueryValidation, ctrl.listChannels,
);
router.post(
  '/channels',
  authenticate, dailyTracking, clientRevenueOnly, requireBrandAccess((req) => req.body.brandId),
  addChannelBodyValidation, ctrl.addChannel,
);
router.get(
  '/entries',
  authenticate, dailyTracking, requireBrandAccess((req) => req.query.brandId),
  entriesQueryValidation, ctrl.listEntries,
);
router.put(
  '/entries',
  authenticate, dailyTracking, clientRevenueOnly, requireBrandAccess((req) => req.body.brandId),
  upsertEntriesBodyValidation, ctrl.upsertEntries,
);
router.delete(
  '/entries',
  authenticate, dailyTracking, clientRevenueOnly, requireBrandAccess((req) => req.query.brandId),
  entriesQueryValidation, ctrl.deleteMonthEntries,
);
router.post(
  '/import',
  authenticate, dailyTracking, clientRevenueOnly, uploadDataFile.single('file'), requireBrandAccess((req) => req.body.brandId),
  importFileBodyValidation, ctrl.importFile,
);
router.post(
  '/meta-sync',
  authenticate, dailyTracking, authorize('admin'),
  metaSyncBodyValidation, ctrl.runMetaSync,
);
router.post(
  '/ingest',
  verifyIngestKey,
  ingestBodyValidation, ctrl.ingestFromAppsScript,
);

export default router;
