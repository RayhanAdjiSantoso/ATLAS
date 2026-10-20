// Integration test for Google Reviews CSV import (V1) through HTTP: auth,
// module and brand access, upload, preview, confirm, idempotency, updates,
// concurrency, AI unavailable / failing / working, dashboard figures.
// Opt-in: GOOGLE_REVIEWS_IT=1 node --test test/
// Every fixture is labelled TEST and built here — none is a Google review.
// Creates throw-away brands, accounts and businesses and deletes them after.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const ENABLED = process.env.GOOGLE_REVIEWS_IT === '1';
const tag = `__itcsv_${crypto.randomBytes(3).toString('hex')}`;
const COLS = ['schema_version', 'business_name', 'business_id', 'business_address', 'business_url', 'business_rating', 'business_review_count',
  'review_id', 'reviewer_name', 'rating', 'review_date', 'review_date_raw', 'review_date_precision', 'review_text', 'review_language',
  'owner_response', 'owner_response_date_raw', 'collected_at', 'source'];
const q = (v) => (v == null ? '' : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function csv(rows, biz = {}) {
  const base = {
    schema_version: 'atlas-gr-1', source: 'atlas_extension', collected_at: '2026-10-20T07:00:00Z', business_name: `Klinik ${tag} (TEST)`,
    business_id: `cid:${tag}`, business_address: 'Jl. Uji 1, Bandung (TEST)', business_url: 'https://www.google.com/maps?cid=1', business_rating: '4.7',
    business_review_count: '20', ...biz,
  };
  return '﻿' + [COLS.join(','), ...rows.map((r) => COLS.map((c) => q({ ...base, ...r }[c])).join(','))].join('\r\n') + '\r\n';
}
const ROWS = [
  { review_id: 'T1', reviewer_name: 'Penguji A', rating: '5', review_text: 'TEST: pelayanan ramah, tempat bersih', review_date_raw: '2 bulan lalu', review_date_precision: 'month', review_language: 'id' },
  { review_id: 'T2', reviewer_name: 'Penguji B', rating: '2', review_text: 'TEST: antri lama sekali\nharga mahal', review_date_raw: '3 minggu lalu', review_date_precision: 'week', review_language: 'id' },
  { review_id: 'T3', reviewer_name: 'Penguji C', rating: '5', review_text: '', review_date_raw: 'setahun lalu', review_date_precision: 'year' },
  { review_id: 'T4', reviewer_name: 'Penguji D', rating: '4', review_text: 'TEST: "friendly staff", comfy 😊', review_date: '2026-09-01', review_date_precision: 'exact', review_language: 'en', owner_response: 'Terima kasih (TEST)' },
];

test('Google Reviews CSV import against the database', { skip: !ENABLED && 'set GOOGLE_REVIEWS_IT=1 to run' }, async (t) => {
  const { default: app } = await import('../src/app.js');
  const { default: pool } = await import('../src/config/db.js');
  const { signToken } = await import('../src/utils/jwt.js');
  const llm = await import('../src/services/googleReviews/llm.js');

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/google-reviews`;
  const made = { users: [], brands: [] };
  const mkBrand = async (name) => {
    const { rows } = await pool.query('INSERT INTO public.brands (brand_name) VALUES ($1) RETURNING brand_id', [`${tag}_${name}`]);
    made.brands.push(rows[0].brand_id);
    return rows[0].brand_id;
  };
  const mkUser = async (name, role, { brands = [], viewOnly = false } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO public.users (email, password_hash, full_name, role, is_view_only) VALUES ($1, 'x', $2, $3::user_role, $4) RETURNING user_id`,
      [`${tag}_${name}@test.invalid`, `${name} (TEST)`, role, viewOnly],
    );
    const id = rows[0].user_id;
    made.users.push(id);
    for (const b of brands) await pool.query('INSERT INTO public.user_brand_access (user_id, brand_id) VALUES ($1, $2)', [id, b]);
    return signToken({ userId: id, role, isViewOnly: viewOnly });
  };
  const call = async (token, method, p, body) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + p, { method, headers, body: payload });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const upload = (token, text, name = 'ATLAS_GoogleReviews_TEST.csv') => {
    const fd = new FormData();
    fd.append('file', new Blob([text], { type: 'text/csv' }), name);
    return call(token, 'POST', '/imports/preview', fd);
  };
  const drive = async (token, run) => {
    let r = run;
    for (let i = 0; i < 20 && r?.status === 'running'; i += 1) r = (await call(token, 'POST', `/runs/${r.id}/step`)).body.run;
    return r;
  };
  const counter = { reviews: 0, fail: false };
  const model = async ({ task, prompt }) => {
    if (counter.fail) throw Object.assign(new Error('model down (TEST)'), { statusCode: 502 });
    if (task === 'classify') {
      const lines = prompt.split('\n').slice(1).map((l) => JSON.parse(l));
      counter.reviews += lines.length;
      return { model: 'test-model', data: { results: lines.map((r) => ({
        id: r.id, sentiment: r.stars >= 4 ? 'positive' : 'negative', confidence: 0.9, language: 'id',
        praises: r.stars >= 4 ? ['pelayanan ramah'] : [], complaints: r.stars >= 4 ? [] : ['waktu tunggu lama'],
      })) } };
    }
    return { model: 'test-model', data: {
      topics: [{ name: 'Pelayanan', aspects: ['pelayanan ramah', 'waktu tunggu lama'], insight: 'i' }],
      love: [], improve: [], executive: { overall: 'o', strengths: [], complaints: [], trend: 't', actions: [], limitations: [] },
    } };
  };

  try {
    const brandA = await mkBrand('A');
    const brandB = await mkBrand('B');
    const admin = await mkUser('free', 'user');
    const limited = await mkUser('limited', 'user', { brands: [brandA] });
    const client = await mkUser('client', 'client');
    const viewer = await mkUser('viewer', 'user', { viewOnly: true });
    let businessId;

    await t.test('access: no token, no module, view-only', async () => {
      assert.equal((await call(null, 'GET', '/imports')).status, 401);
      assert.equal((await call(client, 'GET', '/imports')).status, 403);
      assert.equal((await upload(viewer, csv(ROWS))).status, 403);
    });

    await t.test('bad files are refused with a reason', async () => {
      const wrong = await upload(admin, 'nama,bintang\nA,5\n');
      assert.equal(wrong.status, 400);
      assert.match(wrong.body.message, /business_name, rating, review_text/);
      assert.equal((await upload(admin, csv(ROWS), 'reviews.txt')).status, 400);
      const allBad = await upload(admin, csv([{ review_id: 'X', rating: '9', review_text: 'x' }]));
      assert.equal(allBad.status, 400);
      assert.equal(allBad.body.details.issues[0].column, 'rating');
    });

    await t.test('preview, then confirm: imported; nothing is analysed until the user runs it', async () => {
      llm.setModelForTests(null);
      const pre = await upload(admin, csv(ROWS));
      assert.equal(pre.status, 201, JSON.stringify(pre.body));
      const p = pre.body.import;
      assert.equal(p.validRows, 4);
      assert.equal(p.ratingOnlyRows, 1);
      assert.equal(p.needsMapping, false);
      assert.equal(p.matchedBusiness, null);
      assert.equal(p.fromExporter, true);
      const conf = await call(admin, 'POST', `/imports/${p.id}/confirm`, {});
      assert.equal(conf.status, 200, JSON.stringify(conf.body));
      assert.equal(conf.body.import.newReviews, 4);
      assert.equal(conf.body.import.analysis, 'not_run');
      assert.equal(conf.body.import.run, null);
      businessId = conf.body.import.businessId;
      const d = (await call(admin, 'GET', `/businesses/${businessId}/dashboard`)).body;
      assert.equal(d.dataSource.kind, 'csv');
      assert.equal(d.dataSource.analysis.status, 'not_run');
      assert.equal(d.analysis.method, 'code', 'code-based is the default view');
      const ai = (await call(admin, 'GET', `/businesses/${businessId}/dashboard?method=ai`)).body;
      assert.equal(ai.dataSource.analysis.status, 'unavailable', 'AI without a key: unavailable, not faked');
      assert.equal((await call(admin, 'POST', `/businesses/${businessId}/analysis`, { method: 'ai' })).status, 400);
      assert.equal(d.coverage.collected, 4);
      assert.equal(d.coverage.googleTotal, 20);
      assert.equal(d.coverage.limited, true, '4 of 20 is not the full set');
      assert.equal(d.sentiment.analyzed, 0, 'no insight without a model');
      assert.equal(d.summary, null);
      const { rows } = await pool.query("SELECT text FROM public.gr_reviews WHERE business_id = $1 AND external_id = 'T2'", [businessId]);
      assert.equal(rows[0].text, 'TEST: antri lama sekali\nharga mahal', 'line breaks kept');
    });

    await t.test('the same file again changes nothing', async () => {
      const p = (await upload(admin, csv(ROWS))).body.import;
      assert.deepEqual(p.comparison, { newReviews: 0, mayUpdate: 0, existing: 4, unchanged: 4 });
      assert.ok(p.previouslyImportedAt);
      const c = (await call(admin, 'POST', `/imports/${p.id}/confirm`, {})).body.import;
      assert.deepEqual([c.newReviews, c.updatedReviews, c.unchangedReviews], [0, 0, 4]);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM public.gr_reviews WHERE business_id = $1', [businessId]);
      assert.equal(rows[0].n, 4);
      assert.equal((await call(admin, 'POST', `/imports/${p.id}/confirm`, {})).status, 409, 'a confirmed import cannot be confirmed twice');
    });

    await t.test('with a model: everything waiting is read once; an edited review alone is read again', async () => {
      llm.setModelForTests(model);
      const run = (await call(admin, 'POST', `/businesses/${businessId}/analysis`, { method: 'ai' })).body.run;
      assert.equal(run.method, 'ai');
      assert.equal((await drive(admin, run)).status, 'done');
      assert.equal(counter.reviews, 3, 'the rating-only review is never sent to the model');
      const edited = ROWS.map((r) => (r.review_id === 'T1' ? { ...r, review_text: 'TEST: pelayanan ramah, tempat bersih, diedit' } : r));
      const p = (await upload(admin, csv([...edited, { review_id: 'T5', rating: '1', review_text: 'TEST: kecewa' }]))).body.import;
      assert.deepEqual([p.comparison.newReviews, p.comparison.mayUpdate], [1, 1]);
      const c = (await call(admin, 'POST', `/imports/${p.id}/confirm`, {})).body.import;
      assert.deepEqual([c.newReviews, c.updatedReviews], [1, 1]);
      const again = (await call(admin, 'POST', `/businesses/${businessId}/analysis`, { method: 'ai' })).body.run;
      assert.equal((await drive(admin, again)).status, 'done');
      assert.equal(counter.reviews, 5, 'only the new and the edited review');
      const d = (await call(admin, 'GET', `/businesses/${businessId}/dashboard?method=ai`)).body;
      assert.deepEqual(d.sentiment.items.map((i) => i.count), [2, 0, 2], 'T1, T4 positive; T2, T5 negative; T3 has no text');
      assert.equal(d.sentiment.ratingOnly, 1);
      assert.equal(Math.round(d.sentiment.items.reduce((a, i) => a + i.pct, 0) * 10), 1000);
      assert.deepEqual(d.ratings.items.map((i) => i.count), [2, 1, 0, 1, 1], 'all five reviews in the rating chart, rating-only included');
      assert.equal(d.dataSource.analysis.status, 'done');
      assert.equal(d.topics[0].count, 4, 'four text reviews carry an aspect');
    });

    await t.test('a failing model leaves the import intact; retry finishes it', async () => {
      counter.fail = true;
      const p = (await upload(admin, csv([...ROWS, { review_id: 'T6', rating: '5', review_text: 'TEST: baru' }]))).body.import;
      const c = (await call(admin, 'POST', `/imports/${p.id}/confirm`, {})).body.import;
      assert.equal(c.status, 'imported');
      const started = (await call(admin, 'POST', `/businesses/${businessId}/analysis`, { method: 'ai' })).body.run;
      const failed = await drive(admin, started);
      assert.equal(failed.status, 'failed');
      assert.match(failed.error, /model down/);
      let d = (await call(admin, 'GET', `/businesses/${businessId}/dashboard?method=ai`)).body;
      assert.equal(d.coverage.collected, 6);
      assert.equal(d.dataSource.analysis.status, 'pending');
      counter.fail = false;
      const retry = (await call(admin, 'POST', `/businesses/${businessId}/analysis`, { method: 'ai' })).body.run;
      assert.equal((await drive(admin, retry)).status, 'done');
      d = (await call(admin, 'GET', `/businesses/${businessId}/dashboard?method=ai`)).body;
      assert.equal(d.dataSource.analysis.status, 'done');
    });

    await t.test('two confirms of the same reviews at once: no duplicates', async () => {
      const extra = [{ review_id: 'T7', rating: '4', review_text: 'TEST: paralel' }, { review_id: 'T8', rating: '3', review_text: 'TEST: paralel 2' }];
      const a = (await upload(admin, csv([...ROWS, ...extra]))).body.import;
      const b = (await upload(admin, csv([...ROWS, ...extra]))).body.import;
      const [ra, rb] = await Promise.all([
        call(admin, 'POST', `/imports/${a.id}/confirm`, {}), call(admin, 'POST', `/imports/${b.id}/confirm`, {}),
      ]);
      assert.equal(ra.status, 200);
      assert.equal(rb.status, 200);
      assert.equal(ra.body.import.newReviews + rb.body.import.newReviews, 2);
      const { rows } = await pool.query('SELECT count(*)::int AS n, count(DISTINCT external_id)::int AS u FROM public.gr_reviews WHERE business_id = $1', [businessId]);
      assert.equal(rows[0].n, 8);
      assert.equal(rows[0].u, 8);
    });

    await t.test('brand access: hidden until linked to the account\'s brand', async () => {
      assert.equal((await call(limited, 'GET', `/businesses/${businessId}/dashboard`)).status, 404);
      assert.ok(!(await call(limited, 'GET', '/businesses')).body.businesses.some((b) => b.id === businessId));
      assert.equal((await call(limited, 'PATCH', `/businesses/${businessId}/brand`, { brandId: brandA })).status, 404, 'cannot claim what it cannot see');
      assert.equal((await call(admin, 'PATCH', `/businesses/${businessId}/brand`, { brandId: brandA })).status, 200);
      assert.equal((await call(limited, 'GET', `/businesses/${businessId}/dashboard`)).status, 200);
      assert.equal((await call(limited, 'PATCH', `/businesses/${businessId}/brand`, { brandId: brandB })).status, 403);
      // A file for that business uploaded by the limited account matches it.
      const p = (await upload(limited, csv(ROWS))).body.import;
      assert.equal(p.matchedBusiness.id, businessId);
      // The limited account's imports list shows only what it may see.
      const list = (await call(limited, 'GET', '/imports')).body.imports;
      assert.ok(list.every((i) => i.businessId === businessId || i.businessId === null));
    });

    await t.test('a file without business_id must be mapped by the user', async () => {
      const text = 'business_name,rating,review_text\r\nKlinik Tanpa ID ' + tag + ' (TEST),5,TEST mantap\r\nKlinik Tanpa ID ' + tag + ' (TEST),2,TEST lama\r\n';
      const p = (await upload(admin, text, 'manual.csv')).body.import;
      assert.equal(p.needsMapping, true);
      assert.equal((await call(admin, 'POST', `/imports/${p.id}/confirm`, {})).status, 400);
      const p2 = (await upload(admin, text, 'manual.csv')).body.import;
      const c = (await call(admin, 'POST', `/imports/${p2.id}/confirm`, { createNew: true })).body.import;
      assert.equal(c.newReviews, 2);
      const p3 = (await upload(admin, text, 'manual.csv')).body.import;
      assert.ok(p3.candidates.some((x) => x.id === c.businessId), 'the business made from it is offered next time');
      const c3 = (await call(admin, 'POST', `/imports/${p3.id}/confirm`, { businessId: c.businessId })).body.import;
      assert.deepEqual([c3.newReviews, c3.unchangedReviews], [0, 2]);
      await pool.query('DELETE FROM public.gr_businesses WHERE id = $1', [c.businessId]);
      // A file that names another business cannot be poured into this one.
      const p4 = (await upload(admin, csv(ROWS, { business_id: `cid:${tag}_other` }))).body.import;
      assert.equal((await call(admin, 'POST', `/imports/${p4.id}/confirm`, { businessId })).status, 400);
      await call(admin, 'POST', `/imports/${p4.id}/cancel`);
    });

    await t.test('a larger file (3.000 rows) previews and imports', async () => {
      llm.setModelForTests(null);
      const many = Array.from({ length: 3000 }, (_, i) => ({ review_id: `L${i}`, rating: String((i % 5) + 1), review_text: i % 7 ? `TEST ulasan ${i}, dengan koma` : '', review_date_raw: `${(i % 11) + 1} bulan lalu` }));
      const t0 = Date.now();
      const p = (await upload(admin, csv(many, { business_id: `cid:${tag}_big`, business_name: `Big ${tag} (TEST)` }), 'big.csv')).body.import;
      assert.equal(p.validRows, 3000);
      const c = (await call(admin, 'POST', `/imports/${p.id}/confirm`, {})).body.import;
      assert.equal(c.newReviews, 3000);
      assert.ok(Date.now() - t0 < 30_000, `took ${Date.now() - t0} ms`);
    });

    await t.test('import history', async () => {
      const list = (await call(admin, 'GET', `/imports?businessId=${businessId}`)).body.imports;
      assert.ok(list.length >= 6);
      assert.ok(list.every((i) => ['imported', 'previewed', 'cancelled', 'failed', 'expired'].includes(i.status)));
      assert.ok(list.some((i) => i.createdBy === 'free (TEST)'));
    });
  } finally {
    llm.setModelForTests(null);
    await pool.query("DELETE FROM public.gr_businesses WHERE place_id LIKE $1 OR name LIKE $2", [`cid:${tag}%`, `%${tag}%`]);
    await pool.query('DELETE FROM public.gr_imports WHERE created_by = ANY($1)', [made.users]);
    await pool.query('DELETE FROM public.user_brand_access WHERE user_id = ANY($1)', [made.users]);
    await pool.query('DELETE FROM public.users WHERE user_id = ANY($1)', [made.users]);
    await pool.query('DELETE FROM public.brands WHERE brand_id = ANY($1)', [made.brands]);
    server.close();
    await pool.end();
  }
});
