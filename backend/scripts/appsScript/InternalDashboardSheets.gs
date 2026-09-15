// InternalDashboardSheets.gs — Apps Script Web App backing ATLAS's Internal
// Dashboard live Google Sheets integration.
//
// STANDALONE script (not bound to any spreadsheet), and deliberately uses
// ONLY SpreadsheetApp — NEVER DriveApp or any Drive-search service. See
// "Why no DriveApp" below; this is load-bearing, not a style choice.
//
// Deploy: script.new -> paste this whole file (replace the default Code.gs
// content) -> set API_KEY below to a random string -> Deploy -> New
// deployment -> type "Web app" -> Execute as "Me" -> Who has access
// "Anyone" (needs to be callable from Vercel with no Google login) ->
// Deploy -> copy the /exec URL.
//
// Put that URL + the same API_KEY into the backend env as
// INTERNAL_DASHBOARD_SHEETS_WEBAPP_URL / INTERNAL_DASHBOARD_SHEETS_API_KEY.
//
// Runs as whoever deploys it ("Execute as: Me") — that account's Sheets
// access becomes what this script can read, so deploy it as an account that
// already has every client's Brand Tracking spreadsheet in "Shared with me"
// (this is why the Node side needs no per-file sharing / no service account).
//
// Same request/response contract as the existing Meta Automation Apps
// Script (backend/src/services/metaAutomationService.js): POST JSON
// { action, apiKey, payload } -> { ok: true, data } | { ok: false, error }.
//
// --- Why no DriveApp (debugged 2026-09-15) ---------------------------
// An earlier version also had a `resolveBrandSheets` action that used
// DriveApp.searchFiles to find each client's spreadsheet by name. The
// moment that code's DriveApp/Sheets scope got authorized (via the
// one-time consent flow), this deployment's "Anyone" access broke
// completely: doPost() kept completing successfully server-side (visible
// in Executions, every single time) but the HTTP response was never
// deliverable to any caller — curl, Node fetch, and even a logged-in
// browser console all got a generic Google Drive "cannot open file" page
// instead. A brand-new standalone project with the exact same doPost
// logic but NO DriveApp reference at all worked immediately and has
// stayed reliable. Conclusion: Google restricts anonymous ("Anyone")
// serving for unverified Apps Script projects once they hold a Drive
// scope grant, even for requests that don't touch Drive. The one-time
// brand-sheet mapping bootstrap (which does need DriveApp) is a SEPARATE
// script, BootstrapBrandSheetMapping.gs, run manually from the editor —
// never deployed as a public web app — precisely to keep that scope out
// of this file.

const API_KEY = 'REPLACE_WITH_A_RANDOM_SECRET';
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEFAULT_PERFORMANCE_TAB = '[NEW] Monthly Performance Analysis';

function doPost(e) {
  let action = null;
  try {
    const body = JSON.parse(e.postData.contents);
    action = body.action;
    if (body.apiKey !== API_KEY) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }
    const data = routeAction(action, body.payload || {});
    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, error: (action ? action + ': ' : '') + String((err && err.message) || err) });
  }
}

function routeAction(action, payload) {
  switch (action) {
    case 'ping':
      return { pong: true, time: new Date().toISOString() };
    case 'getMonthlyPerformance':
      return getMonthlyPerformance(payload.spreadsheetId, payload.tabName || DEFAULT_PERFORMANCE_TAB);
    case 'getSheetValues':
      // Generic raw-grid read, e.g. for reading the brand_sheet_sources
      // mapping tab that BootstrapBrandSheetMapping.gs writes to — keeps
      // that lookup on the SpreadsheetApp-only (safe) side too.
      return getSheetValues(payload.spreadsheetId, payload.tabName);
    case 'listTabs':
      // Client spreadsheets don't all name their tab the same way — this
      // is for onboarding a new one (find the real tab name before calling
      // getMonthlyPerformance with it).
      return listTabs(payload.spreadsheetId);
    default:
      throw new Error('Unknown action: ' + action);
  }
}

