import { validationResult } from 'express-validator';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as authService from '../services/authService.js';

function validate(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError('Validasi gagal', 400, errors.array());
  }
}

export const register = asyncHandler(async (req, res) => {
  validate(req);
  const { email, password, fullName, role } = req.body;

  // Only allow admin role if request comes from existing admin (future) — default user
  const assignedRole = req.user?.role === 'admin' && role === 'admin' ? 'admin' : 'user';

  const user = await authService.registerUser({
    email,
    password,
    fullName,
    role: assignedRole,
  });

  res.status(201).json({ message: 'Registrasi berhasil', user });
});

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
  res.json({ user: {
    userId: user.userId,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  } });
});
