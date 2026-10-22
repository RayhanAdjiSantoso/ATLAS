import test from 'node:test';
import assert from 'node:assert/strict';
import {
  languageCode, normaliseReview, originalText, parseCount, parseOwnerResponse, parseRating, parseRatingValue, parseReviewDate, placeKeyFromUrl, placeUrl,
} from '../src/services/googleReviews/providers/googleMapsParse.js';
import { sentimentTrend } from '../src/services/googleReviews/aggregations.js';

const NOW = new Date('2026-10-19T08:00:00Z');

test('relative dates: English, with their real precision', () => {
  const cases = [
    ['6 months ago', '2026-04-19', 'month'],
    ['a month ago', '2026-09-19', 'month'],
    ['Edited 8 years ago', '2018-10-19', 'year'],
    ['a year ago', '2025-10-19', 'year'],
    ['3 weeks ago', '2026-09-28', 'week'],
    ['2 days ago', '2026-10-17', 'day'],
    ['an hour ago', '2026-10-19', 'day'],
    ['yesterday', '2026-10-18', 'day'],
  ];
  for (const [text, day, precision] of cases) {
    const r = parseReviewDate(text, NOW);
    assert.equal(r.date.slice(0, 10), day, text);
    assert.equal(r.precision, precision, text);
  }
});

test('relative dates: Indonesian', () => {
  assert.deepEqual(
    ['6 bulan lalu', 'setahun yang lalu', '2 minggu lalu', 'seminggu lalu', 'sebulan lalu', '10 jam lalu', 'Diedit 3 bulan lalu'].map((x) => {
      const r = parseReviewDate(x, NOW);
      return [r.date.slice(0, 10), r.precision];
    }),
    [['2026-04-19', 'month'], ['2025-10-19', 'year'], ['2026-10-05', 'week'], ['2026-10-12', 'week'], ['2026-09-19', 'month'], ['2026-10-18', 'day'], ['2026-07-19', 'month']],
  );
});

test('absolute dates are exact; nonsense is null', () => {
  const r = parseReviewDate('Mar 3, 2024', NOW);
  assert.equal(r.precision, null);
  assert.equal(r.date.slice(0, 10), '2024-03-03');
  assert.equal(parseReviewDate('12 Mei 2023', NOW).date.slice(0, 10), '2023-05-12');
  assert.equal(parseReviewDate('5 Agu 2022', NOW).date.slice(0, 10), '2022-08-05');
  assert.deepEqual(parseReviewDate('', NOW), { date: null, precision: null });
  assert.deepEqual(parseReviewDate('Local Guide', NOW), { date: null, precision: null });
});

test('ratings, counts and averages', () => {
  assert.equal(parseRating('5 stars'), 5);
  assert.equal(parseRating('1 star'), 1);
  assert.equal(parseRating('Rated 4.0 out of 5,'), 4);
  assert.equal(parseRating('4 bintang'), 4);
  assert.equal(parseRatingValue('5,0\n(239)'), 5);
  assert.equal(parseCount('(1.694)'), 1694);
  assert.equal(parseRating('Photo of someone'), null);
  assert.equal(parseCount('(1,694)'), 1694);
  assert.equal(parseCount('1.694'), 1694);
  assert.equal(parseCount('239 reviews'), 239);
  assert.equal(parseRatingValue('4.8\n(1,694)'), 4.8);
  assert.equal(parseRatingValue('5,0'), 5);
});

test('Google translation: the customer original is kept', () => {
  assert.equal(originalText('(Translated by Google) Friendly staff\n\n(Original)\nStaff ramah'), 'Staff ramah');
  assert.equal(originalText('(Translated by Google) Friendly staff'), 'Friendly staff');
  assert.equal(originalText('   '), null);
});

test('owner response splits into date and text', () => {
  const o = parseOwnerResponse('Response from the owner 2 months ago\nHi, thank you!\nSee you again.', NOW);
  assert.equal(o.text, 'Hi, thank you!\nSee you again.');
  assert.equal(o.date.slice(0, 10), '2026-08-19');
  assert.deepEqual(parseOwnerResponse(null, NOW), { text: null, date: null });
});

test('place key from any Maps URL, and back', () => {
  const k = placeKeyFromUrl('https://www.google.com/maps/place/X/data=!4m6!3m5!1s0x2e68e6169891471f:0xab02047e66b259c1!8m2');
  assert.equal(k, 'cid:12322416471374453185');
  assert.equal(placeKeyFromUrl('https://www.google.com/maps?cid=12322416471374453185&hl=en'), k);
  assert.equal(placeKeyFromUrl('https://www.google.com/maps/search/erha+clinic/@-6.9,107.6,13z'), null);
  assert.equal(placeUrl(k), 'https://www.google.com/maps?cid=12322416471374453185&hl=en');
  assert.equal(placeUrl('ChIJabc'), null);
});

test('a raw review from the page becomes a provider review', () => {
  const r = normaliseReview({
    id: 'Ci9DQUlR', reviewer: 'Shinta', starsLabel: '5 stars', dateText: '6 months ago', text: 'Very good experience', lang: 'en',
    ownerBlock: 'Response from the owner 5 months ago\nTerima kasih',
  }, NOW);
  assert.deepEqual(
    { ...r, date: r.date.slice(0, 10), ownerResponseDate: r.ownerResponseDate.slice(0, 10) },
    { externalId: 'Ci9DQUlR', reviewerName: 'Shinta', rating: 5, date: '2026-04-19', datePrecision: 'month', text: 'Very good experience', language: 'en', ownerResponse: 'Terima kasih', ownerResponseDate: '2026-05-19' },
  );
  const bare = normaliseReview({ id: 'x', starsLabel: '4 stars', dateText: 'a year ago', text: '' }, NOW);
  assert.equal(bare.text, null, 'rating-only stays rating-only');
});

test('trend: month-precise dates never land in a week, year-precise in neither', () => {
  const reviews = [
    { review_date: '2026-04-19T08:00:00Z', date_precision: 'month', sentiment: 'positive' },
    { review_date: '2025-10-19T08:00:00Z', date_precision: 'year', sentiment: 'negative' },
    { review_date: '2026-04-20T08:00:00Z', date_precision: null, sentiment: 'neutral' },
  ];
  const now = new Date('2026-10-19T00:00:00Z');
  const monthly = sentimentTrend(reviews, { granularity: 'month', now });
  assert.equal(monthly.imprecise, 1);
  assert.equal(monthly.points.reduce((a, p) => a + p.total, 0), 2);
  const weekly = sentimentTrend(reviews, { granularity: 'week', now });
  assert.equal(weekly.imprecise, 2);
  assert.equal(weekly.points.reduce((a, p) => a + p.total, 0), 1);
});

test('language from a lang attribute or the translate switch name', () => {
  assert.equal(languageCode('id'), 'id');
  assert.equal(languageCode('en-US'), 'en');
  assert.equal(languageCode('Indonesian'), 'id');
  assert.equal(languageCode('Chinese (Simplified)'), 'zh');
  assert.equal(languageCode('Klingon'), null);
  assert.equal(languageCode(''), null);
});
