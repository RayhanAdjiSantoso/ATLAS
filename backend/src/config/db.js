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
  // Fire-and-forget, but never unhandled: a rejection here (a connection that
  // dies between being handed out and this running) would otherwise surface
  // as an unhandled promise rejection and take the process down.
  client.query('SET search_path TO shopee, public').catch((err) => {
    console.error('[db] gagal menyetel search_path:', err.message);
  });
});

// Without this listener the API dies whenever Postgres drops an IDLE
// connection — a laptop waking from sleep, a network blip, or Neon closing a
// pooled connection on its own schedule. pg-pool re-emits that client's
// error on the pool, and an 'error' event with no listener is a hard crash
// in Node ("Unhandled 'error' event"), not a logged warning. Observed as
// `read EADDRNOTAVAIL` killing the server between requests.
//
// The pool has already discarded the broken client by the time this runs;
// the next query simply opens a fresh one, so logging is the whole job.
pool.on('error', (err) => {
  console.error('[db] koneksi idle terputus, pool memulihkan sendiri:', err.message);
});

export default pool;
