import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { analyseFile } from '../src/services/brandLibraryService.js';

// Regression: `XLSX.SSF` is undefined on the namespace import under Node ESM
// (the package is CommonJS; only its default export carries SSF), so any
// numeric cell in the Excel-date window (40000–60000) made period detection
// throw "Cannot read properties of undefined (reading 'parse_date_code')".
// A plain amount like 50000 — a purchase value, a price — is enough.
const sheet = XLSX.utils.aoa_to_sheet([
  ['Campaign', 'Purchase value', 'Tanggal'],
  ['A', 50000, '2026-08-05'],
  ['B', 45000, '2026-08-06'],
]);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

const result = analyseFile({ buffer, filename: 'report.xlsx', month: '2026-08' });
assert.equal(result.periodMonth, '2026-08-01');
assert.ok(result.coveredDays >= 2, 'the two real dates are still detected');

// A genuine Excel serial for a date in the window is read as that date:
// 46000 = 2025-12-09 (Excel epoch), inside the accepted 40000–60000 range.
const dated = XLSX.utils.aoa_to_sheet([['Tanggal'], [{ t: 'n', v: 46000, z: 'yyyy-mm-dd' }]]);
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, dated, 'Sheet1');
const r2 = analyseFile({ buffer: XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' }), filename: 'x.xlsx', month: null });
assert.equal(r2.periodMonth, '2025-12-01');

console.log('brand-library-serial-dates: ok');
