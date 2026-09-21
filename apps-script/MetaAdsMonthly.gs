/**
 * ============================================================
 * META ADS MONTHLY INSIGHTS -> ATLAS
 * ============================================================
 * Setiap tanggal 1, tarik data Meta Ads bulan SEBELUMNYA untuk semua akun
 * (MAIN dan CPAS) yang sudah terdaftar di Meta Ads Automation > Brand &
 * Langganan DAN tertaut ke brand ATLAS (atlasBrandId terisi), lalu kirim
 * ke ATLAS (Pengaturan Brand > Data & file > Meta Ads). Aturan
 * kelayakannya sama dengan Daily Tracking: terdaftar = otomatis.
 *
 * Breakdown: campaign name x age x gender x day (level=campaign,
 * time_increment=1). Script ini SENGAJA "bodoh": meminta field tetap dan
 * meneruskan tiap baris apa adanya. Definisi metrik (default + opsional
 * per brand) dan perhitungan turunannya (cost per X, rasio) ada di ATLAS:
 * backend/src/config/metaAdsMetrics.js, jadi mengubah metrik tidak perlu
 * deploy ulang script ini.
 *
 * Alur satu akun (dikirim ke ATLAS bertahap, bukan sekali besar, karena
 * satu bulan dengan breakdown sedetail ini bisa puluhan ribu baris):
 *   POST /meta-ads-insights/ingest/start   -> runId + action type yang perlu disimpan
 *   POST /meta-ads-insights/ingest/rows    -> berulang, per ~500 baris
 *   POST /meta-ads-insights/ingest/finish  -> sukses/gagal; saat sukses ATLAS
 *                                             menghapus baris bulan itu yang
 *                                             tidak ikut ditulis run ini
 *   POST /meta-ads-insights/ingest/library -> (setelah sukses) ATLAS menyimpan
 *                                             bulan itu ke perpustakaan Data &
 *                                             file, supaya muncul di grid dan
 *                                             di Report Generator
 * Kalau run mati di tengah, data lama bulan itu TIDAK tersentuh.
 *
 * Batas waktu: satu eksekusi Apps Script maksimal 6 menit, jadi akun
 * diproses lewat ANTREAN (Script Properties). Kalau waktu hampir habis,
 * sisa antrean dilanjutkan trigger sekali-jalan berikutnya.
 *
 * SETUP (sekali)
 *   1. Script Properties yang SUDAH ada untuk Daily Tracking dipakai ulang:
 *      ATLAS_INGEST_URL (.../api/daily-tracking/ingest) dan ATLAS_INGEST_KEY.
 *      Opsional: ATLAS_API_BASE_URL (mis. https://domain/api) kalau
 *      ATLAS_INGEST_URL tidak berbentuk seperti itu.
 *   2. Jalankan setupMetaAdsMonthlyTrigger() SEKALI dari editor.
 *   3. Deploy ulang Web App (Manage deployments > Edit > New version) agar
 *      action `metaAdsEnqueue` (tombol "Tarik sekarang" di ATLAS) aktif.
 *
 * File ini memakai helper Weekly.gs / DailyTrackingBoostPost.gs:
 * CONFIG, fetchJson_, tokenFor_, getAllAccounts_, findAccountById_, num_,
 * tz_, openSpreadsheet_, writeLog_.
 */

var MAM_QUEUE_KEY = 'META_ADS_MONTHLY_QUEUE';
var MAM_WORKER_KEY = 'META_ADS_MONTHLY_WORKER_TS';
var MAM_WORKER_STALE_MS = 7 * 60 * 1000;   // worker dianggap mati kalau lebih lama dari ini
var MAM_START_BUDGET_MS = 3 * 60 * 1000;   // tidak memulai akun baru lewat batas ini
var MAM_ROWS_PER_POST = 500;
var MAM_WINDOW_DAYS = 7;                   // menarik per 7 hari agar Meta tidak menolak "terlalu banyak data"

