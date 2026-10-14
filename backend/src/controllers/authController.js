import { validationResult } from 'express-validator';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as authService from '../services/authService.js';
import { forgetAccount } from '../middlewares/auth.js';

function validate(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError('Validasi gagal', 400, errors.array());
  }
}

export const login = asyncHandler(async (req, res) => {
  validate(req);
  const result = await authService.loginUser(req.body);
  res.json(result);
});

export const logout = asyncHandler(async (req, res) => {
  // JWT is stateless — client removes token
  res.json({ message: 'Logout berhasil' });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user.userId);
  if (!user) throw new AppError('User tidak ditemukan', 404);
  res.json({ user });
});

export const markTourSeen = asyncHandler(async (req, res) => {
  const toursSeen = await authService.markTourSeen(req.user.userId, req.params.tourId);
  res.json({ toursSeen });
});

export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user.userId, req.body?.currentPassword, req.body?.newPassword);
  forgetAccount(req.user.userId);
  res.json({ message: 'Password berhasil diganti' });
});
