/* ATLAS Google Reviews Exporter — the parts that do not touch the page:
 * reading Google's labels, dates and ids, deduplication, and the CSV file
 * (contract atlas-gr-1, docs/google-reviews-csv-v1.md in the ATLAS repo).
 *
 * A classic script, not a module: content scripts cannot be modules. It puts
 * one object on globalThis (AtlasGR) for content.js and popup.js, and
 * exports the same object to Node for the tests. */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 'atlas-gr-1';
  var SOURCE = 'atlas_extension';
  var COLUMNS = [
    'schema_version', 'business_name', 'business_id', 'business_address', 'business_url', 'business_rating',
    'business_review_count', 'review_id', 'reviewer_name', 'rating', 'review_date', 'review_date_raw',
    'review_date_precision', 'review_text', 'review_language', 'owner_response', 'owner_response_date_raw',
    'collected_at', 'source',
  ];

  // "5 stars", "5 bintang", "Rated 4.0 out of 5" -> 1..5, else null.
  function parseRating(label) {
    var m = String(label || '').match(/(\d+(?:[.,]\d)?)\s*(?:stars?|bintang|out of 5|dari 5)/i)
      || String(label || '').match(/(?:rated|bintang)\s+(\d+(?:[.,]\d)?)/i);
    if (!m) return null;
    var v = Math.round(Number(m[1].replace(',', '.')));
    return v >= 1 && v <= 5 ? v : null;
  }

  // "4,8" / "5.0" -> 4.8 / 5
  function parseRatingValue(text) {
    var m = String(text || '').match(/(\d[.,]\d)/);
    if (!m) return null;
    var v = Number(m[1].replace(',', '.'));
    return v >= 1 && v <= 5 ? v : null;
  }

  // "(1.694)", "1,694", "239 ulasan" -> integer
  function parseCount(text) {
    var m = String(text || '').match(/(\d[\d.,]*)/);
    if (!m) return null;
    var n = Number(m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(/[.,]/g, ''));
    return isFinite(n) ? n : null;
  }

  // The feature id in a Maps URL ("!1s0x2e68…:0xab02…") names the place the
  // same way however it was reached; its second half is the public CID.
  // ATLAS keys such a business "cid:<CID>".
  function placeKeyFromUrl(url) {
    var u = String(url || '');
    var m = u.match(/!1s(0x[0-9a-f]+):(0x[0-9a-f]+)/i);
    if (m) return 'cid:' + BigInt(m[2]).toString();
    m = u.match(/[?&]cid=(\d+)/);
    return m ? 'cid:' + m[1] : null;
  }

  var LANGUAGE_NAMES = {
    indonesian: 'id', english: 'en', malay: 'ms', javanese: 'jv', sundanese: 'su', japanese: 'ja', korean: 'ko', chinese: 'zh',
    'chinese (simplified)': 'zh', 'chinese (traditional)': 'zh', arabic: 'ar', dutch: 'nl', french: 'fr', german: 'de', spanish: 'es',
    thai: 'th', vietnamese: 'vi', tagalog: 'tl', filipino: 'tl', hindi: 'hi', russian: 'ru', italian: 'it', portuguese: 'pt', turkish: 'tr',
    indonesia: 'id', 'bahasa indonesia': 'id', inggris: 'en', melayu: 'ms', jawa: 'jv', sunda: 'su', jepang: 'ja', korea: 'ko', mandarin: 'zh',
  };
  function languageCode(value) {
    var v = String(value || '').trim().toLowerCase();
    if (!v) return '';
    if (/^[a-z]{2}(-[a-z0-9]+)?$/.test(v)) return v.slice(0, 2);
    return LANGUAGE_NAMES[v] || '';
  }

  // What Google wrote as the date ("6 bulan lalu", "Edited a year ago",
  // "3 Mar 2024"). A relative date is NOT turned into a calendar date here:
  // the CSV keeps the words and how precise they are, and ATLAS counts back
  // from collected_at. Only a written-out date becomes review_date.
  var UNIT_PRECISION = {
    second: 'day', minute: 'day', hour: 'day', day: 'day', week: 'week', month: 'month', year: 'year',
    detik: 'day', menit: 'day', jam: 'day', hari: 'day', minggu: 'week', bulan: 'month', tahun: 'year',
  };
  var ID_MONTHS = { januari: 'jan', februari: 'feb', maret: 'mar', mei: 'may', juni: 'jun', juli: 'jul', agustus: 'aug', agu: 'aug', agt: 'aug', oktober: 'oct', okt: 'oct', november: 'nov', desember: 'dec', des: 'dec' };
  function cleanDateText(text) {
    return String(text || '').toLowerCase().replace(/\b(edited|diedit|new|baru)\b/g, ' ').replace(/\b(on|di) google\b/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function readDate(text) {
    var t = cleanDateText(text);
    if (!t) return { date: '', precision: '' };
    if (/^(just now|a moment ago|baru saja|yesterday|kemarin)$/.test(t)) return { date: '', precision: 'day' };
    var m = t.match(/^(?:a|an|one|\d+) (second|minute|hour|day|week|month|year)s? ago$/)
      || t.match(/^(?:\d+|se|satu) ?(detik|menit|jam|hari|minggu|bulan|tahun) (?:yang )?lalu$/);
    if (m) return { date: '', precision: UNIT_PRECISION[m[1]] };
    if (/\d{4}/.test(t)) {
      var en = t.replace(/\b([a-z]+)\b/g, function (w) { return ID_MONTHS[w] || w; });
      var d = new Date(en + ' 12:00 GMT+0700');
      if (!isNaN(d.getTime())) {
        var p = function (n) { return String(n).padStart(2, '0'); };
        var local = new Date(d.getTime() + 7 * 3600 * 1000);
        return { date: local.getUTCFullYear() + '-' + p(local.getUTCMonth() + 1) + '-' + p(local.getUTCDate()), precision: 'exact' };
      }
    }
    return { date: '', precision: '' };
  }

  // "Response from the owner 2 months ago\nThank you…" -> { text, dateRaw }
  function splitOwnerResponse(block) {
    var t = String(block || '').trim();
    if (!t) return { text: '', dateRaw: '' };
    var lines = t.split('\n');
    var head = lines[0].replace(/^(response from the owner|tanggapan dari pemilik)\s*/i, '');
    var body = lines.slice(1).join('\n').trim();
    if (head === lines[0] && !body) return { text: t, dateRaw: '' };
    return { text: body, dateRaw: head.trim() };
  }

  // A closing " …" with no "More" left to press is Google's marker on a text
  // that is already complete (checked against reviewers' own profile pages),
  // not the customer's words.
  function cleanReviewText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\s*(see more|more|lihat lainnya|lainnya)\s*$/i, '')
      .replace(/\s*…$/, '')
      .trim();
  }

  // Which collected reviews are the same review: Google's own review id when
  // the page has one; otherwise everything that identifies a review, never
  // the reviewer's name alone. Look-alikes without text or a name are kept
  // apart (two anonymous 5-star ratings may be two people).
  function dedupeKey(businessKey, r, index) {
    if (r.id) return 'id:' + r.id;
    var norm = function (s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); };
    if (!r.text && !r.reviewer) return 'anon:' + index;
    return ['fp', businessKey, norm(r.reviewer), r.rating || '', norm(r.dateRaw), norm(r.text)].join('|');
  }

  // A cell that a spreadsheet would read as a formula gets a leading
  // apostrophe; ATLAS removes exactly that apostrophe again on import.
  function guardCell(value) {
    var s = value == null ? '' : String(value);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  function csvCell(value) {
    var s = guardCell(value);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // business: { name, key, address, url, rating, total }
  // reviews:  [{ id, reviewer, rating, dateRaw, text, lang, ownerBlock }]
  function buildCsv(business, reviews, collectedAt) {
    var lines = [COLUMNS.join(',')];
    reviews.forEach(function (r) {
      var d = readDate(r.dateRaw);
      var owner = splitOwnerResponse(r.ownerBlock);
      var row = {
        schema_version: SCHEMA_VERSION,
        business_name: business.name || '',
        business_id: business.key || '',
        business_address: business.address || '',
        business_url: business.url || '',
        business_rating: business.rating == null ? '' : String(business.rating),
        business_review_count: business.total == null ? '' : String(business.total),
        review_id: r.id || '',
        reviewer_name: r.reviewer || '',
        rating: r.rating == null ? '' : String(r.rating),
        review_date: d.date,
        review_date_raw: cleanDateText(r.dateRaw) ? String(r.dateRaw).trim() : '',
        review_date_precision: d.precision,
        review_text: cleanReviewText(r.text),
        review_language: languageCode(r.lang),
        owner_response: owner.text,
        owner_response_date_raw: owner.dateRaw,
        collected_at: collectedAt,
        source: SOURCE,
      };
      lines.push(COLUMNS.map(function (c) { return csvCell(row[c]); }).join(','));
    });
    // UTF-8 BOM so Excel opens Indonesian text and emoji correctly; CRLF
    // line ends between rows (line breaks inside a review stay inside quotes).
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  // ATLAS_GoogleReviews_<Business>_<YYYY-MM-DD>.csv, dated by the export.
  function fileName(businessName, when) {
    var d = when || new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    var date = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    var name = String(businessName || 'Bisnis')
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'Bisnis';
    return 'ATLAS_GoogleReviews_' + name + '_' + date + '.csv';
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION, SOURCE: SOURCE, COLUMNS: COLUMNS,
    parseRating: parseRating, parseRatingValue: parseRatingValue, parseCount: parseCount, placeKeyFromUrl: placeKeyFromUrl,
    languageCode: languageCode, readDate: readDate, splitOwnerResponse: splitOwnerResponse, cleanReviewText: cleanReviewText,
    dedupeKey: dedupeKey, guardCell: guardCell, csvCell: csvCell, buildCsv: buildCsv, fileName: fileName,
  };
  root.AtlasGR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
