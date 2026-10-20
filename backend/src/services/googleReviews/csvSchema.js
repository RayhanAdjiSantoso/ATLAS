import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import { AppError } from '../../utils/errors.js';
import { languageCode, parseReviewDate } from './providers/googleMapsParse.js';

// Google Reviews CSV, contract V1 — what the ATLAS Google Reviews Exporter
// (Chrome extension) writes and what ATLAS imports. Documented for people in
// docs/google-reviews-csv-v1.md; keep the two in step.
//
// Versioning lives in the file itself, as a column, so the CSV stays a plain
// CSV any spreadsheet opens: every row carries schema_version
// ("atlas-gr-1"). A later version adds columns or a new value; this parser
// keeps reading V1 files, and ignores columns it does not know.
//
// Only three headers are required (business_name, rating, review_text), so
// a hand-made sheet with those can still be imported; everything else falls
// back safely when missing.

export const SCHEMA_VERSION = 'atlas-gr-1';
export const COLUMNS = [
  'schema_version', 'business_name', 'business_id', 'business_address', 'business_url', 'business_rating',
  'business_review_count', 'review_id', 'reviewer_name', 'rating', 'review_date', 'review_date_raw',
  'review_date_precision', 'review_text', 'review_language', 'owner_response', 'owner_response_date_raw',
  'collected_at', 'source',
];
const REQUIRED = ['business_name', 'rating', 'review_text'];
const LIMITS = {
  business_name: 300, business_id: 300, business_address: 500, business_url: 2000, review_id: 300,
  reviewer_name: 200, review_text: 10_000, owner_response: 10_000, review_date_raw: 100, owner_response_date_raw: 100,
};
const PRECISIONS = new Set(['exact', 'day', 'week', 'month', 'year']);
const MAX_ISSUES = 50;

const env = (k, d) => Number(process.env[k]) || d;
export const limits = () => ({
  maxBytes: env('GR_CSV_MAX_BYTES', 4 * 1024 * 1024), // under Vercel's ~4.5 MB body cap
  maxRows: env('GR_CSV_MAX_ROWS', 10_000),
});

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// The exporter guards cells that would start a spreadsheet formula with a
// leading apostrophe; it is not part of the review and comes off here.
export function unguard(value) {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

function isoOrNull(value) {
  if (!value) return null;
  const ok = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value);
  const t = ok ? Date.parse(value.length === 10 ? `${value}T12:00:00+07:00` : value) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// A review without Google's own id still needs a stable key, so a second
// upload of the same file matches the first. Built from what identifies a
// review (business, reviewer, stars, the date as written, the words), never
// the reviewer's name alone. Rows that are identical on all of those and
// carry no text are not assumed to be the same review: each keeps its own
// key by its position among its look-alikes.
export function fingerprint(businessKey, r) {
  const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return `fp:${sha([businessKey, norm(r.reviewerName), r.rating ?? '', norm(r.dateRaw), norm(r.text)].join('|')).slice(0, 32)}`;
}

function decode(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new AppError('File bukan teks UTF-8. Simpan ulang CSV dengan encoding UTF-8 (exporter ATLAS sudah memakai UTF-8).', 400);
  }
}

