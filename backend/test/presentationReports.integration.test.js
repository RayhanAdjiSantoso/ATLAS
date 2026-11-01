// Integration test for Presentation Report drafts through HTTP and the real
// database: ownership, brand isolation, revision conflicts, image rules.
// Opt-in: PRESENTATION_IT=1 node --test test/
// Creates throw-away brands and accounts and deletes them after.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const ENABLED = process.env.PRESENTATION_IT === '1';
const tag = `__itpr_${crypto.randomBytes(3).toString('hex')}`;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

test('Presentation Report drafts against the database', { skip: !ENABLED && 'set PRESENTATION_IT=1 to run' }, async (t) => {
  const { default: app } = await import('../src/app.js');
  const { default: pool } = await import('../src/config/db.js');
  const { signToken } = await import('../src/utils/jwt.js');

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/report-generator/presentations`;
  const made = { users: [], brands: [] };

  const brand = async (suffix) => {
    const { rows } = await pool.query('INSERT INTO public.brands (brand_name) VALUES ($1) RETURNING brand_id', [`${tag}_${suffix}`]);
    made.brands.push(rows[0].brand_id);
    return rows[0].brand_id;
  };
  const user = async (suffix, role, brands = [], viewOnly = false) => {
    const { rows } = await pool.query(
      `INSERT INTO public.users (email, password_hash, full_name, role, is_view_only) VALUES ($1, 'x', $2, $3::user_role, $4) RETURNING user_id`,
      [`${tag}_${suffix}@test.invalid`, `${tag} ${suffix}`, role, viewOnly],
    );
    const id = rows[0].user_id;
    made.users.push(id);
    for (const b of brands) await pool.query('INSERT INTO public.user_brand_access (user_id, brand_id) VALUES ($1, $2)', [id, b]);
    return signToken({ userId: id, role, isViewOnly: viewOnly });
  };
  const call = async (token, method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json };
  };
  const doc = (brandId) => ({
    templateVersion: 1,
    config: { brandId, period: { curStart: '2026-09-01', curEnd: '2026-09-30', oldStart: '2026-08-01', oldEnd: '2026-08-31' }, channels: { meta: { enabled: true }, shopee: { enabled: false } } },
    sections: [], slides: [],
  });

  try {
    const brandA = await brand('a');
    const brandB = await brand('b');
    const admin = await user('admin', 'admin');
    const ownerA = await user('owner', 'user', [brandA]);
    const otherA = await user('other', 'user', [brandA]);
    const onlyB = await user('onlyb', 'user', [brandB]);
    const viewer = await user('viewer', 'user', [brandA], true);
    const clientA = await user('client', 'client', [brandA]);

    let draftId;
    let revision;

    await t.test('needs a login', async () => {
      const res = await fetch(`${base}?client_id=${brandA}`);
      assert.equal(res.status, 401);
    });

    await t.test('creates a draft and stores its period and channels', async () => {
      const res = await call(ownerA, 'POST', '', { client_id: brandA, name: 'Sep', document: doc(brandA), snapshot: { blocks: { a: 1 } } });
      assert.equal(res.status, 201);
      draftId = res.body.id;
      revision = res.body.revision;
      const row = await call(ownerA, 'GET', `/${draftId}`);
      assert.equal(row.status, 200);
      assert.equal(row.body.period_cur_end, '2026-09-30');
      assert.deepEqual(row.body.channels, ['meta']);
      assert.deepEqual(row.body.snapshot, { blocks: { a: 1 } });
    });

    await t.test('cannot create for a brand outside the account', async () => {
      const res = await call(onlyB, 'POST', '', { client_id: brandA, name: 'x', document: doc(brandA) });
      assert.equal(res.status, 403);
    });

    await t.test('a view-only account cannot write', async () => {
      const res = await call(viewer, 'POST', '', { client_id: brandA, name: 'x', document: doc(brandA) });
      assert.equal(res.status, 403);
    });

    await t.test("a brand's team shares a draft; other brands do not see it", async () => {
      assert.equal((await call(otherA, 'GET', `/${draftId}`)).status, 200, 'same brand, other user');
      assert.equal((await call(onlyB, 'GET', `/${draftId}`)).status, 404, 'other brand');
      assert.equal((await call(onlyB, 'PUT', `/${draftId}`, { name: 'x', document: doc(brandA), baseRevision: revision })).status, 404);
      assert.equal((await call(onlyB, 'DELETE', `/${draftId}`)).status, 404);
      assert.equal((await call(onlyB, 'POST', `/${draftId}/duplicate`)).status, 404);
      assert.equal((await call(otherA, 'GET', `?client_id=${brandA}`)).body.drafts.length, 1);
      assert.equal((await call(onlyB, 'GET', `?client_id=${brandA}`)).status, 403);
      assert.equal((await call(ownerA, 'GET', `?client_id=${brandA}`)).body.drafts.length, 1);
      assert.equal((await call(admin, 'GET', `/${draftId}`)).status, 200, 'an unrestricted admin can open it');
    });

    await t.test('a client account on the brand cannot read internal drafts', async () => {
      // Refused here by the module; canOpenDraft also refuses should Pengaturan
      // Akses ever give clients this module (see presentationReports.test.js).
      assert.notEqual((await call(clientA, 'GET', `/${draftId}`)).status, 200);
      assert.notEqual((await call(clientA, 'GET', `?client_id=${brandA}`)).status, 200);
    });

    await t.test('a teammate can continue the draft, and is recorded as its last editor', async () => {
      const saved = await call(otherA, 'PUT', `/${draftId}`, { name: 'Sep', document: doc(brandA), baseRevision: revision });
      assert.equal(saved.status, 200);
      revision = saved.body.revision;
      const listed = (await call(ownerA, 'GET', `?client_id=${brandA}`)).body.drafts[0];
      assert.match(listed.updated_by_name, /other$/);
      assert.match(listed.created_by_name, /owner$/);
    });

    await t.test('a save needs the current revision and keeps the snapshot unless sent', async () => {
      const saved = await call(ownerA, 'PUT', `/${draftId}`, { name: 'Sep v2', document: doc(brandA), baseRevision: revision });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.revision, revision + 1);
      const stale = await call(ownerA, 'PUT', `/${draftId}`, { name: 'old tab', document: doc(brandA), baseRevision: revision });
      assert.equal(stale.status, 409);
      const row = await call(ownerA, 'GET', `/${draftId}`);
      assert.equal(row.body.name, 'Sep v2');
      assert.deepEqual(row.body.snapshot, { blocks: { a: 1 } });
      revision = row.body.revision;
    });

    await t.test('a large document fits the route limit', async () => {
      const big = { ...doc(brandA), padding: 'x'.repeat(1024 * 1024) };
      const res = await call(ownerA, 'PUT', `/${draftId}`, { name: 'Sep v2', document: big, baseRevision: revision });
      assert.equal(res.status, 200);
      revision = res.body.revision;
    });

    const upload = async (token, bytes, type = 'image/png') => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type }), 'a.png');
      const res = await fetch(`${base}/${draftId}/assets`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      return { status: res.status, body: await res.json().catch(() => null) };
    };

    let assetId;
    await t.test('images: real ones are kept, and only for those who may open the draft', async () => {
      const ok = await upload(ownerA, PNG);
      assert.equal(ok.status, 201);
      assetId = ok.body.assetId;
      assert.equal((await upload(ownerA, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'image/png')).status, 415);
      assert.equal((await upload(onlyB, PNG)).status, 404);
      const read = await fetch(`${base}/${draftId}/assets/${assetId}`, { headers: { Authorization: `Bearer ${ownerA}` } });
      assert.equal(read.status, 200);
      assert.equal(read.headers.get('content-type'), 'image/png');
      assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
      const denied = await fetch(`${base}/${draftId}/assets/${assetId}`, { headers: { Authorization: `Bearer ${onlyB}` } });
      assert.equal(denied.status, 404);
    });

    await t.test('duplicating copies images under the new draft', async () => {
      const withImage = { ...doc(brandA), slides: [{ supporting: { images: [{ assetId }] } }] };
      const saved = await call(ownerA, 'PUT', `/${draftId}`, { name: 'Sep v2', document: withImage, baseRevision: revision });
      assert.equal(saved.status, 200);
      const dup = await call(ownerA, 'POST', `/${draftId}/duplicate`);
      assert.equal(dup.status, 201);
      const copy = await call(ownerA, 'GET', `/${dup.body.id}`);
      const newId = copy.body.document.slides[0].supporting.images[0].assetId;
      assert.notEqual(newId, assetId);
      const read = await fetch(`${base}/${dup.body.id}/assets/${newId}`, { headers: { Authorization: `Bearer ${ownerA}` } });
      assert.equal(read.status, 200);
      assert.equal((await call(ownerA, 'DELETE', `/${dup.body.id}`)).status, 204);
    });

    await t.test('AI without a key reports unavailable and refuses cleanly', async () => {
      const status = await call(ownerA, 'GET', '/ai/status');
      assert.equal(status.status, 200);
      assert.equal(typeof status.body.available, 'boolean');
      const noFacts = await call(ownerA, 'POST', '/ai/generate', { client_id: brandA, lang: 'id', tone: 'concise', fields: ['findings'], facts: [] });
      assert.equal(noFacts.status, 400);
      const otherBrand = await call(onlyB, 'POST', '/ai/generate', { client_id: brandA, lang: 'id', tone: 'concise', fields: ['findings'], facts: ['x'] });
      assert.equal(otherBrand.status, 403);
    });

    await t.test('a draft holds a brand back from a plain delete', async () => {
      const { getBrandReferences } = await import('../src/services/brandService.js');
      const refs = await getBrandReferences(brandA);
      assert.ok(refs.blocking.some((b) => b.label === 'Draft Presentation Report'));
    });

    await t.test('deleting removes the draft and its images', async () => {
      assert.equal((await call(ownerA, 'DELETE', `/${draftId}`)).status, 204);
      assert.equal((await call(ownerA, 'GET', `/${draftId}`)).status, 404);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM ads_reports.presentation_assets WHERE report_id = $1', [draftId]);
      assert.equal(rows[0].n, 0);
    });
  } finally {
    await pool.query('DELETE FROM ads_reports.presentation_reports WHERE brand_id = ANY($1::int[])', [made.brands]);
    await pool.query('DELETE FROM public.user_brand_access WHERE user_id = ANY($1::int[])', [made.users]);
    await pool.query('DELETE FROM public.users WHERE user_id = ANY($1::int[])', [made.users]);
    await pool.query('DELETE FROM public.brands WHERE brand_id = ANY($1::int[])', [made.brands]);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
