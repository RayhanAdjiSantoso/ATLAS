import { query, param } from 'express-validator';

// Shared: `period` always arrives from the frontend as "YYYY-MM" (month
// picker). The service converts it to a DATE (YYYY-MM-01) before it hits
// the DB; the CHECK constraints in migration 009 keep it month-aligned.
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// --- S1 Executive Overview -----------------------------------------
export const overviewQueryValidation = [
  query('period').matches(PERIOD_RE).withMessage('period wajib, format YYYY-MM'),
  query('compare').optional().isIn(['mom', 'yoy', 'target']),
  query('category').optional().isIn(['retail', 'b2b_service', 'fnb', 'all']),
  query('status').optional().isIn(['active', 'all']),
  query('basis').optional().isIn(['like_for_like', 'all_clients']),
];

// --- S3 Kategori Besar / S4 Industry ------------------------------
export const categoriesQueryValidation = [
  query('period').matches(PERIOD_RE).withMessage('period wajib, format YYYY-MM'),
  query('compare').optional().isIn(['mom', 'yoy', 'target']),
  query('status').optional().isIn(['active', 'all']),
  query('basis').optional().isIn(['like_for_like', 'all_clients']),
];

export const industriesQueryValidation = [
  ...categoriesQueryValidation,
  query('level').optional().isIn(['industry', 'sub_industry']),
];

// --- S5 Benchmarking -------------------------------------------
export const benchmarkQueryValidation = [
  query('client_id').isInt({ min: 1 }).withMessage('client_id wajib disertakan'),
  query('period').matches(PERIOD_RE).withMessage('period wajib, format YYYY-MM'),
  query('compare').optional().isIn(['mom', 'yoy']),
];

// --- S7 Client Detail + Ranking -------------------------------
export const clientDetailValidation = [
  param('id').isInt({ min: 1 }).withMessage('id client tidak valid'),
  query('period').matches(PERIOD_RE).withMessage('period wajib, format YYYY-MM'),
  query('compare').optional().isIn(['mom', 'yoy']),
];

export const clientRankingQueryValidation = [
  query('period').matches(PERIOD_RE).withMessage('period wajib, format YYYY-MM'),
  query('compare').optional().isIn(['mom', 'yoy']),
  query('metric').optional().isIn(['revenue', 'spend', 'blended_roas', 'growth', 'cpp', 'ad_cost_ratio']),
  query('status').optional().isIn(['active', 'all']),
  query('category').optional().isIn(['retail', 'b2b_service', 'fnb', 'all']),
];

// --- S8 Data Quality -------------------------------------------
export const dataQualityQueryValidation = [
  query('period').matches(PERIOD_RE).withMessage('period wajib, format YYYY-MM'),
];

// --- S2 Business Checkup ----------------------------------------
export const businessCheckupQueryValidation = [
  query('period').matches(PERIOD_RE).withMessage('period wajib, format YYYY-MM'),
  query('compare').optional().isIn(['mom', 'yoy']),
  query('category').optional().isIn(['retail', 'b2b_service', 'fnb', 'all']),
];

// --- S6 Channel & Platform ---------------------------------------
export const channelsQueryValidation = [
  query('period').matches(PERIOD_RE).withMessage('period wajib, format YYYY-MM'),
  query('compare').optional().isIn(['mom', 'yoy']),
  query('status').optional().isIn(['active', 'all']),
  query('category').optional().isIn(['retail', 'b2b_service', 'fnb', 'all']),
];

