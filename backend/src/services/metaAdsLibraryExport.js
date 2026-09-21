import * as XLSX from 'xlsx';
import { exportColumns, TYPED_KEYS } from '../config/metaAdsMetrics.js';

// Writes one month of stored insight rows out as an Ads Manager-style
// workbook, so it can sit in Pengaturan Brand's file library exactly like a
// manual export: the Report Generator's "Pilih dari perpustakaan" downloads
// the bytes and parses them with the same code as an uploaded file.
//
// Layout mirrors Meta's "Formatted data table (.xlsx)" raw sheet, which that
// parser already handles: a banner row (carrying the report period), a blank
// row, then the header row, on a sheet named "Raw Data Report".

const num = (v) => (v == null ? '' : Number(v));

export function buildInsightsWorkbook({ month, rows, extraMetrics }) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const end = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;

  const columns = exportColumns(extraMetrics);
  const headers = ['Campaign name', 'Age', 'Gender', 'Day', 'Currency', ...columns.map((c) => c.header), 'Reporting starts', 'Reporting ends'];

  const body = rows.map((r) => [
    r.campaign_name, r.age, r.gender, r.entry_date, 'IDR',
    ...columns.map(({ key }) => {
      if (key === 'objective') return r.objective ?? '';
      return num(TYPED_KEYS.has(key) ? r[key] : r.metrics?.[key]);
    }),
    start, end,
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([
    ['Meta Ads (ATLAS auto-fetch)', `Report Period: ${start} to ${end}`],
    [],
    headers,
    ...body,
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Raw Data Report');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
