import { Router } from 'express';
import { authenticate, authorize, forgetAccount } from '../middlewares/auth.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import pool from '../config/db.js';
import { MODULES, ROLES, ROLE_LABELS, getPermissionMatrix, setPermission } from '../services/access/permissions.js';
import { createAccount, listAccounts, listAudit, recordPermissionChange, resetPassword, updateAccount } from '../services/access/accounts.js';

// Pengaturan Akses. Superadmin and admin only; which accounts each may touch
// is decided in services/access/accounts.js, and only a superadmin may change
// what a role is allowed to open.
const router = Router();
router.use(authenticate, authorize('admin'));

router.get('/meta', asyncHandler(async (req, res) => {
  const { rows: brands } = await pool.query('SELECT brand_id, brand_name FROM brands ORDER BY lower(brand_name)');
  res.json({ roles: ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r] })), modules: MODULES, brands });
}));

router.get('/users', asyncHandler(async (req, res) => {
  res.json({ users: await listAccounts() });
}));

router.post('/users', asyncHandler(async (req, res) => {
  const result = await createAccount(req.user, req.body || {});
  res.status(201).json(result);
}));

router.patch('/users/:id', asyncHandler(async (req, res) => {
  await updateAccount(req.user, Number(req.params.id), req.body || {});
  forgetAccount(req.params.id);
  res.json({ message: 'Akun diperbarui' });
}));

router.post('/users/:id/reset-password', asyncHandler(async (req, res) => {
  const result = await resetPassword(req.user, Number(req.params.id));
  forgetAccount(req.params.id);
  res.json(result);
}));

router.get('/permissions', asyncHandler(async (req, res) => {
  res.json({ matrix: await getPermissionMatrix(), editable: req.user.role === 'superadmin' });
}));

router.put('/permissions', asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') throw new AppError('Hanya superadmin yang bisa mengubah hak akses role.', 403);
  const { role, module, allowed } = req.body || {};
  try {
    await setPermission(role, module, allowed, req.user.userId);
  } catch (err) {
    throw new AppError(err.message, 400);
  }
  await recordPermissionChange(req.user.userId, { role, module, allowed: Boolean(allowed) });
  res.json({ matrix: await getPermissionMatrix() });
}));

router.get('/audit', asyncHandler(async (req, res) => {
  res.json({ entries: await listAudit(150) });
}));

export default router;
