import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { reportsRouter } from './reportGenerator/reports.js';
import { productMasterRouter } from './reportGenerator/productMaster.js';
import { savedPeriodsRouter } from './reportGenerator/savedPeriods.js';
import { aiSummaryRouter } from './reportGenerator/aiSummary.js';

// Performance Report Generator (Meta/Shopee/TikTok ads reports), merged in
// as a page under ATLAS — same pattern as metaAutomationRoutes.js: one
// router mounted here, `authenticate` gates the whole thing (any logged-in
// user, no role restriction — unlike meta-automation's admin-only gate).
//
// Client/brand data intentionally has NO route here — the frontend talks to
// ATLAS's own /api/brands (brandRoutes.js) directly instead of a duplicate
// wrapper, now that this app shares ATLAS's real public.brands table.
const router = Router();

router.use(authenticate);

router.use('/reports', reportsRouter);
router.use('/product-master', productMasterRouter);
router.use('/saved-periods', savedPeriodsRouter);
router.use('/ai-summary', aiSummaryRouter);

export default router;
