import { Router } from 'express';
import { authenticate, requireModule } from '../middlewares/auth.js';
import { requireBrandAccess, blockWriteIfViewOnly } from '../middlewares/brandAccess.js';
import * as ctrl from '../controllers/googleAdsController.js';
import {
  brandQueryValidation, addAccountValidation, updateAccountValidation, removeAccountValidation,
  resyncValidation, reportValidation, conversionGoalValidation,
  recommendationListValidation, recommendationGenerateValidation, recommendationUpdateValidation, recommendationTaskValidation,
  experimentBodyValidation, experimentIdBodyValidation, experimentIdQueryValidation, alertUpdateValidation,
} from '../validators/googleAdsValidators.js';

// Google Ads: which accounts feed a brand (Pengaturan Brand › Google Ads)
// and the report built from their numbers (Report Generator › Google Ads).
// Customer IDs are not secrets — the credentials live with the fetcher — so
// this follows Pengaturan Brand's access, not Meta Automation's admin gate.
const router = Router();

router.use(authenticate, blockWriteIfViewOnly);

const settings = requireModule('brand_settings');
router.get('/overview', requireModule('brand_settings', 'report_generator'), requireBrandAccess((req) => req.query.brandId), brandQueryValidation, ctrl.getOverview);
router.post('/accounts', settings, requireBrandAccess((req) => req.body.brandId), addAccountValidation, ctrl.addAccount);
router.patch('/accounts/:accountId', settings, requireBrandAccess((req) => req.body.brandId), updateAccountValidation, ctrl.updateAccount);
router.delete('/accounts/:accountId', settings, requireBrandAccess((req) => req.query.brandId), removeAccountValidation, ctrl.removeAccount);
router.post('/accounts/:accountId/resync', settings, requireBrandAccess((req) => req.body.brandId), resyncValidation, ctrl.requestResync);

// Which goal (purchase / lead / micro / other / ignore) each conversion
// action counts toward — read by the report, set in Pengaturan Brand.
router.get('/conversion-goals', requireModule('brand_settings', 'report_generator'), requireBrandAccess((req) => req.query.brandId), brandQueryValidation, ctrl.getConversionGoals);
router.put('/conversion-goals', settings, requireBrandAccess((req) => req.body.brandId), conversionGoalValidation, ctrl.setConversionGoal);

// Optimisation: AI recommendations, experiments, alerts. Proposals and
// records only — nothing here writes to a Google Ads account.
const reports = requireModule('report_generator');
const brandQ = requireBrandAccess((req) => req.query.brandId);
const brandB = requireBrandAccess((req) => req.body.brandId);
router.get('/recommendations', reports, brandQ, recommendationListValidation, ctrl.listRecommendations);
router.post('/recommendations/generate', reports, brandB, recommendationGenerateValidation, ctrl.generateRecommendations);
router.patch('/recommendations/:id', reports, brandB, recommendationUpdateValidation, ctrl.updateRecommendation);
router.post('/recommendations/:id/task', reports, brandB, recommendationTaskValidation, ctrl.recommendationToTask);
router.get('/experiments', reports, brandQ, brandQueryValidation, ctrl.listExperiments);
router.post('/experiments', reports, brandB, experimentBodyValidation, ctrl.createExperiment);
router.patch('/experiments/:id', reports, brandB, experimentIdBodyValidation, ctrl.updateExperiment);
router.delete('/experiments/:id', reports, brandQ, experimentIdQueryValidation, ctrl.deleteExperiment);
router.post('/experiments/:id/evaluate', reports, brandB, experimentIdBodyValidation, ctrl.evaluateExperiment);
router.get('/alerts', requireModule('brand_settings', 'report_generator'), brandQ, brandQueryValidation, ctrl.listAlerts);
router.patch('/alerts/:id', reports, brandB, alertUpdateValidation, ctrl.setAlertStatus);

router.get('/report', requireModule('report_generator'), requireBrandAccess((req) => req.query.brandId), reportValidation, ctrl.getReport);

export default router;
