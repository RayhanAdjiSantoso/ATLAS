import express, { Router } from 'express';
import { verifyIngestKey } from '../middlewares/dailyTrackingIngestAuth.js';
import * as ctrl from '../controllers/metaAdsInsightsController.js';
import { startRunValidation, rowsValidation, finishValidation, libraryRunValidation } from '../validators/metaAdsInsightsValidators.js';

// Machine-to-machine: Apps Script's monthly trigger (apps-script/MetaAdsMonthly.gs)
// reports one run through start -> rows (repeated) -> finish. No user JWT;
// the same shared secret as the Daily Tracking ingest stands in for it.
//
// Mounted in app.js BEFORE the global express.json() (default limit 100kb):
// a chunk of insight rows is far larger than that, so this router brings its
// own parser. 4mb stays under Vercel's 4.5MB request cap.
const router = Router();

router.use(express.json({ limit: '4mb' }));
router.use(verifyIngestKey);

router.post('/start', startRunValidation, ctrl.startRun);
router.post('/rows', rowsValidation, ctrl.ingestRows);
router.post('/finish', finishValidation, ctrl.finishRun);
router.post('/library', libraryRunValidation, ctrl.syncLibraryFromRun);

export default router;
