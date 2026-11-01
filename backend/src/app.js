import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config/index.js';
import authRoutes from './routes/authRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import brandRoutes from './routes/brandRoutes.js';
import metaAutomationRoutes from './routes/metaAutomationRoutes.js';
import reportGeneratorRoutes from './routes/reportGeneratorRoutes.js';
import internalDashboardRoutes from './routes/internalDashboardRoutes.js';
import dailyTrackingRoutes from './routes/dailyTrackingRoutes.js';
import metaAdsInsightsRoutes from './routes/metaAdsInsightsRoutes.js';
import metaAdsInsightsIngestRoutes from './routes/metaAdsInsightsIngestRoutes.js';
import accessRoutes from './routes/accessRoutes.js';
import annotationRoutes from './routes/annotationRoutes.js';
import googleAdsRoutes from './routes/googleAdsRoutes.js';
import googleReviewsRoutes from './routes/googleReviewsRoutes.js';
import { homepageAdminRouter, publicHomepageRouter } from './routes/homepageRoutes.js';
import { publicBrandLogoRouter } from './routes/brandLogoRoutes.js';
import googleAdsIngestRoutes from './routes/googleAdsIngestRoutes.js';
import attributionRoutes from './routes/attributionRoutes.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { securityHeaders } from './middlewares/security.js';
import { isEnabled as fileStoreEnabled } from './services/fileStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Express 5 defaults to the 'simple' query parser, which doesn't understand
// bracket-array syntax (brand[]=a&brand[]=b) used by our multi-select filters.
app.set('query parser', 'extended');
// Do not advertise the framework to anyone probing the server.
app.disable('x-powered-by');
app.use(securityHeaders);

app.use(cors({ origin: config.corsOrigin, credentials: true }));
// Before the global parser on purpose: it needs a bigger body limit (see the router).
app.use('/api/meta-ads-insights/ingest', metaAdsInsightsIngestRoutes);
app.use('/api/google-ads/ingest', googleAdsIngestRoutes);
// A presentation draft (narrative + analytic snapshot) outgrows the default
// 100 KB; kept under what the hosting platform accepts for one request.
app.use('/api/report-generator/presentations', express.json({ limit: '4mb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  // fileStore: where new uploads' bytes go ('r2' once R2_* is set, else
  // 'database') — a yes/no, nothing about the credentials themselves.
  res.json({ status: 'ok', timestamp: new Date().toISOString(), fileStore: fileStoreEnabled() ? 'r2' : 'database' });
});

app.use('/api/auth', authRoutes);
app.use('/api/access', accessRoutes);
app.use('/api/annotations', annotationRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/meta-automation', metaAutomationRoutes);
app.use('/api/report-generator', reportGeneratorRoutes);
app.use('/api/internal-dashboard', internalDashboardRoutes);
app.use('/api/daily-tracking', dailyTrackingRoutes);
app.use('/api/meta-ads-insights', metaAdsInsightsRoutes);
app.use('/api/google-ads', googleAdsRoutes);
app.use('/api/google-reviews', googleReviewsRoutes);
app.use('/api/attribution', attributionRoutes);
app.use('/api/public/homepage', publicHomepageRouter);
app.use('/api/public/brand-logo', publicBrandLogoRouter);
app.use('/api/homepage', homepageAdminRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
