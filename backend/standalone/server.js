import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load standalone/.env explicitly (not backend/.env) so this stays isolated
// from the main ATLAS config -- this server never touches Postgres or auth.
dotenv.config({ path: path.join(__dirname, '.env') });

const { default: express } = await import('express');
const { default: cors } = await import('cors');
const { errorHandler, notFoundHandler } = await import('../src/middlewares/errorHandler.js');
const { default: metaAutomationRoutes } = await import('./routes.js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/meta-automation', metaAutomationRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.STANDALONE_PORT || 5099;
app.listen(PORT, () => {
  console.log(`Meta Automation standalone test server running on http://localhost:${PORT}`);
  console.log('No auth, no Postgres -- for local Apps Script round-trip testing only.');
});
