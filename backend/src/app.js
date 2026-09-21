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
import controlCenterRoutes from './routes/controlCenterRoutes.js';
import dailyTrackingRoutes from './routes/dailyTrackingRoutes.js';
import metaAdsInsightsRoutes from './routes/metaAdsInsightsRoutes.js';
import metaAdsInsightsIngestRoutes from './routes/metaAdsInsightsIngestRoutes.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Express 5 defaults to the 'simple' query parser, which doesn't understand
// bracket-array syntax (brand[]=a&brand[]=b) used by our multi-select filters.
app.set('query parser', 'extended');

app.use(cors({ origin: config.corsOrigin, credentials: true }));
// Before the global parser on purpose: it needs a bigger body limit (see the router).
app.use('/api/meta-ads-insights/ingest', metaAdsInsightsIngestRoutes);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/meta-automation', metaAutomationRoutes);
app.use('/api/report-generator', reportGeneratorRoutes);
app.use('/api/internal-dashboard', internalDashboardRoutes);
app.use('/api/control-center', controlCenterRoutes);
app.use('/api/daily-tracking', dailyTrackingRoutes);
app.use('/api/meta-ads-insights', metaAdsInsightsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
