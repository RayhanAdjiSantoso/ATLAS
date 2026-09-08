import * as XLSX from 'xlsx';
import pool from '../config/db.js';

// Pengaturan Brand's data layer: the brand's narrative profile, and the
// file library every other module reads instead of asking for its own
// upload.
//
// The channel vocabulary below is NOT invented here — it is the exact set
// Report Generator already saves into ads_reports.raw_uploads
// ('meta','cpas','produk','produk_otomatis','toko','toko_keyword','live',
// 'overview','tiktok'), plus the three Dashboard file_type values
// ('order','performance_overview','product_performance') and the product
// master reference. Keeping one vocabulary is what lets a library file be
// handed to the report pipeline later with no translation step.

export const LIBRARY_CHANNELS = {
  meta: ['meta', 'cpas'],
  shopee: [
    'order',
    'performance_overview',
    'product_performance',
    'produk',
    'produk_otomatis',
    'toko',
    'toko_keyword',
    'live',
    'overview',
    'product_master',
  ],
  tiktok: ['tiktok', 'tiktok_order'],
};

// Files that describe a mapping rather than a period. They are stored with
// period_month = NULL and are never asked "which month is this?".
export const REFERENCE_CHANNELS = new Set(['product_master']);

export function isValidScope(platform, channel) {
  return Boolean(LIBRARY_CHANNELS[platform]?.includes(channel));
}

/* ── Brand profile ──────────────────────────────────────────────────── */

const PROFILE_FIELDS = [
  'sector',
  'brand_products_customer',
  'positioning_driver',
  'key_products_channels',
  'business_characteristics',
  'historical_learning',
  'objective_target',
  'strategic_priorities',
  'constraints_concerns',
];

export async function getProfile(brandId) {
  const result = await pool.query(
    `SELECT b.brand_id, b.brand_name,
            ${PROFILE_FIELDS.map((f) => `p.${f}`).join(', ')},
            p.updated_at, u.full_name AS updated_by_name
     FROM public.brands b
     LEFT JOIN public.brand_profiles p ON p.brand_id = b.brand_id
     LEFT JOIN public.users u ON u.user_id = p.updated_by
     WHERE b.brand_id = $1`,
    [brandId],
  );
  return result.rows[0] ?? null;
}

export async function saveProfile(brandId, patch, userId) {
  const values = PROFILE_FIELDS.map((field) => (patch[field] === undefined ? null : patch[field]));
  const result = await pool.query(
    `INSERT INTO public.brand_profiles (brand_id, ${PROFILE_FIELDS.join(', ')}, updated_by, updated_at)
     VALUES ($1, ${PROFILE_FIELDS.map((_, i) => `$${i + 2}`).join(', ')}, $${PROFILE_FIELDS.length + 2}, now())
     ON CONFLICT (brand_id) DO UPDATE SET
       ${PROFILE_FIELDS.map((f) => `${f} = EXCLUDED.${f}`).join(', ')},
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING *`,
    [brandId, ...values, userId ?? null],
  );
  return result.rows[0];
}

/* ── Library ────────────────────────────────────────────────────────── */

// Everything except the bytes — the list endpoint is polled on every brand
// switch and must never drag BYTEA columns across the wire.
const LIBRARY_COLUMNS = `
  f.id, f.brand_id, f.platform, f.channel,
  f.period_month::text AS period_month,
  f.period_start::text AS period_start,
  f.period_end::text AS period_end,
  f.covered_days, f.day_bitmap, f.row_count, f.period_source, f.dashboard_upload_id, f.part_index,
  f.import_status, f.import_error, f.import_rows,
  f.original_filename, f.byte_size, f.uploaded_at, f.updated_at,
  u.full_name AS uploaded_by_name
`;

export async function listLibrary(brandId) {
  const result = await pool.query(
    `SELECT ${LIBRARY_COLUMNS}
     FROM ads_reports.brand_library_files f
     LEFT JOIN public.users u ON u.user_id = f.uploaded_by
     WHERE f.brand_id = $1
     ORDER BY f.platform, f.channel, f.period_month NULLS FIRST, f.part_index`,
    [brandId],
  );
  return result.rows;
}

