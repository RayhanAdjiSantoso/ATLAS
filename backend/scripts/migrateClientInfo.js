/**
 * migrateClientInfo.js  —  ONE-SHOT data migration for the Internal Dashboard.
 *
 * Reads the "Client info" tab of "MIL DIGITAL CLIENTS [UPDATED 2025].xlsx"
 * and maps each client row onto the columns added by
 * migrations/008_internal_dashboard_brands.sql:
 *
 *   brands.status / .industry / .sub_industry / .bm_id / .pic
 *   brands.migration_review_note   (specific reason, for rows needing a human look)
 *   industry_hierarchy(kategori_besar, industry, sub_industry)
 *
 * Design decisions baked in (see technical breakdown §2.1 / §2.6 / §6):
 *   - The 9 ACTIVE clients with no industry data are migrated with NULLs,
 *     NOT skipped. They carry no review note (S8 Data Quality flags them
 *     later via NULL detection); they are listed in the run summary only.
 *   - Rows whose Industry / Sub Industry look swapped, identical, empty on
 *     one side, or unrecognised are NEVER auto-corrected. The script writes
 *     a specific human-readable reason into brands.migration_review_note and
 *     leaves the raw sheet values in place.
 *   - "Display Ads" / "Marketplace Ads" free-text is parsed to a BEST-GUESS
 *     set of §2.5 platform enums for review ONLY. Nothing is written to the
 *     DB for it — the target table/enum (client_platform_spend_monthly)
 *     does not exist yet. Output goes to a CSV for manual review.
 *
 * Usage:
 *   node scripts/migrateClientInfo.js                       # dry run (default)
 *   node scripts/migrateClientInfo.js --file=/path/to.xlsx  # override source
 *   node scripts/migrateClientInfo.js --active-only         # migrate only ACTIVE/FREEZE rows
 *   node scripts/migrateClientInfo.js --commit              # actually write to the DB
 *
 * Dry run always writes review artifacts to  backend/scripts/out/ :
 *   client_info_brands_preview.csv
 *   industry_hierarchy_preview.csv
 *   display_ads_parse_preview.csv
 *   unresolved_industry_pairs.csv
 *
 * Requires DATABASE_URL in the environment (same as scripts/migrate.js).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'out');

const DEFAULT_XLSX = '/Users/rayhanadjisantoso/Downloads/Copy of MIL DIGITAL CLIENTS [UPDATED 2025].xlsx';
const SHEET_NAME = 'Client info';

// --- CLI args --------------------------------------------------------------
const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const ACTIVE_ONLY = args.includes('--active-only');
const CHANNELS_MODE = args.includes('--channels'); // populate client_sales_channels (§2.2) instead of brands
const fileArg = args.find((a) => a.startsWith('--file='));
const XLSX_PATH = fileArg ? fileArg.slice('--file='.length) : DEFAULT_XLSX;

// --- Column indexes in the "Client info" sheet -----------------------------
// Header is sheet row 3 (0-indexed 2); data starts sheet row 4 (index 3).
const COL = {
  brandName: 0,
  status: 1,
  industry: 7,
  subIndustry: 8,
  bmId: 10,
  enabledWebsite: 14, // "Enabled Website" — a clean True/False boolean
  displayAds: 17,
  marketplaceAds: 18,
  pic: 24,
};
// The header row ("Brand Name | Status | …") is located at runtime rather
// than hard-coded, so a blank leading row in the sheet can't shift the math.

// --- Reference data -------------------------------------------------------
const STATUS_MAP = { ACTIVE: 'active', OFF: 'off', FREEZE: 'freeze' };

// Internal / agency entities in the sheet that are NOT real clients — skipped
// entirely (never inserted), so they can't inflate "Active Clients" / "Total
// Portfolio Sales" on S1. Matched case-insensitively on trimmed Brand Name.
const EXCLUDE_BRANDS = new Set([
  'mil digital',
  'opus one (as bc)',
  '[web dev] y. berkat anak',
].map((s) => s.toLowerCase()));

// "Industry" values that are real top-level industries, with their derived
// kategori_besar (breakdown §2.1: kategori_besar is a function of industry).
const KATEGORI_BESAR = {
  'Retail-Non Fashion': 'Retail',
  'Retail-Fashion': 'Retail',
  'B2B + Services': 'B2B/Service',
  'Food & Beverages': 'F&B',
};
const KNOWN_INDUSTRY = new Set(Object.keys(KATEGORI_BESAR));

// Values seen in the "Sub Industry" column (used to detect swapped columns).
const KNOWN_SUB_INDUSTRY = new Set([
  'Health and Beauty', 'Hijab & Modest Wear', 'Jewelry', 'B2B', 'House Appliances',
  'FnB Retail', 'Fashion & Accessories', "Kid's Wear", 'Footwear', 'Service',
  'FnB / Cafe', 'Florist', "Men's Wear", 'Medical and Health', 'B2B + Services',
]);

// Display Ads / Marketplace Ads free-text  →  best-guess §2.5 platform enum.
// Matched as case-insensitive substrings against the whole combined string.
const PLATFORM_HINTS = [
  ['profile visit', 'meta_boost'],
  ['boost post', 'meta_boost'],
  ['boost', 'meta_boost'],
  ['non boost', 'meta_nonboost'],
  ['nonboost', 'meta_nonboost'],
  ['main account', 'meta_nonboost'],
  ['main acc', 'meta_nonboost'],
  ['cpas', 'meta_cpas'],
  ['google ads', 'google_ads'],
  ['gads', 'google_ads'],
  ['g ads', 'google_ads'],
  ['google', 'google_ads'],
  ['shopee iklanku', 'iklanku_shopee'],
  ['iklanku', 'iklanku_shopee'],
  ['shopee ads', 'iklanku_shopee'],
  ['shopee ad', 'iklanku_shopee'],
  ['gmv max', 'gmv_max_tiktok'],
  ['gmv', 'gmv_max_tiktok'],
];
// Recognised words that have NO §2.5 platform enum — surfaced for review
// even when they sit inside an otherwise-mapped token (e.g. "Tiktok Boost
// Post" maps to meta_boost but is really a TikTok placement).
const NO_ENUM_WORDS = ['tokopedia', 'tokped', 'topads', 'ttam', 'tiktok', 'website', 'lazada', 'leads'];

// City / branch abbreviations — presence means the free-text encodes a
// per-branch setup (e.g. Healthy Wagyu's "CPAS Shopee Bdg, Tgr, Jaksel"),
// a detail level closer to brand_ad_accounts than to a plain channel flag.
const CITY_HINTS = [
  'bandung', 'bdg', 'jakarta', 'jkt', 'jaksel', 'jakbar', 'jakpus', 'jaktim', 'jakut',
  'tangerang', 'tgr', 'tangsel', 'bekasi', 'bogor', 'depok', 'cikarang',
  'surabaya', 'sby', 'sidoarjo', 'malang', 'semarang', 'smg', 'solo', 'surakarta',
  'yogya', 'yogyakarta', 'jogja', 'klaten', 'tegal', 'cirebon',
  'medan', 'palembang', 'makassar', 'denpasar', 'bali', 'lampung', 'batam',
];

// Derived channel flags for client_sales_channels (§2.2). Kept SEPARATE
// from the raw text and from the §2.5 platform-enum guesses — a "yes/no"
// convenience only, never a replacement for the original wording.
const CHANNEL_FLAG_HINTS = {
  shopee: ['shopee', 'cpas shopee', 'shopee iklanku', 'shopee ads', 'iklanku'],
  tiktok_shop: ['tiktok', 'ttam', 'gmv max', 'gmv'],
  website: ['website', 'web '],
  offline: ['offline', 'toko fisik', 'store fisik'],
};

// --- helpers -------------------------------------------------------------
const clean = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '' || s === '-' ? null : s;
};

function normBmId(v) {
  if (v === null || v === undefined || v === '') return null;
  // Sheet stores BM IDs as numbers; all observed values are < 9.0e15, i.e.
  // within the float64 safe-integer range, so no precision has been lost.
  let s = typeof v === 'number' ? BigInt(Math.round(v)).toString() : String(v).trim();
  s = s.replace(/\.0+$/, '');
  return /^\d{6,20}$/.test(s) ? s : `INVALID:${String(v).trim()}`;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(file, headers, rows) {
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(','));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, file), lines.join('\n') + '\n');
}

// --- classify a single row --------------------------------------------
function classifyIndustry(industryRaw, subRaw) {
  const industry = clean(industryRaw);
  const sub = clean(subRaw);
  const result = { industry, sub_industry: sub, kategori_besar: null, note: null, resolvedPair: null };

  if (!industry && !sub) return result; // fully empty — handled by caller

  if (industry && sub) {
    if (industry === sub) {
      result.note = `Industry and Sub Industry are identical ("${industry}") — confirm the real sub-industry.`;
    } else if (KNOWN_INDUSTRY.has(industry)) {
      result.kategori_besar = KATEGORI_BESAR[industry];
      result.resolvedPair = { kategori_besar: result.kategori_besar, industry, sub_industry: sub };
    } else if (KNOWN_SUB_INDUSTRY.has(industry)) {
      result.note = `Industry column contains a sub-industry value ("${industry}"); Sub Industry column has "${sub}". Columns look swapped — review before mapping.`;
    } else {
      result.note = `Unrecognised Industry value "${industry}" (Sub Industry "${sub}") — not in the known industry or sub-industry list; needs mapping.`;
    }
    return result;
  }

  if (industry && !sub) {
    if (KNOWN_INDUSTRY.has(industry)) {
      result.kategori_besar = KATEGORI_BESAR[industry];
      result.note = `Sub Industry empty (Industry="${industry}") — sub-industry is required for peer grouping.`;
    } else if (KNOWN_SUB_INDUSTRY.has(industry)) {
      result.note = `Only one column filled and its value ("${industry}") is a sub-industry — it likely belongs in Sub Industry, with the parent Industry missing. Review.`;
    } else {
      result.note = `Unrecognised single value "${industry}" in Industry, Sub Industry empty — needs mapping.`;
    }
    return result;
  }

  // !industry && sub
  result.note = `Industry empty, Sub Industry="${sub}" — derive/confirm the parent industry.`;
  return result;
}

function parsePlatforms(displayAds, marketplaceAds) {
  const raw = [clean(displayAds), clean(marketplaceAds)].filter(Boolean).join(' ; ');
  if (!raw) {
    return {
      raw_display_ads: clean(displayAds), raw_marketplace_ads: clean(marketplaceAds),
      raw_tokens: [], mapped: [], unmapped: [],
      channel_flags: { shopee: false, tiktok_shop: false, website: false, offline: false },
      branch_hint: [], needs_review: false,
    };
  }

  const hay = raw.toLowerCase();
  const mapped = new Set();
  for (const [needle, enumVal] of PLATFORM_HINTS) {
    if (hay.includes(needle)) mapped.add(enumVal);
  }

  const tokens = raw.split(/[;,/()[\]\n]|(?:\s&\s)/).map((t) => t.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
  const unmapped = new Set();
  for (const tok of tokens) {
    const hitNeedles = PLATFORM_HINTS.filter(([needle]) => tok.includes(needle)).map(([n]) => n);
    // a no-enum word inside this token that the matched hint(s) don't already cover
    for (const w of NO_ENUM_WORDS) {
      if (tok.includes(w) && !hitNeedles.some((n) => n.includes(w))) {
        unmapped.add(hitNeedles.length ? `"${w}" in "${tok}" (no §2.5 enum — review)` : `${w} (no §2.5 enum)`);
      }
    }
    if (hitNeedles.length) continue;
    if (NO_ENUM_WORDS.some((w) => tok.includes(w))) continue; // already recorded above
    unmapped.add(`${tok} (unrecognised)`);
  }

  // verbatim tokens — split only on separators, NO case-folding / rewriting.
  // "CPAS Shopee Bdg" stays "CPAS Shopee Bdg", not "shopee".
  const rawTokens = raw.split(/[;,\n]/).map((t) => t.trim()).filter(Boolean);

  const cityHits = CITY_HINTS.filter((c) => new RegExp(`(?<![a-z])${c}(?![a-z])`).test(hay));

  const channelFlags = {};
  for (const [ch, needles] of Object.entries(CHANNEL_FLAG_HINTS)) {
    channelFlags[ch] = needles.some((nd) => hay.includes(nd));
  }

  return {
    raw_display_ads: clean(displayAds),
    raw_marketplace_ads: clean(marketplaceAds),
    raw_tokens: rawTokens,
    mapped: [...mapped],
    unmapped: [...unmapped],
    channel_flags: channelFlags,
    branch_hint: cityHits,
    needs_review: unmapped.size > 0 || mapped.size === 0 || cityHits.length > 0,
  };
}

const SALES_CHANNEL_ENUM = ['shopee', 'tiktok_shop', 'website', 'offline'];

// --channels: derive client_sales_channels (§2.2) rows from the sheet.
//   website  -> the clean "Enabled Website" boolean (true OR false) when
//              set; else a positive from the ads text; else no row.
//   shopee/tiktok_shop -> a POSITIVE only, when the Display/Marketplace Ads
//              free-text names the channel. NOT a negative: those columns
//              describe where a client ADVERTISES, which is a lower bound
//              on where it SELLS, not the full picture (Petite Fleur has
//              real Shopee sales but "Google Ads, Main Account" as its ads
//              text). Real sales data (client_channel_sales_monthly) is
//              layered on top in --commit as a stronger positive.
//   offline  -> no reliable sheet signal at all; effectively never a row
//              from here.
//   A client with no signal for a channel gets NO row -> S8 treats it as
//   "belum dinilai", not "tidak dipakai".
function channelRowsFor(brandName, row) {
  const ewRaw = row[COL.enabledWebsite];
  const ew = ewRaw === true ? true : ewRaw === false ? false : null;
  const p = parsePlatforms(row[COL.displayAds], row[COL.marketplaceAds]);
  const hasText = !!(p.raw_display_ads || p.raw_marketplace_ads);

  const out = [];
  if (ew !== null) out.push({ brand_name: brandName, channel: 'website', is_used: ew, source: 'enabled_website_col' });
  else if (hasText && p.channel_flags.website) out.push({ brand_name: brandName, channel: 'website', is_used: true, source: 'ads_text_positive' });

  if (hasText) {
    for (const ch of ['shopee', 'tiktok_shop', 'offline']) {
      if (p.channel_flags[ch]) out.push({ brand_name: brandName, channel: ch, is_used: true, source: 'ads_text_positive' });
    }
  }
  return out;
}

async function runChannelsMode(grid, firstDataRowIdx) {
  const rows = [];
  const perClientCount = new Map();
  for (let i = firstDataRowIdx; i < grid.length; i += 1) {
    const r = grid[i];
    if (!r) continue;
    const name = clean(r[COL.brandName]);
    if (!name || EXCLUDE_BRANDS.has(name.toLowerCase())) continue;
    const cr = channelRowsFor(name, r);
    rows.push(...cr);
    perClientCount.set(name, cr.length);
  }

  writeCsv('client_sales_channels_preview.csv',
    ['brand_name', 'channel', 'is_used', 'source'],
    rows.map((x) => ({ ...x, is_used: x.is_used ? 'true' : 'false' })));

  const by = (f) => rows.reduce((m, x) => (m[f(x)] = (m[f(x)] || 0) + 1, m), {});
  const noSignal = [...perClientCount].filter(([, n]) => n === 0).map(([n]) => n);
  console.log('='.repeat(72));
  console.log(`CHANNELS mode · ${COMMIT ? 'COMMIT' : 'DRY RUN'} · source: ${XLSX_PATH}`);
  console.log('-'.repeat(72));
  console.log(`client_sales_channels rows to write : ${rows.length}`);
  console.log(`  by channel : ${JSON.stringify(by((x) => x.channel))}`);
  console.log(`  by source  : ${JSON.stringify(by((x) => x.source))}`);
  console.log(`  is_used    : ${JSON.stringify(by((x) => (x.is_used ? 'true' : 'false')))}`);
  console.log(`clients with at least one channel row : ${[...perClientCount.values()].filter((n) => n > 0).length}`);
  console.log(`clients with NO channel signal at all : ${noSignal.length}`);
  console.log(`  -> ${noSignal.join(', ')}`);
  console.log('-'.repeat(72));
  console.log(`Preview CSV: ${path.join(OUT_DIR, 'client_sales_channels_preview.csv')}`);
  console.log('='.repeat(72));

  if (!COMMIT) {
    console.log('\nDry run. Review the CSV, then re-run with --channels --commit.');
    return;
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET search_path TO public');
    const nameToId = new Map(
      (await client.query('SELECT brand_id, brand_name FROM brands')).rows.map((r) => [r.brand_name, r.brand_id]),
    );
    const missing = [...new Set(rows.map((r) => r.brand_name))].filter((n) => !nameToId.has(n));
    if (missing.length) throw new Error(`brand_name not found in brands: ${missing.join(', ')}`);

    // stronger positive: any channel with actual sales data
    const salesData = (await client.query(
      `SELECT brand_id, channel::text AS channel FROM client_channel_sales_monthly GROUP BY brand_id, channel`,
    )).rows;

    const all = [
      ...rows.map((r) => ({ brand_id: nameToId.get(r.brand_name), channel: r.channel, is_used: r.is_used, source: r.source })),
      ...salesData.map((r) => ({ brand_id: r.brand_id, channel: r.channel, is_used: true, source: 'sales_data' })),
    ];
    // sales_data wins over sheet parse for the same (brand, channel)
    const byKey = new Map();
    for (const r of all) {
      const k = `${r.brand_id}|${r.channel}`;
      const prev = byKey.get(k);
      if (!prev || r.source === 'sales_data') byKey.set(k, r);
    }

    let inserted = 0;
    let updated = 0;
    for (const r of byKey.values()) {
      const res = await client.query(
        `INSERT INTO client_sales_channels (brand_id, channel, is_used, source)
         VALUES ($1, $2::sales_channel, $3, $4)
         ON CONFLICT (brand_id, channel) DO UPDATE SET is_used = EXCLUDED.is_used, source = EXCLUDED.source
         RETURNING (xmax::text = '0') AS was_insert`,
        [r.brand_id, r.channel, r.is_used, r.source],
      );
      if (res.rows[0].was_insert) inserted += 1; else updated += 1;
    }
    await client.query('COMMIT');
    console.log(`\nCOMMITTED: ${inserted} inserted, ${updated} updated (incl. ${salesData.length} from real sales data).`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nROLLED BACK.');
    throw err;
  } finally {
    await client.end();
  }
}

// --- main --------------------------------------------------------------
async function main() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`Source file not found: ${XLSX_PATH}\nPass --file=/path/to/xlsx`);
    process.exit(1);
  }
  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) {
    console.error(`Sheet "${SHEET_NAME}" not found. Sheets: ${wb.SheetNames.join(', ')}`);
    process.exit(1);
  }
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const headerIdx = grid.findIndex((r) => r && clean(r[COL.brandName]) === 'Brand Name');
  if (headerIdx === -1) {
    console.error('Could not locate the "Brand Name" header row in the sheet.');
    process.exit(1);
  }
  const FIRST_DATA_ROW_IDX = headerIdx + 1;

  if (CHANNELS_MODE) {
    await runChannelsMode(grid, FIRST_DATA_ROW_IDX);
    return;
  }

  const brandsPreview = [];
  const displayAdsPreview = [];
  const hierarchyPairs = new Map(); // key: industry||sub  -> {kategori_besar, industry, sub_industry}
  const unresolvedPairs = [];
  const activeNoIndustry = [];
  const skipped = [];
  const excluded = [];
  const seenNames = new Set();

  for (let i = FIRST_DATA_ROW_IDX; i < grid.length; i++) {
    const row = grid[i];
    if (!row) continue;
    const brandName = clean(row[COL.brandName]);
    if (!brandName) continue;

    if (EXCLUDE_BRANDS.has(brandName.toLowerCase())) {
      excluded.push({ row: i + 1, brand_name: brandName });
      continue;
    }

    const statusRaw = clean(row[COL.status]);
    const status = statusRaw ? (STATUS_MAP[statusRaw.toUpperCase()] ?? null) : null;
    let note = null;
    if (statusRaw && !status) note = `Unrecognised Status value "${statusRaw}" — expected ACTIVE / OFF / FREEZE.`;
    else if (!statusRaw) note = 'Status blank in the sheet — confirm whether this row is a real client (may be an internal / agency entry).';

    // duplicate brand name in the sheet
    const key = brandName.toLowerCase();
    if (seenNames.has(key)) {
      note = [note, `Duplicate "Brand Name" in the sheet (row ${i + 1}).`].filter(Boolean).join(' ');
    }
    seenNames.add(key);

    if (ACTIVE_ONLY && !(status === 'active' || status === 'freeze')) {
      skipped.push({ row: i + 1, brand_name: brandName, status: statusRaw ?? '(blank)' });
      continue;
    }

    const ind = classifyIndustry(row[COL.industry], row[COL.subIndustry]);
    const bmId = normBmId(row[COL.bmId]);
    const pic = clean(row[COL.pic]);

    // Merge notes: status note + industry note.
    const notes = [note, ind.note].filter(Boolean);
    const migrationReviewNote = notes.length ? notes.join(' ') : null;

    if (!ind.industry && !ind.sub_industry && (status === 'active' || status === 'freeze')) {
      activeNoIndustry.push(brandName);
    }

    if (ind.resolvedPair) {
      const k = `${ind.resolvedPair.industry}||${ind.resolvedPair.sub_industry}`;
      if (!hierarchyPairs.has(k)) hierarchyPairs.set(k, ind.resolvedPair);
    } else if (ind.industry || ind.sub_industry) {
      unresolvedPairs.push({
        brand_name: brandName,
        industry: ind.industry ?? '',
        sub_industry: ind.sub_industry ?? '',
        reason: ind.note ?? '',
      });
    }

    brandsPreview.push({
      sheet_row: i + 1,
      brand_name: brandName,
      status: status ?? '',
      status_raw: statusRaw ?? '',
      industry: ind.industry ?? '',
      sub_industry: ind.sub_industry ?? '',
      kategori_besar_derived: ind.kategori_besar ?? '',
      bm_id: bmId ?? '',
      pic: pic ?? '',
      migration_review_note: migrationReviewNote ?? '',
    });

    const p = parsePlatforms(row[COL.displayAds], row[COL.marketplaceAds]);
    displayAdsPreview.push({
      brand_name: brandName,
      raw_display_ads: p.raw_display_ads ?? '',
      raw_marketplace_ads: p.raw_marketplace_ads ?? '',
      raw_tokens: p.raw_tokens.join(' | '), // verbatim, not normalised
      channel_shopee: p.channel_flags.shopee ? 'y' : '',
      channel_tiktok_shop: p.channel_flags.tiktok_shop ? 'y' : '',
      channel_website: p.channel_flags.website ? 'y' : '',
      channel_offline: p.channel_flags.offline ? 'y' : '',
      platform_enum_guess: p.mapped.join(' | '),
      unmapped_tokens: p.unmapped.join(' | '),
      branch_hint: p.branch_hint.join(' | '),
      needs_review: p.needs_review ? 'yes' : '',
    });
  }

  // --- write review artifacts -----------------------------------------
  writeCsv('client_info_brands_preview.csv',
    ['sheet_row', 'brand_name', 'status', 'status_raw', 'industry', 'sub_industry',
      'kategori_besar_derived', 'bm_id', 'pic', 'migration_review_note'],
    brandsPreview);

  writeCsv('industry_hierarchy_preview.csv',
    ['kategori_besar', 'industry', 'sub_industry'],
    [...hierarchyPairs.values()].sort((a, b) =>
      (a.kategori_besar + a.industry + a.sub_industry).localeCompare(b.kategori_besar + b.industry + b.sub_industry)));

  // Raw text (raw_display_ads / raw_marketplace_ads / raw_tokens) is the
  // authoritative record — the channel_* flags and platform_enum_guess are
  // derived conveniences and must never overwrite or replace it.
  writeCsv('display_ads_parse_preview.csv',
    ['brand_name', 'raw_display_ads', 'raw_marketplace_ads', 'raw_tokens',
      'channel_shopee', 'channel_tiktok_shop', 'channel_website', 'channel_offline',
      'platform_enum_guess', 'unmapped_tokens', 'branch_hint', 'needs_review'],
    displayAdsPreview);

  writeCsv('unresolved_industry_pairs.csv',
    ['brand_name', 'industry', 'sub_industry', 'reason'],
    unresolvedPairs);

  // --- summary -------------------------------------------------------
  const withNote = brandsPreview.filter((r) => r.migration_review_note).length;
  console.log('='.repeat(72));
  console.log(`Source : ${XLSX_PATH}`);
  console.log(`Mode   : ${COMMIT ? 'COMMIT (writing to DB)' : 'DRY RUN (no DB writes)'}${ACTIVE_ONLY ? '  [--active-only]' : ''}`);
  console.log('-'.repeat(72));
  console.log(`Client rows to migrate        : ${brandsPreview.length}`);
  console.log(`  ACTIVE                       : ${brandsPreview.filter((r) => r.status === 'active').length}`);
  console.log(`  OFF                          : ${brandsPreview.filter((r) => r.status === 'off').length}`);
  console.log(`  FREEZE                       : ${brandsPreview.filter((r) => r.status === 'freeze').length}`);
  console.log(`  blank / unrecognised status  : ${brandsPreview.filter((r) => !r.status).length}`);
  console.log(`Rows with migration_review_note: ${withNote}`);
  console.log(`ACTIVE/FREEZE with NO industry : ${activeNoIndustry.length}  -> ${activeNoIndustry.join(', ') || '(none)'}`);
  console.log(`industry_hierarchy pairs (clean): ${hierarchyPairs.size}`);
  console.log(`Unresolved industry/sub pairs  : ${unresolvedPairs.length}`);
  console.log(`Display/Marketplace Ads rows needing review: ${displayAdsPreview.filter((r) => r.needs_review).length}`);
  console.log(`  filled (any Display/Marketplace Ads text): ${displayAdsPreview.filter((r) => r.raw_display_ads || r.raw_marketplace_ads).length}`);
  console.log(`  with branch/city hint (per-branch setup) : ${displayAdsPreview.filter((r) => r.branch_hint).length}  -> ${displayAdsPreview.filter((r) => r.branch_hint).map((r) => r.brand_name).join(', ') || '(none)'}`);
  console.log(`Excluded (internal / non-client): ${excluded.length}  -> ${excluded.map((e) => e.brand_name).join(', ') || '(none)'}`);
  if (ACTIVE_ONLY) console.log(`Skipped (not ACTIVE/FREEZE)    : ${skipped.length}`);
  console.log('-'.repeat(72));
  console.log(`Review CSVs written to: ${OUT_DIR}`);
  console.log('='.repeat(72));

  // --- reconcile against existing brands rows -----------------------
  // brands already holds a handful of rows (created by the Report
  // Generator). Report exact matches (will be UPDATEd), new names (will
  // be INSERTed), and case/whitespace near-misses (would create a
  // duplicate — fix the sheet or the existing row first).
  let nearMissCount = 0;
  if (process.env.DATABASE_URL) {
    const chk = new pg.Client({ connectionString: process.env.DATABASE_URL });
    try {
      await chk.connect();
      const existing = (await chk.query('SELECT brand_name FROM public.brands')).rows.map((r) => r.brand_name);
      const existingExact = new Set(existing);
      const existingCi = new Map(existing.map((n) => [n.trim().toLowerCase(), n]));
      const willUpdate = [];
      const willInsert = [];
      const nearMiss = [];
      for (const r of brandsPreview) {
        if (existingExact.has(r.brand_name)) willUpdate.push(r.brand_name);
        else if (existingCi.has(r.brand_name.trim().toLowerCase())) nearMiss.push(`"${r.brand_name}"  vs existing  "${existingCi.get(r.brand_name.trim().toLowerCase())}"`);
        else willInsert.push(r.brand_name);
      }
      console.log(`brands in DB now              : ${existing.length}`);
      console.log(`  will UPDATE (exact match)   : ${willUpdate.length}${willUpdate.length ? '  -> ' + willUpdate.join(', ') : ''}`);
      console.log(`  will INSERT (new)           : ${willInsert.length}`);
      nearMissCount = nearMiss.length;
      if (nearMiss.length) {
        console.log(`  !! CASE/WHITESPACE NEAR-MISS : ${nearMiss.length} — would create a DUPLICATE, resolve first:`);
        nearMiss.forEach((m) => console.log(`       ${m}`));
      }
      console.log('='.repeat(72));
    } catch (e) {
      console.log(`(could not reconcile against DB: ${e.message})`);
      console.log('='.repeat(72));
    } finally {
      await chk.end();
    }
  } else {
    console.log('(DATABASE_URL not set — skipped reconciliation against existing brands)');
    console.log('='.repeat(72));
  }

  if (!COMMIT) {
    console.log('\nDry run only. Review the CSVs, then re-run with --commit to write.');
    console.log('NOTE: Display/Marketplace Ads parsing is NOT written to the DB by this');
    console.log('script (no target table yet) — it is exported for review only. The raw');
    console.log('text (raw_display_ads / raw_marketplace_ads / raw_tokens) is authoritative;');
    console.log('channel_* flags + platform_enum_guess are derived, never a replacement.');
    return;
  }

  // --- COMMIT --------------------------------------------------------
  if (nearMissCount > 0) {
    console.error(`\nAborting --commit: ${nearMissCount} case/whitespace near-miss(es) above would create duplicate brands rows.`);
    console.error('Fix the sheet or the existing brands row so the names match exactly, then re-run.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET search_path TO public');

    let inserted = 0;
    let updated = 0;
    for (const r of brandsPreview) {
      const vals = [
        r.brand_name,
        r.status || null,
        r.industry || null,
        r.sub_industry || null,
        r.bm_id || null,
        r.pic || null,
        r.migration_review_note || null,
      ];
      const res = await client.query(
        `INSERT INTO brands (brand_name, status, industry, sub_industry, bm_id, pic, migration_review_note)
         VALUES ($1, $2::brand_status, $3, $4, $5, $6, $7)
         ON CONFLICT (brand_name) DO UPDATE SET
           status                = EXCLUDED.status,
           industry              = EXCLUDED.industry,
           sub_industry          = EXCLUDED.sub_industry,
           bm_id                 = EXCLUDED.bm_id,
           pic                   = EXCLUDED.pic,
           migration_review_note = EXCLUDED.migration_review_note
         RETURNING (xmax::text = '0') AS was_insert`,
        vals,
      );
      if (res.rows[0].was_insert) inserted++;
      else updated++;
    }

    let hierInserted = 0;
    for (const p of hierarchyPairs.values()) {
      const res = await client.query(
        `INSERT INTO industry_hierarchy (kategori_besar, industry, sub_industry)
         VALUES ($1, $2, $3)
         ON CONFLICT (industry, sub_industry) DO NOTHING`,
        [p.kategori_besar, p.industry, p.sub_industry],
      );
      hierInserted += res.rowCount;
    }

    await client.query('COMMIT');
    console.log(`\nCOMMITTED.`);
    console.log(`  brands inserted            : ${inserted}`);
    console.log(`  brands updated             : ${updated}`);
    console.log(`  industry_hierarchy inserted: ${hierInserted}`);
    console.log(`\nbrand_ad_accounts: not populated (sheet has no individual ad-account IDs).`);
    console.log(`Display/Marketplace Ads parsing: not written (review CSV only).`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nROLLED BACK — nothing written.');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
