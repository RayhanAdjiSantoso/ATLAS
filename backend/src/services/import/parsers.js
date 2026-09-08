/**
 * Indonesian-format parsing helpers.
 * Ported from import_shopee_data.py
 */
import XLSX from 'xlsx';

export function parseIdr(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    return Number.isNaN(raw) ? null : raw;
  }
  let s = String(raw).trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'nan') return null;
  s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

export function parsePct(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim().replace(/%$/, '').trim();
  if (s === '' || s === '-' || s.toLowerCase() === 'nan') return null;
  s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isNaN(n) ? null : n / 100;
}

export function parseIntValue(raw) {
  const d = parseIdr(raw);
  return d == null ? null : Math.trunc(d);
}

export function blankToNone(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === '' || s === '-' || s.toLowerCase() === 'nan' ? null : s;
}

export function parseTs(raw, fmt = null) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (s === '' || s === '-') return null;

  if (fmt === '%Y-%m-%d %H:%M') {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }

  if (fmt === '%d-%m-%Y') {
    const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1]);
  }

  // Excel serial date
  if (typeof raw === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + raw * 86400000);
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Shopee/TikTok stamp the reporting range into the download name:
// "parentskudetail.20260701_20260731.xlsx",
// "...-01_07_2026-31_07_2026.csv". Pulled out here because some exports
// (the "parentskudetail" Product Performance variant) carry no parseable
// date anywhere in their contents -- the filename is the only period signal.
export function parseFilenamePeriod(filename = '') {
  const name = String(filename);
  let m = name.match(/(\d{4})(\d{2})(\d{2})\D{1,3}(\d{4})(\d{2})(\d{2})/);
  if (m) {
    const [y1, mo1, d1, y2, mo2, d2] = m.slice(1).map(Number);
    return { start: `${y1}-${pad2(mo1)}-${pad2(d1)}`, end: `${y2}-${pad2(mo2)}-${pad2(d2)}` };
  }
  m = name.match(/(\d{2})[_-](\d{2})[_-](\d{4})\D{1,3}(\d{2})[_-](\d{2})[_-](\d{4})/);
  if (m) {
    const [d1, mo1, y1, d2, mo2, y2] = m.slice(1).map(Number);
    return { start: `${y1}-${pad2(mo1)}-${pad2(d1)}`, end: `${y2}-${pad2(mo2)}-${pad2(d2)}` };
  }
  return null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function toDateString(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parsePeriodSummary(raw) {
  // "01-06-2026-30-06-2026" -> { start, end }
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})-(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return {
    start: `${m[3]}-${m[2]}-${m[1]}`,
    end: `${m[6]}-${m[5]}-${m[4]}`,
  };
}

export function readSheetAsStrings(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" tidak ditemukan`);
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = v == null ? '' : String(v);
    }
    return out;
  });
}

// Accepts either a filesystem path (dev / scripts) or a Buffer of the raw
// file bytes (dashboard uploads, which are held in memory — see
// middlewares/upload.js — and never touch disk on serverless).
export function readWorkbook(src) {
  if (Buffer.isBuffer(src)) {
    return XLSX.read(src, { type: 'buffer', cellDates: false, raw: false });
  }
  return XLSX.readFile(src, { cellDates: false, raw: false });
}

export function readSheetRaw(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet "${sheetName}" tidak ditemukan`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}
