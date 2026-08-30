import bcrypt from 'bcryptjs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function seed() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    const adminHash = await bcrypt.hash('admin12345', 12);
    const userHash = await bcrypt.hash('user12345', 12);

    await client.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, 'Administrator', 'admin')
       ON CONFLICT (email) DO NOTHING`,
      ['admin@atlas.local', adminHash],
    );

    await client.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, 'Demo User', 'user')
       ON CONFLICT (email) DO NOTHING`,
      ['user@atlas.local', userHash],
    );

    console.log('Seed users created:');
    console.log('  Admin: admin@atlas.local / admin12345');
    console.log('  User:  user@atlas.local / user12345');
  } finally {
    await client.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
