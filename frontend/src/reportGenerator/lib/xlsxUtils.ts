import * as XLSX from 'xlsx';
import type { SheetRow } from './types';

export function requireSheet(wb: XLSX.WorkBook): void {
  if (!wb || !wb.SheetNames || !wb.SheetNames.length) {
    throw new Error(
      'File tidak memiliki sheet yang bisa dibaca. Pastikan file adalah workbook Excel/CSV yang valid.',
    );
  }
}

export function readWorkbookFromText(text: string): XLSX.WorkBook {
  const wb = XLSX.read(text, { type: 'string' });
  requireSheet(wb);
  return wb;
}

export function readWorkbookFromArrayBuffer(buffer: ArrayBuffer): XLSX.WorkBook {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  requireSheet(wb);
  return wb;
}

// A cell exactly matching one of these (case-insensitive) is a strong
// signal that its row is the real header row, not data or a title banner —
// spans every column-header this app looks for across Meta and Shopee
// exports (see findHeaderRowIndex).
const HEADER_HINT_KEYWORDS = ['campaign name', 'amount spent', 'reach', 'impressions', 'month', 'kunjungan', 'produk terjual'];

// Meta's "Formatted data table (.xlsx)" export puts a title banner ("Report
// Period: …") in row 1 and leaves row 2 blank before the real header on row
// 3 — SheetJS's default sheet_to_json always treats row 1 as the header, so
// without this every column would come out as garbage keys like
// "Formatted report Jul-1-2026 to Aug-15-2026" or "__EMPTY_7". Scans for the
// header by content instead of assuming it's row 1; every previously
// supported export already has its header on row 1, so this returns 0 for
// those (a no-op) and only matters for a file with a banner above the
// header. `header: 1` mode reads the sheet as a raw grid of arrays without
// assuming any row is special, keeping row indices aligned with the actual
// sheet so the index found here can be reused as sheet_to_json's `range`.
function findHeaderRowIndex(ws: XLSX.WorkSheet): number {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  const scanLimit = Math.min(grid.length, 15);
  for (let i = 0; i < scanLimit; i++) {
    const cells = (grid[i] || []).map((c) => String(c ?? '').trim().toLowerCase());
    const hits = HEADER_HINT_KEYWORDS.filter((kw) => cells.includes(kw)).length;
    if (hits >= 2) return i;
  }
  return 0;
}

export function firstSheetRows(
  wb: XLSX.WorkBook,
  defval: string | number = '',
): SheetRow[] {
  // Meta's "Formatted data table (.xlsx)" export bundles two sheets: a
  // "Formatted Report" (Excel-style, blank cells mean "same as the row
  // above" — a merged-cell display convention this app has no way to
  // interpret as a flat table) and a "Raw Data Report" (the same data,
  // self-contained per row — Campaign/Month/Age/Gender repeated on every
  // row instead of inherited). Prefer the raw sheet by name so a report
  // that has both isn't accidentally parsed from the formatted one. Every
  // other supported export has just one sheet, where this is a no-op.
  const rawSheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'raw data report');
  const ws = wb.Sheets[rawSheetName ?? wb.SheetNames[0]];
  const headerRow = findHeaderRowIndex(ws);
  return XLSX.utils.sheet_to_json(ws, headerRow > 0 ? { defval, range: headerRow } : { defval }) as SheetRow[];
}

// Ported from the original readFile(): reads a .csv as text, anything else
// (.xlsx/.xls) as an array buffer.
export async function readSpreadsheetFile(file: File): Promise<SheetRow[]> {
  const wb = file.name.endsWith('.csv') ? readWorkbookFromText(await file.text()) : readWorkbookFromArrayBuffer(await file.arrayBuffer());
  return firstSheetRows(wb);
}
