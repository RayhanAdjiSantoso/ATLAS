import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

// Bumped from 3/1000 — the Meta Ads Automation tabs each fire 2-3 of these
// in parallel on load (tracking + accounts + brands), which is exactly the
// "concurrent script executions" condition the comment below warns about,
// so the old budget (~3s across 3 tries) wasn't always enough headroom.
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1200;

const TIMEOUT_MESSAGE = 'Apps Script terlalu lama merespons (Meta Ads lambat). Coba lagi beberapa saat lagi.';

// A retry is only worth starting if there's room for the sleep plus a
// realistic attempt; below this it just burns the budget on a certain timeout.
const MIN_ATTEMPT_MS = 8000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One HTTP round-trip to the Apps Script web app. Throws AppError on any
// failure (network, non-JSON response, or doPost()'s own { ok: false }).
async function callOnce(action, payload, timeoutMs) {
  let res;
  try {
    res = await fetch(config.metaAutomation.webAppUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      // doPost() requires Content-Type: text/plain to sidestep the CORS
      // preflight it can't handle for application/json -- the body is
      // still a JSON string.
      body: JSON.stringify({ action, apiKey: config.metaAutomation.apiKey, payload }),
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new AppError(TIMEOUT_MESSAGE, 504);
    throw new AppError('Tidak bisa menghubungi Apps Script Web App', 502);
  }

  let text;
  try {
    text = await res.text();
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new AppError(TIMEOUT_MESSAGE, 504);
    throw new AppError('Tidak bisa menghubungi Apps Script Web App', 502);
  }
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

// `deadline` (epoch ms) bounds the WHOLE call, retries and sleeps included.
// Vercel kills the function at maxDuration (60s, vercel.json) and the client
// then only sees an opaque HTML 504 -- callers with a hard platform limit
// pass a deadline just under it so a slow Apps Script/Meta round trip
// surfaces as a readable error instead. Omitted = unbounded (old behavior).
export async function callAppsScript(action, payload, { deadline } = {}) {
  if (!config.metaAutomation.webAppUrl || !config.metaAutomation.apiKey) {
    throw new AppError('META_AUTOMATION_WEBAPP_URL / META_AUTOMATION_API_KEY belum dikonfigurasi di server', 500);
  }

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const remaining = deadline ? deadline - Date.now() : null;
    if (remaining !== null && remaining <= 0) throw lastErr || new AppError(TIMEOUT_MESSAGE, 504);
    try {
      return await callOnce(action, payload, remaining);
    } catch (err) {
      lastErr = err;
      // A real error from doPost() (statusCode 502 with a message from
      // body.error) is final -- retrying won't change Apps Script's own
      // application logic. Only network failures and non-JSON responses
      // (both statusCode 502, but without a doPost()-authored message) are
      // worth retrying.
      const isAppLogicError = err instanceof AppError && err.statusCode === 502 && !err.message.startsWith('Respons Apps Script tidak valid') && err.message !== 'Tidak bisa menghubungi Apps Script Web App';
      const isTimeout = err instanceof AppError && err.statusCode === 504;
      if (isAppLogicError || isTimeout || attempt === MAX_ATTEMPTS) throw err;
      const delay = RETRY_DELAY_MS * attempt;
      if (deadline && deadline - Date.now() - delay < MIN_ATTEMPT_MS) throw err;
      await sleep(delay);
    }
  }
  throw lastErr;
}
