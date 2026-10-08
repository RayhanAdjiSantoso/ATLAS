import * as XLSX from 'xlsx';
import { exportColumns, storedValue } from '../config/metaAdsMetrics.js';

// Writes stored insight rows (one month for the library, or any range the
// Report Generator asks for) out as an Ads Manager-style workbook, so it
// parses with the same code as a manual export: the library file sits in
// Data Collection Hub like an upload, and the custom range is read the same
// way.
//
// Layout mirrors Meta's "Formatted data table (.xlsx)" raw sheet, which that
// parser already handles: a banner row (carrying the report period), a blank
// row, then the header row, on a sheet named "Raw Data Report".
//
// `sections` picks the metric columns (metaAdsMetrics SECTIONS). `campaignType`
// — a function row -> 'Boost Post' | 'Non Boost Post' — adds a Campaign type
// column, which the Report Generator's Boost/Non-Boost split reads before
// falling back to campaign names (features/meta/metaReport.ts isBoostRow).

const num = (v) => (v == null ? '' : Number(v));

export function buildInsightsWorkbook({ start, end, rows, sections, campaignType = null }) {
  const columns = exportColumns(sections);
  const headers = [
    'Campaign name', 'Ad set name', 'Ad name', 'Age', 'Gender', 'Objective', 'Day',
    ...(campaignType ? ['Campaign type'] : []),
    'Currency', ...columns.map((c) => c.header), 'Reporting starts', 'Reporting ends',
  ];

  const body = rows.map((r) => [
    r.campaign_name, r.adset_name ?? '', r.ad_name ?? '', r.age, r.gender, r.objective ?? '', r.entry_date,
    ...(campaignType ? [campaignType(r)] : []),
    'IDR', ...columns.map(({ key }) => num(storedValue(r, key))),
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