export async function upsertLibraryFile({
  brandId, platform, channel, periodMonth, periodStart, periodEnd,
  coveredDays, dayBitmap, rowCount, periodSource, partIndex = 1, filename, buffer, userId,
}) {
  // Two upsert targets because the uniqueness of a reference file (no
  // month) is expressed by a different partial index than a monthly one.
  const conflict = periodMonth
    ? '(brand_id, platform, channel, period_month, part_index) WHERE period_month IS NOT NULL'
    : '(brand_id, platform, channel) WHERE period_month IS NULL';

  const result = await pool.query(
    `INSERT INTO ads_reports.brand_library_files
       (brand_id, platform, channel, period_month, period_start, period_end,
        covered_days, day_bitmap, row_count, period_source, part_index, original_filename, byte_size, raw_file, uploaded_by)
     VALUES ($1, $2::ads_reports.platform_enum, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT ${conflict} DO UPDATE SET
       period_start = EXCLUDED.period_start,
       period_end = EXCLUDED.period_end,
       covered_days = EXCLUDED.covered_days,
       day_bitmap = EXCLUDED.day_bitmap,
       row_count = EXCLUDED.row_count,
       period_source = EXCLUDED.period_source,
       part_index = EXCLUDED.part_index,
       original_filename = EXCLUDED.original_filename,
       byte_size = EXCLUDED.byte_size,
       raw_file = EXCLUDED.raw_file,
       uploaded_by = EXCLUDED.uploaded_by,
       updated_at = now()
     RETURNING id`,
    [
      brandId, platform, channel, periodMonth, periodStart, periodEnd,
      coveredDays, dayBitmap, rowCount, periodSource ?? null, partIndex, filename, buffer?.length ?? null, buffer ?? null, userId ?? null,
    ],
  );

  const saved = await pool.query(
    `SELECT ${LIBRARY_COLUMNS}
     FROM ads_reports.brand_library_files f
     LEFT JOIN public.users u ON u.user_id = f.uploaded_by
     WHERE f.id = $1`,
    [result.rows[0].id],
  );
  return saved.rows[0];
}

// The three exports Dashboard Business Overview is built on. Everything else
// in the library is read by the Report Generator straight from its bytes;
// these three have to be parsed into shopee.* fact tables as well, because
// that is what the dashboard queries.
export const DASHBOARD_FILE_TYPES = {
  order: 'order',
  performance_overview: 'performance_overview',
  product_performance: 'product_performance',
};

