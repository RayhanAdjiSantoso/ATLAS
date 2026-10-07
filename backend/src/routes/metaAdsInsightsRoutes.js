import { Router } from 'express';
import { authenticate, requireModule } from '../middlewares/auth.js';
import { requireBrandAccess } from '../middlewares/brandAccess.js';
import * as ctrl from '../controllers/metaAdsInsightsController.js';
import {
  brandQueryValidation, saveConfigValidation, fetchNowValidation, syncLibraryValidation, deleteMonthValidation,
  exportRangeValidation,
} from '../validators/metaAdsInsightsValidators.js';

// Meta Ads auto-fetch settings for Pengaturan Brand › Performance Database. Admin
// only, like every other route that reaches Apps Script / the Meta tokens
// (see metaAutomationRoutes.js). The two read-only routes for the Report
// Generator's custom range come first: they only read stored rows, so they
// follow the Report Generator's access instead of the admin gate.
const router = Router();

router.use(authenticate);

const reportGenerator = requireModule('report_generator');
router.get('/days', reportGenerator, requireBrandAccess((req) => req.query.brandId), brandQueryValidation, ctrl.getStoredDays);
router.get('/export', reportGenerator, requireBrandAccess((req) => req.query.brandId), exportRangeValidation, ctrl.exportRange);

router.use(requireModule('meta_automation'));

router.get('/overview', requireBrandAccess((req) => req.query.brandId), brandQueryValidation, ctrl.getOverview);
router.get('/accounts', requireBrandAccess((req) => req.query.brandId), brandQueryValidation, ctrl.listAccounts);
router.put('/config', requireBrandAccess((req) => req.body.brandId), saveConfigValidation, ctrl.saveConfig);
router.post('/fetch', requireBrandAccess((req) => req.body.brandId), fetchNowValidation, ctrl.fetchNow);
router.post('/library', requireBrandAccess((req) => req.body.brandId), syncLibraryValidation, ctrl.syncLibrary);
router.delete('/months', requireBrandAccess((req) => req.query.brandId), deleteMonthValidation, ctrl.deleteMonth);

export default router;
