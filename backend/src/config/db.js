import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Neon (and any hosted Postgres) needs TLS; a local dev database doesn't.
const connectionString = process.env.DATABASE_URL || '';
const isLocal = /@(localhost|127\.0\.0\.1|::1)[:/]/.test(connectionString);

const pool = new pg.Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: true },
  // Serverless: many short-lived instances, keep each pool small. Use Neon's
  // non-pooled connection string so the SET search_path below sticks per
  // session.
  max: Number(process.env.PG_POOL_MAX) || 3,
});

pool.on('connect', (client) => {
  client.query('SET search_path TO shopee, public');
});

export default pool;
