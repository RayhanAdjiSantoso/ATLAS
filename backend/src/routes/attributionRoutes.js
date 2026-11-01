import { Router } from 'express';
import pool from '../config/db.js';
import { authenticate, authorize } from '../middlewares/auth.js';
import { asyncHandler, AppError } from '../utils/errors.js';
import { loadAttributionData } from '../services/attribution/dataSource.js';
import { analyzeAttribution } from '../services/attribution/engine.js';

// Atribusi & Kebocoran Channel — admin only, read-only. One endpoint: a
// brand and a month range in, the full analysis out (engine.js). Nothing is
// stored; every call reads what ATLAS already holds.
const router = Router();

router.use(authenticate, authorize('admin'));

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const lastDayOf = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
};

router.get('/:brandId', asyncHandler(async (req, res) => {
  const brandId = Number(req.params.brandId);
  const { from, to } = req.query;
  if (!Number.isInteger(brandId) || brandId <= 0) throw new AppError('Brand tidak valid.', 400);
  if (!MONTH.test(String(from)) || !MONTH.test(String(to)) || from > to) throw new AppError('Rentang bulan tidak valid (format YYYY-MM).', 400);
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if ((ty - fy) * 12 + (tm - fm) > 23) throw new AppError('Rentang maksimal 24 bulan.', 400);
  const targetRoas = req.query.targetRoas ? Number(req.query.targetRoas) : 3;
  if (!(targetRoas > 0 && targetRoas <= 50)) throw new AppError('ROAS target tidak valid.', 400);

  // Optional pair of months the bottom-up thread compares (default: the last
  // two complete months).
  const { compareFrom, compareTo } = req.query;
  const compare = MONTH.test(String(compareFrom)) && MONTH.test(String(compareTo)) && compareFrom < compareTo ? { compareFrom, compareTo } : {};

  const data = await loadAttributionData(pool, brandId, { from: `${from}-01`, to: lastDayOf(to) });
  if (!data.brand) throw new AppError('Brand tidak ditemukan.', 404);
  res.json(analyzeAttribution(data, { targetRoas, ...compare }));
}));

export default router;
