import * as XLSX from 'xlsx';

// The three Google Ads datasets of Pengaturan Brand › Data & file, as files:
//
//   auction_insights  Auction insights export (manual only — Google does not
//                     open these metrics to scripts or the API)
//   search_terms      Search terms report (written by ATLAS from the daily
//                     rows the Google Ads Script pushes, or uploaded)
//   change_history    Change history (written from google_ads_change_events,
//                     or uploaded for months older than Google's 30 days)
//
// Parsers read Google Ads UI exports in English or Indonesian by matching
// header names, never column positions: the UI lets people add, drop and
// reorder columns before downloading. Builders write files those same
// parsers read back, so an auto-filed month and an uploaded one take the
// same road into the Report Generator.

/* ── reading ────────────────────────────────────────────────────────── */

function readRows(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
  } catch {
    // Google's CSV comes as UTF-16 with tabs when "CSV (Excel)" is picked.
    const text = buffer.toString(buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf16le' : 'utf8');
    workbook = XLSX.read(text, { type: 'string', raw: true });
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false, defval: '' });
}

const norm = (v) => String(v ?? '').replace(/^﻿/, '').trim().toLowerCase();

// The header row is the first one where at least `need` of the expected
// columns are present — above it sit the report title and date range.
function locate(rows, spec, need = 2) {
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const cells = rows[i].map(norm);
    const cols = {};
    for (const [key, patterns] of Object.entries(spec)) {
      const idx = cells.findIndex((c, j) => c && !Object.values(cols).includes(j) && patterns.some((p) => p.test(c)));
      if (idx >= 0) cols[key] = idx;
    }
    if (Object.keys(cols).length >= need) return { headerIndex: i, cols, indonesian: cells.some((c) => /tayangan|biaya|kampanye|perubahan|pangsa/.test(c)) };
  }
  return null;
}

// "1,234.56" · "1.234,56" · "Rp1.234" · "45.12%" · "--" → number | null.
// A lone "1.234" is thousands in an Indonesian export and a decimal in an
// English one, so the header language decides that one case.
export function parseNumber(value, { indonesian = false } = {}) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let s = String(value ?? '').trim();
  if (!s || s === '--' || s === '-' || /^n\/?a$/i.test(s)) return null;
  const percent = s.endsWith('%');
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) && !indonesian ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s) && (indonesian || (s.match(/\./g) || []).length > 1)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return percent ? n / 100 : n;
}

// Auction insights shares come as "45.12%", "< 10%" or "--". Keep what the
// export said for display, plus a number where there is one.
function parseShare(value, opts) {
  const text = String(value ?? '').trim();
  if (!text || text === '--') return { value: null, text: '—' };
  if (/^<\s*10/.test(text)) return { value: null, text: '< 10%' };
  const n = typeof value === 'number' ? (value > 1 ? value / 100 : value) : parseNumber(text, opts);
  return { value: n, text: n == null ? text : `${(n * 100).toFixed(2)}%` };
}

/* ── Auction insights ───────────────────────────────────────────────── */

const AUCTION_SPEC = {
  domain: [/display url domain/, /domain url tampilan/, /^domain/, /url tampilan/],
  impression_share: [/^impr\.? share/, /impression share/, /pangsa tayangan/, /^pangsa tay/],
  overlap_rate: [/overlap/, /tumpang tindih/],
  position_above_rate: [/position above/, /posisi di atas/, /posisi lebih tinggi/],
  abs_top_of_page_rate: [/abs\.? top/, /absolute top/, /paling atas/, /teratas absolut/],
  top_of_page_rate: [/^top of page/, /top of page rate/, /posisi teratas/, /bagian atas halaman/],
  outranking_share: [/outranking/, /mengungguli/],
};
export const AUCTION_METRICS = ['impression_share', 'overlap_rate', 'position_above_rate', 'top_of_page_rate', 'abs_top_of_page_rate', 'outranking_share'];

export function parseAuctionInsights(buffer) {
  const rows = readRows(buffer);
  const found = locate(rows, AUCTION_SPEC, 3);
  if (!found || found.cols.domain == null) return [];
  const { headerIndex, cols, indonesian } = found;
  const seen = new Map();
  for (const row of rows.slice(headerIndex + 1)) {
    const domain = String(row[cols.domain] ?? '').trim();
    if (!domain || /^total/i.test(domain)) continue;
    // A segmented export (by campaign, month...) repeats each domain; the
    // first row per domain is kept rather than averaging shares blindly.
    if (seen.has(domain.toLowerCase())) continue;
    const entry = { domain, isYou: /^(you|anda)$/i.test(domain) };
    for (const key of AUCTION_METRICS) {
      entry[key] = cols[key] == null ? { value: null, text: '—' } : parseShare(row[cols[key]], { indonesian });
    }
    seen.set(domain.toLowerCase(), entry);
  }
  return [...seen.values()];
}

/* ── Search terms ───────────────────────────────────────────────────── */

const SEARCH_TERM_SPEC = {
  search_term: [/^search term$/, /^search term/, /istilah penelusuran/, /^kueri/],
  match_type: [/match type/, /jenis pencocokan/],
  campaign_name: [/^campaign$/, /^kampanye$/],
  ad_group_name: [/^ad group$/, /^grup iklan$/],
  cost: [/^cost$/, /^biaya$/],
  impressions: [/^impr\.?$/, /^impressions$/, /^tayangan$/, /^tayang\.?$/],
  clicks: [/^clicks$/, /^klik$/, /^interactions$/],
  conversions: [/^conversions$/, /^konversi$/, /^conv\.$/],
  conversions_value: [/^conv\. value$/, /^conversion value$/, /^nilai konv/],
  all_conversions: [/^all conv\.?$/, /^all conversions$/, /^semua konv/],
};