// Parse and check one file. Never throws for a bad row — the row is listed in
// issues and left out; throws only when the file as a whole cannot be used.
export function parseReviewsCsv(buffer, { now = new Date() } = {}) {
  const { maxBytes, maxRows } = limits();
  if (!buffer?.length) throw new AppError('File CSV kosong.', 400);
  if (buffer.length > maxBytes) throw new AppError(`File terlalu besar (maks. ${Math.round(maxBytes / 1024 / 1024 * 10) / 10} MB).`, 413);
  if (buffer.includes(0)) throw new AppError('File berisi data biner, bukan CSV.', 400);

  let records;
  try {
    records = parse(decode(buffer), {
      bom: true, skip_empty_lines: true, relax_column_count: true, trim: false, max_record_size: 64 * 1024,
      to: maxRows + 2,
    });
  } catch (err) {
    const where = err.lines ? ` (sekitar baris ${err.lines})` : '';
    throw new AppError(`CSV tidak bisa dibaca${where}: ${String(err.message).split('\n')[0].slice(0, 160)}`, 400);
  }
  if (!records.length) throw new AppError('File CSV kosong.', 400);

  const header = records[0].map((h) => String(h).trim().toLowerCase().replace(/^﻿/, ''));
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) {
    throw new AppError(`Header CSV tidak sesuai: kolom ${missing.join(', ')} tidak ditemukan. Gunakan CSV dari ATLAS Google Reviews Exporter.`, 400);
  }
  const body = records.slice(1);
  if (!body.length) throw new AppError('CSV hanya berisi header, tanpa ulasan.', 400);
  if (body.length > maxRows) throw new AppError(`CSV melebihi ${maxRows.toLocaleString('id-ID')} baris. Bagi menjadi beberapa file.`, 413);

  const col = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)]));
  const unknown = header.filter((h) => h && !COLUMNS.includes(h));
  const issues = [];
  const issue = (row, column, message) => { if (issues.length < MAX_ISSUES) issues.push({ row, column, message }); };
  if (unknown.length) issue(1, unknown.join(', '), 'Kolom tidak dikenal, diabaikan.');

  const rows = [];
  const seen = new Map(); // key -> row number
  const lookAlikes = new Map(); // fingerprint -> count
  const businessKeys = new Map(); // business key/name -> first row
  let invalid = 0;
  let duplicates = 0;
  const versions = new Set();

  body.forEach((rec, i) => {
    const rowNo = i + 2; // spreadsheet numbering, header is row 1
    const get = (c) => (col[c] >= 0 && rec[col[c]] != null ? unguard(String(rec[col[c]])) : '');
    const errs = [];

    for (const [c, max] of Object.entries(LIMITS)) {
      if (get(c).length > max) errs.push([c, `Lebih dari ${max.toLocaleString('id-ID')} karakter.`]);
    }
    const ratingRaw = get('rating').trim();
    const rating = /^[1-5]$/.test(ratingRaw) ? Number(ratingRaw) : null;
    if (rating == null) errs.push(['rating', ratingRaw ? `Rating "${ratingRaw.slice(0, 10)}" harus angka bulat 1–5.` : 'Rating kosong.']);
    const businessName = get('business_name').trim();
    if (!businessName) errs.push(['business_name', 'Nama bisnis kosong.']);
    if (errs.length) {
      invalid += 1;
      for (const [c, m] of errs) issue(rowNo, c, m);
      return;
    }

    const version = get('schema_version').trim();
    if (version) versions.add(version);
    const businessId = get('business_id').trim() || null;
    businessKeys.set(businessId ?? `name:${businessName.toLowerCase()}`, { row: rowNo, businessId, businessName });

    const collectedAt = isoOrNull(get('collected_at').trim());
    if (get('collected_at').trim() && !collectedAt) issue(rowNo, 'collected_at', 'Format waktu tidak dikenal; memakai waktu upload.');
    const basis = collectedAt ? new Date(collectedAt) : now;

    // Date: an ISO date as given (with its stated precision), else read from
    // the text Google showed ("6 bulan lalu"), else none. Never invented.
    const dateRaw = get('review_date_raw').trim() || null;
    let date = null;
    let precision = null;
    const iso = get('review_date').trim();
    const stated = get('review_date_precision').trim().toLowerCase();
    if (iso) {
      date = isoOrNull(iso);
      if (!date) issue(rowNo, 'review_date', `Tanggal "${iso.slice(0, 30)}" tidak dikenal${dateRaw ? '; dibaca dari review_date_raw' : '; ulasan disimpan tanpa tanggal'}.`);
      else precision = PRECISIONS.has(stated) && stated !== 'exact' ? stated : null;
    }
    if (!date && dateRaw) {
      const p = parseReviewDate(dateRaw, basis);
      date = p.date;
      precision = p.precision;
      if (!date) issue(rowNo, 'review_date_raw', `Tanggal "${dateRaw.slice(0, 30)}" tidak dikenal; ulasan disimpan tanpa tanggal.`);
    }
    if (date && new Date(date).getTime() > basis.getTime() + 86_400_000) {
      issue(rowNo, 'review_date', 'Tanggal di masa depan; ulasan disimpan tanpa tanggal.');
      date = null;
      precision = null;
    }

    const text = get('review_text').replace(/\r\n?/g, '\n').trim() || null;
    const ownerRaw = get('owner_response').replace(/\r\n?/g, '\n').trim() || null;
    const ownerDateRaw = get('owner_response_date_raw').trim();
    const review = {
      reviewerName: get('reviewer_name').trim() || null,
      rating,
      date,
      datePrecision: precision,
      dateRaw,
      text,
      language: languageCode(get('review_language')),
      ownerResponse: ownerRaw,
      ownerResponseDate: ownerDateRaw ? parseReviewDate(ownerDateRaw, basis).date : null,
    };
    const reviewId = get('review_id').trim() || null;
    let key = reviewId;
    if (!key) {
      const fp = fingerprint(businessId ?? businessName, review);
      // Without text or a reviewer, look-alikes may be different people.
      const ambiguous = !text && !review.reviewerName;
      const n = (lookAlikes.get(fp) ?? 0) + 1;
      lookAlikes.set(fp, n);
      key = ambiguous ? `${fp}#${n}` : fp;
    }
    if (seen.has(key)) {
      duplicates += 1;
      issue(rowNo, 'review_id', `Duplikat baris ${seen.get(key)}; dilewati.`);
      return;
    }
    seen.set(key, rowNo);
    rows.push({ externalId: key, ...review });
  });

  // One file, one business: two branches in one dataset would be mixed.
  const ids = [...new Set([...businessKeys.values()].map((b) => b.businessId).filter(Boolean))];
  if (ids.length > 1) {
    throw new AppError(`CSV berisi lebih dari satu bisnis (${ids.slice(0, 3).join(', ')}). Ekspor tiap bisnis ke file terpisah.`, 400);
  }
  const names = [...new Set([...businessKeys.values()].map((b) => b.businessName))];
  if (!ids.length && names.length > 1) {
    throw new AppError(`CSV berisi lebih dari satu nama bisnis (${names.slice(0, 3).join(', ')}) tanpa business_id. Ekspor tiap bisnis ke file terpisah.`, 400);
  }
  if (versions.size && ![...versions].every((v) => v === SCHEMA_VERSION)) {
    issue(1, 'schema_version', `Versi ${[...versions].join(', ')} — dibaca dengan aturan ${SCHEMA_VERSION}.`);
  }

  const first = (c) => {
    for (const rec of body) {
      const v = col[c] >= 0 ? unguard(String(rec[col[c]] ?? '')).trim() : '';
      if (v) return v;
    }
    return null;
  };
  const ratingVal = Number(String(first('business_rating') ?? '').replace(',', '.'));
  const countVal = Number(String(first('business_review_count') ?? '').replace(/[.,\s]/g, ''));
  const url = first('business_url');
  const dates = rows.map((r) => r.date).filter(Boolean).sort();

  return {
    schemaVersion: versions.size ? [...versions][0] : null,
    fromExporter: versions.has(SCHEMA_VERSION) && first('source') === 'atlas_extension',
    business: {
      key: ids[0] ?? null,
      name: names[0] ?? null,
      address: first('business_address'),
      url: url && /^https:\/\/(www\.)?google\.[a-z.]+\/maps|^https:\/\/maps\.google\./i.test(url) ? url : null,
      rating: ratingVal >= 1 && ratingVal <= 5 ? Math.round(ratingVal * 10) / 10 : null,
      totalReviews: Number.isInteger(countVal) && countVal > 0 ? countVal : null,
    },
    rows,
    issues,
    stats: {
      total: body.length,
      valid: rows.length,
      invalid,
      duplicates,
      ratingOnly: rows.filter((r) => !r.text).length,
      withoutDate: rows.filter((r) => !r.date).length,
      dateFrom: dates[0] ?? null,
      dateTo: dates.at(-1) ?? null,
    },
  };
}