// Once a Dashboard file has actually been parsed, the rows that landed in
// the fact tables are the truth about what it covers — more reliable than
// the filename, which is a request parameter Shopee echoes back, not a
// description of the contents. "Order.all.20260801_20260831_part_1_of_2"
// names the whole month and holds three weeks of it; without this the
// library would report a complete August that the dashboard cannot back up.
export async function syncCoverageFromImport(fileId, range, monthKey) {
  if (!range?.start || !range?.end) return null;
  const summary = summariseRange(range, monthKey);
  const result = await pool.query(
    `UPDATE ads_reports.brand_library_files
     SET period_start = $2, period_end = $3, covered_days = $4, day_bitmap = $5, period_source = 'import', updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [fileId, summary.periodStart, summary.periodEnd, summary.coveredDays, summary.dayBitmap],
  );
  return result.rowCount ? summary : null;
}

export async function setDashboardUpload(fileId, uploadId) {
  await pool.query(
    'UPDATE ads_reports.brand_library_files SET dashboard_upload_id = $1 WHERE id = $2',
    [uploadId, fileId],
  );
}

// Hasil impor disimpan eksplisit, bukan disimpulkan dari ada-tidaknya
// dashboard_upload_id: "gagal" dan "bukan dataset Dashboard" sama-sama
// membuat kolom itu NULL, dan membedakan keduanya justru yang dibutuhkan UI.
export async function setImportResult(fileId, { status, error = null, rows = null, uploadId = null }) {
  await pool.query(
    `UPDATE ads_reports.brand_library_files
     SET import_status = $2, import_error = $3, import_rows = $4,
         dashboard_upload_id = COALESCE($5, CASE WHEN $2 = 'failed' THEN NULL ELSE dashboard_upload_id END),
         updated_at = now()
     WHERE id = $1`,
    [fileId, status, error, rows, uploadId],
  );
}

// Byte file untuk impor ulang — supaya percobaan kedua tidak menuntut
// pengguna mengunggah file yang sama sekali lagi.
export async function getFileForImport(brandId, fileId) {
  const result = await pool.query(
    `SELECT id, brand_id, platform, channel, period_month::text AS period_month,
            original_filename, raw_file, dashboard_upload_id, uploaded_by
     FROM ads_reports.brand_library_files
     WHERE brand_id = $1 AND id = $2`,
    [brandId, fileId],
  );
  return result.rows[0] ?? null;
}

// Every part already filed under one month slot, oldest part first.
export async function listSlotParts(brandId, platform, channel, periodMonth) {
  const result = await pool.query(
    `SELECT id, part_index, original_filename, dashboard_upload_id
     FROM ads_reports.brand_library_files
     WHERE brand_id = $1 AND platform = $2::ads_reports.platform_enum AND channel = $3
       AND period_month IS NOT DISTINCT FROM $4
     ORDER BY part_index`,
    [brandId, platform, channel, periodMonth],
  );
  return result.rows;
}

// Where a newly uploaded file belongs in the slot. Re-uploading a file with
// the same name replaces that part rather than adding a duplicate of it —
// picking the same export twice is a slip, not a request for two copies.
export function placePart(existingParts, filename) {
  const sameName = existingParts.find((part) => part.original_filename === filename);
  if (sameName) return { partIndex: sameName.part_index, previousUploadId: sameName.dashboard_upload_id, replaced: true };
  const next = existingParts.reduce((max, part) => Math.max(max, part.part_index), 0) + 1;
  return { partIndex: next, previousUploadId: null, replaced: false };
}

export async function deleteLibraryFile(brandId, fileId) {
  const result = await pool.query(
    'DELETE FROM ads_reports.brand_library_files WHERE brand_id = $1 AND id = $2 RETURNING id, dashboard_upload_id',
    [brandId, fileId],
  );
  return result.rows[0] ?? null;
}

export async function getLibraryFileBytes(brandId, fileId) {
  const result = await pool.query(
    'SELECT original_filename, raw_file FROM ads_reports.brand_library_files WHERE brand_id = $1 AND id = $2',
    [brandId, fileId],
  );
  return result.rows[0] ?? null;
}

/* ── Period detection ───────────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// Excel serials only count as dates inside a sane window (roughly 2009 to
// 2064). Without that guard every quantity/price column in the sheet would
// register as a date and the detected period would be nonsense.
const SERIAL_MIN = 40000;
const SERIAL_MAX = 60000;

function cellToIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return iso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'number' && value >= SERIAL_MIN && value <= SERIAL_MAX) {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? iso(parsed.y, parsed.m, parsed.d) : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  let m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  // Indonesian exports write DD-MM-YYYY / DD/MM/YYYY; day-first is the
  // right reading for both Shopee and TikTok Seller Center.
  m = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

// Marketplace exports are not always the .xlsx their extension claims:
// Shopee and TikTok Seller Centre both hand out "Excel" files that are
// really CSV or an HTML table, and those throw on a plain buffer read. Try
// the honest reading first, then the text readings, before giving up.
function readWorkbook(buffer) {
  // raw:true is load-bearing, not tidiness. Without it SheetJS parses a
  // text date like "01-06-2026" month-first and hands back 6 January —
  // silently moving every Indonesian date whose day is <= 12 into the wrong
  // month. Keeping text as text lets cellToIso() below apply the day-first
  // reading these exports actually use. Real date-typed cells still arrive
  // as Date objects, which are unambiguous.
  const options = { cellDates: true, raw: true };
  try {
    return XLSX.read(buffer, { type: 'buffer', ...options });
  } catch (bufferError) {
    try {
      return XLSX.read(buffer.toString('utf8'), { type: 'string', ...options });
    } catch {
      throw bufferError;
    }
  }
}

// Scans every sheet for date-shaped cells. Deliberately header-agnostic:
// the eleven supported exports name their date column at least six
// different ways ("Tanggal", "Waktu Pesanan Dibuat", "Day", "Tanggal
// Mulai"...), and a whitelist would silently detect nothing the first time
// a platform renames one.
export function detectDates(buffer, { maxRows = 20000 } = {}) {
  const workbook = typeof buffer?.SheetNames === 'undefined' ? readWorkbook(buffer) : buffer;
  const dates = new Set();
  let rowCount = 0;

  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, blankrows: false });
    rowCount = Math.max(rowCount, Math.max(rows.length - 1, 0));
    for (const row of rows.slice(0, maxRows)) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        const found = cellToIso(cell);
        if (found) dates.add(found);
      }
    }
  }
  return { dates: [...dates].sort(), rowCount, workbook };
}

// ── Where a period actually comes from ──────────────────────────────
//
// Row dates are the LAST resort, not the first. The two most common Shopee
// exports prove why:
//
//   - "Data Keseluruhan Iklan Shopee" carries one row per campaign, and its
//     Tanggal Mulai is the day that campaign was created — dates spanning
//     2024 to 2026 in a report about July 2026. Reading the rows gives a
//     confidently wrong answer. The file states its real period on a
//     "Periode,01/07/2026 - 31/07/2026" line above the table.
//   - "parentskudetail" (performa toko) has no date column at all; its
//     period lives only in the filename, 20260701_20260731.
//
// So: a declared period beats a filename, a filename beats row dates, and
// row dates are trusted only when nothing better exists.

const RANGE_PATTERNS = [
  // 01/07/2026 - 31/07/2026 · 01-07-2026 s/d 31-07-2026 (day-first)
  { re: /(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*(?:-|–|s\/d|sampai|to|until)\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i, order: 'dmy' },
  // 2026-07-01 to 2026-07-31
  { re: /(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:-|–|s\/d|to|until)\s*(\d{4})-(\d{1,2})-(\d{1,2})/i, order: 'ymd' },
];

function rangeFromText(text) {
  for (const { re, order } of RANGE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const [a, b, c, d, e, f] = m.slice(1).map(Number);
    return order === 'dmy'
      ? { start: iso(c, b, a), end: iso(f, e, d) }
      : { start: iso(a, b, c), end: iso(d, e, f) };
  }
  return null;
}

// A "Periode" / "Reporting period" line in the rows above the table. Only
// the first handful of rows are considered: further down, a cell reading
// "Periode" is a data value, not a header.
export function detectDeclaredPeriod(workbook, { scanRows = 12 } = {}) {
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, blankrows: false }).slice(0, scanRows);
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const text = row.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? ''))).join(' ');
      if (!/periode|period|rentang|date range/i.test(text)) continue;
      const range = rangeFromText(text);
      if (range) return range;
    }
  }
  return null;
}

// Shopee and TikTok both stamp the range into the download name:
// "...-01_07_2026-31_07_2026.csv", "parentskudetail.20260701_20260731.xlsx".
export function detectFilenamePeriod(filename = '') {
  const name = String(filename);
  let m = name.match(/(\d{2})[_-](\d{2})[_-](\d{4})\D{1,3}(\d{2})[_-](\d{2})[_-](\d{4})/);
  if (m) {
    const [d1, m1, y1, d2, m2, y2] = m.slice(1).map(Number);
    return { start: iso(y1, m1, d1), end: iso(y2, m2, d2) };
  }
  m = name.match(/(\d{4})(\d{2})(\d{2})\D{1,3}(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const [y1, m1, d1, y2, m2, d2] = m.slice(1).map(Number);
    return { start: iso(y1, m1, d1), end: iso(y2, m2, d2) };
  }
  return rangeFromText(name);
}

// Turns the detected dates into the coverage the UI draws.
export function summarisePeriod(dates, forcedMonth = null) {
  if (!dates.length) {
    if (!forcedMonth) return { periodMonth: null, periodStart: null, periodEnd: null, coveredDays: 0, dayBitmap: null };
    const [y, m] = forcedMonth.split('-').map(Number);
    return { periodMonth: iso(y, m, 1), periodStart: null, periodEnd: null, coveredDays: 0, dayBitmap: '0'.repeat(daysInMonth(y, m)) };
  }

  let year;
  let month;
  if (forcedMonth) {
    [year, month] = forcedMonth.split('-').map(Number);
  } else {
    // The month that owns the most dates — a campaign export whose rows sit
    // in July but whose "Tanggal Selesai" spills into August belongs to July.
    const tally = new Map();
    for (const date of dates) {
      const key = date.slice(0, 7);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const [best] = [...tally.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    [year, month] = best[0].split('-').map(Number);
  }

  const total = daysInMonth(year, month);
  const prefix = `${year}-${pad(month)}-`;
  const inMonth = dates.filter((d) => d.startsWith(prefix));
  const days = new Set(inMonth.map((d) => Number(d.slice(8, 10))));

  // A campaign-level export carries "Tanggal Mulai"/"Tanggal Selesai", not
  // one row per day: every row repeats the same one or two ranges. Four
  // distinct days spanning a fortnight means the file covers the fortnight,
  // not four days — fill the span so coverage isn't understated. The bound
  // is deliberately low: a daily export has far more distinct days than
  // this, so its exact (and possibly gappy) coverage is left untouched.
  if (days.size > 0 && days.size <= 4) {
    const min = Math.min(...days);
    const max = Math.max(...days);
    if (max - min >= 2) for (let d = min; d <= max; d += 1) days.add(d);
  }

  const bitmap = Array.from({ length: total }, (_, i) => (days.has(i + 1) ? '1' : '0')).join('');
  const sorted = [...days].sort((a, b) => a - b);
  return {
    periodMonth: iso(year, month, 1),
    periodStart: sorted.length ? iso(year, month, sorted[0]) : null,
    periodEnd: sorted.length ? iso(year, month, sorted[sorted.length - 1]) : null,
    coveredDays: sorted.length,
    dayBitmap: bitmap,
  };
}

// The single entry point the controller uses: read the file once, then let
// the best available signal decide the period. `source` travels back to the
// UI so the user can see WHY a month was filled in the way it was.
export function analyseFile({ buffer, filename, month }) {
  const workbook = readWorkbook(buffer);
  const { dates, rowCount } = detectDates(workbook);

  const declared = detectDeclaredPeriod(workbook);
  const fromName = detectFilenamePeriod(filename);
  const range = declared ?? fromName;

  if (range) {
    return {
      ...summariseRange(range, month),
      rowCount,
      source: declared ? 'declared' : 'filename',
      declaredRange: range,
    };
  }
  return { ...summarisePeriod(dates, month), rowCount, source: dates.length ? 'rows' : 'none', declaredRange: null };
}

// Coverage from an explicit start/end range, clipped to the month the file
// was filed under. A range that misses the month entirely yields no days —
// the caller turns that into a "wrong slot?" warning rather than a silent 0.
export function summariseRange(range, forcedMonth) {
  const monthKey = forcedMonth ?? range.start.slice(0, 7);
  const [year, month] = monthKey.split('-').map(Number);
  const total = daysInMonth(year, month);
  const monthStart = iso(year, month, 1);
  const monthEnd = iso(year, month, total);

  const start = range.start > monthStart ? range.start : monthStart;
  const end = range.end < monthEnd ? range.end : monthEnd;

  if (start > end) {
    return { periodMonth: iso(year, month, 1), periodStart: null, periodEnd: null, coveredDays: 0, dayBitmap: '0'.repeat(total) };
  }

  const from = Number(start.slice(8, 10));
  const to = Number(end.slice(8, 10));
  const bitmap = Array.from({ length: total }, (_, i) => (i + 1 >= from && i + 1 <= to ? '1' : '0')).join('');
  return { periodMonth: iso(year, month, 1), periodStart: start, periodEnd: end, coveredDays: to - from + 1, dayBitmap: bitmap };
}
