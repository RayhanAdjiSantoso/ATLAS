import { body, query } from 'express-validator';

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

export const uploadListValidation = [
  query('brand').optional(),
  query('fileType').optional().custom((value) => {
    const allowed = ['order', 'performance_overview', 'product_performance'];
    const values = Array.isArray(value) ? value : [value];
    return values.every((v) => allowed.includes(v));
  }),
  query('userId').optional().custom((value) => {
    const values = Array.isArray(value) ? value : [value];
    return values.every((v) => /^\d+$/.test(String(v)));
  }),
  query('periodStart').optional().isISO8601(),
  query('periodEnd').optional().isISO8601(),
];
