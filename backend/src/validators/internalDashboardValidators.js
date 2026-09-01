import { body, query, param } from 'express-validator';

// Shared: `period` always arrives from the frontend as "YYYY-MM" (month
// picker). The service converts it to a DATE (YYYY-MM-01) before it hits
// the DB; the CHECK constraints in migration 009 keep it month-aligned.
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const periodField = (f) => f.matches(PERIOD_RE).withMessage('Periode harus format YYYY-MM');

const SALES_CHANNELS = ['shopee', 'tiktok_shop', 'website', 'offline'];
const AD_PLATFORMS = ['meta_nonboost', 'meta_boost', 'meta_cpas', 'iklanku_shopee', 'gmv_max_tiktok', 'google_ads'];

const optInt = (f) => f.optional({ nullable: true }).isInt({ min: 0 }).withMessage('Harus bilangan bulat ≥ 0');
const optNum = (f) => f.optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Harus angka ≥ 0');

export const brandQueryValidation = [
  query('brand_id').isInt({ min: 1 }).withMessage('brand_id wajib disertakan'),
  query('period').optional().matches(PERIOD_RE).withMessage('Periode harus format YYYY-MM'),
];

export const ingestionLogQueryValidation = [
  query('brand_id').optional().isInt({ min: 1 }),
  query('target').optional().isIn([
    'client_monthly_metrics',
    'client_channel_sales_monthly',
    'client_platform_spend_monthly',
  ]),
  query('limit').optional().isInt({ min: 1, max: 200 }),
];

export const idParamValidation = [
  param('id').isInt({ min: 1 }).withMessage('id tidak valid'),
];

// --- §2.3 client_monthly_metrics -------------------------------------
export const monthlyMetricsBodyValidation = [
  body('brand_id').isInt({ min: 1 }).withMessage('Client wajib dipilih'),
  periodField(body('period')),
  body('revenue').isFloat({ min: 0 }).withMessage('Revenue wajib diisi (angka ≥ 0)'),
  optInt(body('transaksi')),
  optInt(body('qty_sold')),
  optNum(body('target_sales')),
];

// --- §2.4 client_channel_sales_monthly ------------------------------
export const channelSalesBodyValidation = [
  body('brand_id').isInt({ min: 1 }).withMessage('Client wajib dipilih'),
  periodField(body('period')),
  body('channels').isArray({ min: 1 }).withMessage('Minimal satu channel diisi'),
  body('channels.*.channel').isIn(SALES_CHANNELS).withMessage('Channel tidak valid'),
  body('channels.*.sales').isFloat({ min: 0 }).withMessage('Nilai sales harus angka ≥ 0'),
];

// --- §2.5 client_platform_spend_monthly -----------------------------
export const platformSpendBodyValidation = [
  body('brand_id').isInt({ min: 1 }).withMessage('Client wajib dipilih'),
  periodField(body('period')),
  body('platform').isIn(AD_PLATFORMS).withMessage('Platform tidak valid'),

  // required (raw / summable)
  body('amount_spent').isFloat({ min: 0 }).withMessage('Amount spent wajib diisi'),
  body('impressions').isInt({ min: 0 }).withMessage('Impressions wajib diisi'),
  body('link_clicks').isInt({ min: 0 }).withMessage('Link clicks wajib diisi'),
  body('purchase').isInt({ min: 0 }).withMessage('Purchase (jumlah) wajib diisi'),
  body('purchase_value').isFloat({ min: 0 }).withMessage('Purchase value wajib diisi'),

  // optional (raw / summable)
  optInt(body('reach')),
  optNum(body('frequency')),
  optInt(body('view_content')),
  optInt(body('atc')),
  optInt(body('lpv')),
  optInt(body('ig_profile_visit')),

  // optional (stored ratios — display-only cross-check, never aggregated)
  optNum(body('cpm')),
  optNum(body('cpc')),
  optNum(body('ctr')),
  optNum(body('cost_per_vc')),
  optNum(body('cost_per_atc')),
  optNum(body('cost_per_purchase')),
  optNum(body('roas')),
];

export const constants = { SALES_CHANNELS, AD_PLATFORMS };
