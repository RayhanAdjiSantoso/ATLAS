import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { requireBrandAccess } from '../middlewares/brandAccess.js';
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

// Daily Tracking — unlike every other brand-scoped router, view-only/client
// accounts MUST be able to write here (their own brand's daily sales + ad
// spend), so this router deliberately never applies blockWriteIfViewOnly.
// requireBrandAccess still keeps a brand-locked account inside its own brand.
// Middleware is attached per-route (not via one router.use(...)) because one
// route (POST /ingest) is a machine-to-machine call authenticated by a shared
// secret instead of a user JWT.
const router = Router();

router.get(
  '/channels',
  authenticate, requireBrandAccess((req) => req.query.brandId),
  channelsQueryValidation, ctrl.listChannels,
);
router.post(
  '/channels',
  authenticate, requireBrandAccess((req) => req.body.brandId),
  addChannelBodyValidation, ctrl.addChannel,
);
router.get(
  '/entries',
  authenticate, requireBrandAccess((req) => req.query.brandId),
  entriesQueryValidation, ctrl.listEntries,
);
router.put(
  '/entries',
  authenticate, requireBrandAccess((req) => req.body.brandId),
  upsertEntriesBodyValidation, ctrl.upsertEntries,
);
router.post(
  '/import',
  authenticate, uploadDataFile.single('file'), requireBrandAccess((req) => req.body.brandId),
  importFileBodyValidation, ctrl.importFile,
);
router.post(
  '/meta-sync',
  authenticate, authorize('admin'),
  metaSyncBodyValidation, ctrl.runMetaSync,
);
router.post(
  '/ingest',
  verifyIngestKey,
  ingestBodyValidation, ctrl.ingestFromAppsScript,
);

export default router;
