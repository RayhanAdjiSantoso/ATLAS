import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { uploadExcel } from '../middlewares/upload.js';
import { uploadValidation, uploadListValidation } from '../validators/authValidators.js';
import * as uploadController from '../controllers/uploadController.js';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  uploadExcel.single('file'),
  uploadValidation,
  uploadController.uploadFile,
);

router.get('/', uploadListValidation, uploadController.listUploads);
router.get('/filters', uploadController.getFilterOptions);
router.get('/:uploadId/download', uploadController.downloadUpload);
router.get('/:uploadId', uploadController.getUpload);
router.delete('/:uploadId', uploadController.deleteUpload);

export default router;
