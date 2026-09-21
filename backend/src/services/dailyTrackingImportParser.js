import { AppError } from '../utils/errors.js';
import { readWorkbook, readSheetRaw } from './import/parsers.js';
import {
  FIXED_SALES_LABELS, FIXED_SPEND_LABELS, slugifyChannelLabel,
} from '../config/dailyTrackingChannels.js';

// Best-effort importer for whatever shape a client's own Daily Tracking
// Google Sheet export happens to be in — real examples seen so far disagree
// on almost everything (column order, date format, Indonesian vs English
// month names, "Non-Boost Post" vs "FB Ads", a channel triplet's column
// order, extra derived-metric columns interleaved) but share one structural
// idea: a header row with a "Tanggal"/"Date" column, revenue channels as a
// (name, qty, transaction) triplet, and standalone ad-spend columns after
// them. This never guesses at meaning it can't infer — an unrecognized
// header just becomes a new custom channel, and a genuinely unreadable file
// throws a specific AppError explaining exactly what's missing, rather than
// silently importing nothing or guessing wrong.

const DATE_HEADER = /^(tanggal|date)$/i;
const QTY_HEADER = /qty|kuantitas|pcs/i;
const TX_HEADER = /transaksi|transaction/i;
const NOTES_HEADER = /^(notes?|catatan)$/i;

// Aggregate/derived columns that ride along in these sheets but are never
// themselves a channel to import — everything here gets recomputed by ATLAS
// from the raw per-channel cells instead of trusted from the sheet (the
// sheets we've seen in practice have stale SUM ranges on exactly these
// columns, e.g. a grand-total row not extended to cover a month's last day).
// Exact-match only: several sheets use "Total Revenue <Channel>" as a
// per-channel column header (cleanChannelLabel strips that prefix), so
// "total revenue" can only be a skip when it's the WHOLE label (the actual
// grand-total column) — matching it as a substring would wrongly skip every
// per-channel revenue column too.
const SKIP_EXACT = new Set([
  'no', 'no.', 'day', 'hari', 'notes', 'catatan',
  'total revenue', 'total kuantitas', 'total qty', 'total transaksi', 'total transaction', 'total ads',
]);
const SKIP_SUBSTRINGS = [
  'message inquiry', 'rate message', 'cost per message',
  'cost/revenue', 'cost per revenue', 'roas', 'aov', 'aur',
  'revenue ga', 'success rate', 'ctr', 'cpc', 'cpm', 'impressions', 'reach', 'frequency', 'clicks',
];

function isSkipHeader(label) {
  const l = label.toLowerCase().trim();
  if (!l) return true;
  if (SKIP_EXACT.has(l)) return true;
  return SKIP_SUBSTRINGS.some((w) => l.includes(w));
}

