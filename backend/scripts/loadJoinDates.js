/**
 * loadJoinDates.js — one-shot loader for brands.join_date ("Mulai kerja sama").
 *
 * join_date is NOT in the "Client info" sheet. This table was supplied
 * separately from AO / Consultant / PIC engagement records (~40 clients,
 * corrected from an earlier column-shift bug). Every value is the first of
 * the engagement month.
 *
 * Names are matched to the EXACT public.brands.brand_name (verified once by
 * hand against the migrated 141-row brand list — several needed fixing:
 * "BoxAreUs"->"Box Are Us", "Max Baren's"->"Max Barens", "Zulfa Cake &
 * Bakery"->"Zulfa Bakery & Cake" (word order), "Mikimana"->"MIKIMANA",
 * "TumbuhLab"->"Tumbuh Lab", "2Timestoo"->"2TimesToo Studio", etc).
 *
 * Clients absent from this table keep join_date = NULL (never proxied from
 * "first month with data").
 *
 *   node scripts/loadJoinDates.js            # dry run — reports matches
 *   node scripts/loadJoinDates.js --commit   # write
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const COMMIT = process.argv.includes('--commit');

// brand_name (exact, as in public.brands)  ->  join_date (YYYY-MM-01)
const JOIN_DATES = {
  'HIA Everywear': '2021-03-01',
  Orient: '2022-07-01',
  'Toko Mas Jawa Jewelry': '2022-07-01',
  'Healthy Wagyu': '2022-08-01',
  'Box Are Us': '2022-10-01',
  'Lylà Officielle': '2022-11-01',
  'Candy Button': '2022-12-01',
  Crabus: '2023-02-01',
  Bluesville: '2023-03-01',
  Teknikmart: '2023-04-01',
  Istafada: '2023-05-01',
  Authentism: '2023-06-01',
  'Orange Shopz': '2023-07-01',
  'Opus One': '2023-06-01',
  'Koperasi BUMI & Gritiwa': '2023-08-01',
  'Klinik Fadya': '2023-09-01',
  Valentine: '2023-09-01',
  MIKIMANA: '2023-09-01',
  'Tumbuh Lab': '2023-09-01',
  Wheels: '2023-10-01',
  Onycha: '2023-10-01',
  Cintella: '2023-11-01',
  Moiwa: '2023-11-01',
  'Petite Fleur': '2023-11-01', // NOT "Petite Fleur KL" (Malaysia, separate brand)
  'Parahyangan EBP': '2023-12-01',
  Ishika: '2023-12-01',
  'BIG Kabel': '2024-01-01',
  'Max Barens': '2024-01-01',
  Emica: '2024-01-01',
  '2TimesToo Studio': '2024-02-01',
  Bartega: '2024-02-01',
  'Karya Ruang': '2024-02-01',
  'Zulfa Bakery & Cake': '2024-02-01',
  'Lekoh Coffee': '2024-02-01',
  'Toko Baru': '2024-03-01',
  'ECO Construct': '2024-09-01',
  Twiloona: '2024-09-01',
  Vegeto: '2024-11-01',
  'Extrude Frame': '2025-10-01',
  Maiimi: '2026-07-01',
};

// In the source table but NOT matched by whoever compiled it. Reported so a
// human can confirm/reject; NOT written (no date was supplied for them).
const UNMATCHED_SOURCE = ['PBSP', 'Mobil Seken', 'Mekar Ban'];

// "Yayasan Berkat Anak" (May 2024) is in the source table but is the
// internal "[Web Dev] Y. Berkat Anak" entity, excluded from the brand
// migration — intentionally not loaded.

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const dbNames = new Set((await client.query('SELECT brand_name FROM brands')).rows.map((r) => r.brand_name));

    const matched = [];
    const missing = [];
    for (const [name, date] of Object.entries(JOIN_DATES)) {
      if (dbNames.has(name)) matched.push([name, date]);
      else missing.push(name);
    }

    console.log(`Mode: ${COMMIT ? 'COMMIT' : 'DRY RUN'}`);
    console.log(`Source entries: ${Object.keys(JOIN_DATES).length} · matched to brands: ${matched.length} · NOT found: ${missing.length}`);
    if (missing.length) console.log('  !! not found in brands (fix the mapping):', missing.join(', '));

    // candidate matches for the source's own unmatched names
    console.log('\nSource names the compiler could not match — candidates in brands:');
    for (const u of UNMATCHED_SOURCE) {
      const q = u.toLowerCase().replace(/[^a-z0-9]/g, '');
      const cands = [...dbNames].filter((n) => {
        const nn = n.toLowerCase().replace(/[^a-z0-9]/g, '');
        return nn.includes(q) || q.includes(nn);
      });
      console.log(`  "${u}" -> ${cands.length ? cands.join(', ') : '(no candidate)'}  [no join_date supplied — not written]`);
    }

    if (COMMIT) {
      await client.query('BEGIN');
      let n = 0;
      for (const [name, date] of matched) {
        const r = await client.query('UPDATE brands SET join_date = $1 WHERE brand_name = $2', [date, name]);
        n += r.rowCount;
      }
      await client.query('COMMIT');
      console.log(`\nCOMMITTED: ${n} brands.join_date set.`);
    } else {
      console.log('\nDry run — re-run with --commit to write. Preview:');
      for (const [name, date] of matched) console.log(`  ${name.padEnd(28)} ${date}`);
    }

    const stillNull = (await client.query(
      "SELECT count(*)::int n FROM brands WHERE status IS NOT NULL AND join_date IS NULL",
    )).rows[0].n;
    console.log(`\nMigrated brands still without join_date: ${stillNull} (kept NULL — not guessed).`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
