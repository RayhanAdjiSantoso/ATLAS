// The extension's content script against a Google-Maps-shaped page (a TEST
// fixture built from the real markup's structure): business detection, the
// translate switch, "More", owner replies — and the bug where a rating-only
// review took its owner's reply as its own text.
// Opt-in (launches Chromium): GOOGLE_REVIEWS_IT=1 node --test test/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ENABLED = process.env.GOOGLE_REVIEWS_IT === '1';
const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../extensions/google-reviews-exporter');

const review = (id, name, stars, inner) => `
  <div class="jftiEf" aria-label="${name}" data-review-id="${id}">
    <div class="DU9Pgb"><span role="img" aria-label="${stars} bintang"></span><span class="rsqaWe">3 bulan lalu</span></div>
    ${inner}
  </div>`;
const ownerReply = (text) => `
  <div class="CDe7pd"><div><span>Tanggapan dari pemilik</span> <span>2 bulan lalu</span></div>
    <div class="wiI7pd" lang="id">${text}</div></div>`;

const PAGE = `<!doctype html><html><body>
  <h1>Klinik Fixture (TEST)</h1>
  <div class="F7nice"><span>4,5</span><span>(3)</span></div>
  <button data-item-id="address" aria-label="Alamat: Jl. Uji 1, Bandung"></button>
  <div role="tablist"><button role="tab" aria-label="Ulasan untuk Klinik Fixture (TEST)">Ulasan</button></div>
  <div id="list" style="height:300px; overflow-y:auto">
    ${review('R1', 'Penguji Satu', 5, `<div class="MyEned" lang="id" id="t1"><span class="wiI7pd">TEST: tempatnya nyaman … </span><button aria-label="Lihat lainnya" onclick="document.querySelector('#t1 .wiI7pd').textContent='TEST: tempatnya nyaman, terapisnya teliti.';this.remove()">Lainnya</button></div>${ownerReply('Terima kasih atas reviewnya! (TEST)')}`)}
    ${review('R2', 'Penguji Dua', 4, ownerReply('Terima kasih untuk reviewnya 😊 (TEST)'))}
    ${review('R3', 'Penguji Tiga', 2, `<div class="MyEned" lang="en" id="t3"><span class="wiI7pd">TEST: the wait was long</span></div>
      <button role="switch" aria-checked="true" onclick="document.querySelector('#t3 .wiI7pd').textContent='TEST: antrinya lama banget';document.querySelector('#t3').setAttribute('lang','id');this.setAttribute('aria-checked','false');this.textContent='Lihat terjemahan (Inggris)'">Diterjemahkan oleh Google · Lihat versi asli (Indonesia)</button>`)}
    <div style="height:600px"></div>
  </div>
</body></html>`;

