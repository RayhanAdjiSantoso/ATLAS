import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../../migrations');

// Setiap file dijalankan sekali, dicatat, lalu dilewati selamanya.
//
// Sebelumnya script ini menjalankan ULANG semua file pada setiap run, tanpa
// catatan apa pun, dan menyandarkan keamanannya pada setiap file ditulis
// idempotent. Itu bertahan sampai satu migration mengubah sesuatu yang
// dibuat migration sebelumnya: 016 menghapus lalu mengganti indeks milik
// 015, jadi run kedua mencoba membuat ulang aturan "satu file per bulan" di
// atas tabel yang sekarang sah berisi beberapa part — dan gagal, membawa
// seluruh migrasi ikut gagal. Kelas masalah itu akan terulang setiap kali
// ada migration yang menyentuh hasil migration lain.
//
// Pola tabel pencatat ini bukan hal baru di repo: report generator versi
// standalone memakainya (ads_reports.schema_migrations, masih ada isinya
// dari 2026-08-22), dan hanya hilang saat script-nya ditulis ulang di sini.
//
// Perpindahan dari cara lama tidak butuh langkah khusus: pada run pertama
// tabelnya kosong, jadi semua file dijalankan sekali lagi (semuanya masih
// idempotent, jadi ini aman) lalu tercatat. Untuk database yang sudah pasti
// mutakhir dan tidak ingin disentuh sama sekali, pakai --baseline.

const TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

function readMigrations() {
  return fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
      return { filename, sql, checksum: sha(sql) };
    });
}

async function applied(client) {
  const { rows } = await client.query('SELECT filename, checksum FROM public.schema_migrations');
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

async function runOne(client, migration) {
  // Efek migration dan catatannya commit bersama: tidak mungkin ada file
  // yang tercatat "sudah dijalankan" padahal isinya gagal separuh jalan.
  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)
       ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
      [migration.filename, migration.checksum],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--status') ? 'status' : args.includes('--baseline') ? 'baseline' : 'run';
  const redoIndex = args.indexOf('--redo');
  const redo = redoIndex >= 0 ? args[redoIndex + 1] : null;

  const migrations = readMigrations();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(TRACKING_TABLE);
    const done = await applied(client);

    if (mode === 'status') {
      for (const m of migrations) {
        const state = !done.has(m.filename) ? 'BELUM'
          : done.get(m.filename) === m.checksum ? 'sudah'
            : 'sudah (ISI FILE BERUBAH)';
        console.log(`${state.padEnd(24)} ${m.filename}`);
      }
      return;
    }

    if (mode === 'baseline') {
      for (const m of migrations) {
        await client.query(
          `INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)
           ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum`,
          [m.filename, m.checksum],
        );
      }
      console.log(`Baseline: ${migrations.length} migration ditandai sudah dijalankan (tanpa dieksekusi).`);
      return;
    }

    if (redo) {
      const target = migrations.find((m) => m.filename === redo);
      if (!target) throw new Error(`Migration tidak ditemukan: ${redo}`);
      await runOne(client, target);
      console.log(`Dijalankan ulang: ${redo}`);
      return;
    }

    let ran = 0;
    for (const m of migrations) {
      if (done.has(m.filename)) {
        // File yang isinya berubah setelah dijalankan tidak dijalankan ulang
        // diam-diam — mengubah migration yang sudah dipakai orang lain adalah
        // keputusan, bukan kecelakaan, jadi biarkan manusia yang memutuskan.
        if (done.get(m.filename) !== m.checksum) {
          console.warn(`PERINGATAN  ${m.filename} sudah dijalankan tapi isinya berubah sejak itu.`);
          console.warn(`            Jalankan ulang dengan: npm run migrate -- --redo ${m.filename}`);
        }
        continue;
      }
      await runOne(client, m);
      console.log(`Migration ${m.filename} applied successfully.`);
      ran += 1;
    }
    console.log(ran ? `${ran} migration dijalankan.` : 'Tidak ada migration baru — database sudah mutakhir.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
