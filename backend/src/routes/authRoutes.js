import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { loginValidation } from '../validators/authValidators.js';
import { loginRateLimit } from '../middlewares/security.js';
import * as authController from '../controllers/authController.js';

const router = Router();

// No public self-registration: every account is created by the team
// (scripts/createUser.js, later the access-settings page) with its role and
// brand restriction set on creation. An open sign-up handed any stranger an
// account that could read every brand's data.
router.post('/login', loginRateLimit, loginValidation, authController.login);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);
router.post('/change-password', authenticate, loginRateLimit, authController.changePassword);

export default router;
