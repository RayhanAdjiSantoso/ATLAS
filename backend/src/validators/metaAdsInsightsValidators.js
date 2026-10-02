import { body, query } from 'express-validator';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const brandId = (source) => source('brandId').isInt({ min: 1 }).withMessage('brandId wajib disertakan');
const accountType = (source) => source('accountType').isIn(['MAIN', 'CPAS']).withMessage('accountType harus MAIN atau CPAS');
const month = (source) => source('month').matches(MONTH_RE).withMessage('month harus format YYYY-MM');
const isoDate = (source, field, optional = false) => {
  const chain = source(field);
  return (optional ? chain.optional({ nullable: true }) : chain).isISO8601({ strict: true }).isLength({ min: 10, max: 10 })
    .withMessage(`${field} harus format YYYY-MM-DD`);
};

export const brandQueryValidation = [brandId(query)];

export const saveConfigValidation = [
  brandId(body), accountType(body),
  body('extraMetrics').isArray().withMessage('extraMetrics harus array'),
];

export const fetchNowValidation = [brandId(body), accountType(body), month(body)];

export const syncLibraryValidation = [brandId(body), accountType(body), month(body)];

export const deleteMonthValidation = [brandId(query), accountType(query), month(query)];

export const exportRangeValidation = [brandId(query), accountType(query), isoDate(query, 'start'), isoDate(query, 'end')];

// ── ingest (Apps Script) ─────────────────────────────────────────────
export const startRunValidation = [
  brandId(body), accountType(body), month(body),
  isoDate(body, 'since', true), isoDate(body, 'until', true),
  body('adAccountId').isString().trim().notEmpty().withMessage('adAccountId wajib diisi'),
  body('trigger').optional().isIn(['scheduled', 'manual']),
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
];

export const libraryRunValidation = [
  body('runId').isString().notEmpty().withMessage('runId wajib diisi'),
];
