import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeText, detectLanguage, ENGINE_VERSION } from '../src/services/googleReviews/codeSentiment/engine.js';
import { buildCodeSummary } from '../src/services/googleReviews/codeSentiment/summary.js';

// Sentences here are written for the tests (labelled behaviour targets), not
// Google reviews.
const s = (t) => analyzeText(t).sentiment;

test('the examples from the brief', () => {
  assert.equal(s('Pelayanannya sangat ramah dan tempatnya nyaman'), 'positive');
  assert.equal(s('Pelayanannya tidak ramah dan lama sekali'), 'negative');
  assert.equal(s('Saya datang untuk konsultasi kemarin'), 'neutral');
  assert.equal(s('Not bad at all'), 'positive');
  // Mixed: the dominant side, or neutral when balanced.
  assert.equal(s('Tempatnya bagus, tapi harus menunggu sangat lama'), 'negative', 'the clause after "tapi" carries the point');
});

test('positive and negative, Indonesian and English', () => {
  for (const t of ['Dokternya informatif dan sabar, hasilnya memuaskan', 'Mantap, recommended banget!', 'Excellent service, very friendly staff', 'Great place, will come back']) {
    assert.equal(s(t), 'positive', t);
  }
  for (const t of ['Kecewa, pelayanannya jutek', 'Mahal dan hasilnya tidak sesuai harapan', 'Terrible experience, rude staff', 'Waste of money, never again']) {
    assert.equal(s(t), 'negative', t);
  }
});

test('negation flips, and a negated complaint is mild praise', () => {
  assert.equal(s('Staffnya tidak ramah'), 'negative');
  assert.equal(s('Staffnya gak ramah'), 'negative', 'slang negator');
  assert.equal(s('Tidak buruk'), 'positive');
  assert.equal(s('Tidak ada keluhan sama sekali'), 'positive');
  assert.equal(s('not friendly at all'), 'negative');
  assert.equal(s('Kurang bersih'), 'negative', '"kurang" flips and softens');
  assert.ok(analyzeText('Tidak buruk').score < analyzeText('Bagus').score, 'a negated complaint is weaker than praise');
});

test('intensifiers before and after, dampeners soften', () => {
  const plain = analyzeText('ramah').score;
  assert.ok(analyzeText('sangat ramah').score > plain);
  assert.ok(analyzeText('ramah banget').score > plain, 'Indonesian booster after the word');
  assert.ok(analyzeText('really friendly').score > analyzeText('friendly').score);
  assert.ok(analyzeText('agak lama').score > analyzeText('lama').score, 'agak softens a complaint');
  // A booster used once is not counted again as a word ("mahal parah").
  assert.deepEqual(analyzeText('mahal parah').terms, ['mahal']);
});

test('"lama" after "sudah/dari" is a duration; "tidak sabar" is eagerness', () => {
  assert.deepEqual(analyzeText('Sudah cukup lama perawatan di sini').complaints, []);
  assert.equal(s('Sudah cukup lama langganan, hasilnya selalu bagus'), 'positive');
  assert.equal(s('Antri lama sekali'), 'negative', 'a wait is still a wait');
  assert.equal(s('Tidak sabar untuk datang lagi'), 'positive');
});

test('slang and stretched letters are understood', () => {
  assert.equal(s('pelayanannya ramah bgt, mantul'), 'positive');
  assert.equal(s('bagussss bangettt'), 'positive');
  assert.equal(s('lelet, nunggu lama'), 'negative');
  assert.equal(s('gak worth it, mahal parah'), 'negative');
});

test('mixed Indonesian-English reviews', () => {
  const r = analyzeText('Staffnya friendly banget, tempatnya cozy dan worth it sih');
  assert.equal(r.sentiment, 'positive');
  assert.equal(analyzeText('The treatment was great and the staff were friendly, tapi parkirnya agak susah dan antri lama banget').language, 'mixed');
});

test('contrast and concession', () => {
  assert.equal(s('Meskipun antri lama, hasilnya memuaskan'), 'positive', 'what is conceded counts less');
  assert.equal(s('The doctor was very informative but the waiting time was too long'), 'negative');
  // "cuma" marks a side note, not a reversal.
  assert.notEqual(s('Bagus banget, cuma parkirnya sempit'), 'negative');
});