function listTabs(spreadsheetId) {
  if (!spreadsheetId) throw new Error('spreadsheetId wajib diisi');
  const ss = SpreadsheetApp.openById(spreadsheetId);
  return { title: ss.getName(), tabs: ss.getSheets().map((s) => s.getName()) };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheetValues(spreadsheetId, tabName) {
  if (!spreadsheetId) throw new Error('spreadsheetId wajib diisi');
  if (!tabName) throw new Error('tabName wajib diisi');
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab "' + tabName + '" tidak ditemukan di spreadsheet ' + spreadsheetId);
  return { values: sheet.getDataRange().getValues() };
}

// ---------------------------------------------------------------------
// getMonthlyPerformance — the live data feed for one client.
//
// Opens spreadsheetId and reads its "[NEW] Monthly Performance Analysis"
// tab, returning every metric row as { section, label, values: {Jan:n,...} }.
// Values are the sheet's underlying numbers (not display strings) —
// currency/percent formatting is cosmetic, this returns the real number.
//
// Row shape (verified against the live grid, Petite Fleur, 2026-09-15):
//   col A: always blank (spacer)
//   col B: the label — "- Metric Name" (top-level), "  -> Nested Metric"
//          (indented, e.g. under "Ads Spent"), or a bare section header
//          with no leading "-"/"->" (e.g. "Main account", "CPAS Shopee")
//   from col C on: repeating month blocks. Jan is 2 cols (value, blank
//   spacer before Feb) since it has no "Changes" (%) column; Feb onward
//   are (value, Changes%, blank spacer) — but this code locates each
//   month's VALUE column purely by matching the header row's text ("Jan",
//   "Feb", …), so the exact spacing/Changes-column layout doesn't matter.
// ---------------------------------------------------------------------
function getMonthlyPerformance(spreadsheetId, tabName) {
  if (!spreadsheetId) throw new Error('spreadsheetId wajib diisi');
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab "' + tabName + '" tidak ditemukan di spreadsheet ' + spreadsheetId);

  const values = sheet.getDataRange().getValues();

  const monthRowIdx = values.findIndex((row) => row.some((c) => String(c).trim() === 'Jan'));
  if (monthRowIdx === -1) throw new Error('Baris header bulan ("Jan") tidak ditemukan di tab ini');

  // The year lives a couple of rows above the month header as a bare
  // number (e.g. "2026", next to ": Fill in this blank") — found by
  // scanning upward from the month row for the first plain 4-digit
  // number, rather than a fixed row offset, since blank spacer rows
  // aren't perfectly consistent across every client's copy of this
  // template.
  let year = null;
  for (let r = monthRowIdx - 1; r >= 0 && year === null; r -= 1) {
    for (const cell of values[r]) {
      if (typeof cell === 'number' && cell >= 2000 && cell <= 2100) {
        year = cell;
        break;
      }
    }
  }
  if (year === null) throw new Error('Tahun (angka 4 digit di atas baris bulan) tidak ditemukan di tab ini');

  const monthHeader = values[monthRowIdx];
  const monthCols = [];
  monthHeader.forEach((cell, colIdx) => {
    const label = String(cell).trim();
    if (MONTH_LABELS.indexOf(label) !== -1) monthCols.push({ colIdx: colIdx, label: label });
  });
  if (!monthCols.length) throw new Error('Tidak ada kolom bulan yang terbaca di baris header');

  const rows = [];
  let currentSection = null;
  for (let r = monthRowIdx + 1; r < values.length; r += 1) {
    const row = values[r];
    // Label lives in column B (index 1) — column A is a blank spacer
    // throughout this template.
    const firstCell = String(row[1] || '').trim();
    if (!firstCell) continue;

    const isMetricRow = firstCell.charAt(0) === '-' || firstCell.indexOf('->') === 0;
    if (!isMetricRow) {
      currentSection = firstCell;
      continue;
    }

    const label = firstCell.replace(/^->\s*/, '').replace(/^-\s*/, '').trim();
    const valuesByMonth = {};
    monthCols.forEach((mc) => {
      const v = row[mc.colIdx];
      valuesByMonth[mc.label] = v === '' || v === null || typeof v === 'undefined' ? null : Number(v);
    });
    rows.push({ section: currentSection, label: label, values: valuesByMonth });
  }

  return { spreadsheetId: spreadsheetId, tabName: tabName, year: year, rows: rows };
}
