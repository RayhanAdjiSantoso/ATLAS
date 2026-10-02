import * as XLSX from 'xlsx';
import { exportColumns, TYPED_KEYS } from '../config/metaAdsMetrics.js';

// Writes stored insight rows (one month for the library, or any range the
// Report Generator asks for) out as an Ads Manager-style workbook, so it
// parses with the same code as a manual export: the library file sits in
// Pengaturan Brand like an upload, and the custom range is read the same way.
//
// Layout mirrors Meta's "Formatted data table (.xlsx)" raw sheet, which that
// parser already handles: a banner row (carrying the report period), a blank
// row, then the header row, on a sheet named "Raw Data Report".

const num = (v) => (v == null ? '' : Number(v));

export function buildInsightsWorkbook({ start, end, rows, extraMetrics }) {
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
