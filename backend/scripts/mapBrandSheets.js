/**
 * mapBrandSheets.js — bootstrap public.brand_sheet_sources (migration 022)
 * from the "ATLAS Brand Sheet Mapping" tab that
 * scripts/appsScript/BootstrapBrandSheetMapping.gs writes into the master
 * roster spreadsheet (run manually from the Apps Script editor — see that
 * file's header comment for why it's separate from the deployed web app).
 *
 * Reads that tab via the deployed Internal Dashboard Apps Script's safe
 * `getSheetValues` action (SpreadsheetApp only, no DriveApp — see
 * scripts/appsScript/InternalDashboardSheets.gs) rather than calling Drive
 * directly, so this script needs no Google credentials of its own.
 *
 * Every row this script writes has is_verified = FALSE — a human must check
 * spreadsheet_title against the brand before the dashboard trusts it (a
 * roster row can resolve to zero, one, or several Drive candidates; brand
 * names and sheet titles are hand-typed and don't always match cleanly, per
 * the same lesson learned migrating brands.industry/sub_industry by hand).
 *
 * Requires DATABASE_URL, INTERNAL_DASHBOARD_SHEETS_WEBAPP_URL / _API_KEY,
 * and MASTER_ROSTER_SPREADSHEET_ID.
 *
 * Usage:
 *   node scripts/mapBrandSheets.js            # dry run — prints report
 *   node scripts/mapBrandSheets.js --commit    # write to brand_sheet_sources
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { callSheetsAppsScript } from '../src/services/internalDashboardSheets/sheetsGateway.js';

dotenv.config();

const COMMIT = process.argv.includes('--commit');
const MASTER_ROSTER_SPREADSHEET_ID = process.env.MASTER_ROSTER_SPREADSHEET_ID;
const OUTPUT_SHEET_NAME = 'ATLAS Brand Sheet Mapping';
const TAB_NAME = '[NEW] Monthly Performance Analysis';

if (!MASTER_ROSTER_SPREADSHEET_ID) {
  console.error('MASTER_ROSTER_SPREADSHEET_ID belum di-set di .env.');
  process.exit(1);
}

function normalize(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const { rows: brands } = await pool.query('SELECT brand_id, brand_name FROM brands WHERE status = $1', ['active']);
  const brandByName = new Map(brands.map((b) => [normalize(b.brand_name), b]));

  console.log(`Membaca tab "${OUTPUT_SHEET_NAME}" dari spreadsheet ${MASTER_ROSTER_SPREADSHEET_ID}...`);
  let sheetData;
  try {
    sheetData = await callSheetsAppsScript('getSheetValues', {
      spreadsheetId: MASTER_ROSTER_SPREADSHEET_ID,
      tabName: OUTPUT_SHEET_NAME,
    });
  } catch (err) {
    console.error(
      `Gagal baca tab "${OUTPUT_SHEET_NAME}": ${err.message}\n` +
        'Sudah jalankan resolveBrandSheets() dari BootstrapBrandSheetMapping.gs di editor Apps Script belum?'
    );
    process.exit(1);
  }

  const [header, ...dataRows] = sheetData.values;
  const col = (name) => header.indexOf(name);
  const rows = dataRows
    .filter((r) => r[col('brandName')])
    .map((r) => ({
      brandName: r[col('brandName')],
      trackingName: r[col('trackingName')],
      spreadsheetId: r[col('spreadsheetId')],
      spreadsheetTitle: r[col('spreadsheetTitle')],
      candidateCount: Number(r[col('candidateCount')]) || 0,
    }));
  console.log(`${rows.length} baris di tab mapping.\n`);

  const matched = [];
  const noDbBrand = [];
  const noCandidate = [];

  for (const row of rows) {
    const brand = brandByName.get(normalize(row.brandName));
    if (!brand) {
      noDbBrand.push(row);
      continue;
    }
    if (!row.spreadsheetId) {
      noCandidate.push(row);
      continue;
    }
    matched.push({ brand, row });
  }

  console.log('=== Matched (akan ditulis, is_verified=false) ===');
  for (const { brand, row } of matched) {
    const flag = row.candidateCount > 1 ? ` [AMBIGUOUS: ${row.candidateCount} kandidat, dipilih yang terbaru]` : '';
    console.log(`  ${brand.brand_name} -> "${row.spreadsheetTitle}" (${row.spreadsheetId})${flag}`);
  }

  if (noDbBrand.length) {
    console.log('\n=== Tidak ada di brands (status=active) — cek nama ===');
    noDbBrand.forEach((r) => console.log(`  "${r.brandName}" (tracking: "${r.trackingName}")`));
  }

  if (noCandidate.length) {
    console.log('\n=== Tidak ketemu file di Drive — perlu link manual ===');
    noCandidate.forEach((r) => console.log(`  ${r.brandName}: "${r.trackingName}"`));
  }

  console.log(`\nTotal: ${matched.length} matched, ${noDbBrand.length} no-db-brand, ${noCandidate.length} no-candidate.`);

  if (!COMMIT) {
    console.log('\nDry run — tidak ada yang ditulis. Jalankan ulang dengan --commit setelah hasil di atas dicek.');
    await pool.end();
    return;
  }

  console.log('\nMenulis ke brand_sheet_sources...');
  for (const { brand, row } of matched) {
    const note = row.candidateCount > 1 ? `${row.candidateCount} kandidat Drive ditemukan untuk "${row.trackingName}", dipilih yang terakhir diubah — cek manual.` : null;
    await pool.query(
      `INSERT INTO brand_sheet_sources (brand_id, spreadsheet_id, spreadsheet_title, tab_name, is_verified, match_method, note)
       VALUES ($1, $2, $3, $4, FALSE, 'auto_name_match', $5)
       ON CONFLICT (brand_id) DO UPDATE SET
         spreadsheet_id = EXCLUDED.spreadsheet_id,
         spreadsheet_title = EXCLUDED.spreadsheet_title,
         tab_name = EXCLUDED.tab_name,
         is_verified = FALSE,
         match_method = 'auto_name_match',
         note = EXCLUDED.note`,
      [brand.brand_id, row.spreadsheetId, row.spreadsheetTitle, TAB_NAME, note]
    );
  }
  console.log(`Selesai. ${matched.length} baris ditulis/diupdate. Semua is_verified=FALSE sampai direview manual.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
