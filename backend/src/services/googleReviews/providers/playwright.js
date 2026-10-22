import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  normaliseReview, parseCount, parseRatingValue, placeKeyFromUrl, placeUrl,
} from './googleMapsParse.js';

// Google Reviews › an EXPERIMENTAL source for local development: a real
// browser (Playwright) opens the business's Google Maps page and reads its
// reviews. Enabled with GOOGLE_REVIEWS_PROVIDER=playwright.
//
// Signed out (tested 2026-10-19), Google Maps shows a "limited view": about
// five "most relevant" reviews, no sorting, no further pages. Signed in, the
// whole list can be sorted newest-first and scrolled. Signing in is done by
// the account owner, by hand, once, in a normal Chrome window
// (`npm run google-reviews:login`); the session lives in a browser profile
// outside the repository (GR_PLAYWRIGHT_PROFILE_DIR) and is reused here.
// ATLAS never sees or types a password.
//
// What it does not do, by design: solve or avoid a CAPTCHA, rotate proxies or
// disguise the browser. A CAPTCHA, a consent wall or a sign-in prompt ends
// the run with a clear message instead of a retry.
//
// Never on Vercel: a serverless function has no browser, no profile and 60
// seconds.

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

export const DEFAULT_PROFILE_DIR = path.join(os.homedir(), '.atlas', 'google-maps-profile');
export const profileDir = () => path.resolve(env('GR_PLAYWRIGHT_PROFILE_DIR', DEFAULT_PROFILE_DIR));

export class SourceBlockedError extends Error {
  constructor(message) {
    super(message);
    this.statusCode = 503;
    // Retrying a block only asks again for the same refusal.
    this.fatal = true;
  }
}

// Google's session cookies: present once someone signed in in this profile.
export const isSignedIn = (cookies) => cookies.some((c) => /(^|\.)google\.com$/.test(c.domain.replace(/^\./, '')) && /^(SID|__Secure-1PSID|__Secure-3PSID)$/.test(c.name));

