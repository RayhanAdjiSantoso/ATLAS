/* ATLAS Google Reviews Exporter — popup. Talks only to the content script in
 * the Google Maps tab; builds the CSV here and hands it to the browser as a
 * download. Preferences (the one-time notice, the maximum) live in
 * chrome.storage.local; reviews never do. */
(function () {
  'use strict';
  var G = globalThis.AtlasGR;
  var MAPS = ['https://www.google.com/maps*', 'https://www.google.co.id/maps*', 'https://maps.google.com/*'];
  var ACK_KEY = 'atlasGrAckV1';
  var $ = function (id) { return document.getElementById(id); };
  var tabId = null;
  var last = null;
  var timer = null;

  var STATUS = { idle: 'Idle', collecting: 'Collecting', completed: 'Completed', stopped: 'Stopped', error: 'Error' };
  var fmt = function (n) { return n == null ? '—' : Number(n).toLocaleString('id-ID'); };

  function isMaps(url) { return /^https:\/\/(www\.google\.(com|co\.id)\/maps|maps\.google\.com)/.test(url || ''); }

  // The Google Maps tab: the active one, else the most recently used.
  function findTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
        var t = tabs && tabs[0];
        if (t && isMaps(t.url)) return resolve(t.id);
        chrome.tabs.query({ url: MAPS }, function (all) {
          all = (all || []).sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); });
          resolve(all[0] ? all[0].id : null);
        });
      });
    });
  }

  function send(msg) {
    return new Promise(function (resolve) {
      if (tabId == null) return resolve(null);
      chrome.tabs.sendMessage(tabId, msg, function (res) {
        // No content script in the tab (not Maps, or opened before install).
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res || null);
      });
    });
  }

  function show(id, on) { $(id).hidden = !on; }

  function render(s) {
    last = s;
    var ready = !!(s && s.business);
    show('not-ready', !ready);
    show('business', ready);
    show('progress-card', ready);
    show('controls', ready);
    if (!s) {
      $('not-ready-text').textContent = 'Cari bisnisnya di Google Maps, buka halamannya, lalu klik ikon extension ini lagi. Jika extension baru dipasang, muat ulang tab Google Maps sekali.';
      return;
    }
    if (!ready) {
      $('not-ready-text').textContent = s.limited
        ? 'Google menampilkan "tampilan terbatas". Login ke akun Google di Chrome ini dan muat ulang halaman bisnisnya.'
        : 'Buka halaman sebuah bisnis (bukan daftar hasil pencarian) di tab Google Maps.';
      return;
    }
    var b = s.business;
    $('biz-name').textContent = b.name;
    $('biz-address').textContent = b.address || 'Alamat tidak terbaca';
    $('biz-rating').textContent = b.rating == null ? '—' : b.rating.toLocaleString('id-ID', { minimumFractionDigits: 1 });
    $('biz-total').textContent = fmt(b.total);
    $('biz-id').textContent = b.key;

    var st = $('status');
    st.textContent = STATUS[s.status] || s.status;
    st.className = 'pill is-' + s.status;

    var target = Math.min(s.max || Infinity, b.total || Infinity);
    var pct = isFinite(target) && target > 0 ? Math.min(100, (s.collected / target) * 100) : (s.status === 'completed' ? 100 : 0);
    $('bar').style.width = pct + '%';
    $('bar').parentElement.classList.toggle('is-busy', s.status === 'collecting');
    $('bar').parentElement.setAttribute('aria-valuenow', String(Math.round(pct)));

    $('s-collected').textContent = fmt(s.collected);
    $('s-total').textContent = b.total ? fmt(b.total) : '—';
    $('s-dup').textContent = fmt(s.duplicates);
    $('s-text').textContent = fmt(s.withText);
    $('s-notext').textContent = fmt(s.withoutText);

    var msg = s.message;
    if (!msg && s.status === 'collecting') msg = 'Mengumpulkan… biarkan tab Google Maps tetap terbuka.';
    if (!msg && s.status === 'idle') msg = 'Tekan Start Collection untuk membaca ulasan bisnis ini.';
    if (s.status === 'completed' && b.total && s.collected < b.total) {
      msg += ' Terkumpul ' + fmt(s.collected) + ' dari ' + fmt(b.total) + ' ulasan yang dilaporkan Google.';
    }
    $('message').textContent = msg;
    $('message').classList.toggle('is-error', s.status === 'error');

    var busy = s.status === 'collecting';
    $('start').disabled = busy;
    $('start').textContent = s.collected && !busy && s.status !== 'idle' ? 'Lanjutkan' : 'Start Collection';
    $('stop').disabled = !busy;
    $('export').disabled = busy || !s.collected;
    $('reset').disabled = busy;
    $('max').disabled = busy;
  }

  async function refresh() {
    if (tabId == null) tabId = await findTab();
    render(await send({ type: 'atlas-gr:state' }));
  }

  async function exportCsv() {
    var data = await send({ type: 'atlas-gr:export' });
    if (!data || !data.reviews || !data.reviews.length) return;
    var csv = G.buildCsv(data.business, data.reviews, data.collectedAt);
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = G.fileName(data.business.name, new Date());
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    if ($('clear-after').checked) render(await send({ type: 'atlas-gr:reset' }));
    $('message').textContent = 'CSV tersimpan (' + data.reviews.length + ' ulasan). Unggah file ini di ATLAS → Google Reviews → Import CSV.';
  }

  function startMain() {
    show('ack', false);
    show('main', true);
    chrome.storage.local.get(['atlasGrMax'], function (v) { if (v.atlasGrMax) $('max').value = v.atlasGrMax; });
    $('max').addEventListener('change', function () {
      var n = Math.max(1, Math.min(10000, Number($('max').value) || 1000));
      $('max').value = n;
      chrome.storage.local.set({ atlasGrMax: n });
    });
    $('start').addEventListener('click', async function () { render(await send({ type: 'atlas-gr:start', max: Number($('max').value) })); });
    $('stop').addEventListener('click', async function () { render(await send({ type: 'atlas-gr:stop' })); });
    $('reset').addEventListener('click', async function () { render(await send({ type: 'atlas-gr:reset' })); });
    $('export').addEventListener('click', exportCsv);
    refresh();
    timer = setInterval(refresh, 700);
  }

  chrome.storage.local.get([ACK_KEY], function (v) {
    if (v[ACK_KEY]) return startMain();
    show('ack', true);
    $('ack-box').addEventListener('change', function () { $('ack-ok').disabled = !$('ack-box').checked; });
    $('ack-ok').addEventListener('click', function () {
      chrome.storage.local.set({ [ACK_KEY]: new Date().toISOString() }, startMain);
    });
  });

  window.addEventListener('unload', function () { clearInterval(timer); });
})();
