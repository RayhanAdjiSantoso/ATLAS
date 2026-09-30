import { Router } from 'express';
import { authenticate, requireModule } from '../middlewares/auth.js';
import * as ctrl from '../controllers/internalDashboardController.js';
import {
  overviewQueryValidation,
  categoriesQueryValidation,
  industriesQueryValidation,
  channelsQueryValidation,
  businessCheckupQueryValidation,
  benchmarkQueryValidation,
  clientDetailValidation,
  clientRankingQueryValidation,
  dataQualityQueryValidation,
} from '../validators/internalDashboardValidators.js';

// Internal Dashboard — all-clients performance capture. READ-ONLY: there is
// no input endpoint here. The monthly fact tables are rolled up
// automatically from Daily Tracking + Meta Ads insights
// (services/internalDashboardSync), and ad accounts are copied from
// Pengaturan Brand > Meta Ads Automation.
// New ATLAS page, same "one sub-router mounted in app.js" shape as
// metaAutomationRoutes / reportGeneratorRoutes. Data is keyed off
// public.brands (extended by migrations 008/009), no parallel client model.
const router = Router();

router.use(authenticate, requireModule('internal_dashboard'));

router.get('/clients', ctrl.listClients);

// S1 — Executive Overview
router.get('/overview', overviewQueryValidation, ctrl.getOverview);
// S3 — Kategori Besar
router.get('/categories', categoriesQueryValidation, ctrl.getCategories);
// S4 — Industry / Sub-industry
router.get('/industries', industriesQueryValidation, ctrl.getIndustries);
// S2 — Business Checkup
router.get('/business-checkup', businessCheckupQueryValidation, ctrl.getBusinessCheckup);
// S5 — Benchmarking
router.get('/benchmark', benchmarkQueryValidation, ctrl.getBenchmark);
// S6 — Channel & Platform
router.get('/channels', channelsQueryValidation, ctrl.getChannels);
// S7 — Client Detail + Ranking ( /clients/ranking BEFORE /clients/:id )
router.get('/clients/ranking', clientRankingQueryValidation, ctrl.getClientRanking);
router.get('/clients/:id', clientDetailValidation, ctrl.getClientDetail);
// S8 — Data Quality
router.get('/data-quality', dataQualityQueryValidation, ctrl.getDataQuality);

export default router;