var MAM_FIELDS = [
  'campaign_id', 'campaign_name', 'objective',
  'spend', 'impressions', 'reach', 'frequency',
  'inline_link_clicks', 'inline_link_click_ctr', 'cost_per_inline_link_click', 'cpm',
  'actions', 'action_values', 'purchase_roas'
];

// ============================================================
// ENTRY POINTS
// ============================================================

/** Pasang trigger bulanan: tanggal 1, sekitar 02:00 WIB. Jalankan SEKALI. */
function setupMetaAdsMonthlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runMonthlyMetaAdsFetch') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runMonthlyMetaAdsFetch')
    .timeBased()
    .onMonthDay(1)
    .atHour(2)
    .inTimezone('Asia/Jakarta')
    .create();
  Logger.log('Trigger terpasang: tanggal 1 tiap bulan, sekitar 02:00 WIB, menarik bulan sebelumnya.');
}

/** Handler trigger bulanan. */
function runMonthlyMetaAdsFetch() {
  var month = metaAdsPreviousMonth_();
  var items = [];
  getAllAccounts_().forEach(function (acct) {
    if (!acct.atlasBrandId) return;
    items.push(metaAdsQueueItem_(acct, month, 'scheduled'));
  });
  if (!items.length) {
    Logger.log('Tidak ada akun yang tertaut ke brand ATLAS -- tidak ada yang ditarik.');
    return;
  }
  enqueueMetaAdsItems_(items);
  processMetaAdsQueue();
}

/**
 * Handler trigger sekali-jalan (dibuat oleh scheduleMetaAdsQueueRun_):
 * menguras antrean sampai habis atau waktu hampir habis.
 */
function processMetaAdsQueue() {
  deleteMetaAdsQueueTriggers_();

  var props = PropertiesService.getScriptProperties();
  var busySince = Number(props.getProperty(MAM_WORKER_KEY) || 0);
  if (busySince && Date.now() - busySince < MAM_WORKER_STALE_MS) {
    // Worker lain masih hidup. Jangan dibuang diam-diam: kalau worker itu
    // baru saja selesai mengecek antrean, item baru bisa tertinggal.
    scheduleMetaAdsQueueRun_(60 * 1000);
    return;
  }

  props.setProperty(MAM_WORKER_KEY, String(Date.now()));
  var startedAt = Date.now();
  try {
    var item;
    while ((item = dequeueMetaAdsItem_())) {
      runMetaAdsFetchItem_(item);
      if (Date.now() - startedAt > MAM_START_BUDGET_MS) break;
    }
  } finally {
    props.deleteProperty(MAM_WORKER_KEY);
  }

  if (getMetaAdsQueue_().length) scheduleMetaAdsQueueRun_(1000);
}

/**
 * doPost action `metaAdsEnqueue` (tombol "Tarik sekarang" di ATLAS).
 * Hanya mengantre lalu langsung membalas: hasilnya baru ada beberapa menit
 * kemudian, jauh melewati batas 60 detik function Vercel, jadi ATLAS memantau
 * progres lewat tabel log-nya sendiri.
 */
