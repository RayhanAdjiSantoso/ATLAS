import { validationResult } from 'express-validator';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as service from '../services/internalDashboardService.js';
import { CPS_COLUMNS } from '../repositories/internalDashboardRepository.js';

function validate(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError('Validasi gagal', 400, errors.array());
  }
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// GET /api/internal-dashboard/clients
export const listClients = asyncHandler(async (req, res) => {
  res.json({ clients: await service.listClients() });
});

// --- §2.3 client_monthly_metrics -----------------------------------
export const listMonthlyMetrics = asyncHandler(async (req, res) => {
  validate(req);
  const entries = await service.listMonthlyMetrics(Number(req.query.brand_id));
  res.json({ entries });
});

export const saveMonthlyMetric = asyncHandler(async (req, res) => {
  validate(req);
  const b = req.body;
  const result = await service.saveMonthlyMetric({
    brandId: Number(b.brand_id),
    period: b.period,
    revenue: num(b.revenue),
    transaksi: num(b.transaksi),
    qtySold: num(b.qty_sold),
    targetSales: num(b.target_sales),
    pic: b.pic?.trim() || null,
    userId: req.user.userId,
  });
  res.status(result.wasInsert ? 201 : 200).json(result);
});

export const deleteMonthlyMetric = asyncHandler(async (req, res) => {
  validate(req);
  await service.deleteMonthlyMetric(Number(req.params.id), req.user.userId);
  res.json({ message: 'Data bulanan dihapus' });
});

// --- §2.4 client_channel_sales_monthly ----------------------------
export const listChannelSales = asyncHandler(async (req, res) => {
  validate(req);
  const entries = await service.listChannelSales(Number(req.query.brand_id));
  res.json({ entries });
});

export const saveChannelSales = asyncHandler(async (req, res) => {
  validate(req);
  const b = req.body;
  const result = await service.saveChannelSales({
    brandId: Number(b.brand_id),
    period: b.period,
    channels: (b.channels || []).map((c) => ({ channel: c.channel, sales: num(c.sales) })),
    pic: b.pic?.trim() || null,
    userId: req.user.userId,
  });
  res.json(result);
});

export const deleteChannelSale = asyncHandler(async (req, res) => {
  validate(req);
  await service.deleteChannelSale(Number(req.params.id), req.user.userId);
  res.json({ message: 'Data channel dihapus' });
});

// --- §2.5 client_platform_spend_monthly --------------------------
export const listPlatformSpend = asyncHandler(async (req, res) => {
  validate(req);
  const entries = await service.listPlatformSpend(Number(req.query.brand_id));
  res.json({ entries });
});

export const savePlatformSpend = asyncHandler(async (req, res) => {
  validate(req);
  const b = req.body;
  const metrics = {};
  for (const col of CPS_COLUMNS) metrics[col] = num(b[col]);
  const result = await service.savePlatformSpend({
    brandId: Number(b.brand_id),
    period: b.period,
    platform: b.platform,
    metrics,
    pic: b.pic?.trim() || null,
    userId: req.user.userId,
  });
  res.status(result.wasInsert ? 201 : 200).json(result);
});

export const deletePlatformSpend = asyncHandler(async (req, res) => {
  validate(req);
  await service.deletePlatformSpend(Number(req.params.id), req.user.userId);
  res.json({ message: 'Data platform spend dihapus' });
});

// --- S1 Executive Overview -------------------------------------
export const getOverview = asyncHandler(async (req, res) => {
  validate(req);
  const overview = await service.getOverview({
    period: req.query.period,
    compare: req.query.compare,
    category: req.query.category,
    status: req.query.status,
    basis: req.query.basis,
  });
  res.json(overview);
});

// --- S3 Kategori Besar ----------------------------------------
export const getCategories = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getCategories({
    period: req.query.period,
    compare: req.query.compare,
    status: req.query.status,
    basis: req.query.basis,
  }));
});

// --- S4 Industry / Sub-industry -------------------------------
export const getIndustries = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getIndustries({
    period: req.query.period,
    compare: req.query.compare,
    status: req.query.status,
    basis: req.query.basis,
    level: req.query.level,
  }));
});

// --- S5 Benchmarking ----------------------------------------
export const getBenchmark = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getBenchmark({
    client_id: req.query.client_id,
    period: req.query.period,
    compare: req.query.compare,
  }));
});

// --- S7 Client Detail + Ranking -----------------------------
export const getClientRanking = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getClientRanking({
    period: req.query.period,
    compare: req.query.compare,
    metric: req.query.metric,
    status: req.query.status,
    category: req.query.category,
  }));
});

export const getClientDetail = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getClientDetail({
    client_id: req.params.id,
    period: req.query.period,
    compare: req.query.compare,
  }));
});

// --- S2 Business Checkup -------------------------------------
export const getBusinessCheckup = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getBusinessCheckup({
    period: req.query.period,
    compare: req.query.compare,
    category: req.query.category,
  }));
});

// --- S6 Channel & Platform -----------------------------------
export const getChannels = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getChannels({
    period: req.query.period,
    compare: req.query.compare,
    status: req.query.status,
    category: req.query.category,
  }));
});

// --- §2.7 data_ingestion_log ------------------------------------
export const listIngestionLog = asyncHandler(async (req, res) => {
  validate(req);
  const log = await service.listIngestionLog({
    brandId: req.query.brand_id ? Number(req.query.brand_id) : null,
    target: req.query.target || null,
    limit: req.query.limit ? Number(req.query.limit) : 50,
  });
  res.json({ log });
});
