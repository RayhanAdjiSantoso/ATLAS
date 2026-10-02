import { Router } from 'express';
import { authenticate, requireModule } from '../middlewares/auth.js';
import { requireBrandAccess, blockWriteIfViewOnly } from '../middlewares/brandAccess.js';
import * as ctrl from '../controllers/googleAdsController.js';
import {
  brandQueryValidation, addAccountValidation, updateAccountValidation, removeAccountValidation,
  resyncValidation, reportValidation,
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

router.get('/report', requireModule('report_generator'), requireBrandAccess((req) => req.query.brandId), reportValidation, ctrl.getReport);

export default router;