test('extension content script on a Maps-shaped page', { skip: !ENABLED && 'set GOOGLE_REVIEWS_IT=1 to run' }, async () => {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://www.google.com/maps**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }));
    // A stand-in for the extension runtime: the content script registers its
    // listener here and the test calls it like the popup would.
    await page.addInitScript(() => {
      window.chrome = { runtime: { onMessage: { addListener: (fn) => { window.__atlasListener = fn; } } } };
    });
    await page.goto('https://www.google.com/maps?cid=4242&hl=id');
    for (const f of ['lib/core.js', 'content.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(EXT, f), 'utf8') });
    const send = (msg) => page.evaluate((m) => new Promise((resolve) => window.__atlasListener(m, {}, resolve)), msg);

    const idle = await send({ type: 'atlas-gr:state' });
    assert.deepEqual(
      { name: idle.business.name, key: idle.business.key, total: idle.business.total, rating: idle.business.rating, address: idle.business.address },
      { name: 'Klinik Fixture (TEST)', key: 'cid:4242', total: 3, rating: 4.5, address: 'Jl. Uji 1, Bandung' },
    );
    await send({ type: 'atlas-gr:start', max: 100 });
    let st;
    for (let i = 0; i < 40; i += 1) {
      st = await send({ type: 'atlas-gr:state' });
      if (st.status !== 'collecting') break;
      await page.waitForTimeout(500);
    }
    assert.equal(st.status, 'completed', st.message);
    assert.deepEqual([st.collected, st.withText, st.withoutText, st.duplicates], [3, 2, 1, 0]);

    const out = await send({ type: 'atlas-gr:export' });
    const byId = Object.fromEntries(out.reviews.map((r) => [r.id, r]));
    assert.equal(byId.R1.text.trim(), 'TEST: tempatnya nyaman, terapisnya teliti.', '"Lainnya" opened before reading');
    assert.match(byId.R1.ownerBlock, /Terima kasih atas reviewnya/);
    assert.equal(byId.R2.text, '', 'a rating-only review never takes the owner reply as its text');
    assert.match(byId.R2.ownerBlock, /Terima kasih untuk reviewnya/);
    assert.equal(byId.R3.text.trim(), 'TEST: antrinya lama banget', 'original text, not Google\'s translation');
    assert.equal(byId.R3.lang, 'Indonesia');

    // Through the CSV writer: the reply lands in owner_response, not review_text.
    const csv = await page.evaluate((o) => window.AtlasGR.buildCsv(o.business, o.reviews, '2026-10-20T00:00:00Z'), out);
    const r2 = csv.split('\r\n').find((l) => l.includes(',R2,'));
    assert.match(r2, /,4,,3 bulan lalu,month,,,Terima kasih untuk reviewnya/, 'empty review_text, reply in owner_response');

    // Reset clears everything.
    const cleared = await send({ type: 'atlas-gr:reset' });
    assert.equal(cleared.collected, 0);
  } finally {
    await browser.close();
  }
});

// Overview tab open: a few review cards and "More reviews (N)" on screen,
// the full list only behind the Reviews tab. The extension must open it.
const card = (id, name, text) => `
  <div class="jftiEf" aria-label="${name}" data-review-id="${id}">
    <span role="img" aria-label="5 stars"></span><span class="rsqaWe">a month ago</span>
    <div class="MyEned" lang="en"><span class="wiI7pd">${text}</span></div>
  </div>`;
const LIST = [1, 2, 3, 4, 5, 6].map((n) => card(`L${n}`, `Tester ${n}`, `TEST review number ${n}, nice place`)).join('');
const OVERVIEW_PAGE = `<!doctype html><html><head><title>Store Fixture (TEST) - Google Maps</title></head><body>
  <h1>Store Fixture (TEST)</h1>
  <button data-item-id="address" aria-label="Address: Jl. Uji 2, Bandung"></button>
  <div class="F7nice"><span>4.7</span><span>(6)</span></div>
  <div role="tablist">
    <button role="tab" aria-selected="true" aria-label="Overview of Store Fixture (TEST)">Overview</button>
    <button role="tab" aria-selected="false" id="tab-reviews" aria-label="Reviews for Store Fixture (TEST)"
      onclick="this.setAttribute('aria-selected','true');document.querySelector('[role=tab]').setAttribute('aria-selected','false');
               document.getElementById('panel').innerHTML = window.__list;
               document.querySelector('h1').remove(); document.querySelector('.F7nice').remove();
               document.querySelector('[data-item-id=address]').remove();">Reviews</button>
  </div>
  <div id="panel" style="height:300px; overflow-y:auto">
    ${card('L1', 'Tester 1', 'TEST review number 1, nice place')}
    ${card('L2', 'Tester 2', 'TEST review number 2, nice place')}
    <button aria-label="Sort reviews">Sort</button>
    <button onclick="document.getElementById('tab-reviews').click()">More reviews (4)</button>
  </div>
  <script>window.__list = '<button aria-label="Sort reviews">Sort</button>' + ${JSON.stringify(LIST)} + '<div style="height:900px"></div>';</script>
</body></html>`;

test('extension opens the Reviews tab when Overview is showing', { skip: !ENABLED && 'set GOOGLE_REVIEWS_IT=1 to run' }, async () => {
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route('https://www.google.com/maps**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: OVERVIEW_PAGE }));
    await page.addInitScript(() => { window.chrome = { runtime: { onMessage: { addListener: (fn) => { window.__atlasListener = fn; } } } }; });
    await page.goto('https://www.google.com/maps/place/X/data=!4m6!3m5!1s0x2e68e6b7ba43d937:0xa5dadda0cfc021a9!8m2');
    for (const f of ['lib/core.js', 'content.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(EXT, f), 'utf8') });
    const send = (msg) => page.evaluate((m) => new Promise((resolve) => window.__atlasListener(m, {}, resolve)), msg);
    await send({ type: 'atlas-gr:start', max: 100 });
    let st;
    for (let i = 0; i < 40; i += 1) {
      st = await send({ type: 'atlas-gr:state' });
      if (st.status !== 'collecting') break;
      await page.waitForTimeout(500);
    }
    assert.equal(st.status, 'completed', st.message);
    assert.equal(st.collected, 6, 'all six from the list, not the two Overview cards');
    assert.equal(st.duplicates, 0, 'the Overview cards are the same reviews, not extra ones');
    assert.equal(await page.getAttribute('#tab-reviews', 'aria-selected'), 'true');
    assert.equal(st.business.key, 'cid:11951108243931013545');
    assert.equal(st.business.name, 'Store Fixture (TEST)', 'name kept although the Reviews tab has no heading');
    assert.equal(st.business.address, 'Jl. Uji 2, Bandung', 'details read on Overview are kept');
  } finally {
    await browser.close();
  }
});