function cleanChannelLabel(label) {
  return String(label)
    .replace(/\n/g, ' ')
    .replace(/^total revenue\s*/i, '')
    .replace(/\(rp\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Order matters: non-boost/FB Ads must be checked before the plainer "boost
// post" pattern, and CPAS before the looser Shopee-ads pattern.
const REVENUE_SYNONYMS = [
  [/website/i, 'website'],
  [/^chat$/i, 'chat'],
  [/tiktok/i, 'tiktok'],
  [/tokopedia/i, 'tokopedia'],
  [/offline/i, 'offline_store'],
  [/shopee/i, 'shopee'],
];
const SPEND_SYNONYMS = [
  [/non-?\s*boost|fb\s*ads/i, 'meta_nonboost_post'],
  [/boost\s*post/i, 'meta_boost_post'],
  [/cpas.*shopee/i, 'cpas_shopee'],
  [/shopee.*(ads|iklanku)|iklan\s*shopee/i, 'shopee_iklanku'],
  [/gmv\s*max/i, 'gmv_max'],
  [/ttam/i, 'ttam'],
];

function mapChannel(label, synonyms) {
  const cleaned = cleanChannelLabel(label);
  for (const [re, key] of synonyms) {
    if (re.test(cleaned)) return { key, label: cleaned, isCustom: false };
  }
  const key = slugifyChannelLabel(cleaned);
  return { key: key || `channel_${Math.random().toString(36).slice(2, 8)}`, label: cleaned, isCustom: true };
}

// One header row establishes the column layout for every data row that
// follows it, until the next header row (a sheet with several month blocks
// commonly repeats the header once per block, unchanged) or EOF.
function classifyHeaderRow(headerRow) {
  const norm = headerRow.map((c) => String(c ?? '').trim());
  const dateCol = norm.findIndex((c) => DATE_HEADER.test(c));
  if (dateCol === -1) return null;

  const consumed = new Set([dateCol]);
  const revenueChannels = [];
  for (let i = 0; i < norm.length; i += 1) {
    if (consumed.has(i) || !norm[i] || isSkipHeader(norm[i])) continue;
    const next1 = norm[i + 1] || '';
    const next2 = norm[i + 2] || '';
    if (QTY_HEADER.test(next1) && TX_HEADER.test(next2)) {
      // A Notes column sitting right after the triplet belongs to this channel
      // (e.g. Drc's "RETUR"). A Notes column anywhere else (commonly right
      // after Tanggal) is not tied to a channel and stays ignored.
      const notesCol = NOTES_HEADER.test(norm[i + 3] || '') ? i + 3 : null;
      revenueChannels.push({ revCol: i, qtyCol: i + 1, txCol: i + 2, notesCol, rawLabel: norm[i] });
      consumed.add(i); consumed.add(i + 1); consumed.add(i + 2);
      if (notesCol !== null) consumed.add(notesCol);
      i += notesCol !== null ? 3 : 2;
    }
  }

  const lastRevenueCol = revenueChannels.length
    ? Math.max(...revenueChannels.flatMap((c) => [c.revCol, c.qtyCol, c.txCol]))
    : dateCol;

  const spendChannels = [];
  for (let i = lastRevenueCol + 1; i < norm.length; i += 1) {
    if (consumed.has(i) || !norm[i] || isSkipHeader(norm[i])) continue;
    spendChannels.push({ col: i, rawLabel: norm[i] });
    consumed.add(i);
  }

  return { dateCol, revenueChannels, spendChannels };
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  januari: 1, februari: 2, maret: 3, mei: 5, juni: 6, juli: 7, agustus: 8, oktober: 10, desember: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, agu: 8, sep: 9, sept: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

function pad2(n) { return String(n).padStart(2, '0'); }

// Handles every format seen in practice: ISO, "01 January 2026"/"1 Sep 26"
// (full or 2-digit year, full or abbreviated month name, Indonesian or
// English), "DD/MM/YYYY", "DD-MM-YYYY", and a raw Excel date serial number
// (falls back to that when cellDates parsing hands us a plain number instead
// of a formatted string).
function parseFlexibleDate(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const ms = Date.UTC(1899, 11, 30) + raw * 86400000;
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const s = String(raw).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;

  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;

  m = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(\d{4})$/);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase().replace(/\.$/, '')];
    if (mm) return `${m[3]}-${pad2(mm)}-${pad2(+m[1])}`;
  }

  m = s.match(/^(\d{1,2})\s+([A-Za-zÀ-ÿ.]+)\s+(\d{2})$/);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase().replace(/\.$/, '')];
    if (mm) return `20${m[3]}-${pad2(mm)}-${pad2(+m[1])}`;
  }

  return null;
}

