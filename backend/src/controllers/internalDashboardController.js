import { validationResult } from 'express-validator';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as service from '../services/internalDashboardService.js';

function validate(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError('Validasi gagal', 400, errors.array());
  }
}

// GET /api/internal-dashboard/clients
export const listClients = asyncHandler(async (req, res) => {
  res.json({ clients: await service.listClients() });
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

// --- S8 Data Quality ---------------------------------------
export const getDataQuality = asyncHandler(async (req, res) => {
  validate(req);
  res.json(await service.getDataQuality({ period: req.query.period }));
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
