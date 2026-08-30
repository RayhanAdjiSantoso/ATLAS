import { Router } from 'express';
import * as metaAutomationController from '../src/controllers/metaAutomationController.js';

// Standalone test routes -- same paths/behavior as ../src/routes/metaAutomationRoutes.js,
// deliberately WITHOUT authenticate/authorize('admin'). For local round-trip
// testing against the Apps Script Web App only; not wired into app.js.
const router = Router();

router.get('/accounts', metaAutomationController.getAccounts);
router.get('/log', metaAutomationController.getLog);

router.post('/weekly/run', metaAutomationController.weeklyRun);
router.post('/weekly/check-tokens', metaAutomationController.weeklyCheckTokens);

router.post('/daily/run', metaAutomationController.dailyRun);
router.post('/daily/reset-cooldown', metaAutomationController.dailyResetCooldown);

router.get('/tracking', metaAutomationController.trackingList);
router.post('/tracking', metaAutomationController.trackingCreate);
router.put('/tracking/:id', metaAutomationController.trackingUpdate);
router.delete('/tracking/:id', metaAutomationController.trackingDelete);
router.post('/tracking/:id/preview', metaAutomationController.trackingPreview);
router.post('/tracking/run-all', metaAutomationController.trackingRunAll);

router.get('/brand-accounts', metaAutomationController.brandAccountList);
router.post('/brand-accounts', metaAutomationController.brandAccountCreate);
router.put('/brand-accounts/:id', metaAutomationController.brandAccountUpdate);
router.delete('/brand-accounts/:id', metaAutomationController.brandAccountDelete);
router.get('/brand-accounts/:id/campaigns', metaAutomationController.brandAccountCampaigns);

export default router;