function uiEnqueueMetaAds_(payload) {
  var atlasBrandId = parseInt(payload.atlasBrandId, 10);
  var type = String(payload.type || 'MAIN').toUpperCase();
  var month = String(payload.month || '');
  if (!isFinite(atlasBrandId)) throw new Error('atlasBrandId wajib berupa angka.');
  if (type !== 'MAIN' && type !== 'CPAS') throw new Error('type harus MAIN atau CPAS.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('month harus berformat YYYY-MM.');

  var items = [];
  getAllAccounts_().forEach(function (acct) {
    if (Number(acct.atlasBrandId) !== atlasBrandId) return;
    if ((acct.type || 'MAIN').toUpperCase() !== type) return;
    items.push(metaAdsQueueItem_(acct, month, 'manual'));
  });
  if (!items.length) {
    throw new Error('Tidak ada akun ' + type + ' yang tertaut ke brand ATLAS ini di Brand & Langganan.');
  }

  var queued = enqueueMetaAdsItems_(items);
  scheduleMetaAdsQueueRun_(1000);
  return { queued: queued, month: month, type: type };
}

// ============================================================
// ANTREAN
// ============================================================

function metaAdsQueueItem_(acct, month, trigger) {
  return {
    accountId: acct.id,
    client: acct.client,
    type: (acct.type || 'MAIN').toUpperCase(),
    atlasBrandId: acct.atlasBrandId,
    month: month,
    trigger: trigger
  };
}

function getMetaAdsQueue_() {
  var raw = PropertiesService.getScriptProperties().getProperty(MAM_QUEUE_KEY);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveMetaAdsQueue_(list) {
  PropertiesService.getScriptProperties().setProperty(MAM_QUEUE_KEY, JSON.stringify(list));
}

/** Tambah ke antrean, lewati yang sudah ada (akun + bulan sama). Mengembalikan jumlah yang benar-benar ditambah. */
function enqueueMetaAdsItems_(items) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var queue = getMetaAdsQueue_();
    var added = 0;
    items.forEach(function (it) {
      var dup = queue.some(function (q) { return q.accountId === it.accountId && q.month === it.month; });
      if (!dup) { queue.push(it); added++; }
    });
    saveMetaAdsQueue_(queue);
    return added;
  } finally {
    lock.releaseLock();
  }
}

function dequeueMetaAdsItem_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var queue = getMetaAdsQueue_();
    var item = queue.shift() || null;
    saveMetaAdsQueue_(queue);
    return item;
  } finally {
    lock.releaseLock();
  }
}

function scheduleMetaAdsQueueRun_(delayMs) {
  ScriptApp.newTrigger('processMetaAdsQueue').timeBased().after(delayMs).create();
}

/** Trigger sekali-jalan tidak otomatis hilang setelah jalan; batas Google 20 trigger per script. */
function deleteMetaAdsQueueTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processMetaAdsQueue') ScriptApp.deleteTrigger(t);
  });
}

// ============================================================
// SATU AKUN, SATU BULAN
// ============================================================

function runMetaAdsFetchItem_(item) {
  var startedAt = new Date();
  var acct = findAccountById_(item.accountId);
  var label = item.client + ' ' + item.type + ' ' + item.month;
  var runId = null;
  var total = 0;

  try {
    if (!acct) throw new Error('Akun ' + item.accountId + ' sudah tidak ada di Brand & Langganan.');

    var started = atlasIngestPost_('/start', {
      brandId: item.atlasBrandId,
      accountType: item.type,
      adAccountId: acct.id,
      month: item.month,
      trigger: item.trigger
    });
    runId = started.runId;

    var buffer = [];
    var flush = function () {
      if (!buffer.length) return;
      atlasIngestPost_('/rows', { runId: runId, rows: buffer });
      total += buffer.length;
      buffer = [];
    };

    fetchMetaAdsMonth_(tokenFor_(acct), acct.id, item.month, started.actionTypes || [], function (rows) {
      buffer = buffer.concat(rows);
      while (buffer.length >= MAM_ROWS_PER_POST) {
        var chunk = buffer.slice(0, MAM_ROWS_PER_POST);
        buffer = buffer.slice(MAM_ROWS_PER_POST);
        atlasIngestPost_('/rows', { runId: runId, rows: chunk });
        total += chunk.length;
      }
    });
    flush();

    atlasIngestPost_('/finish', { runId: runId, status: 'success', rowCount: total });

    // Langkah terpisah dari /finish: menyimpan bulan ini ke perpustakaan
    // Data & file (file .xlsx yang dibaca Report Generator) butuh menulis
    // ribuan baris ke Excel, dan tidak boleh membuat run yang datanya sudah
    // aman tersimpan tampak gagal. Kegagalannya cuma dicatat; tombol
    // "Simpan ke library" di ATLAS bisa mengulanginya kapan saja.
    var libraryNote = '';
    try {
      var lib = atlasIngestPost_('/library', { runId: runId });
      if (lib && lib.synced === false) libraryNote = ' | library dilewati: ' + lib.reason;
    } catch (e) {
      libraryNote = ' | library GAGAL: ' + e.message;
    }
    writeMetaAdsLog_(startedAt, 'OK', label + ': ' + total + ' baris' + libraryNote);
  } catch (e) {
    Logger.log('[%s] Gagal: %s', label, e.message);
    if (runId) {
      try {
        atlasIngestPost_('/finish', { runId: runId, status: 'failed', rowCount: total, note: String(e.message).slice(0, 480) });
      } catch (e2) { /* ATLAS tidak terjangkau; run tetap 'running' di sana dan dianggap gagal oleh UI */ }
    }
    writeMetaAdsLog_(startedAt, 'GAGAL', label + ': ' + e.message);
  }
}