// Manual uploads, Google's labels → ATLAS's match_type codes.
const MATCH_CODES = [
  [/exact.*close|close.*exact|mirip.*tepat|tepat.*mirip|variasi.*tepat/, 'NEAR_EXACT'],
  [/phrase.*close|close.*phrase|frasa.*mirip|mirip.*frasa|variasi.*frasa/, 'NEAR_PHRASE'],
  [/exact|tepat/, 'EXACT'],
  [/phrase|frasa/, 'PHRASE'],
  [/broad|luas/, 'BROAD'],
];
const matchCode = (text) => (MATCH_CODES.find(([re]) => re.test(norm(text)))?.[1]) ?? String(text ?? '').trim().toUpperCase();

export function parseSearchTerms(buffer) {
  const rows = readRows(buffer);
  const found = locate(rows, SEARCH_TERM_SPEC, 3);
  if (!found || found.cols.search_term == null) return [];
  const { headerIndex, cols, indonesian } = found;
  const num = (row, key) => (cols[key] == null ? 0 : parseNumber(row[cols[key]], { indonesian }) ?? 0);
  return rows.slice(headerIndex + 1)
    .map((row) => ({
      search_term: String(row[cols.search_term] ?? '').trim(),
      match_type: cols.match_type == null ? '' : matchCode(row[cols.match_type]),
      campaign_name: cols.campaign_name == null ? '' : String(row[cols.campaign_name] ?? '').trim(),
      ad_group_name: cols.ad_group_name == null ? '' : String(row[cols.ad_group_name] ?? '').trim(),
      cost: num(row, 'cost'),
      impressions: num(row, 'impressions'),
      clicks: num(row, 'clicks'),
      conversions: num(row, 'conversions'),
      conversions_value: num(row, 'conversions_value'),
      all_conversions: num(row, 'all_conversions'),
    }))
    .filter((r) => r.search_term && !/^total/i.test(r.search_term));
}

/* ── Change history ─────────────────────────────────────────────────── */

const CHANGE_SPEC = {
  changed_at: [/date.*time/, /^date$/, /tanggal/, /waktu/],
  user_email: [/^user$/, /^pengguna$/, /changed by/, /diubah oleh/],
  campaign_name: [/^campaign$/, /^kampanye$/],
  ad_group_name: [/^ad group$/, /^grup iklan$/],
  resource_type: [/item changed/, /^item$/, /item yang diubah/, /^jenis/],
  changes: [/^changes?$/, /^perubahan$/, /^detail/],
  client_type: [/^tool$/, /^alat$/, /^source$/, /^sumber$/],
};

export function parseChangeHistory(buffer) {
  const rows = readRows(buffer);
  const found = locate(rows, CHANGE_SPEC, 3);
  if (!found || found.cols.changes == null) return [];
  const { headerIndex, cols } = found;
  const text = (row, key) => (cols[key] == null ? '' : String(row[cols[key]] ?? '').replace(/\s+/g, ' ').trim());
  return rows.slice(headerIndex + 1)
    .map((row) => {
      const raw = cols.changed_at == null ? '' : row[cols.changed_at];
      return {
        changed_at: raw instanceof Date ? raw.toISOString().slice(0, 16).replace('T', ' ') : String(raw ?? '').trim(),
        user_email: text(row, 'user_email'),
        client_type: text(row, 'client_type'),
        resource_type: text(row, 'resource_type'),
        operation: '',
        campaign_name: text(row, 'campaign_name'),
        ad_group_name: text(row, 'ad_group_name'),
        changes: text(row, 'changes'),
      };
    })
    .filter((r) => r.changes);
}

/* ── writing (auto-filed months) ────────────────────────────────────── */

function workbookOf(title, month, headers, body) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  // "Report period: … to …" is what brandLibraryService's period detection
  // reads, so the library grid shows the month as fully covered.
  const sheet = XLSX.utils.aoa_to_sheet([[title], [`Report period: ${start} to ${end}`], [], headers, ...body]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Report');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

export function buildSearchTermsWorkbook(month, rows) {
  return workbookOf(
    'Search terms report (ATLAS auto-fetch)', month,
    ['Search term', 'Match type', 'Campaign', 'Ad group', 'Cost', 'Impr.', 'Clicks', 'Conversions', 'Conv. value', 'All conv.'],
    rows.map((r) => [r.search_term, r.match_type, r.campaign_name, r.ad_group_name, r.cost, r.impressions, r.clicks, r.conversions, r.conversions_value, r.all_conversions]),
  );
}

export function buildChangeHistoryWorkbook(month, rows) {
  return workbookOf(
    'Change history (ATLAS auto-fetch)', month,
    ['Date & time', 'User', 'Tool', 'Item changed', 'Campaign', 'Ad group', 'Changes'],
    rows.map((r) => [r.changed_at, r.user_email, r.client_type, [r.resource_type, r.operation].filter(Boolean).join(' · '), r.campaign_name, r.ad_group_name, r.changes]),
  );
}
