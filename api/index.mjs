// Vercel serverless entry — the whole Express app behind one function.
// vercel.json rewrites /api/* here; Express still sees the original URL
// (e.g. /api/auth/login) so its route mounts work unchanged.
import app from '../backend/src/app.js';

export default app;
