// The Chrome extension (extensions/google-reviews-exporter): its manifest,
// its pure functions, and — the contract — that a CSV it writes is read by
// ATLAS's importer exactly as intended. Fixtures are labelled TEST.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { parseReviewsCsv, COLUMNS } from '../src/services/googleReviews/csvSchema.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../extensions/google-reviews-exporter');
const G = createRequire(import.meta.url)(path.join(dir, 'lib/core.js'));

test('manifest: MV3, minimum permissions, files present', () => {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ['storage']);
  for (const h of m.host_permissions) assert.match(h, /^https:\/\/(www\.google\.(com|co\.id)\/maps\*|maps\.google\.com\/\*)$/);
  assert.ok(!JSON.stringify(m).includes('<all_urls>'));
  assert.ok(!/cookies|webRequest|scripting|tabs"/.test(JSON.stringify(m.permissions)));
  for (const f of [m.action.default_popup, ...m.content_scripts[0].js, ...Object.values(m.icons)]) {
    assert.ok(fs.existsSync(path.join(dir, f)), `${f} missing`);
  }
  assert.match(m.content_security_policy.extension_pages, /script-src 'self'/);
  // No remote code: every script the popup loads is a local file.
  const html = fs.readFileSync(path.join(dir, 'popup.html'), 'utf8');
  assert.ok(![...html.matchAll(/<script[^>]*src="([^"]+)"/g)].some((x) => /^https?:/.test(x[1])));
  for (const f of ['content.js', 'popup.js', 'lib/core.js']) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/\beval\(|new Function\(|fetch\(|XMLHttpRequest|document\.cookie|chrome\.cookies/.test(src), `${f} must not fetch, eval or read cookies`);
  }
});

test('the extension writes exactly the ATLAS V1 columns', () => {
  assert.deepEqual(G.COLUMNS, COLUMNS);
});

test('labels: rating, counts, place key, language', () => {
  assert.equal(G.parseRating('5 bintang'), 5);
  assert.equal(G.parseRating('1 star'), 1);
  assert.equal(G.parseRatingValue('4,8\n(1.694)'), 4.8);
  assert.equal(G.parseCount('239 ulasan'), 239);
  assert.equal(G.parseCount('(1.694)'), 1694);
  assert.equal(G.placeKeyFromUrl('https://www.google.com/maps/place/X/data=!4m6!3m5!1s0x2e68e6169891471f:0xab02047e66b259c1!8m2'), 'cid:12322416471374453185');
  assert.equal(G.languageCode('Inggris'), 'en');
  assert.equal(G.languageCode('id'), 'id');
});

test('dates: relative keeps words + precision only; written dates become exact', () => {
  assert.deepEqual(G.readDate('6 bulan lalu'), { date: '', precision: 'month' });
  assert.deepEqual(G.readDate('Diedit setahun lalu'), { date: '', precision: 'year' });
  assert.deepEqual(G.readDate('a week ago'), { date: '', precision: 'week' });
  assert.deepEqual(G.readDate('10 jam lalu'), { date: '', precision: 'day' });
  assert.deepEqual(G.readDate('12 Mei 2023'), { date: '2023-05-12', precision: 'exact' });
  assert.deepEqual(G.readDate('Local Guide'), { date: '', precision: '' });
});

test('text: Google\'s closing marker and "More" leftovers go, the words stay', () => {
  assert.equal(G.cleanReviewText('homey 🤍 …'), 'homey 🤍');
  assert.equal(G.cleanReviewText('tahun 2023 … Lainnya'), 'tahun 2023');
  assert.equal(G.cleanReviewText('Baris 1\r\nBaris 2'), 'Baris 1\nBaris 2');
  assert.deepEqual(G.splitOwnerResponse('Tanggapan dari pemilik 5 tahun lalu\nTerima kasih!\nSalam'), { text: 'Terima kasih!\nSalam', dateRaw: '5 tahun lalu' });
});

test('dedupe: review id first; never the name alone; anonymous look-alikes stay apart', () => {
  assert.equal(G.dedupeKey('cid:1', { id: 'abc' }, 0), 'id:abc');
  const a = G.dedupeKey('cid:1', { reviewer: 'Ani', rating: 5, dateRaw: '2 bulan lalu', text: 'ok' }, 0);
  assert.notEqual(a, G.dedupeKey('cid:1', { reviewer: 'Ani', rating: 4, dateRaw: '2 bulan lalu', text: 'ok' }, 1));
  assert.equal(a, G.dedupeKey('cid:1', { reviewer: 'Ani', rating: 5, dateRaw: '2 bulan lalu', text: 'ok' }, 7));
  assert.notEqual(G.dedupeKey('cid:1', { rating: 5, dateRaw: 'setahun lalu' }, 3), G.dedupeKey('cid:1', { rating: 5, dateRaw: 'setahun lalu' }, 4));
});

test('file name: ATLAS_GoogleReviews_<Business>_<export date>.csv', () => {
  assert.equal(G.fileName('Alluderma Skin & Aesthetic Clinic', new Date(2026, 9, 20)), 'ATLAS_GoogleReviews_Alluderma_Skin_Aesthetic_Clinic_2026-10-20.csv');
  assert.equal(G.fileName('Café Ñoño / Bandung', new Date(2026, 0, 2)), 'ATLAS_GoogleReviews_Cafe_Nono_Bandung_2026-01-02.csv');
});

test('contract: a CSV written by the extension imports into ATLAS unchanged', () => {
  const business = { name: 'Klinik Kontrak (TEST)', key: 'cid:42', address: 'Jl. Uji, "Blok A", Bandung', url: 'https://www.google.com/maps?cid=42', rating: 4.9, total: 120 };
  const reviews = [
    { id: 'K1', reviewer: 'Penguji, Satu', rating: 5, dateRaw: '6 bulan lalu', text: 'TEST: "Ramah", bersih,\nnyaman 😊🙏🏻 …', lang: 'id', ownerBlock: 'Tanggapan dari pemilik 5 bulan lalu\nTerima kasih (TEST)' },
    { id: 'K2', reviewer: 'Penguji Dua', rating: 2, dateRaw: '12 Mei 2023', text: '=HYPERLINK("x") TEST', lang: 'English', ownerBlock: '' },
    { id: 'K3', reviewer: 'Penguji Tiga', rating: 4, dateRaw: 'setahun lalu', text: '', lang: '', ownerBlock: '' },
    { id: 'K4', reviewer: 'Penguji Empat', rating: 3, dateRaw: '2 minggu lalu', text: '- antri lama\n- parkir sempit', lang: 'id', ownerBlock: '' },
  ];
  const csv = G.buildCsv(business, reviews, '2026-10-20T07:00:00.000Z');
  assert.ok(csv.startsWith('﻿'), 'UTF-8 BOM for Excel');
  assert.ok(csv.includes("'=HYPERLINK"), 'formula cells are guarded in the file');

  const out = parseReviewsCsv(Buffer.from(csv, 'utf8'), { now: new Date('2026-10-20T08:00:00Z') });
  assert.equal(out.fromExporter, true);
  assert.equal(out.stats.valid, 4);
  assert.equal(out.stats.invalid, 0);
  assert.deepEqual(out.issues, []);
  assert.deepEqual(out.business, { key: 'cid:42', name: 'Klinik Kontrak (TEST)', address: 'Jl. Uji, "Blok A", Bandung', url: 'https://www.google.com/maps?cid=42', rating: 4.9, totalReviews: 120 });
  const [k1, k2, k3, k4] = out.rows;
  assert.equal(k1.text, 'TEST: "Ramah", bersih,\nnyaman 😊🙏🏻', 'quotes, commas, line break, emoji intact; marker gone');
  assert.equal(k1.reviewerName, 'Penguji, Satu');
  assert.equal(k1.datePrecision, 'month');
  assert.equal(k1.date.slice(0, 10), '2026-04-20');
  assert.equal(k1.ownerResponse, 'Terima kasih (TEST)');
  assert.equal(k1.language, 'id');
  assert.equal(k2.text, '=HYPERLINK("x") TEST', 'guard removed again on import');
  assert.equal(k2.date.slice(0, 10), '2023-05-12');
  assert.equal(k2.datePrecision, null);
  assert.equal(k2.language, 'en');
  assert.equal(k3.text, null, 'rating-only stays rating-only');
  assert.equal(k3.datePrecision, 'year');
  assert.equal(k4.text, '- antri lama\n- parkir sempit');
});
