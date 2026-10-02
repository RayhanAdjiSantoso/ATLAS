import express, { Router } from 'express';
import { verifyIngestKey } from '../middlewares/dailyTrackingIngestAuth.js';
import * as ctrl from '../controllers/googleAdsController.js';
import { startRunValidation, rowsValidation, finishValidation } from '../validators/googleAdsValidators.js';

// Machine-to-machine: the Google Ads Script (apps-script/GoogleAdsReport.js)
// asks /jobs what to fetch, then reports each job through start -> rows
// (repeated) -> finish. A future Google Ads API fetcher uses the same calls.
// No user JWT; the Daily Tracking ingest's shared secret stands in for it.
//
// Mounted in app.js BEFORE the global express.json() (100kb limit): a chunk
// of rows is larger than that. 4mb stays under Vercel's 4.5MB request cap.
const router = Router();

router.use(express.json({ limit: '4mb' }));
router.use(verifyIngestKey);

router.get('/jobs', ctrl.getJobs);
router.post('/start', startRunValidation, ctrl.startRun);
router.post('/rows', rowsValidation, ctrl.ingestRows);
router.post('/finish', finishValidation, ctrl.finishRun);

export default router;
