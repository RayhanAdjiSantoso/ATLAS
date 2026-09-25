import { Router } from 'express';
import { authenticate, requireModule } from '../middlewares/auth.js';
import { requireBrandAccess } from '../middlewares/brandAccess.js';
import * as dashboardController from '../controllers/dashboardController.js';

const router = Router();

router.use(authenticate, requireModule('dashboard'));

const brandScoped = requireBrandAccess((req) => req.query.brandId);

// /filters is not brand-scoped -- it returns the brand list itself
// (already filtered per-user inside the controller).
router.get('/filters', dashboardController.getDashboardFilters);
router.get('/executive-snapshot', brandScoped, dashboardController.getExecutiveSnapshot);
router.get('/executive-summary', dashboardController.getExecutiveSummary);
router.get('/business-growth', brandScoped, dashboardController.getBusinessGrowth);
router.get('/traffic-funnel', brandScoped, dashboardController.getTrafficAndFunnel);
router.get('/rfm', brandScoped, dashboardController.getRfmAnalysis);
router.get('/transaction-behavior', brandScoped, dashboardController.getTransactionBehavior);
router.get('/basket-analysis', brandScoped, dashboardController.getBasketAnalysis);
router.get('/root-cause', brandScoped, dashboardController.getRootCauseAnalysis);
router.get('/product-performance', brandScoped, dashboardController.getProductPerformance);

export default router;
