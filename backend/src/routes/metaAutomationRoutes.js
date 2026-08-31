import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import * as metaAutomationController from '../controllers/metaAutomationController.js';

const router = Router();

router.use(authenticate, authorize('admin'));

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
