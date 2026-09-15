import { AppError, asyncHandler } from '../utils/errors.js';
import * as controlCenter from '../services/controlCenterService.js';
import { currentMonth, isMonth, todayJakarta } from '../utils/monthPeriod.js';

function monthParam(req) {
  const month = req.query.month ?? currentMonth();
  if (!isMonth(month)) throw new AppError('Bulan tidak valid (format YYYY-MM)', 400);
  return month;
}

export const dataCompleteness = asyncHandler(async (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'active';
  res.json(await controlCenter.getDataCompleteness({ month: monthParam(req), scope }));
});

// Raw records, parsed in the browser with the same momModel the MOM pages
// use; `today` comes from the server so "tertunda N hari" is not at the mercy
// of a laptop clock.
export const openTasks = asyncHandler(async (req, res) => {
  res.json({ minutes: await controlCenter.listMinutesWithTasks(), today: todayJakarta(), overdueDays: controlCenter.OVERDUE_DAYS });
});

export const summary = asyncHandler(async (req, res) => {
  res.json(await controlCenter.getSummary());
});
