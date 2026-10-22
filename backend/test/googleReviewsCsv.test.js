import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, SCHEMA_VERSION, fingerprint, parseReviewsCsv, unguard } from '../src/services/googleReviews/csvSchema.js';

// Fixtures here are labelled test data, built in code — not Google reviews.
const NOW = new Date('2026-10-20T08:00:00Z');
const q = (v) => (v == null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const BIZ = { business_name: 'Klinik Uji (TEST)', business_id: 'cid:123', business_address: 'Jl. Uji 1, Bandung', business_url: 'https://www.google.com/maps?cid=123', business_rating: '4.8', business_review_count: '239' };
function csv(rows, { header = COLUMNS, bom = true, eol = '\r\n' } = {}) {
  const lines = [header.join(',')];
  for (const r of rows) {
    const full = { schema_version: SCHEMA_VERSION, source: 'atlas_extension', collected_at: '2026-10-20T07:00:00Z', ...BIZ, ...r };
    lines.push(header.map((h) => q(full[h])).join(','));
  }
  return Buffer.from((bom ? '﻿' : '') + lines.join(eol) + eol, 'utf8');
}
const parseOk = (buf) => parseReviewsCsv(buf, { now: NOW });

test('a valid exporter file: business, rows, stats', () => {
  const out = parseOk(csv([
    { review_id: 'R1', rating: '5', review_text: 'Pelayanan ramah', review_date_raw: '6 bulan lalu', review_date_precision: 'month', review_language: 'id' },
    { review_id: 'R2', rating: '2', review_text: '', review_date_raw: 'setahun lalu', review_date_precision: 'year' },
  ]));
  assert.equal(out.fromExporter, true);
  assert.deepEqual(out.business, { key: 'cid:123', name: 'Klinik Uji (TEST)', address: 'Jl. Uji 1, Bandung', url: 'https://www.google.com/maps?cid=123', rating: 4.8, totalReviews: 239 });
  assert.equal(out.stats.valid, 2);
  assert.equal(out.stats.ratingOnly, 1);
  assert.equal(out.rows[0].datePrecision, 'month');
  assert.equal(out.rows[0].date.slice(0, 10), '2026-04-20', 'read from the raw text against collected_at');
  assert.equal(out.rows[1].text, null, 'no comment stays no comment');
});

test('multiline, quotes, commas and emoji survive unchanged', () => {
  const text = 'Baris 1, dengan koma\n"Kutipan" 😊🙏🏻\n\nBaris 4';
  const out = parseOk(csv([{ review_id: 'R1', rating: '5', review_text: text }]));
  assert.equal(out.rows[0].text, text);
});

test('a formula guard added by the exporter comes off; other text is untouched', () => {
  assert.equal(unguard("'=SUM(A1)"), '=SUM(A1)');
  assert.equal(unguard("'- pelayanan bagus"), '- pelayanan bagus');
  assert.equal(unguard("'biasa saja"), "'biasa saja");
  const out = parseOk(csv([{ review_id: 'R1', rating: '4', review_text: "'+ ramah\n- antri lama" }]));
  assert.equal(out.rows[0].text, '+ ramah\n- antri lama');
});

test('empty file, header only, wrong header, not UTF-8, binary, too big', () => {
  assert.throws(() => parseOk(Buffer.alloc(0)), /kosong/);
  assert.throws(() => parseOk(csv([])), /hanya berisi header/);
  assert.throws(() => parseOk(Buffer.from('nama,bintang,komentar\nA,5,ok\n')), /business_name, rating, review_text/);
  assert.throws(() => parseOk(Buffer.from([0x62, 0x75, 0xff, 0xfe, 0x0a])), /UTF-8/);
  assert.throws(() => parseOk(Buffer.from('business_name,rating,review_text\nA,5,o\u0000k\n')), /biner/);
  process.env.GR_CSV_MAX_BYTES = '200';
  try {
    assert.throws(() => parseOk(csv([{ review_id: 'R1', rating: '5', review_text: 'x'.repeat(300) }])), /terlalu besar/);
  } finally {
    delete process.env.GR_CSV_MAX_BYTES;
  }
});

test('row limit is enforced', () => {
  process.env.GR_CSV_MAX_ROWS = '3';
  try {
    assert.throws(() => parseOk(csv([1, 2, 3, 4].map((n) => ({ review_id: `R${n}`, rating: '5', review_text: 'ok' })))), /melebihi 3 baris/);
  } finally {
    delete process.env.GR_CSV_MAX_ROWS;
  }
});

test('bad rows are listed by row and column, good rows still import', () => {
  const out = parseOk(csv([
    { review_id: 'R1', rating: '5', review_text: 'ok' },
    { review_id: 'R2', rating: '6', review_text: 'x' },
    { review_id: 'R3', rating: '', review_text: 'x' },
    { review_id: 'R4', rating: '4.5', review_text: 'x' },
    { review_id: 'R5', rating: '3', review_text: 'y'.repeat(10_001) },
  ]));
  assert.equal(out.stats.valid, 1);
  assert.equal(out.stats.invalid, 4);
  assert.deepEqual(out.issues.map((i) => [i.row, i.column]), [[3, 'rating'], [4, 'rating'], [5, 'rating'], [6, 'review_text']]);
});

test('only the three required columns: a minimal sheet imports with safe fallbacks', () => {
  const buf = Buffer.from('business_name,rating,review_text\r\nKlinik Uji (TEST),5,Mantap\r\nKlinik Uji (TEST),3,\r\n');
  const out = parseOk(buf);
  assert.equal(out.business.key, null, 'no identifier: the user must map it');
  assert.equal(out.fromExporter, false);
  assert.equal(out.stats.valid, 2);
  assert.ok(out.rows.every((r) => r.externalId.startsWith('fp:')));
  assert.ok(out.rows.every((r) => r.date === null));
});

test('malformed and future dates are flagged, never invented', () => {
  const out = parseOk(csv([
    { review_id: 'R1', rating: '5', review_text: 'a', review_date: '32/13/2026' },
    { review_id: 'R2', rating: '5', review_text: 'b', review_date: 'kapan-kapan', review_date_raw: '2 minggu lalu' },
    { review_id: 'R3', rating: '5', review_text: 'c', review_date: '2030-01-01' },
    { review_id: 'R4', rating: '5', review_text: 'd', review_date: '2025-03-04', review_date_precision: 'exact' },
  ]));
  const [a, b, c, d] = out.rows;
  assert.equal(a.date, null);
  assert.equal(b.datePrecision, 'week');
  assert.equal(c.date, null);
  assert.equal(d.date.slice(0, 10), '2025-03-04');
  assert.equal(d.datePrecision, null);
  assert.equal(out.stats.withoutDate, 2);
  assert.ok(out.issues.some((i) => i.row === 2 && i.column === 'review_date'));
});

test('duplicate rows: same review id or same fingerprint is skipped, look-alike rating-only rows are kept', () => {
  const out = parseOk(csv([
    { review_id: 'R1', rating: '5', review_text: 'Bagus' },
    { review_id: 'R1', rating: '5', review_text: 'Bagus' },
    { reviewer_name: 'Ani', rating: '4', review_text: 'Oke', review_date_raw: '2 bulan lalu' },
    { reviewer_name: 'Ani', rating: '4', review_text: 'Oke', review_date_raw: '2 bulan lalu' },
    { rating: '5', review_text: '', review_date_raw: 'setahun lalu' },
    { rating: '5', review_text: '', review_date_raw: 'setahun lalu' },
  ]));
  assert.equal(out.stats.duplicates, 2);
  assert.equal(out.stats.valid, 4, 'two anonymous 5-star rows may be two people');
});

test('fingerprints are stable across uploads and never from the name alone', () => {
  const a = fingerprint('cid:1', { reviewerName: 'Ani', rating: 5, dateRaw: 'setahun lalu', text: 'Bagus  sekali' });
  assert.equal(a, fingerprint('cid:1', { reviewerName: 'ani', rating: 5, dateRaw: 'Setahun lalu', text: 'Bagus sekali' }));
  assert.notEqual(a, fingerprint('cid:1', { reviewerName: 'Ani', rating: 4, dateRaw: 'setahun lalu', text: 'Bagus sekali' }));
  assert.notEqual(a, fingerprint('cid:2', { reviewerName: 'Ani', rating: 5, dateRaw: 'setahun lalu', text: 'Bagus sekali' }));
});

test('one file, one business', () => {
  assert.throws(() => parseOk(csv([
    { review_id: 'R1', rating: '5', review_text: 'a' },
    { review_id: 'R2', rating: '5', review_text: 'b', business_id: 'cid:999' },
  ])), /lebih dari satu bisnis/);
  assert.throws(() => parseOk(Buffer.from('business_name,rating,review_text\nA,5,x\nB,5,y\n')), /lebih dari satu nama bisnis/);
});

test('works without BOM and with LF line endings; unknown columns are ignored with a note', () => {
  const header = [...COLUMNS, 'extra_col'];
  const out = parseOk(csv([{ review_id: 'R1', rating: '5', review_text: 'ok', extra_col: 'x' }], { header, bom: false, eol: '\n' }));
  assert.equal(out.stats.valid, 1);
  assert.ok(out.issues.some((i) => i.column === 'extra_col'));
});

test('a business URL that is not Google Maps is dropped', () => {
  const out = parseOk(csv([{ review_id: 'R1', rating: '5', review_text: 'ok', business_url: 'javascript:alert(1)' }]));
  assert.equal(out.business.url, null);
});
