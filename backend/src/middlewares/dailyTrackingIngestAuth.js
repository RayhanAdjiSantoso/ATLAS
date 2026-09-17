import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

// The one machine-to-machine route in Daily Tracking: Apps Script's scheduled
// 1am WIB run POSTs here directly (see apps-script/DailyTrackingBoostPost.gs's
// postToAtlas_ helper). There's no ATLAS user/session on this call, so it
// can't go through authenticate/requireBrandAccess — a shared secret header
// stands in for a JWT instead.
export function verifyIngestKey(req, res, next) {
  if (!config.dailyTracking.ingestApiKey) {
    return next(new AppError('DAILY_TRACKING_INGEST_API_KEY belum dikonfigurasi di server', 500));
  }
  const provided = req.headers['x-ingest-key'];
  if (!provided || provided !== config.dailyTracking.ingestApiKey) {
    return next(new AppError('Ingest key tidak valid', 401));
  }
  next();
}
