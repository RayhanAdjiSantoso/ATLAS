import { Router } from 'express';
import { authenticate, requireModule } from '../middlewares/auth.js';
import { uploadExcel } from '../middlewares/upload.js';
import { uploadValidation } from '../validators/authValidators.js';
import { requireBrandAccess, blockWriteIfViewOnly } from '../middlewares/brandAccess.js';
import * as uploadController from '../controllers/uploadController.js';

const router = Router();

// Only the Dashboard's Upload tab posts here. The list/detail/download/delete
// routes went with the History Upload page (October 2026); files are managed
// in Brand Setting › Data Collection Hub.
router.use(authenticate, requireModule('brand_settings'), blockWriteIfViewOnly);

router.post(
  '/',
  uploadExcel.single('file'),
  uploadValidation,
  requireBrandAccess((req) => req.body.brandId),
  uploadController.uploadFile,
);


export default router;
