import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import * as ctrl from '../controllers/internalDashboardController.js';
import {
  brandQueryValidation,
  ingestionLogQueryValidation,
  idParamValidation,
  monthlyMetricsBodyValidation,
  channelSalesBodyValidation,
  platformSpendBodyValidation,
} from '../validators/internalDashboardValidators.js';

// Internal Dashboard — admin-only, all-clients performance capture.
// New ATLAS page, same "one sub-router mounted in app.js" shape as
// metaAutomationRoutes / reportGeneratorRoutes. Data is keyed off
// public.brands (extended by migrations 008/009), no parallel client model.
const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/clients', ctrl.listClients);

// §2.3 — client_monthly_metrics
router.get('/monthly-metrics', brandQueryValidation, ctrl.listMonthlyMetrics);
router.post('/monthly-metrics', monthlyMetricsBodyValidation, ctrl.saveMonthlyMetric);
router.delete('/monthly-metrics/:id', idParamValidation, ctrl.deleteMonthlyMetric);

// §2.4 — client_channel_sales_monthly
router.get('/channel-sales', brandQueryValidation, ctrl.listChannelSales);
router.post('/channel-sales', channelSalesBodyValidation, ctrl.saveChannelSales);
router.delete('/channel-sales/:id', idParamValidation, ctrl.deleteChannelSale);

// §2.5 — client_platform_spend_monthly
router.get('/platform-spend', brandQueryValidation, ctrl.listPlatformSpend);
router.post('/platform-spend', platformSpendBodyValidation, ctrl.savePlatformSpend);
router.delete('/platform-spend/:id', idParamValidation, ctrl.deletePlatformSpend);

// §2.7 — data_ingestion_log (read-only feed)
router.get('/ingestion-log', ingestionLogQueryValidation, ctrl.listIngestionLog);

export default router;