function parseAmount(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (s === '' || /^#/.test(s)) return null; // '', '#REF!', '#DIV/0!'
  const digits = s.replace(/[^\d.-]/g, '');
  if (digits === '' || digits === '-') return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses a Daily Tracking spreadsheet (CSV/XLS/XLSX) into rows ready for
 * dailyTrackingService.importFromFile. Never touches the database. Throws
 * AppError(..., 422) with a specific, human-readable reason for anything
 * that makes the whole file unusable; per-row oddities (a date that doesn't
 * parse, a totally blank row) are silently skipped, not fatal, since sheets
 * routinely have separator rows, month-marker rows, and stale grand-total
 * rows mixed in with real data.
 */
export function parseDailyTrackingFile(buffer, originalFilename = 'file') {
  let workbook;
  try {
    workbook = readWorkbook(buffer);
  } catch (err) {
    throw new AppError(`"${originalFilename}" tidak bisa dibaca sebagai file Excel/CSV: ${err.message}`, 422);
  }

  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) throw new AppError(`"${originalFilename}" tidak punya sheet/tab sama sekali.`, 422);

  let raw;
  try {
    raw = readSheetRaw(workbook, sheetName);
  } catch (err) {
    throw new AppError(`Gagal membaca isi sheet "${sheetName}": ${err.message}`, 422);
  }
  if (!raw.length) throw new AppError(`Sheet "${sheetName}" kosong.`, 422);

  let currentMap = null;
  let headerSeen = false;
  const salesRows = [];
  const spendRows = [];
  const recognized = { sales: new Map(), spend: new Map() };
  let dataRowsParsed = 0;

  for (const row of raw) {
    const map = classifyHeaderRow(row);
    if (map) { currentMap = map; headerSeen = true; continue; }
    if (!currentMap) continue;

    const entryDate = parseFlexibleDate(row[currentMap.dateCol]);
    if (!entryDate) continue; // separator / month-marker / grand-total row — not an error

    let anyValue = false;
    for (const ch of currentMap.revenueChannels) {
      const revenue = parseAmount(row[ch.revCol]);
      const qtySold = parseAmount(row[ch.qtyCol]);
      const transaksi = parseAmount(row[ch.txCol]);
      // undefined = this channel has no Notes column in the file (leave stored
      // notes alone); null = column exists but the cell is blank.
      const notes = ch.notesCol == null ? undefined : (String(row[ch.notesCol] ?? '').trim() || null);
      if (revenue == null && qtySold == null && transaksi == null && !notes) continue;
      anyValue = true;
      const mapped = mapChannel(ch.rawLabel, REVENUE_SYNONYMS);
      recognized.sales.set(mapped.key, { label: mapped.isCustom ? mapped.label : FIXED_SALES_LABELS[mapped.key], isCustom: mapped.isCustom });
      salesRows.push({ entryDate, channelKey: mapped.key, revenue, qtySold, transaksi, notes });
    }
    for (const ch of currentMap.spendChannels) {
      const amount = parseAmount(row[ch.col]);
      if (amount == null) continue;
      anyValue = true;
      const mapped = mapChannel(ch.rawLabel, SPEND_SYNONYMS);
      recognized.spend.set(mapped.key, { label: mapped.isCustom ? mapped.label : FIXED_SPEND_LABELS[mapped.key], isCustom: mapped.isCustom });
      spendRows.push({ entryDate, channelKey: mapped.key, amount });
    }
    if (anyValue) dataRowsParsed += 1;
  }

  if (!headerSeen) {
    throw new AppError(
      `Tidak menemukan kolom "Tanggal" atau "Date" di "${originalFilename}" — pastikan ada satu baris header yang jelas dengan salah satu nama kolom itu.`,
      422,
    );
  }
  if (dataRowsParsed === 0) {
    throw new AppError(
      `Kolom Tanggal ketemu di "${originalFilename}", tapi tidak ada satu pun baris dengan tanggal valid DAN nilai terisi di channel manapun — tidak ada yang bisa diimpor.`,
      422,
    );
  }

  return {
    salesRows,
    spendRows,
    recognizedSales: [...recognized.sales.entries()].map(([key, v]) => ({ key, ...v })),
    recognizedSpend: [...recognized.spend.entries()].map(([key, v]) => ({ key, ...v })),
    dataRowsParsed,
  };
}
