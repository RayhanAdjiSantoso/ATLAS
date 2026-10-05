import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, authorize, requireModule } from '../middlewares/auth.js';
import { requireBrandAccess, blockWriteIfViewOnly } from '../middlewares/brandAccess.js';
import * as ctrl from '../controllers/googleAdsController.js';
import {
  brandQueryValidation, addAccountValidation, updateAccountValidation, removeAccountValidation,
  resyncValidation, reportValidation, conversionGoalValidation,
  recommendationListValidation, recommendationGenerateValidation, recommendationUpdateValidation, recommendationTaskValidation,
  experimentBodyValidation, experimentIdBodyValidation, experimentIdQueryValidation, alertUpdateValidation, adCopyValidation,
  feedbackValidation, calibrationValidation,
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
// Files Data & file archive copies for every finished month already synced.
router.post('/library/rebuild', settings, requireBrandAccess((req) => req.body.brandId), [body('brandId').isInt({ min: 1 })], ctrl.rebuildLibrary);
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
// Writes into the brand's MOM, which belongs to Pengaturan Brand: needs that access too.
router.post('/recommendations/:id/task', reports, settings, brandB, recommendationTaskValidation, ctrl.recommendationToTask);
router.get('/experiments', reports, brandQ, brandQueryValidation, ctrl.listExperiments);
router.post('/experiments', reports, brandB, experimentBodyValidation, ctrl.createExperiment);
router.patch('/experiments/:id', reports, brandB, experimentIdBodyValidation, ctrl.updateExperiment);
router.delete('/experiments/:id', reports, brandQ, experimentIdQueryValidation, ctrl.deleteExperiment);
router.post('/experiments/:id/evaluate', reports, brandB, experimentIdBodyValidation, ctrl.evaluateExperiment);
router.post('/ad-copy', reports, brandB, adCopyValidation, ctrl.suggestAdCopy);
// Internal calibration and operations tools (no secrets in any response).
router.post('/feedback', reports, brandB, feedbackValidation, ctrl.saveFeedback);
router.get('/feedback', reports, brandQ, brandQueryValidation, ctrl.listFeedback);
router.get('/ops', requireModule('brand_settings', 'report_generator'), brandQ, brandQueryValidation, ctrl.operations);
// Across brands when brandId is omitted: admin only.
router.get('/calibration', reports, calibrationValidation, (req, res, next) => (req.query.brandId ? requireBrandAccess((r) => r.query.brandId)(req, res, next) : authorize('admin')(req, res, next)), ctrl.rulePerformance);
router.get('/alerts', requireModule('brand_settings', 'report_generator'), brandQ, brandQueryValidation, ctrl.listAlerts);
router.patch('/alerts/:id', reports, brandB, alertUpdateValidation, ctrl.setAlertStatus);

router.get('/report', requireModule('report_generator'), requireBrandAccess((req) => req.query.brandId), reportValidation, ctrl.getReport);

export default router;
