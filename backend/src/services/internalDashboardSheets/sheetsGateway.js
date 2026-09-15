import { config } from '../../config/index.js';
import { AppError } from '../../utils/errors.js';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One HTTP round-trip to the Internal Dashboard's Apps Script web app —
// same shape as metaAutomationService.callAppsScript (see that file for why
// Content-Type: text/plain and the retry rule), deployed separately with its
// own URL/key: a standalone project (not bound to any spreadsheet) that
// deliberately never uses DriveApp — see the long comment at the top of
// scripts/appsScript/InternalDashboardSheets.gs for why that distinction
// matters (an earlier version that did use DriveApp broke "Anyone" access
// entirely, for every action, the moment that scope got authorized).
async function callOnce(action, payload) {
  let res;
  try {
    res = await fetch(config.internalDashboardSheets.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, apiKey: config.internalDashboardSheets.apiKey, payload }),
    });
  } catch {
    throw new AppError('Tidak bisa menghubungi Apps Script Web App (Internal Dashboard Sheets)', 502);
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError(`Respons Apps Script tidak valid (HTTP ${res.status}): ${text.slice(0, 300) || '(kosong)'}`, 502);
  }
  if (!body.ok) {
    throw new AppError(body.error || 'Apps Script mengembalikan error', 502);
  }

  return body.data;
}

export async function callSheetsAppsScript(action, payload) {
  if (!config.internalDashboardSheets.webAppUrl || !config.internalDashboardSheets.apiKey) {
    throw new AppError('INTERNAL_DASHBOARD_SHEETS_WEBAPP_URL / INTERNAL_DASHBOARD_SHEETS_API_KEY belum dikonfigurasi di server', 500);
  }

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callOnce(action, payload);
    } catch (err) {
      lastErr = err;
      const isAppLogicError = err instanceof AppError && err.statusCode === 502 && !err.message.startsWith('Respons Apps Script tidak valid') && !err.message.startsWith('Tidak bisa menghubungi');
      if (isAppLogicError || attempt === MAX_ATTEMPTS) throw err;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}
