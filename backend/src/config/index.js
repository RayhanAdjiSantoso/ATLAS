import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 5001,
  // The fallback only exists for local development. A production deployment
  // without its own secret would sign tokens anyone could forge, so it refuses
  // to start instead (see the check below).
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  metaAutomation: {
    webAppUrl: process.env.META_AUTOMATION_WEBAPP_URL,
    apiKey: process.env.META_AUTOMATION_API_KEY,
  },
  internalDashboardSheets: {
    webAppUrl: process.env.INTERNAL_DASHBOARD_SHEETS_WEBAPP_URL,
    apiKey: process.env.INTERNAL_DASHBOARD_SHEETS_API_KEY,
  },
  dailyTracking: {
    // Shared secret the Apps Script's scheduled 1am WIB run sends back when
    // it POSTs to /api/daily-tracking/ingest (see apps-script/DailyTrackingBoostPost.gs).
    ingestApiKey: process.env.DAILY_TRACKING_INGEST_API_KEY,
  },
};

if (process.env.VERCEL_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET wajib diisi di environment production.');
}
