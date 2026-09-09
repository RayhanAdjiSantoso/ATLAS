import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import * as dashboardController from '../controllers/dashboardController.js';

const router = Router();

router.use(authenticate);

router.get('/filters', dashboardController.getDashboardFilters);
router.get('/executive-snapshot', dashboardController.getExecutiveSnapshot);
router.get('/business-growth', dashboardController.getBusinessGrowth);
router.get('/traffic-funnel', dashboardController.getTrafficAndFunnel);
router.get('/rfm', dashboardController.getRfmAnalysis);
router.get('/transaction-behavior', dashboardController.getTransactionBehavior);
router.get('/basket-analysis', dashboardController.getBasketAnalysis);
router.get('/root-cause', dashboardController.getRootCauseAnalysis);
router.get('/product-performance', dashboardController.getProductPerformance);

export default router;
