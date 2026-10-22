// Google Maps page text → review fields. Pure functions, no browser: the
// Playwright adapter reads raw strings off the page and everything that
// interprets them lives here, where it can be tested.

const UNITS = {
  second: 'day', minute: 'day', hour: 'day', day: 'day', week: 'week', month: 'month', year: 'year',
  detik: 'day', menit: 'day', jam: 'day', hari: 'day', minggu: 'week', bulan: 'month', tahun: 'year',
};
const EN_UNIT = { detik: 'second', menit: 'minute', jam: 'hour', hari: 'day', minggu: 'week', bulan: 'month', tahun: 'year' };

function shift(now, unit, n) {
  const d = new Date(now.getTime());
  switch (unit) {
    case 'second': d.setUTCSeconds(d.getUTCSeconds() - n); break;
    case 'minute': d.setUTCMinutes(d.getUTCMinutes() - n); break;
    case 'hour': d.setUTCHours(d.getUTCHours() - n); break;
    case 'day': d.setUTCDate(d.getUTCDate() - n); break;
    case 'week': d.setUTCDate(d.getUTCDate() - 7 * n); break;
    case 'month': d.setUTCMonth(d.getUTCMonth() - n); break;
    case 'year': d.setUTCFullYear(d.getUTCFullYear() - n); break;
    default: return null;
  }
  return d;
}

// "6 months ago", "Edited a year ago", "2 minggu lalu", "setahun yang lalu",
// "Mar 3, 2024". Returns { date, precision } — precision null for an exact
// date, otherwise the unit the source rounded to ("6 months ago" is only
// known to the month, so it never lands in one particular week). Unreadable
// text gives { date: null, precision: null }.
export function parseReviewDate(text, now = new Date()) {
  const t = String(text ?? '')
    .toLowerCase()
    .replace(/\b(edited|diedit|new|baru)\b/g, ' ')
    .replace(/\bon google\b|\bdi google\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return { date: null, precision: null };

  if (/^(just now|a moment ago|baru saja)$/.test(t) || /^(yesterday|kemarin)$/.test(t)) {
    return { date: shift(now, 'day', t.startsWith('y') || t.startsWith('k') ? 1 : 0).toISOString(), precision: 'day' };
  }

  let m = t.match(/^(a|an|one|\d+) (second|minute|hour|day|week|month|year)s? ago$/);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
    return { date: shift(now, m[2], n).toISOString(), precision: UNITS[m[2]] };
  }
  m = t.match(/^(\d+|se|satu) ?(detik|menit|jam|hari|minggu|bulan|tahun) (?:yang )?lalu$/)
    || t.match(/^se(detik|menit|jam|hari|minggu|bulan|tahun) (?:yang )?lalu$/);
  if (m) {
    const [num, unit] = m.length === 3 ? [m[1], m[2]] : ['1', m[1]];
    const n = /^\d+$/.test(num) ? Number(num) : 1;
    return { date: shift(now, EN_UNIT[unit], n).toISOString(), precision: UNITS[unit] };
  }

  // An absolute date ("Mar 3, 2024", "3 Mar 2024"): exact, read as Jakarta noon
  // so the day never slips across midnight.
  const ID_MONTHS = { januari: 'jan', februari: 'feb', maret: 'mar', mei: 'may', juni: 'jun', juli: 'jul', agustus: 'aug', agu: 'aug', agt: 'aug', oktober: 'oct', okt: 'oct', november: 'nov', desember: 'dec', des: 'dec' };
  const en = t.replace(/\b([a-z]+)\b/g, (w) => ID_MONTHS[w] ?? w);
  const abs = Date.parse(`${en} 12:00 GMT+0700`);
  if (!Number.isNaN(abs) && /\d{4}/.test(en)) return { date: new Date(abs).toISOString(), precision: null };
  return { date: null, precision: null };
}

