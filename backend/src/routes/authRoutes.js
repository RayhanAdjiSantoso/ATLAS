import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { registerValidation, loginValidation } from '../validators/authValidators.js';
import * as authController from '../controllers/authController.js';

const router = Router();

router.post('/register', registerValidation, authController.register);
router.post('/login', loginValidation, authController.login);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

export default router;
