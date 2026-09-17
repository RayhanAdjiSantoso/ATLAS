import { body, query } from 'express-validator';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const channelsQueryValidation = [
  query('brandId').isInt({ min: 1 }).withMessage('brandId wajib disertakan'),
];

export const addChannelBodyValidation = [
  body('brandId').isInt({ min: 1 }).withMessage('brandId wajib disertakan'),
  body('kind').isIn(['sales', 'spend']).withMessage('kind harus sales atau spend'),
  body('label').isString().trim().notEmpty().withMessage('Nama channel wajib diisi'),
];

export const entriesQueryValidation = [
  query('brandId').isInt({ min: 1 }).withMessage('brandId wajib disertakan'),
  query('month').matches(MONTH_RE).withMessage('month harus format YYYY-MM'),
];

export const upsertEntriesBodyValidation = [
  body('brandId').isInt({ min: 1 }).withMessage('brandId wajib disertakan'),
  body('entryDate').matches(DATE_RE).withMessage('entryDate harus format YYYY-MM-DD'),
  body('sales').optional().isArray().withMessage('sales harus array'),
  body('sales.*.channelKey').if(body('sales').exists()).isString().notEmpty(),
  body('spend').optional().isArray().withMessage('spend harus array'),
  body('spend.*.channelKey').if(body('spend').exists()).isString().notEmpty(),
];

export const importFileBodyValidation = [
  body('brandId').isInt({ min: 1 }).withMessage('brandId wajib disertakan'),
];

export const metaSyncBodyValidation = [
  body('brandId').isInt({ min: 1 }).withMessage('brandId wajib disertakan'),
  body('trackingConfigId').notEmpty().withMessage('trackingConfigId wajib disertakan'),
];

export const ingestBodyValidation = [
  body('brandId').isInt({ min: 1 }).withMessage('brandId wajib disertakan'),
  body('entryDate').matches(DATE_RE).withMessage('entryDate harus format YYYY-MM-DD'),
  body('entries').isArray({ min: 1 }).withMessage('entries wajib diisi'),
  body('entries.*.channelKey').isString().notEmpty(),
  body('entries.*.amount').isFloat({ min: 0 }).withMessage('amount harus angka >= 0'),
];
