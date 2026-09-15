import { Router } from 'express';
import { authenticate, authorize } from '../middlewares/auth.js';
import * as controlCenterController from '../controllers/controlCenterController.js';

// Pusat Kendali reads across every brand, so it is admin-only here at the
// API — not merely hidden from the sidebar (PRODUCT.md, rule 8 applied to a
// new cross-client surface).
const router = Router();
router.use(authenticate, authorize('admin'));

router.get('/summary', controlCenterController.summary);
router.get('/data-completeness', controlCenterController.dataCompleteness);
router.get('/open-tasks', controlCenterController.openTasks);

export default router;