export function createPlaywrightProvider() {
  const cfg = {
    headless: env('GR_PLAYWRIGHT_HEADLESS', 'false') === 'true',
    channel: env('GR_PLAYWRIGHT_CHANNEL', undefined),
    maxReviews: Math.max(1, Number(env('GR_PLAYWRIGHT_MAX_REVIEWS', 500))),
    // One step of scrolling; the run calls again for the next.
    pageMs: Math.max(5_000, Number(env('GR_PLAYWRIGHT_PAGE_MS', 20_000))),
    timeoutMs: Math.max(10_000, Number(env('GR_PLAYWRIGHT_TIMEOUT_MS', 60_000))),
    minIntervalMs: Math.max(1000, Number(env('GR_PLAYWRIGHT_MIN_INTERVAL_MS', 5000))),
    idleCloseMs: 120_000,
    retentionDays: Number(env('GR_PLAYWRIGHT_RETENTION_DAYS', 30)) || null,
    maxResults: 8,
    // The interface language. Google gives a "More" button only to reviews in
    // the interface's language; in another language it shows its own
    // translation in full and only a snippet of the original. 'id' suits
    // businesses in Indonesia (most reviews Indonesian, others shown in their
    // original language by default).
    lang: env('GR_PLAYWRIGHT_LANG', 'id'),
  };
  const LOCALE = { id: 'id-ID', en: 'en-US' }[cfg.lang] ?? cfg.lang;

  /* ── One browser, one profile, one thing at a time ─────────────────── */

  let context = null;
  let signedIn = null; // unknown until the browser has opened once
  let idleTimer = null;
  const sessions = new Map(); // placeKey -> { page, returned: Set, startedAt }

  async function closeAll() {
    clearTimeout(idleTimer);
    sessions.clear();
    const c = context;
    context = null;
    await c?.close().catch(() => {});
  }
  const touch = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { closeAll(); }, cfg.idleCloseMs);
    idleTimer.unref?.();
  };

  async function getContext(onProgress) {
    if (context) return context;
    if (process.env.VERCEL) throw new SourceBlockedError('Sumber Playwright hanya untuk development lokal dan tidak dijalankan di Vercel.');
    onProgress?.('init');
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      throw new SourceBlockedError('Playwright belum terpasang. Jalankan "npm install" di folder backend, lalu "npx playwright install chromium" (atau set GR_PLAYWRIGHT_CHANNEL=chrome).');
    }
    const dir = profileDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      context = await chromium.launchPersistentContext(dir, {
        headless: cfg.headless, channel: cfg.channel, locale: LOCALE, viewport: { width: 1280, height: 900 },
      });
    } catch (err) {
      const first = String(err.message).split('\n')[0];
      throw new SourceBlockedError(/ProcessSingleton|SingletonLock|already in use/i.test(err.message)
        ? 'Profil browser Google Reviews sedang dipakai jendela lain (mis. jendela login). Tutup jendela itu lalu coba lagi.'
        : `Browser tidak bisa dijalankan: ${first}`);
    }
    context.on('close', () => { context = null; sessions.clear(); });
    signedIn = isSignedIn(await context.cookies('https://www.google.com'));
    return context;
  }

  let queue = Promise.resolve();
  let lastNavigation = 0;
  // Serialised, with a pause before every new page load: a person-paced look
  // at a few pages, not a crawler. Scrolling an open list is not a new load.
  const exclusive = (fn, { navigates = true } = {}) => {
    const run = queue.then(async () => {
      if (navigates) {
        const wait = lastNavigation + cfg.minIntervalMs - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      let timer;
      try {
        return await Promise.race([
          fn(),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              reject(Object.assign(new Error(`Waktu pengambilan habis (${Math.round(cfg.timeoutMs / 1000)} detik).`), { statusCode: 504 }));
              closeAll();
            }, cfg.timeoutMs);
          }),
        ]);
      } catch (err) {
        // A failed visit leaves nothing half-open behind it.
        await closeAll();
        throw err;
      } finally {
        clearTimeout(timer);
        if (navigates) lastNavigation = Date.now();
        if (context) touch();
      }
    });
    queue = run.catch(() => {});
    return run;
  };

  // Stop on anything that is Google declining the visit.
  async function guard(page) {
    const url = page.url();
    if (/\/sorry\//.test(url)) throw new SourceBlockedError('Google meminta verifikasi CAPTCHA ("unusual traffic"). Pengambilan dihentikan — coba lagi nanti; CAPTCHA tidak akan dilewati.');
    if (/consent\.google\./.test(url)) throw new SourceBlockedError('Google menampilkan halaman persetujuan cookie. Buka "npm run google-reviews:login", setujui di sana, lalu coba lagi.');
    if (/accounts\.google\./.test(url)) throw new SourceBlockedError('Google meminta login ulang. Jalankan "npm run google-reviews:login" di folder backend, login sendiri di jendela Chrome, lalu coba lagi.');
  }

  async function readPlace(page) {
    await page.waitForSelector('h1', { timeout: 20_000 });
    await guard(page);
    return page.evaluate(() => {
      const txt = (el) => el?.textContent?.trim() || null;
      const head = document.querySelector('div.F7nice');
      const countLabel = [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).find((a) => /^[\d.,]+\s+(reviews?|ulasan)$/i.test(a || ''));
      return {
        name: txt(document.querySelector('h1')),
        ratingText: head?.innerText ?? null,
        countText: countLabel ?? head?.innerText?.match(/\(([\d.,]+)\)/)?.[1] ?? null,
        category: txt(document.querySelector('button[jsaction*="category"]')),
        address: document.querySelector('[data-item-id="address"]')?.getAttribute('aria-label')?.replace(/^(Address|Alamat):\s*/i, '').trim() || null,
        limited: /limited view of Google Maps|tampilan terbatas/i.test(document.body.innerText),
      };
    });
  }

  const placeOut = (key, raw) => ({
    placeId: key,
    name: raw.name,
    address: raw.address,
    category: raw.category,
    rating: parseRatingValue(raw.ratingText),
    totalReviews: parseCount(raw.countText),
    mapsUrl: placeUrl(key, cfg.lang),
  });

  async function openPlace(page, key) {
    const url = placeUrl(key, cfg.lang);
    if (!url) throw new SourceBlockedError('ID bisnis ini bukan dari sumber Google Maps (Playwright).');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await guard(page);
    return readPlace(page);
  }

  async function withNewPage(fn, onProgress) {
    const ctx = await getContext(onProgress);
    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);
    try {
      return await fn(page);
    } finally {
      await page.close().catch(() => {});
    }
  }

  /* ── Reviews list ──────────────────────────────────────────────────── */

  // Open the reviews tab and, where Google offers it (signed in), sort it
  // newest first — so a refresh can stop at the first page it already has.
  async function openReviews(page) {
    const tab = page.getByRole('tab', { name: /reviews|ulasan/i });
    if (!(await tab.count())) {
      const limited = /limited view of Google Maps|tampilan terbatas/i.test(await page.locator('body').innerText());
      throw new SourceBlockedError(limited
        ? 'Google hanya menampilkan "limited view" tanpa tab ulasan. Login dulu dengan "npm run google-reviews:login" (di folder backend), atau jika GR_PLAYWRIGHT_HEADLESS=true coba false.'
        : 'Tab ulasan tidak ditemukan di halaman bisnis ini. Tata letak Google Maps mungkin berubah.');
    }
    await tab.first().click();
    await page.waitForSelector('div[data-review-id][aria-label]', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await guard(page);

    let sorted = false;
    const sortBtn = page.locator('button[aria-label*="Sort" i], button[aria-label*="Urutkan" i], button[data-value="Sort"], button[data-value="Urutkan"]').first();
    if (await sortBtn.count()) {
      await sortBtn.click().catch(() => {});
      const newest = page.getByRole('menuitemradio', { name: /newest|terbaru/i });
      await newest.first().waitFor({ timeout: 4000 }).catch(() => {});
      if (await newest.count()) {
        await newest.first().click();
        await page.waitForTimeout(2000);
        sorted = true;
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
    }
    await guard(page);
    return { sorted };
  }

  const EXTRACT = (els) => els.map((el) => {
    const stars = el.querySelector('[role="img"][aria-label*="star" i], [role="img"][aria-label*="bintang" i]');
    const dateEl = el.querySelector('.rsqaWe') ?? [...(stars?.parentElement?.querySelectorAll('span') ?? [])].find((s) => /ago|lalu|\d{4}/i.test(s.textContent));
    const owners = [...el.querySelectorAll('div')].filter((d) => /^(response from the owner|tanggapan dari pemilik)/i.test(d.innerText?.trim() ?? '') && d.innerText.includes('\n'));
    const owner = owners.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    // The review's own text, never the owner's reply (also a div[lang]).
    const outer = owners.at(-1);
    const body = [...el.querySelectorAll('div[lang], .MyEned')].find((d) => !(outer && outer.contains(d)) && !(owner && owner.contains(d))) ?? null;
    const unexpanded = [...el.querySelectorAll('button')].some((b) => /^(see more|more|lihat lainnya|lainnya)$/i.test(b.getAttribute('aria-label') || b.textContent.trim()));
    // Still showing Google's translation (the switch has not flipped yet).
    const translated = [...el.querySelectorAll('button[role="switch"]')].some((b) => b.getAttribute('aria-checked') === 'true' && /see original|lihat (teks |versi )?asli|tampilkan (teks )?asli/i.test(b.textContent));
    return {
      id: el.getAttribute('data-review-id'),
      reviewer: el.getAttribute('aria-label'),
      starsLabel: stars?.getAttribute('aria-label') ?? null,
      dateText: dateEl?.textContent ?? null,
      // With no expand button left, a closing " …" is Google's marker on a
      // complete text (checked against the reviewer's own profile page), not
      // the customer's words.
      text: body ? body.innerText.replace(/\s*(see more|more|lihat lainnya|lainnya)\s*$/i, '').trim().replace(/\s*…$/, '') : null,
      lang: el.dataset.atlasLang || body?.getAttribute('lang') || null,
      ownerBlock: owner?.innerText?.replace(/\s*(see more|more|lihat lainnya|lainnya)\s*$/i, '').trim() ?? null,
      unexpanded: unexpanded || translated,
    };
  });

  // Scroll for up to pageMs; return the reviews not returned before. A review
  // whose "More" has not opened yet waits for the next round, so its text is
  // never saved cut short.
  async function scrollSome(session, fetchedAt) {
    const { page, returned } = session;
    const fresh = new Map();
    const until = Date.now() + cfg.pageMs;
    let idle = 0;
    while (Date.now() < until && returned.size + fresh.size < cfg.maxReviews && idle < 4) {
      // Signed in, Google shows its own English translation of reviews in
      // other languages. The customer's own words are what is analysed, so
      // each one is switched back to the original ("See original (Indonesian)")
      // and its language noted, then truncated texts are opened ("More").
      await page.$$eval('div[data-review-id][aria-label]', (els) => els.forEach((el) => {
        const sw = [...el.querySelectorAll('button[role="switch"]')].find((b) => b.getAttribute('aria-checked') === 'true' && /see original|lihat (teks |versi )?asli|tampilkan (teks )?asli/i.test(b.textContent));
        if (!sw) return;
        const lang = sw.textContent.match(/\(([^)]+)\)\s*$/)?.[1];
        if (lang) el.dataset.atlasLang = lang;
        sw.click();
      }));
      await page.waitForTimeout(500);
      await page.$$eval('div[data-review-id][aria-label] button', (bs) => bs
        .filter((b) => /^(see more|more|lihat lainnya|lainnya)$/i.test(b.getAttribute('aria-label') || b.textContent.trim()))
        .forEach((b) => b.click()));
      await page.waitForTimeout(400);
      const batch = await page.$$eval('div[data-review-id][aria-label]', EXTRACT);
      const before = fresh.size;
      for (const r of batch) if (r.id && !returned.has(r.id) && !r.unexpanded) fresh.set(r.id, r);
      const atEnd = await page.evaluate(() => {
        let s = document.querySelector('div[data-review-id][aria-label]')?.parentElement;
        while (s && !(s.scrollHeight > s.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
        if (!s) return true;
        const bottom = s.scrollTop + s.clientHeight >= s.scrollHeight - 5;
        s.scrollTop += 1200;
        return bottom;
      });
      idle = fresh.size === before && atEnd ? idle + 1 : 0;
      await page.waitForTimeout(1200);
      await guard(page);
    }
    const reviews = [...fresh.values()].slice(0, cfg.maxReviews - returned.size).map((r) => normaliseReview(r, fetchedAt));
    for (const r of reviews) returned.add(r.externalId);
    const done = idle >= 4 || returned.size >= cfg.maxReviews;
    return { reviews, done };
  }

  async function endSession(key) {
    const s = sessions.get(key);
    sessions.delete(key);
    await s?.page.close().catch(() => {});
  }

  return {
    id: 'google_maps_playwright',
    label: 'Google Maps (Playwright, eksperimen lokal)',
    experimental: true,
    retentionDays: cfg.retentionDays,
    // Signed in, the list is complete; signed out, it is the limited view.
    get coverage() { return signedIn ? 'full' : 'limited'; },
    get coverageNote() {
      return signedIn
        ? 'Sumber eksperimen: Google Maps dengan akun Google yang login di profil browser lokal. Tanggal ulasan berupa perkiraan ("6 bulan lalu").'
        : 'Sumber eksperimen: tanpa login, Google Maps hanya menampilkan sebagian kecil ulasan (biasanya ±5 "paling relevan"). Tanggal ulasan berupa perkiraan ("6 bulan lalu").';
    },
    status: () => ({ signedIn, profileDir: profileDir() }),

    searchBusinesses: (query) => exclusive(() => withNewPage(async (page) => {
      await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=${cfg.lang}`, { waitUntil: 'domcontentloaded' });
      await guard(page);
      // Either a list of places, or Maps jumped straight to the one match.
      // (The search page carries an h1 of its own before the jump, so the
      // signal for "one match" is the URL, not a heading.)
      await Promise.race([
        page.waitForSelector('[role="feed"] a[href*="/maps/place/"]', { timeout: 20_000 }),
        page.waitForURL(/\/maps\/place\/.*!1s0x/, { timeout: 20_000 }),
      ]).catch(() => {});
      await guard(page);
      if (await page.locator('[role="feed"] a[href*="/maps/place/"]').count()) {
        const cards = await page.$$eval('[role="feed"] a[href*="/maps/place/"]', (as, max) => as.slice(0, max).map((a) => {
          const card = a.closest('[role="article"]') ?? a.parentElement;
          const lines = [...card.querySelectorAll('.W4Efsd')].map((d) => d.innerText.trim()).filter(Boolean);
          const info = lines.find((l) => l.includes('·') && !/opens|closes|open 24|closed|buka|tutup/i.test(l)) ?? '';
          const stars = card.querySelector('[role="img"][aria-label*="star" i]')?.getAttribute('aria-label') ?? null;
          return {
            // Ads sit in the same list; they are not search results.
            sponsored: /\b(sponsored|bersponsor)\b/i.test(card.innerText),
            href: a.href,
            name: a.getAttribute('aria-label'),
            ratingText: stars,
            countText: stars?.match(/([\d.,]+)\s+(review|ulasan)/i)?.[1] ?? null,
            category: info.split('·')[0]?.trim() || null,
            address: info.split('·').slice(1).map((s) => s.trim()).filter(Boolean).join(', ') || null,
          };
        }), cfg.maxResults * 2);
        return cards
          .filter((c) => !c.sponsored)
          .map((c) => ({ key: placeKeyFromUrl(c.href), c }))
          .filter((x) => x.key && x.c.name)
          .slice(0, cfg.maxResults)
          .map(({ key, c }) => placeOut(key, c));
      }
      const key = placeKeyFromUrl(page.url());
      if (!key) return [];
      return [placeOut(key, await readPlace(page))];
    })),

    // The run is done with this business: let its open list go.
    endCollection: (key) => exclusive(() => endSession(key), { navigates: false }),

    getBusiness: (key) => exclusive(() => withNewPage(async (page) => placeOut(key, await openPlace(page, key)))),

    // First call opens the list (newest first when signed in); each later
    // call scrolls on from where the last stopped. A server restart loses the
    // open list — the next call starts it again and the saved reviews are
    // simply recognised.
    fetchReviewsPage: ({ placeId, cursor, onProgress }) => {
      const resuming = Boolean(cursor && sessions.has(placeId));
      return exclusive(async () => {
        const fetchedAt = new Date();
        let business = null;
        let note = null;
        let session = resuming ? sessions.get(placeId) : null;
        if (!session) {
          await endSession(placeId);
          const ctx = await getContext(onProgress);
          const page = await ctx.newPage();
          page.setDefaultTimeout(20_000);
          session = { page, returned: new Set() };
          sessions.set(placeId, session);
          onProgress?.('open');
          const place = await openPlace(page, placeId);
          business = placeOut(placeId, place);
          onProgress?.('load');
          const { sorted } = await openReviews(page);
          session.sorted = sorted;
          session.total = business.totalReviews;
        }
        onProgress?.('collect');
        const { reviews, done } = await scrollSome(session, fetchedAt);
        if (done) {
          await endSession(placeId);
          const got = session.returned.size;
          if (session.total && got < session.total) {
            note = signedIn
              ? `Terbaca ${got.toLocaleString('id-ID')} dari ${session.total.toLocaleString('id-ID')} ulasan${got >= cfg.maxReviews ? ` (batas GR_PLAYWRIGHT_MAX_REVIEWS ${cfg.maxReviews})` : ''}. Google tidak selalu menampilkan semua ulasan yang dihitungnya.`
              : `Google Maps menampilkan ${got} dari ${session.total.toLocaleString('id-ID')} ulasan tanpa login. Login dengan "npm run google-reviews:login" untuk daftar lengkap.`;
          }
        }
        return { reviews, nextCursor: done ? null : 'continue', business, notice: note };
      }, { navigates: !resuming });
    },
  };
}
