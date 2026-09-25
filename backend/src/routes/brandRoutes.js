import { Router } from 'express';
import { authenticate, requireModule } from '../middlewares/auth.js';
import { uploadDataFile } from '../middlewares/upload.js';
import { requireBrandAccess, blockWriteIfViewOnly } from '../middlewares/brandAccess.js';
import * as brandController from '../controllers/brandController.js';
import * as brandLibraryController from '../controllers/brandLibraryController.js';

const router = Router();

// The brand list and library feed several pages, not only Pengaturan Brand.
router.use(authenticate, requireModule('brand_settings', 'report_generator', 'daily_tracking'), blockWriteIfViewOnly);
// Every route below except GET/POST '/' has :brandId — routes without it
// pass straight through (see requireBrandAccess).
router.use(requireBrandAccess((req) => req.params.brandId));

router.get('/', brandController.listBrands);
router.post('/', brandController.createBrand);
router.patch('/:brandId/status', brandController.updateBrandStatus);

// Pengaturan Brand: the brand's narrative profile, and the file library the
// other modules read instead of asking for their own upload.
router.get('/:brandId/profile', brandLibraryController.getProfile);
router.put('/:brandId/profile', brandLibraryController.saveProfile);
router.get('/:brandId/minutes', brandLibraryController.listMinutes);
router.post('/:brandId/minutes', brandLibraryController.createMinute);
router.post('/:brandId/minutes/summary', brandLibraryController.generateMinutesSummary);
router.put('/:brandId/minutes/:minuteId', brandLibraryController.updateMinute);
router.patch('/:brandId/minutes/:minuteId/tasks', brandLibraryController.saveMinuteTaskState);
router.delete('/:brandId/minutes/:minuteId', brandLibraryController.deleteMinute);
router.get('/:brandId/library', brandLibraryController.listLibrary);
// .array, not .single: a month whose export Shopee split into parts is
// filed in one action (see migration 016).
router.post('/:brandId/library', uploadDataFile.array('file', 12), brandLibraryController.uploadLibraryFile);
router.post('/:brandId/library/:fileId/import', brandLibraryController.reimportLibraryFile);
router.delete('/:brandId/library/:fileId', brandLibraryController.deleteLibraryFile);
router.get('/:brandId/library/:fileId/download', brandLibraryController.downloadLibraryFile);

export default router;
