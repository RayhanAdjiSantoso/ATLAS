import { asyncHandler, AppError } from '../utils/errors.js';
import * as dashboardService from '../services/dashboardService.js';
import pool from '../config/db.js';

// Runs a dashboard service fn for the main period, and again for the compare
// period (if provided), bundling the latter under `compare` in the response.
// Any extra params (e.g. `level`) are forwarded to both calls unchanged.
async function withCompare(serviceFn, { brandId, startDate, endDate, compareStartDate, compareEndDate, ...rest }) {
  const data = await serviceFn({ brandId, startDate, endDate, ...rest });
  if (!compareStartDate || !compareEndDate) {
    return { ...data, compare: null };
  }
  const compareData = await serviceFn({ brandId, startDate: compareStartDate, endDate: compareEndDate, ...rest });
  return { ...data, compare: compareData };
}

// Get list of brands for dropdown
export const getDashboardFilters = asyncHandler(async (req, res) => {
  const result = await pool.query(
    'SELECT brand_id, brand_name FROM brands ORDER BY brand_name'
  );
  res.json({ brands: result.rows });
});

// GET /api/dashboard/executive-snapshot
export const getExecutiveSnapshot = asyncHandler(async (req, res) => {
  const { brandId, startDate, endDate, compareStartDate, compareEndDate } = req.query;

  if (!brandId) {
    throw new AppError('Brand ID wajib disertakan', 400);
  }
  if (!startDate || !endDate) {
    throw new AppError('Tanggal awal dan akhir wajib disertakan', 400);
  }

  const data = await dashboardService.getExecutiveSnapshot({
    brandId: Number(brandId),
    startDate,
    endDate,
    compareStartDate: compareStartDate || null,
    compareEndDate: compareEndDate || null,
  });

  let compare = null;
  if (compareStartDate && compareEndDate) {
    compare = await dashboardService.getExecutiveSnapshot({
      brandId: Number(brandId),
      startDate: compareStartDate,
      endDate: compareEndDate,
    });
  }

  res.json({ ...data, compare });
});

// GET /api/dashboard/business-growth
//
// Doesn't use the generic withCompare() helper other tabs use (which runs
// the service twice, independently, and lets the frontend render two
// side-by-side panels) -- Business Growth needs both periods' totals at once
// to compute a GMV/Transaksi/AOV delta and a headline, so it follows the
// same single-call-with-both-periods pattern getExecutiveSnapshot already
// uses below.
export const getBusinessGrowth = asyncHandler(async (req, res) => {
  const { brandId, startDate, endDate, compareStartDate, compareEndDate } = req.query;

  if (!brandId) {
    throw new AppError('Brand ID wajib disertakan', 400);
  }
  if (!startDate || !endDate) {
    throw new AppError('Tanggal awal dan akhir wajib disertakan', 400);
  }

  const data = await dashboardService.getBusinessGrowth({
    brandId: Number(brandId),
    startDate,
    endDate,
    compareStartDate: compareStartDate || null,
    compareEndDate: compareEndDate || null,
  });

  res.json(data);
});

// GET /api/dashboard/traffic-funnel
//
// Doesn't use the generic withCompare() helper (independent calls, two
// side-by-side panels) -- the traffic growth-driver and funnel bottleneck
// insights need both periods' numbers at once, so this follows the same
// single-call-with-both-periods pattern getBusinessGrowth/getExecutiveSnapshot
// already use.
export const getTrafficAndFunnel = asyncHandler(async (req, res) => {
  const { brandId, startDate, endDate, compareStartDate, compareEndDate } = req.query;

  if (!brandId) {
    throw new AppError('Brand ID wajib disertakan', 400);
  }
  if (!startDate || !endDate) {
    throw new AppError('Tanggal awal dan akhir wajib disertakan', 400);
  }

  const data = await dashboardService.getTrafficAndFunnel({
    brandId: Number(brandId),
    startDate,
    endDate,
    compareStartDate: compareStartDate || null,
    compareEndDate: compareEndDate || null,
  });

  res.json(data);
});

