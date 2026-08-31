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

router.get('/brands', metaAutomationController.brandList);
router.post('/brands', metaAutomationController.brandCreate);
router.put('/brands/:id', metaAutomationController.brandUpdate);
router.delete('/brands/:id', metaAutomationController.brandDelete);

router.get('/subscriptions', metaAutomationController.subscriptionList);
router.post('/subscriptions', metaAutomationController.subscriptionCreate);
router.put('/subscriptions/:id', metaAutomationController.subscriptionUpdate);
router.delete('/subscriptions/:id', metaAutomationController.subscriptionDelete);

export default router;