function writeMetaAdsLog_(startedAt, status, detail) {
  try {
    writeLog_(openSpreadsheet_(), startedAt, status, '[INSIGHTS] ' + detail);
  } catch (e) { /* sheet log tidak terjangkau, abaikan */ }
}

// ============================================================
// META MARKETING API
// ============================================================

/**
 * Tarik satu bulan, per jendela MAM_WINDOW_DAYS hari. `onRows(rows)`
 * dipanggil per halaman hasil dengan baris yang sudah dipetakan
 * (mapMetaInsightRow_), supaya memori tidak menampung sebulan penuh.
 */
function fetchMetaAdsMonth_(token, accountId, month, actionTypes, onRows) {
  var y = parseInt(month.substring(0, 4), 10);
  var m = parseInt(month.substring(5, 7), 10);
  var lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  var wanted = {};
  actionTypes.forEach(function (t) { wanted[t] = true; });

  for (var from = 1; from <= lastDay; from += MAM_WINDOW_DAYS) {
    var to = Math.min(from + MAM_WINDOW_DAYS - 1, lastDay);
    var since = month + '-' + ('0' + from).slice(-2);
    var until = month + '-' + ('0' + to).slice(-2);

    var url = 'https://graph.facebook.com/' + CONFIG.API_VERSION + '/' + accountId + '/insights' +
      '?fields=' + encodeURIComponent(MAM_FIELDS.join(',')) +
      '&level=campaign' +
      '&breakdowns=' + encodeURIComponent('age,gender') +
      '&time_increment=1' +
      '&time_range=' + encodeURIComponent(JSON.stringify({ since: since, until: until })) +
      '&limit=500&access_token=' + encodeURIComponent(token);

    var guard = 0;
    while (url && guard < 200) {
      guard++;
      var body = fetchJson_(url);
      var rows = [];
      (body.data || []).forEach(function (d) { rows.push(mapMetaInsightRow_(d, wanted)); });
      if (rows.length) onRows(rows);
      url = (body.paging && body.paging.next) ? body.paging.next : null;
      if (url) Utilities.sleep(200);
    }
    if (url) throw new Error('Terlalu banyak halaman untuk ' + since + ' s/d ' + until + ' -- dihentikan.');
  }
}

/** Satu baris Marketing API -> bentuk mentah yang dibaca normalizeInsightRow() di ATLAS. */
function mapMetaInsightRow_(d, wantedActionTypes) {
  return {
    date: d.date_start,
    campaignId: d.campaign_id,
    campaignName: d.campaign_name,
    objective: d.objective || null,
    age: d.age,
    gender: d.gender,
    spend: d.spend,
    impressions: d.impressions,
    reach: d.reach,
    frequency: d.frequency,
    linkClicks: d.inline_link_clicks,
    linkCtr: d.inline_link_click_ctr,
    cpc: d.cost_per_inline_link_click,
    cpm: d.cpm,
    purchaseRoas: firstActionValue_(d.purchase_roas),
    actions: pickActionList_(d.actions, wantedActionTypes),
    actionValues: pickActionList_(d.action_values, wantedActionTypes)
  };
}

