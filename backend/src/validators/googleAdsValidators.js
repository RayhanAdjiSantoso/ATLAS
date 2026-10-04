import { body, param, query } from 'express-validator';
import { DAILY_DATASETS, KNOWN_DATASETS, SNAPSHOT_DATASETS } from '../services/googleAdsDatasets.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const brandId = (source) => source('brandId').isInt({ min: 1 }).withMessage('brandId wajib disertakan');
const date = (source, field) => source(field).matches(ISO_DATE).withMessage(`${field} harus format YYYY-MM-DD`);
const accountId = param('accountId').isInt({ min: 1 }).withMessage('accountId tidak valid');

export const brandQueryValidation = [brandId(query)];

export const addAccountValidation = [
  brandId(body),
  body('customerId').isString().trim().notEmpty().withMessage('Customer ID wajib diisi'),
  body('label').optional({ nullable: true }).isString().isLength({ max: 80 }),
  body('backfillFrom').optional({ nullable: true }).matches(ISO_DATE).withMessage('backfillFrom harus format YYYY-MM-DD'),
];

export const updateAccountValidation = [
  accountId, brandId(body),
  body('label').optional().isString().isLength({ max: 80 }),
  body('isActive').optional().isBoolean(),
  body('backfillFrom').optional().matches(ISO_DATE).withMessage('backfillFrom harus format YYYY-MM-DD'),
];

export const removeAccountValidation = [accountId, brandId(query)];

export const resyncValidation = [accountId, brandId(body), date(body, 'from'), date(body, 'to')];

export const conversionGoalValidation = [
  brandId(body),
  body('customerId').isString().trim().notEmpty().withMessage('customerId wajib diisi'),
  body('conversionActionId').isString().trim().matches(/^\d+$/).withMessage('conversionActionId tidak valid'),
  body('goal').optional({ nullable: true }).isIn(['purchase', 'lead', 'micro', 'other', 'ignore']).withMessage('goal tidak dikenal'),
];

const idParam = param('id').isInt({ min: 1 }).withMessage('id tidak valid');
export const recommendationListValidation = [brandId(query)];
export const recommendationGenerateValidation = [brandId(body), date(body, 'oldStart'), date(body, 'oldEnd'), date(body, 'curStart'), date(body, 'curEnd')];
export const recommendationUpdateValidation = [
  idParam, brandId(body),
  body('status').optional({ nullable: true }).isIn(['new', 'reviewed', 'planned', 'in_progress', 'monitoring', 'completed', 'dismissed']).withMessage('status tidak dikenal'),
  body('notes').optional({ nullable: true }).isString().isLength({ max: 2000 }),
];
export const recommendationTaskValidation = [idParam, brandId(body), body('pic').isString().trim().isLength({ min: 1, max: 60 }).withMessage('PIC wajib diisi')];
export const experimentBodyValidation = [brandId(body)];
export const experimentIdBodyValidation = [idParam, brandId(body)];
export const experimentIdQueryValidation = [idParam, brandId(query)];
export const adCopyValidation = [
  brandId(body), body('adGroupId').isString().trim().notEmpty().withMessage('adGroupId wajib diisi'),
  body('customerId').optional({ nullable: true }).isString(),
  date(body, 'oldStart'), date(body, 'oldEnd'), date(body, 'curStart'), date(body, 'curEnd'),
];
export const alertUpdateValidation = [idParam, brandId(body), body('status').isIn(['open', 'acknowledged', 'resolved']).withMessage('status tidak dikenal')];

export const reportValidation = [
  brandId(query), date(query, 'oldStart'), date(query, 'oldEnd'), date(query, 'curStart'), date(query, 'curEnd'),
];

// ── ingest (Google Ads Script / API fetcher) ──────────────────────────
export const startRunValidation = [
  body('customerId').isString().trim().notEmpty().withMessage('customerId wajib diisi'),
  date(body, 'startDate'), date(body, 'endDate'),
  body('source').optional().isIn(['ads_script', 'api']),
  body('account').optional({ nullable: true }).isObject(),
  body('datasets').optional({ nullable: true }).isArray({ max: KNOWN_DATASETS.length }),
  body('datasets.*').optional().isIn(KNOWN_DATASETS).withMessage('dataset tidak dikenal'),
];

export const datasetValidation = [
  body('runId').isString().notEmpty().withMessage('runId wajib diisi'),
  body('dataset').isIn([...DAILY_DATASETS, ...SNAPSHOT_DATASETS]).withMessage('dataset tidak dikenal'),
  body('rows').isArray({ min: 1 }).withMessage('rows wajib diisi'),
];

export const rowsValidation = [
  body('runId').isString().notEmpty().withMessage('runId wajib diisi'),
  body('rows').isArray({ min: 1 }).withMessage('rows wajib diisi'),
];

export const finishValidation = [
  body('runId').isString().notEmpty().withMessage('runId wajib diisi'),
  body('status').isIn(['success', 'failed']).withMessage('status harus success atau failed'),
  body('rowCount').isInt({ min: 0 }).withMessage('rowCount harus angka >= 0'),
  body('note').optional({ nullable: true }).isString().isLength({ max: 500 }),
  body('datasets').optional({ nullable: true }).isObject(),
];
