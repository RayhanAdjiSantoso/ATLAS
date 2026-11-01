import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenDraft, remapAssetIds, sniffImage, validateDraftBody } from '../src/services/presentationReportService.js';
import { buildPrompt, generateNarrative, normaliseNarrative, numbersIn, unmatchedNumbers, validateRequest } from '../src/services/presentationAiService.js';

const factNumbers = (lines) => lines.flatMap((l) => numbersIn(l).flatMap((n) => n.values));

test("a draft opens for its brand's team, never across brands, and not for clients", () => {
  const row = { brand_id: 5, created_by: 10 };
  assert.equal(canOpenDraft({ userId: 10, role: 'user', allowedBrandIds: [5] }, row), true);
  assert.equal(canOpenDraft({ userId: 11, role: 'user', allowedBrandIds: [5] }, row), true, 'a teammate on the same brand');
  assert.equal(canOpenDraft({ userId: 11, role: 'reviewer', allowedBrandIds: [5] }, row), true);
  assert.equal(canOpenDraft({ userId: 12, role: 'user', allowedBrandIds: null }, row), true, 'an unrestricted account opens any brand');
  assert.equal(canOpenDraft({ userId: 10, role: 'user', allowedBrandIds: [6] }, row), false, 'creator who lost the brand');
  assert.equal(canOpenDraft({ userId: 13, role: 'client', allowedBrandIds: [5] }, row), false, "a client does not see the team's drafts");
  assert.equal(canOpenDraft({ userId: 10, role: 'client', allowedBrandIds: [5] }, row), true, 'but does see its own');
  assert.equal(canOpenDraft({ userId: 99, role: 'admin', allowedBrandIds: null }, row), true);
  assert.equal(canOpenDraft({ userId: 99, role: 'admin', allowedBrandIds: [6] }, row), false, 'a brand-restricted admin stays restricted');
  assert.equal(canOpenDraft({ userId: 10, role: 'user' }, null), false);
});

test('draft bodies need a name and a document', () => {
  assert.ok(validateDraftBody({ name: 'x' }));
  assert.ok(validateDraftBody({ name: ' ', document: {} }));
  assert.ok(validateDraftBody({ name: 'x', document: [] }));
  assert.ok(validateDraftBody({ name: 'x', document: {}, snapshot: 'no' }));
  assert.equal(validateDraftBody({ name: 'x', document: {} }), null);
  assert.equal(validateDraftBody({ name: 'x', document: {}, snapshot: null }), null);
});

test('images are identified by their bytes, and SVG is refused', () => {
  const pad = Buffer.alloc(12);
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), pad])), 'image/jpeg');
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad])), 'image/png');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'image/webp');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
  assert.equal(sniffImage(Buffer.from('short')), null);
});

test('duplicating remaps image references at any depth', () => {
  const doc = { slides: [{ supporting: { images: [{ assetId: 7, caption: 'a' }, { assetId: 8 }] } }], other: 7 };
  const out = remapAssetIds(doc, { 7: 70 });
  assert.equal(out.slides[0].supporting.images[0].assetId, 70);
  assert.equal(out.slides[0].supporting.images[1].assetId, 8, 'an unknown id stays');
  assert.equal(out.other, 7, 'only assetId fields change');
});

test('AI numbers must trace back to the facts', () => {
  const facts = factNumbers(['Spend: current Rp19,938,018, change +4.92%', 'ROAS 3.40x', 'Omzet Rp1.234.567']);
  assert.deepEqual(unmatchedNumbers('Spend naik 4,92% menjadi Rp19,9 jt dengan ROAS 3,4x', facts), []);
  assert.deepEqual(unmatchedNumbers('Spend of Rp19.9M grew 4.92%', facts), []);
  assert.deepEqual(unmatchedNumbers('Omzet mencapai Rp1.234.567', facts), []);
  assert.deepEqual(unmatchedNumbers('Sales grew 37%', facts), ['37']);
  assert.deepEqual(unmatchedNumbers('CTR naik 12%', facts), ['12'], 'a small number with a unit is still a claim');
  assert.deepEqual(unmatchedNumbers('Rp500 jt lost', facts), ['500 jt']);
  assert.deepEqual(unmatchedNumbers('Pada 2026, 3 channel dan Top 5 produk', facts), [], 'years and small counts are not claims');
});

test('normalising keeps requested fields, tags points, and reports unsupported numbers', () => {
  const raw = {
    headline: 'Spend naik 4,92%',
    findings: [{ text: 'Spend naik 4,92%', kind: 'fact' }, { text: 'Revenue naik 99%', kind: 'nonsense' }, { text: '  ', kind: 'fact' }],
    insights: [{ text: 'not requested', kind: 'fact' }],
    actions: [{ action: 'Uji creative', priority: 'Urgent', owner: 'Someone' }],
  };
  const { suggestions, warnings } = normaliseNarrative(raw, ['headline', 'findings', 'actions'], ['Spend change +4.92%']);
  assert.equal(suggestions.headline, 'Spend naik 4,92%');
  assert.equal(suggestions.insights, undefined);
  assert.equal(suggestions.findings.length, 2);
  assert.equal(suggestions.findings[1].kind, 'hypothesis', 'an unknown kind is not presented as fact');
  assert.deepEqual(suggestions.actions[0], { action: 'Uji creative', priority: 'Medium', owner: 'MIL Digital' });
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0].unmatched, ['99']);
});

test('generation needs facts and known options, and never needs a provider to validate', () => {
  const ok = { fields: ['findings'], lang: 'id', tone: 'concise', facts: ['a'] };
  assert.equal(validateRequest(ok), null);
  assert.ok(validateRequest({ ...ok, facts: [] }), 'no data, no draft');
  assert.ok(validateRequest({ ...ok, fields: ['poem'] }));
  assert.ok(validateRequest({ ...ok, lang: 'fr' }));
  assert.ok(validateRequest({ ...ok, tone: 'funny' }));
});

test('the prompt carries facts, context and the do-not-repeat list', async () => {
  let seen = '';
  const out = await generateNarrative(
    { brandId: 1, brandName: 'Brand', lang: 'en', tone: 'analytical', fields: ['findings'], facts: ['Spend: Rp100'], rootCause: ['Traffic down'], context: 'Payday promo ended', otherNarratives: ['Already said'], slideTitle: 'S', period: 'Sep vs Aug' },
    { getProfile: async () => null, request: async (prompt) => { seen = prompt; return { parsed: { findings: [{ text: 'Spend was Rp100', kind: 'fact' }] }, model: 'test' }; } },
  );
  assert.match(seen, /Spend: Rp100/);
  assert.match(seen, /Payday promo ended/);
  assert.match(seen, /Already said/);
  assert.match(seen, /Traffic down/);
  assert.equal(out.model, 'test');
  assert.deepEqual(out.warnings, []);
  assert.equal(buildPrompt({ brandName: 'B', lang: 'id', tone: 'concise', fields: ['headline'], facts: ['x'] }).includes('KONTEKS PENGGUNA'), false);
});
