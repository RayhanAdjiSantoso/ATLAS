import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

// Apps Script doPost() requires Content-Type: text/plain to sidestep the
// CORS preflight it can't handle for application/json -- the body is still
// a JSON string.
export async function callAppsScript(action, payload) {
  if (!config.metaAutomation.webAppUrl || !config.metaAutomation.apiKey) {
    throw new AppError('META_AUTOMATION_WEBAPP_URL / META_AUTOMATION_API_KEY belum dikonfigurasi di server', 500);
  }

  let res;
  try {
    res = await fetch(config.metaAutomation.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action, apiKey: config.metaAutomation.apiKey, payload }),
    });
  } catch {
    throw new AppError('Tidak bisa menghubungi Apps Script Web App', 502);
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // doPost() always wraps its work in try/catch and returns valid JSON, so a
    // parse failure here means Google's platform layer returned something else
    // (an HTML error page, an auth redirect, an empty body) before doPost ran.
    // Surface enough of it to actually diagnose instead of a dead-end message.
    throw new AppError(`Respons Apps Script tidak valid (HTTP ${res.status}): ${text.slice(0, 300) || '(kosong)'}`, 502);
  }
  if (!body.ok) {
    throw new AppError(body.error || 'Apps Script mengembalikan error', 502);
  }

  return body.data;
}