/** [{action_type, value}] -> { action_type: value }, hanya untuk tipe yang diminta ATLAS. */
function pickActionList_(arr, wanted) {
  var out = {};
  (arr || []).forEach(function (x) {
    if (wanted[x.action_type]) out[x.action_type] = x.value;
  });
  return out;
}

/** purchase_roas: utamakan omni_purchase (angka yang dipakai Ads Manager), kalau tidak ada ambil entri pertama. */
function firstActionValue_(arr) {
  if (!arr || !arr.length) return null;
  var found = null;
  arr.forEach(function (x) { if (x.action_type === 'omni_purchase') found = x.value; });
  return found !== null ? found : arr[0].value;
}

// ============================================================
// KE ATLAS
// ============================================================

function atlasApiBase_() {
  var props = PropertiesService.getScriptProperties();
  var explicit = props.getProperty('ATLAS_API_BASE_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  var url = props.getProperty('ATLAS_INGEST_URL');
  if (!url) throw new Error('ATLAS_INGEST_URL belum di-set di Script Properties.');
  var m = url.match(/^(.*\/api)\/daily-tracking\/ingest\/?$/);
  if (!m) throw new Error('ATLAS_INGEST_URL tidak berbentuk .../api/daily-tracking/ingest -- set ATLAS_API_BASE_URL (mis. https://domain/api).');
  return m[1];
}

/**
 * POST ke /meta-ads-insights/ingest<path>. Melempar Error kalau gagal
 * (pemanggil yang memutuskan run ini gagal); 3 percobaan untuk kegagalan
 * jaringan/5xx karena cold start Vercel kadang menolak percobaan pertama.
 * 4xx tidak diulang -- pesan validasi ATLAS ikut dilempar apa adanya.
 */
function atlasIngestPost_(path, payload) {
  var key = PropertiesService.getScriptProperties().getProperty('ATLAS_INGEST_KEY');
  if (!key) throw new Error('ATLAS_INGEST_KEY belum di-set di Script Properties.');
  var url = atlasApiBase_() + '/meta-ads-insights/ingest' + path;

  var lastErr;
  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'post',
        // application/json, BUKAN text/plain: tujuannya Express ATLAS, bukan
        // doPost() Apps Script -- lihat catatan di postToAtlas_.
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        headers: { 'X-Ingest-Key': key },
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      var text = res.getContentText();
      if (code >= 200 && code < 300) return JSON.parse(text);
      lastErr = new Error('ATLAS HTTP ' + code + ' (' + path + '): ' + text.slice(0, 200));
      if (code < 500) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (/^ATLAS HTTP 4/.test(e.message)) throw e;
    }
    if (attempt < 3) Utilities.sleep(1500 * attempt);
  }
  throw lastErr;
}

// ============================================================
// UTIL
// ============================================================

/** 'YYYY-MM' bulan sebelum hari ini (zona waktu script). */
function metaAdsPreviousMonth_() {
  var now = new Date();
  var y = parseInt(Utilities.formatDate(now, tz_(), 'yyyy'), 10);
  var m = parseInt(Utilities.formatDate(now, tz_(), 'M'), 10);
  if (m === 1) { y -= 1; m = 12; } else { m -= 1; }
  return y + '-' + ('0' + m).slice(-2);
}

/** Uji manual dari editor: tarik bulan sebelumnya untuk SATU brand ATLAS (ubah angka di bawah). */
function testMetaAdsMonthly() {
  var atlasBrandId = 0; // <- isi id brand ATLAS
  var acct = getAllAccounts_().filter(function (a) { return Number(a.atlasBrandId) === atlasBrandId; })[0];
  if (!acct) throw new Error('Tidak ada akun tertaut ke atlasBrandId ' + atlasBrandId);
  runMetaAdsFetchItem_(metaAdsQueueItem_(acct, metaAdsPreviousMonth_(), 'manual'));
}
