// BootstrapBrandSheetMapping.gs — MANUAL-RUN ONLY. Never deploy this as a
// web app, and never paste it into InternalDashboardSheets.gs's project —
// it uses DriveApp, which breaks that project's public "Anyone" serving
// once authorized (see the long comment at the top of
// InternalDashboardSheets.gs for what that looked like).
//
// Paste into its OWN standalone project (script.new). Run `resolveBrandSheets`
// directly from the editor (dropdown next to Run) whenever the brand roster
// changes — approve the one-time Drive authorization prompt when it appears.
//
// Reads the roster's "Client info" tab; for every row with a non-empty
// "Link Daily Tracking" value, searches Drive for spreadsheets whose title
// contains that text, and writes one row per brand into a
// "ATLAS Brand Sheet Mapping" tab (created if missing) in the SAME roster
// spreadsheet: brandName | trackingName | spreadsheetId | spreadsheetTitle |
// candidateCount | lastUpdated. A candidateCount > 1 means Drive found
// several matches — the row picks the most recently modified one, but flag
// those for a human to double-check before trusting them.
//
// backend/scripts/mapBrandSheets.js reads that tab (via
// InternalDashboardSheets.gs's safe `getSheetValues` action — no DriveApp
// needed on that side) to populate public.brand_sheet_sources.

const ROSTER_SPREADSHEET_ID = 'REPLACE_WITH_ROSTER_SPREADSHEET_ID';
const ROSTER_SHEET_NAME = 'Client info';
const OUTPUT_SHEET_NAME = 'ATLAS Brand Sheet Mapping';

function resolveBrandSheets() {
  const ss = SpreadsheetApp.openById(ROSTER_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(ROSTER_SHEET_NAME);
  if (!sheet) throw new Error('Tab "' + ROSTER_SHEET_NAME + '" tidak ditemukan');

  const values = sheet.getDataRange().getValues();
  const headerRowIdx = values.findIndex((row) => row.some((c) => String(c).trim().toLowerCase() === 'brand name'));
  if (headerRowIdx === -1) throw new Error('Header "Brand Name" tidak ditemukan');

  const header = values[headerRowIdx].map((c) => String(c).trim().toLowerCase());
  const brandCol = header.indexOf('brand name');
  const trackingCol = header.indexOf('link daily tracking');
  if (trackingCol === -1) throw new Error('Kolom "Link Daily Tracking" tidak ditemukan di header');

  const output = [['brandName', 'trackingName', 'spreadsheetId', 'spreadsheetTitle', 'candidateCount', 'lastUpdated']];

  for (let i = headerRowIdx + 1; i < values.length; i += 1) {
    const brandName = String(values[i][brandCol] || '').trim();
    const trackingName = String(values[i][trackingCol] || '').trim();
    if (!brandName || !trackingName) continue;

    const escaped = trackingName.replace(/'/g, "\\'");
    const it = DriveApp.searchFiles(
      "title contains '" + escaped + "' and mimeType = '" + MimeType.GOOGLE_SHEETS + "' and trashed = false"
    );
    const candidates = [];
    while (it.hasNext()) {
      const f = it.next();
      candidates.push({ id: f.getId(), title: f.getName(), lastUpdated: f.getLastUpdated() });
    }
    if (!candidates.length) {
      output.push([brandName, trackingName, '', '(tidak ditemukan)', 0, '']);
      continue;
    }
    const best = candidates.sort((a, b) => (a.lastUpdated < b.lastUpdated ? 1 : -1))[0];
    output.push([brandName, trackingName, best.id, best.title, candidates.length, best.lastUpdated.toISOString()]);
  }

  let outSheet = ss.getSheetByName(OUTPUT_SHEET_NAME);
  if (!outSheet) outSheet = ss.insertSheet(OUTPUT_SHEET_NAME);
  outSheet.clearContents();
  outSheet.getRange(1, 1, output.length, output[0].length).setValues(output);

  Logger.log('Selesai: %s brand ditulis ke tab "%s"', output.length - 1, OUTPUT_SHEET_NAME);
}
