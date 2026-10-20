/* ATLAS Google Reviews Exporter — runs inside the Google Maps tab.
 *
 * Reads the business the tab shows and, when the person presses Start, the
 * reviews in its Reviews panel: it scrolls that panel the way a person would,
 * opens truncated texts with the page's own "More" / "Lihat lainnya" button,
 * and switches a review Google shows in translation back to its original
 * text with the page's "See original" switch. Nothing else is touched: no
 * sign-in, no cookies, no other site. Collected reviews stay in this tab's
 * memory until exported or reset; nothing is sent anywhere. */
(function () {
  'use strict';
  if (window.__atlasGrLoaded) return;
  window.__atlasGrLoaded = true;
  var G = globalThis.AtlasGR;

  var REVIEW = 'div[data-review-id][aria-label]';
  var EXPAND = /^(see more|more|lihat lainnya|lainnya)$/i;
  var SEE_ORIGINAL = /see original|lihat (teks |versi )?asli|tampilkan (teks )?asli/i;
  var LIMITED = /limited view of Google Maps|tampilan terbatas/i;
  var ROUND_MS = 1200;
  var IDLE_ROUNDS = 5;

  var state = fresh();
  function fresh() {
    return {
      status: 'idle', // idle | collecting | completed | stopped | error
      message: '',
      business: null,
      reviews: new Map(), // dedupe key -> raw review
      // Page elements already read, so a review is taken once however many
      // rounds it stays on screen; a second element with the same key is a
      // true duplicate on the page.
      taken: new WeakSet(),
      duplicates: 0,
      max: 1000,
      startedAt: null,
      finishedAt: null,
      stopRequested: false,
    };
  }

  function text(el) { return el && el.textContent ? el.textContent.trim() : ''; }

  // The place's id comes from the URL (present on every tab of a place). The
  // name is the heading on Overview; the Reviews tab has no heading, so the
  // page title ("Opus One - Google Maps") stands in.
  function placeName() {
    var h1 = document.querySelector('h1');
    if (h1 && text(h1)) return text(h1);
    var fromTitle = document.title.replace(/\s+[-–]\s+Google\s+Maps\s*$/i, '').trim();
    return fromTitle && !/^google maps$/i.test(fromTitle) ? fromTitle : '';
  }

  function readBusiness() {
    var key = G.placeKeyFromUrl(location.href);
    var name = placeName();
    if (!key || !name) return null;
    var head = document.querySelector('div.F7nice');
    var countLabel = Array.prototype.map.call(document.querySelectorAll('[aria-label]'), function (e) { return e.getAttribute('aria-label') || ''; })
      .find(function (a) { return /^[\d.,]+\s+(reviews?|ulasan)$/i.test(a); });
    var addr = document.querySelector('[data-item-id="address"]');
    return {
      name: name,
      key: key,
      address: addr ? (addr.getAttribute('aria-label') || '').replace(/^(Address|Alamat):\s*/i, '').trim() : '',
      url: 'https://www.google.com/maps?cid=' + key.slice(4),
      rating: G.parseRatingValue(head ? head.innerText : ''),
      total: G.parseCount(countLabel || (head && (head.innerText.match(/\(([\d.,]+)\)/) || [])[1]) || ''),
    };
  }

  function scroller() {
    var s = document.querySelector(REVIEW);
    s = s && s.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    return s;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function reviewsTab() {
    return Array.prototype.find.call(document.querySelectorAll('[role="tab"]'), function (t) {
      return /reviews|ulasan/i.test((t.getAttribute('aria-label') || '') + ' ' + t.textContent);
    }) || null;
  }

  // The full list lives in the Reviews tab. The Overview tab also shows a
  // few review cards (with "More reviews (699)" under them) — and its own
  // "Sort reviews" button — so neither proves the list is open: the Reviews
  // tab must be the selected one.
  function inReviewsList() {
    var tab = reviewsTab();
    var selected = tab ? tab.getAttribute('aria-selected') : null;
    // The tab's own state decides when it has one: the Overview tab has a
    // "Sort reviews" button too, so that button alone proves nothing.
    if (selected === 'true' || selected === 'false') return selected === 'true';
    if (document.querySelector('button[aria-label*="Sort review" i], button[aria-label*="Urutkan ulasan" i]') && !moreReviewsButton()) return true;
    // No selection state to read: cards without a "More reviews" button
    // under them are the list.
    return !!document.querySelector(REVIEW) && !moreReviewsButton();
  }

  function moreReviewsButton() {
    return Array.prototype.find.call(document.querySelectorAll('button'), function (b) {
      return /^(more reviews|ulasan lainnya|lihat ulasan lainnya|ulasan lain)\b/i.test((b.textContent || '').trim())
        || /^(more reviews|ulasan lainnya)/i.test(b.getAttribute('aria-label') || '');
    }) || null;
  }

  // Open the Reviews tab with the page's own controls: the tab itself, or
  // "More reviews" when there is no tab. Returns false when neither exists.
  async function openReviewsList() {
    if (inReviewsList()) return true;
    var control = reviewsTab() || moreReviewsButton();
    if (!control) return false;
    control.click();
    for (var i = 0; i < 20 && !inReviewsList(); i += 1) await sleep(400);
    await sleep(800);
    return inReviewsList() || !!document.querySelector(REVIEW);
  }

  // The page's own controls: back to the original text, then open "More".
  function prepareVisible() {
    document.querySelectorAll(REVIEW).forEach(function (el) {
      var sw = Array.prototype.find.call(el.querySelectorAll('button[role="switch"]'), function (b) {
        return b.getAttribute('aria-checked') === 'true' && SEE_ORIGINAL.test(b.textContent);
      });
      if (sw) {
        var lang = (sw.textContent.match(/\(([^)]+)\)\s*$/) || [])[1];
        if (lang) el.dataset.atlasLang = lang;
        sw.click();
      }
    });
    document.querySelectorAll(REVIEW + ' button').forEach(function (b) {
      if (EXPAND.test(b.getAttribute('aria-label') || b.textContent.trim())) b.click();
    });
  }

  function readReview(el) {
    var stars = el.querySelector('[role="img"][aria-label*="star" i], [role="img"][aria-label*="bintang" i]');
    var dateEl = el.querySelector('.rsqaWe') || Array.prototype.find.call(stars && stars.parentElement ? stars.parentElement.querySelectorAll('span') : [], function (s) {
      return /ago|lalu|\d{4}/i.test(s.textContent);
    });
    var owners = Array.prototype.filter.call(el.querySelectorAll('div'), function (d) {
      var t = (d.innerText || '').trim();
      return /^(response from the owner|tanggapan dari pemilik)/i.test(t) && t.indexOf('\n') > 0;
    }).sort(function (a, b) { return a.innerText.length - b.innerText.length; });
    // The review's own text — never the owner's reply, which also sits in a
    // div[lang]. A rating-only review with a reply has no text of its own.
    var ownerBox = owners.length ? owners[owners.length - 1] : null;
    var body = Array.prototype.find.call(el.querySelectorAll('div[lang], .MyEned'), function (d) {
      return !(ownerBox && ownerBox.contains(d)) && !(owners[0] && owners[0].contains(d));
    }) || null;
    var pending = Array.prototype.some.call(el.querySelectorAll('button'), function (b) {
      return EXPAND.test(b.getAttribute('aria-label') || b.textContent.trim())
        || (b.getAttribute('role') === 'switch' && b.getAttribute('aria-checked') === 'true' && SEE_ORIGINAL.test(b.textContent));
    });
    return {
      id: el.getAttribute('data-review-id') || '',
      reviewer: el.getAttribute('aria-label') || '',
      rating: G.parseRating(stars ? stars.getAttribute('aria-label') : ''),
      dateRaw: dateEl ? text(dateEl) : '',
      text: body ? body.innerText : '',
      lang: el.dataset.atlasLang || (body ? body.getAttribute('lang') : '') || '',
      ownerBlock: owners[0] ? owners[0].innerText : '',
      pending: pending,
    };
  }

  function summary() {
    var withText = 0;
    state.reviews.forEach(function (r) { if (G.cleanReviewText(r.text)) withText += 1; });
    return {
      status: state.status,
      message: state.message,
      business: state.business || readBusiness(),
      limited: LIMITED.test(document.body ? document.body.innerText.slice(-4000) : ''),
      collected: state.reviews.size,
      duplicates: state.duplicates,
      withText: withText,
      withoutText: state.reviews.size - withText,
      max: state.max,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
    };
  }

  function finish(status, message) {
    state.status = status;
    state.message = message || '';
    state.finishedAt = new Date().toISOString();
  }

  async function collect() {
    var business = readBusiness();
    if (!business) return finish('error', 'Buka halaman sebuah bisnis di Google Maps terlebih dahulu.');
    if (state.business && state.business.key !== business.key) {
      return finish('error', 'Halaman sekarang menampilkan bisnis lain. Tekan Reset sebelum mengumpulkan ulasan bisnis ini.');
    }
    state.business = business;
    if (!(await openReviewsList())) {
      return finish('error', LIMITED.test(document.body.innerText)
        ? 'Google menampilkan "tampilan terbatas" tanpa tab Ulasan. Login ke akun Google di Chrome ini, lalu muat ulang halaman.'
        : 'Tab Ulasan tidak ditemukan. Buka tab "Ulasan" bisnis ini, lalu coba lagi.');
    }
    var idle = 0;
    var tries = 0;
    while (!document.querySelector(REVIEW) && tries < 20) { await sleep(500); tries += 1; }
    if (!document.querySelector(REVIEW)) return finish('error', 'Daftar ulasan tidak muncul. Buka tab "Ulasan", lalu coba lagi.');

    var unreadable = 0;
    while (!state.stopRequested) {
      var now = readBusiness();
      // While Maps redraws (switching tabs, updating the URL) the heading or
      // the id can be missing for a moment: wait. Only a different business
      // stops the run.
      if (now && now.key !== state.business.key) {
        return finish('error', 'Halaman berpindah ke bisnis lain; pengumpulan dihentikan. Ulasan yang sudah terkumpul tetap untuk ' + state.business.name + '.');
      }
      if (!now) {
        unreadable += 1;
        if (unreadable > 15) return finish('error', 'Halaman bisnis tidak lagi terbaca. Buka kembali halaman ' + state.business.name + ', lalu tekan Lanjutkan.');
        await sleep(ROUND_MS);
        continue;
      }
      unreadable = 0;
      if (/\/sorry\//.test(location.href)) return finish('error', 'Google meminta verifikasi (CAPTCHA). Pengumpulan dihentikan.');
      // Fill in what the first page did not show (the Reviews tab lacks the
      // address, Overview may lack the count) — never overwrite.
      ['total', 'rating', 'address'].forEach(function (k) { if ((state.business[k] == null || state.business[k] === '') && now[k]) state.business[k] = now[k]; });

      prepareVisible();
      await sleep(450);
      var before = state.reviews.size;
      var els = document.querySelectorAll(REVIEW);
      for (var i = 0; i < els.length; i += 1) {
        var r = readReview(els[i]);
        if (r.pending) continue; // read on the next round, once fully open
        if (state.taken.has(els[i])) continue;
        if (state.reviews.size >= state.max) break;
        var key = G.dedupeKey(state.business.key, r, state.reviews.size);
        state.taken.add(els[i]);
        if (state.reviews.has(key)) { state.duplicates += 1; continue; }
        state.reviews.set(key, r);
      }
      if (state.reviews.size >= state.max) return finish('completed', 'Batas ' + state.max + ' ulasan tercapai.');
      // Someone switched back to Overview mid-way: reopen the list.
      var tabNow = reviewsTab();
      if (tabNow && tabNow.getAttribute('aria-selected') === 'false' && !inReviewsList() && !(await openReviewsList())) {
        return finish('stopped', 'Tab Ulasan tertutup. Buka lagi tab "Ulasan/Reviews", lalu tekan Lanjutkan.');
      }

      var box = scroller();
      var atEnd = !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 5;
      if (box) box.scrollTop += 1200;
      idle = state.reviews.size === before && atEnd ? idle + 1 : 0;
      if (idle >= IDLE_ROUNDS) {
        var total = state.business.total;
        return finish('completed', total && state.reviews.size < total * 0.9 && LIMITED.test(document.body.innerText)
          ? 'Google hanya menampilkan sebagian ulasan ("tampilan terbatas"). Login ke akun Google di Chrome ini untuk daftar lengkap.'
          : 'Semua ulasan yang dimuat halaman sudah terbaca.');
      }
      await sleep(ROUND_MS);
    }
    finish('stopped', 'Dihentikan. Ulasan yang sudah terkumpul tetap bisa diekspor.');
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (!msg || typeof msg.type !== 'string') return false;
    if (msg.type === 'atlas-gr:state') {
      reply(summary());
    } else if (msg.type === 'atlas-gr:start') {
      if (state.status !== 'collecting') {
        var max = Math.max(1, Math.min(10000, Number(msg.max) || 1000));
        var current = readBusiness();
        if (state.business && current && current.key !== state.business.key) {
          state = fresh(); // a different business never joins the old dataset
        }
        state.max = max;
        state.status = 'collecting';
        state.message = '';
        state.stopRequested = false;
        state.startedAt = state.startedAt || new Date().toISOString();
        state.finishedAt = null;
        collect().catch(function (err) { finish('error', 'Terjadi kesalahan: ' + (err && err.message ? err.message : err)); });
      }
      reply(summary());
    } else if (msg.type === 'atlas-gr:stop') {
      state.stopRequested = true;
      reply(summary());
    } else if (msg.type === 'atlas-gr:reset') {
      state.stopRequested = true;
      state = fresh();
      reply(summary());
    } else if (msg.type === 'atlas-gr:export') {
      var reviews = Array.from(state.reviews.values()).map(function (r) {
        return { id: r.id, reviewer: r.reviewer, rating: r.rating, dateRaw: r.dateRaw, text: r.text, lang: r.lang, ownerBlock: r.ownerBlock };
      });
      reply({ business: state.business, reviews: reviews, collectedAt: state.startedAt || new Date().toISOString() });
    } else {
      return false;
    }
    return false;
  });
})();
