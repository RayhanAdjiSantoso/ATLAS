import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import { requireBrandAccess } from '../middlewares/brandAccess.js';
import * as ctrl from '../controllers/metaAdsInsightsController.js';
import {
  brandQueryValidation, saveConfigValidation, fetchNowValidation, deleteMonthValidation,
} from '../validators/metaAdsInsightsValidators.js';

// Meta Ads auto-fetch settings for Pengaturan Brand › Data & file. Admin
// only, like every other route that reaches Apps Script / the Meta tokens
// (see metaAutomationRoutes.js).
const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/overview', requireBrandAccess((req) => req.query.brandId), brandQueryValidation, ctrl.getOverview);
router.get('/accounts', requireBrandAccess((req) => req.query.brandId), brandQueryValidation, ctrl.listAccounts);
router.put('/config', requireBrandAccess((req) => req.body.brandId), saveConfigValidation, ctrl.saveConfig);
router.post('/fetch', requireBrandAccess((req) => req.body.brandId), fetchNowValidation, ctrl.fetchNow);
router.delete('/months', requireBrandAccess((req) => req.query.brandId), deleteMonthValidation, ctrl.deleteMonth);

export default router;
