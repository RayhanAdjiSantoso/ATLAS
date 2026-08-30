import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('connect', (client) => {
  client.query('SET search_path TO shopee, public');
});

export default pool;