// "5 stars", "Rated 4.0 out of 5,", "4 bintang" → 1–5, else null.
export function parseRating(label) {
  const m = String(label ?? '').match(/(\d+(?:[.,]\d)?)\s*(?:stars?|bintang|out of 5|dari 5)/i)
    || String(label ?? '').match(/rated\s+(\d+(?:[.,]\d)?)/i);
  if (!m) return null;
  const v = Math.round(Number(m[1].replace(',', '.')));
  return v >= 1 && v <= 5 ? v : null;
}

// "1,694" / "1.694" / "(239)" / "239 reviews" → integer.
export function parseCount(text) {
  const m = String(text ?? '').match(/(\d[\d.,]*)/);
  if (!m) return null;
  const n = Number(m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseRatingValue(text) {
  const m = String(text ?? '').match(/(\d[.,]\d)/);
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return v >= 1 && v <= 5 ? v : null;
}

// Google sometimes shows its own translation first. The review is the
// customer's own words, so the original is kept when it is on the page.
export function originalText(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const m = t.match(/\((?:original|asli)\)\s*([\s\S]+)$/i);
  if (m) return m[1].trim() || null;
  return t.replace(/^\((?:translated by google|diterjemahkan oleh google)\)\s*/i, '').trim() || null;
}

// "Response from the owner 2 months ago\nHi, thank you…" → { text, date }.
export function parseOwnerResponse(block, now = new Date()) {
  const t = String(block ?? '').trim();
  if (!t) return { text: null, date: null };
  const [first, ...rest] = t.split('\n');
  const head = first.replace(/^(response from the owner|tanggapan dari pemilik)\s*/i, '');
  const body = rest.join('\n').trim();
  if (head === first && !body) return { text: t, date: null };
  return { text: body || null, date: parseReviewDate(head, now).date };
}

// The feature id in a Maps URL ("!1s0x2e68e6…:0xab02…") names the place the
// same way whether it was reached by search or by link; its second half is
// the public CID. ATLAS keys a business scraped from Maps by "cid:<CID>".
export function placeKeyFromUrl(url) {
  const m = String(url ?? '').match(/!1s(0x[0-9a-f]+):(0x[0-9a-f]+)/i) || String(url ?? '').match(/[?&]cid=(\d+)/);
  if (!m) return null;
  return m.length === 3 ? `cid:${BigInt(m[2]).toString()}` : `cid:${m[1]}`;
}

export function placeUrl(key, lang = 'en') {
  const m = String(key ?? '').match(/^cid:(\d+)$/);
  return m ? `https://www.google.com/maps?cid=${m[1]}&hl=${lang}` : null;
}

// "id", "en-US", or the name Google prints on its translate switch
// ("Indonesian") → an ISO 639-1 code; unknown names stay null.
const LANGUAGE_NAMES = {
  indonesian: 'id', english: 'en', malay: 'ms', javanese: 'jv', sundanese: 'su', japanese: 'ja', korean: 'ko',
  chinese: 'zh', 'chinese (simplified)': 'zh', 'chinese (traditional)': 'zh', arabic: 'ar', dutch: 'nl', french: 'fr',
  german: 'de', spanish: 'es', thai: 'th', vietnamese: 'vi', tagalog: 'tl', filipino: 'tl', hindi: 'hi', russian: 'ru',
  italian: 'it', portuguese: 'pt', turkish: 'tr',
  'bahasa indonesia': 'id', inggris: 'en', melayu: 'ms', jawa: 'jv', sunda: 'su', jepang: 'ja', korea: 'ko', mandarin: 'zh',
};
export function languageCode(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (/^[a-z]{2}(-[a-z0-9]+)?$/.test(v)) return v.slice(0, 2);
  return LANGUAGE_NAMES[v] ?? null;
}

// One raw review from the page → the shape providers return.
export function normaliseReview(raw, now = new Date()) {
  const when = parseReviewDate(raw.dateText, now);
  const owner = parseOwnerResponse(raw.ownerBlock, now);
  return {
    externalId: raw.id || null,
    reviewerName: raw.reviewer || null,
    rating: parseRating(raw.starsLabel),
    date: when.date,
    datePrecision: when.precision,
    text: originalText(raw.text),
    language: languageCode(raw.lang),
    ownerResponse: owner.text,
    ownerResponseDate: owner.date,
  };
}
