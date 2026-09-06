import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One HTTP round-trip to the Apps Script web app. Throws AppError on any
// failure (network, non-JSON response, or doPost()'s own { ok: false }).
async function callOnce(action, payload) {
  let res;
  try {
    res = await fetch(config.metaAutomation.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      // doPost() requires Content-Type: text/plain to sidestep the CORS
      // preflight it can't handle for application/json -- the body is
      // still a JSON string.
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
    // This happens intermittently for a healthy, correctly-deployed web app --
    // Google's front end occasionally serves a loading/interstitial page
    // instead of proxying through, especially under concurrent script
    // executions (e.g. a time trigger firing at the same time). It's
    // transient, so the caller retries a few times before giving up.
    throw new AppError(`Respons Apps Script tidak valid (HTTP ${res.status}): ${text.slice(0, 300) || '(kosong)'}`, 502);
  }
  if (!body.ok) {
    throw new AppError(body.error || 'Apps Script mengembalikan error', 502);
  }

  return body.data;
}

export async function callAppsScript(action, payload) {
  if (!config.metaAutomation.webAppUrl || !config.metaAutomation.apiKey) {
    throw new AppError('META_AUTOMATION_WEBAPP_URL / META_AUTOMATION_API_KEY belum dikonfigurasi di server', 500);
  }

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callOnce(action, payload);
    } catch (err) {
      lastErr = err;
      // A real error from doPost() (statusCode 502 with a message from
      // body.error) is final -- retrying won't change Apps Script's own
      // application logic. Only network failures and non-JSON responses
      // (both statusCode 502, but without a doPost()-authored message) are
      // worth retrying.
      const isAppLogicError = err instanceof AppError && err.statusCode === 502 && !err.message.startsWith('Respons Apps Script tidak valid') && err.message !== 'Tidak bisa menghubungi Apps Script Web App';
      if (isAppLogicError || attempt === MAX_ATTEMPTS) throw err;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}