// GET /api/dashboard/rfm
//
// Doesn't use the generic withCompare() helper (independent calls, two
// side-by-side panels) -- segment pp-change, cohort retention, and the
// segment-change insight need both periods' numbers at once, so this
// follows the same single-call-with-both-periods pattern Business Growth
// and Traffic & Funnel already use.
export const getRfmAnalysis = asyncHandler(async (req, res) => {
  const { brandId, startDate, endDate, compareStartDate, compareEndDate } = req.query;

  if (!brandId) {
    throw new AppError('Brand ID wajib disertakan', 400);
  }
  if (!startDate || !endDate) {
    throw new AppError('Tanggal awal dan akhir wajib disertakan', 400);
  }

  const data = await dashboardService.getRfmAnalysis({
    brandId: Number(brandId),
    startDate,
    endDate,
    compareStartDate: compareStartDate || null,
    compareEndDate: compareEndDate || null,
  });

  res.json(data);
});

// GET /api/dashboard/transaction-behavior
export const getTransactionBehavior = asyncHandler(async (req, res) => {
  const { brandId, startDate, endDate, compareStartDate, compareEndDate } = req.query;

  if (!brandId) {
    throw new AppError('Brand ID wajib disertakan', 400);
  }
  if (!startDate || !endDate) {
    throw new AppError('Tanggal awal dan akhir wajib disertakan', 400);
  }

  const data = await withCompare(dashboardService.getTransactionBehavior, {
    brandId: Number(brandId),
    startDate,
    endDate,
    compareStartDate,
    compareEndDate,
  });

  res.json(data);
});

// GET /api/dashboard/basket-analysis
export const getBasketAnalysis = asyncHandler(async (req, res) => {
  const { brandId, startDate, endDate, compareStartDate, compareEndDate } = req.query;

  if (!brandId) {
    throw new AppError('Brand ID wajib disertakan', 400);
  }
  if (!startDate || !endDate) {
    throw new AppError('Tanggal awal dan akhir wajib disertakan', 400);
  }

  const data = await withCompare(dashboardService.getBasketAnalysis, {
    brandId: Number(brandId),
    startDate,
    endDate,
    compareStartDate,
    compareEndDate,
  });

  res.json(data);
});

// GET /api/dashboard/root-cause
//
// Interactive GMV-decomposition tree. Like getExecutiveSnapshot, it runs the
// service once per period and returns the comparison tree under `compare`
// (null when no comparison range) — the frontend zips the two trees by node
// id to draw a per-node delta, rather than the side-by-side split render the
// other tabs use.
export const getRootCauseAnalysis = asyncHandler(async (req, res) => {
  const { brandId, startDate, endDate, compareStartDate, compareEndDate } = req.query;

  if (!brandId) {
    throw new AppError('Brand ID wajib disertakan', 400);
  }
  if (!startDate || !endDate) {
    throw new AppError('Tanggal awal dan akhir wajib disertakan', 400);
  }

  const data = await dashboardService.getRootCauseAnalysis({
    brandId: Number(brandId),
    startDate,
    endDate,
  });

  let compare = null;
  if (compareStartDate && compareEndDate) {
    compare = await dashboardService.getRootCauseAnalysis({
      brandId: Number(brandId),
      startDate: compareStartDate,
      endDate: compareEndDate,
    });
  }

  res.json({ ...data, compare });
});

// GET /api/dashboard/product-performance
export const getProductPerformance = asyncHandler(async (req, res) => {
  const { brandId, startDate, endDate, compareStartDate, compareEndDate, level } = req.query;

  if (!brandId) {
    throw new AppError('Brand ID wajib disertakan', 400);
  }
  if (!startDate || !endDate) {
    throw new AppError('Tanggal awal dan akhir wajib disertakan', 400);
  }
  if (level && !['category', 'variant'].includes(level)) {
    throw new AppError('Level produk tidak valid', 400);
  }

  const data = await withCompare(dashboardService.getProductPerformance, {
    brandId: Number(brandId),
    startDate,
    endDate,
    compareStartDate,
    compareEndDate,
    level: level || 'category',
  });

  res.json(data);
});
