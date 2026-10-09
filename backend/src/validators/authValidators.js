import { body } from 'express-validator';

export const registerValidation = [
  body('email').isEmail().withMessage('Email tidak valid').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password minimal 8 karakter'),
  body('fullName').trim().notEmpty().withMessage('Nama lengkap wajib diisi'),
  body('role').optional().isIn(['admin', 'user']).withMessage('Role tidak valid'),
];

export const loginValidation = [
  body('email').isEmail().withMessage('Email tidak valid').normalizeEmail(),
  body('password').notEmpty().withMessage('Password wajib diisi'),
];

export const uploadValidation = [
  body('brandId').notEmpty().withMessage('Brand wajib dipilih').isInt().withMessage('Brand tidak valid'),
  body('fileType')
    .isIn(['order', 'performance_overview', 'product_performance'])
    .withMessage('Jenis file tidak valid'),
];

