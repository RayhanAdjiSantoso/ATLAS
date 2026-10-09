import * as XLSX from 'xlsx';
import { AppError } from '../utils/errors.js';
import { isBoostByName } from '../config/metaAdsMetrics.js';

// A manual Meta Ads export uploaded to Data Collection Hub is one Ads Manager
// file holding Boost and Non-Boost campaigns together. It is filed as two
// library files — Boost Post and Non Boost Post — split per row by the
// campaign-name rule the Report Generator has always used
// (features/meta/metaReport.ts isBoostRow, mirrored in isBoostByName).
//
// The written files keep the export's own layout: whatever banner rows sat
// above the header (Meta's "Report Period" line, which the library reads the
// period from), the header row, then that half's rows. Several files picked
// at once (an export split into parts) are merged first.

const HEADER_CELL = 'campaign name';

function readSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: true });
  const name = workbook.SheetNames.find((n) => /raw data/i.test(n)) ?? workbook.SheetNames[0];
  return XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false });
}

function parseExport({ buffer, originalname }) {
  let rows;
  try {
    rows = readSheet(buffer);
  } catch {
    throw new AppError(`${originalname}: tidak dapat dibaca sebagai spreadsheet`, 400);
  }
  const headerAt = rows.findIndex((r) => Array.isArray(r) && r.some((c) => String(c).trim().toLowerCase() === HEADER_CELL));
  if (headerAt < 0) {
    throw new AppError(`${originalname}: kolom "Campaign name" tidak ditemukan, jadi Boost Post dan Non Boost Post tidak bisa dipisahkan`, 400);
  }
  const header = rows[headerAt].map((c) => String(c).trim());
  const campaignCol = header.findIndex((h) => h.toLowerCase() === HEADER_CELL);
  header[campaignCol] = 'Campaign name'; // one spelling across parts
  return {
    preamble: rows.slice(0, headerAt),
    header,
    // Rows without a campaign name are Ads Manager's total / summary lines,
    // which would be counted twice once the rows are summed.
    rows: rows.slice(headerAt + 1).filter((r) => String(r[campaignCol] ?? '').trim()).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))),
  };
}

function writeWorkbook(preamble, header, rows) {
  const sheet = XLSX.utils.aoa_to_sheet([...preamble, header, ...rows.map((r) => header.map((h) => r[h] ?? ''))]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Raw Data Report');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

// files: multer files ({ buffer, originalname }). Returns one entry per half
// that has rows: { channel, label, rowCount, file: { buffer, originalname } }.
export function splitMetaExport(files) {
  const parsed = files.map(parseExport);
  // Parts of one export share their columns; any column only some parts have
  // is kept, in first-seen order.
  const header = [...new Set(parsed.flatMap((p) => p.header).filter(Boolean))];
  const rows = parsed.flatMap((p) => p.rows);
  const base = files[0].originalname.replace(/\.(xlsx|xls|csv)$/i, '');

  return [
    { channel: 'boost', label: 'Boost Post', rows: rows.filter((r) => isBoostByName(r['Campaign name'])) },
    { channel: 'nonboost', label: 'Non Boost Post', rows: rows.filter((r) => !isBoostByName(r['Campaign name'])) },
  ].map((half) => ({
    channel: half.channel,
    label: half.label,
    rowCount: half.rows.length,
    file: half.rows.length
      ? { buffer: writeWorkbook(parsed[0].preamble, header, half.rows), originalname: `${base} - ${half.label}.xlsx` }
      : null,
  }));
}
