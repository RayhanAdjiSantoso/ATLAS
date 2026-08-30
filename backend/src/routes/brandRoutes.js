import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import * as brandController from '../controllers/brandController.js';

const router = Router();

router.use(authenticate);

router.get('/', brandController.listBrands);
router.post('/', brandController.createBrand);

export default router;