test('emoji count when they are clear', () => {
  assert.equal(s('😍😍'), 'positive');
  assert.equal(s('👎'), 'negative');
  assert.equal(analyzeText('😂').evidence, 'no_evidence');
});

test('evidence labels instead of an invented confidence number', () => {
  assert.equal(analyzeText('Saya datang kemarin jam 3').evidence, 'no_evidence');
  assert.equal(analyzeText('oke').evidence, 'low_evidence');
  assert.equal(analyzeText('Bagus dan kotor').evidence, 'ambiguous', 'praise and complaint of similar weight');
  assert.equal(analyzeText('Bagus, tapi kotor').sentiment, 'negative', 'after "tapi" the complaint dominates');
  assert.equal(analyzeText('Pelayanannya sangat ramah, tempatnya bersih dan nyaman').evidence, 'clear');
  assert.equal(analyzeText('x').evidence, 'no_evidence');
});

test('empty text is neutral with no evidence (rating-only is decided before the engine)', () => {
  for (const t of ['', '   ', null, undefined]) {
    const r = analyzeText(t);
    assert.equal(r.sentiment, 'neutral');
    assert.equal(r.evidence, 'no_evidence');
  }
});

test('known limit: sarcasm reads as written, flagged as not clear', () => {
  const r = analyzeText('Bagus banget, 2 jam nunggu 🙄');
  assert.notEqual(r.sentiment, 'positive', 'at least it is not read as praise');
  assert.notEqual(r.evidence, 'clear');
});

test('aspects follow the clause that names them', () => {
  const r = analyzeText('Dokternya informatif, tapi antri lama dan harganya mahal');
  assert.ok(r.praises.includes('dokter'));
  assert.ok(r.complaints.includes('waktu tunggu'));
  assert.ok(r.complaints.includes('harga'));
  assert.deepEqual(analyzeText('Saya ke sini untuk facial').praises, []);
});

test('language detection', () => {
  const lang = (t) => analyzeText(t).language;
  assert.equal(lang('Pelayanannya ramah dan tempatnya nyaman sekali'), 'id');
  assert.equal(lang('The staff were friendly and the place was clean'), 'en');
  assert.equal(lang('12345'), 'unknown');
  assert.equal(detectLanguage([]), 'unknown');
});

test('engine version is stamped on every reading', () => {
  assert.match(ENGINE_VERSION, /^code-\d+\.\d+\.\d+$/);
  assert.equal(analyzeText('bagus').engineVersion, ENGINE_VERSION);
});

test('code summary: counted statements, no recommendations', () => {
  const reviews = [
    { id: 1, rating: 5, text: 'a', sentiment: 'positive', praises: ['pelayanan'], complaints: [], aspects: ['pelayanan'], evidence: 'clear', review_date: null },
    { id: 2, rating: 5, text: 'b', sentiment: 'positive', praises: ['pelayanan'], complaints: [], aspects: ['pelayanan'], evidence: 'clear', review_date: null },
    { id: 3, rating: 2, text: 'c', sentiment: 'negative', praises: [], complaints: ['waktu tunggu'], aspects: ['waktu tunggu'], evidence: 'low_evidence', review_date: null },
    { id: 4, rating: 4, text: null, sentiment: 'rating_only', praises: [], complaints: [], aspects: [], review_date: null },
  ];
  const sum = buildCodeSummary({ business: { google_total: 50 }, reviews });
  assert.match(sum.executive.overall, /Dari 3 ulasan teks yang dianalisis, 66,7% positif \(2\)/);
  assert.deepEqual(sum.executive.actions, [], 'no business recommendations from rules');
  assert.equal(sum.love[0].title, 'Kualitas Pelayanan');
  assert.equal(sum.improve.length, 0, 'one complaint is not a recurring finding');
  assert.ok(sum.executive.limitations.some((l) => /3|4 dari 50/.test(l)));
  assert.ok(sum.executive.limitations.some((l) => /sarkasme/.test(l)));
  assert.equal(sum.topics.find((t) => t.name === 'Kualitas Pelayanan').insight, '2 ulasan menyebut topik ini: 2 positif, 0 netral, 0 negatif.');
});
