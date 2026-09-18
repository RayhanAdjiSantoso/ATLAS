/**
 * ============================================================
 * DAILY TRACKING — BOOST POST / NON-BOOST AMOUNT SPENT
 * (MULTI-BRAND, dikonfigurasi lewat sidebar ATAU halaman Web App)
 * ============================================================
 * Mengisi otomatis kolom "Boost Post" dan kolom non-boost
 * (namanya bisa beda-beda per brand — "FB Ads", "Non-Boost Post",
 * dst.) di sheet Daily Tracking tiap brand, berdasarkan SUM
 * Amount Spent campaign Meta Ads kemarin (H-1), dikelompokkan
 * lewat nama campaign (mengandung kata kunci -> Boost Post,
 * selain itu -> non-boost).
 *
 * INI VERSI BARU — MENGGANTIKAN versi single-brand sebelumnya
 * (yang punya var global DAILY_TRACKING & fungsi
 * updateDailyTrackingSpend). Ganti SELURUH isi file lama dengan
 * isi file ini — jangan biarkan dua versi hidup berdampingan di
 * project yang sama, nanti nama fungsi/var bentrok.
 *
 * KONFIGURASI BRAND TIDAK LAGI DITULIS LANGSUNG DI KODE.
 * Disimpan di Script Properties (kunci DAILY_TRACKING_CONFIGS),
 * dikelola lewat form — ada 2 cara buka form-nya, dua-duanya
 * pakai UI dan logic yang SAMA persis:
 *   a) Sidebar di dalam spreadsheet — menu "Daily Tracking" >
 *      "Kelola Konfigurasi Brand" (perlu buka Sheets dulu).
 *   b) Halaman Web App berdiri sendiri — buka lewat URL hasil
 *      Deploy, tidak perlu buka spreadsheet sama sekali (lihat
 *      doGet() di bawah). INI YANG DIPAKAI kalau mau rekan cukup
 *      buka satu link dan langsung terhubung.
 *   c) JSON API (doPost()) — dipanggil dari sistem lain server-to-
 *      server (mis. backend ATLAS), dilindungi API key terpisah.
 *      Bukan untuk dipanggil langsung dari browser.
 *
 * FILE PENDAMPING WAJIB ADA di project yang sama: Sidebar.html
 *
 * SIAPA YANG BUTUH AKSES APA
 * - Lewat SIDEBAR: tombol Test/Simpan jalan sebagai identitas
 *   orang yang sedang buka Sheets-nya — jadi tiap orang butuh
 *   akses sendiri ke Google Sheets brand yang mau didaftarkan.
 * - Lewat WEB APP dengan "Execute as: Me" (lihat doGet()): semua
 *   aksi jalan pakai identitas akun yang men-deploy — siapa pun
 *   yang buka link TIDAK perlu akses Sheets sama sekali. Ini yang
 *   bikin "buka halaman, otomatis terhubung" beneran kejadian.
 * - Trigger harian otomatis (01:00) selalu jalan sebagai ORANG
 *   YANG MEMASANG TRIGGER (yang menjalankan
 *   setupDailyTrackingTrigger()). Kalau Web App dan trigger
 *   di-deploy/dipasang oleh AKUN YANG SAMA, seluruh alur (tambah
 *   brand, test, dan run otomatis) konsisten pakai satu identitas
 *   — tidak ada lagi kasus "test berhasil tapi run 01:00 gagal
 *   karena beda akses".
 * - Script Properties (termasuk token Meta Ads) dipakai bersama
 *   oleh semua orang yang bisa menjalankan script ini — ini bukan
 *   hal baru, sudah begitu sejak Weekly.gs/Daily.gs.
 *
 * KETERGANTUNGAN — harus ada di project Apps Script yang SAMA:
 *   CONFIG, fetchInsights_, tokenFor_, num_, tz_, openSpreadsheet_,
 *   writeLog_  (semuanya dari Weekly.gs / file v5)
 *   weeklyRun, checkTokens (dari Weekly.gs)
 *   dailyUrgentCheck, resetUrgentCooldown (dari Daily.gs)
 * — doPost() di file ini sekarang jadi JSON API TERPADU untuk
 * ketiga automasi (weekly, daily, daily tracking), bukan cuma daily
 * tracking sendirian. Pakai versi Weekly.gs & Daily.gs yang
 * menyertai file ini (ada tambahan prefix "[WEEKLY]"/"[DAILY]" di
 * writeLog_, tidak ada logic lain yang berubah) — kalau masih pakai
 * versi lama, action 'log' di API tetap jalan tapi baris dari
 * ketiganya tidak bisa dibedakan sumbernya.
 *
 * PEMASANGAN
 * 1. Ganti seluruh isi file lama dengan isi file ini.
 * 2. Timpa Weekly.gs dan Daily.gs dengan versi yang menyertai
 *    handoff ini (cuma tambahan prefix log, lihat di atas).
 * 3. Tambah file HTML baru di project yang sama, namai persis
 *    "Sidebar" (Apps Script otomatis kasih ekstensi .html), isi
 *    dengan Sidebar.html yang menyertai file ini.
 * 4. Reload/refresh spreadsheet-nya di browser supaya menu
 *    "Daily Tracking" muncul (opsional, kalau mau tetap ada akses
 *    lewat sidebar juga).
 * 5. Jalankan seedPetiteFleurConfig() SATU KALI dari editor Apps
 *    Script (dropdown fungsi di toolbar) — ini memindahkan
 *    konfigurasi Petite Fleur yang sudah tervalidasi ke
 *    penyimpanan baru, supaya tidak hilang & langsung muncul di
 *    form.
 * 6. Kalau trigger versi lama (updateDailyTrackingSpend) pernah
 *    dipasang, hapus manual lewat menu Triggers di editor Apps
 *    Script. Lalu jalankan setupDailyTrackingTrigger() (versi
 *    baru ini mengarah ke updateAllDailyTrackingSpend). Trigger
 *    weeklyRun (setupWeeklyTrigger()) dan dailyUrgentCheck
 *    (setupDailyTrigger()) TIDAK berubah, biarkan seperti sudah ada.
 * 7. DEPLOY SEBAGAI WEB APP (ini yang bikin rekan tidak perlu buka
 *    Sheets sama sekali):
 *      a. Di editor Apps Script: Deploy > New deployment.
 *      b. Klik ikon gerigi di "Select type" > pilih "Web app".
 *      c. "Execute as" -> pilih "Me" (lihat penjelasan doGet() di
 *         bawah kenapa ini disarankan).
 *      d. "Who has access" -> "Anyone with the link" (paling
 *         praktis), atau "Anyone within [domain kamu]" kalau pakai
 *         Google Workspace (lebih aman).
 *      e. Klik Deploy, copy URL yang muncul — itu link yang
 *         dibagikan ke rekan, buka langsung tanpa perlu ke Sheets.
 *      f. SETIAP kali kode di project ini diubah lagi, deployment
 *         lama TIDAK otomatis update — harus Deploy > Manage
 *         deployments > ikon pensil di deployment yang aktif >
 *         Version "New version" > Deploy, baru perubahannya kepakai
 *         di URL yang sama.
 * 8. Beri akses edit spreadsheet INI (yang jadi rumah project
 *    Apps Script) ke siapa pun yang masih perlu lewat sidebar juga.
 * ============================================================
 */

var TRACKING_STORE_KEY = 'DAILY_TRACKING_CONFIGS';

// ============================================================
// MENU & SIDEBAR
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Daily Tracking')
    .addItem('Kelola Konfigurasi Brand', 'showTrackingSidebar')
    .addItem('Jalankan Sekarang (Semua Brand)', 'menuRunAllNow')
    .addToUi();
}

function showTrackingSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Daily Tracking — Konfigurasi Brand');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Dipanggil dari menu — jalankan semua brand sekarang juga, di luar jadwal 01:00. */
function menuRunAllNow() {
  var summary = updateAllDailyTrackingSpend();
  var ui = SpreadsheetApp.getUi();
  var detail = summary.ok.map(function (r) { return '✓ ' + r.label; })
    .concat(summary.failed.map(function (r) { return '✗ ' + r.label + ' — ' + r.error; }))
    .join('\n');
  ui.alert('Selesai: ' + summary.ok.length + ' berhasil, ' + summary.failed.length + ' gagal.\n\n' +
    (detail || '(tidak ada brand terdaftar)'));
}

// ============================================================
// WEB APP — halaman berdiri sendiri, tidak perlu buka Google Sheets
// ============================================================

/**
 * Dipanggil otomatis saat URL Web App (hasil Deploy > New deployment
 * > Web app, lihat catatan pemasangan di atas) dibuka lewat browser.
 * Pakai file HTML yang SAMA dengan sidebar (Sidebar.html) — isinya
 * generik, google.script.run jalan sama persis baik dipanggil dari
 * sidebar maupun dari halaman Web App, jadi tidak perlu file
 * terpisah.
 *
 * PENTING — saat Deploy, pilihan "Execute as":
 * - "Me" (DISARANKAN untuk kasus kamu): seluruh aksi di halaman
 *   (test, simpan, baca/tulis sheet) jalan pakai identitas AKUN
 *   YANG DEPLOY. Siapa pun yang buka link tidak perlu punya akses
 *   ke Google Sheets brand apa pun sama sekali — cocok dengan
 *   permintaan "buka halaman, otomatis sudah terhubung".
 * - "User accessing the web app": tiap orang pakai identitas
 *   Google mereka sendiri, artinya tiap orang yang mau tambah/test
 *   brand butuh akses sendiri ke sheet brand itu (sama seperti
 *   sidebar versi sebelumnya).
 * Access-nya diatur terpisah di dialog Deploy yang sama — "Anyone
 * with the link" paling praktis, tapi kalau kantor pakai Google
 * Workspace, "Anyone within [nama domain]" lebih aman (link yang
 * bocor ke luar tidak bisa dipakai).
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('Daily Tracking — Konfigurasi Brand')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * JSON API TERPADU untuk 3 automasi (Weekly Campaign Review, Daily
 * Urgent Check, Daily Tracking Boost Post) — didesain untuk dipanggil
 * backend ATLAS (server-to-server), BUKAN langsung dari browser/
 * frontend ATLAS (lihat catatan Content-Type di bawah, soal kenapa).
 *
 * Body request (JSON, dikirim sebagai text): { action, apiKey, payload }
 *   apiKey  : harus cocok dengan Script Property API_SHARED_KEY
 *
 *   action                | payload           | efek
 *   -----------------------|-------------------|----------------------------
 *   accounts               | -                 | list ringkas semua akun -- hardcoded
 *                          |                   | (CONFIG.ACCOUNTS) + dinamis (DYNAMIC_ACCOUNTS)
 *   log                    | { limit? }        | N baris terakhir tab "Automation Log"
 *                          |                   | (default limit 20), dipakai 3 tab
 *   weeklyRun               | -                | JALANKAN weeklyRun() SUNGGUHAN —
 *                          |                   | tulis 2 tab sheet + kirim email
 *   weeklyCheckTokens       | -                | cek semua token Meta Ads hidup
 *   dailyRun                 | -                | JALANKAN dailyUrgentCheck() SUNGGUHAN —
 *                          |                   | email cuma terkirim kalau ada temuan
 *   dailyResetCooldown       | -                | reset cooldown alert harian
 *   trackingList             | -                | list semua config brand Daily Tracking
 *   trackingSave             | object config    | tambah/update 1 brand (tervalidasi ke sheet asli)
 *   trackingDelete           | { id }           | hapus 1 config brand
 *   trackingPreview          | { id }           | dry run 1 brand, TIDAK menulis ke sheet
 *   trackingRunAll           | -                | JALANKAN untuk SEMUA brand — menulis ke sheet
 *   accountTrackingPreview   | { client, type } | dry run 1 akun Brand & Langganan (TANPA config
 *                          |                   | Daily Tracking) -- lihat catatan brandSave di bawah.
 *                          |                   | `type` ('MAIN'|'CPAS', default 'MAIN') WAJIB
 *                          |                   | disertakan kalau brand yang sama punya akun MAIN
 *                          |                   | DAN CPAS -- client saja ambigu (lihat findAccount_).
 *   accountTrackingRun       | { client, type } | JALANKAN 1 akun Brand & Langganan sungguhan --
 *                          |                   | push ke ATLAS, TIDAK ada Sheet untuk ditulis
 *   brandList                | -                | list semua brand (hardcoded + dinamis), TANPA
 *                          |                   | setelan notifikasi apa pun -- lihat uiListBrands_
 *   brandSave                | object brand     | tambah/update 1 brand DINAMIS -- id, client, type,
 *                          |                   | token, boostMatch, atlasBrandId. Lihat uiSaveBrand_.
 *                          |                   | TIDAK ADA lagi threshold/metrik/override di sini
 *                          |                   | sejak v6 -- itu semua pindah ke Langganan.
 *   brandDelete              | { id }           | hapus 1 brand dinamis + CASCADE hapus semua
 *                          |                   | langganannya. Tetap ditolak kalau masih dipakai
 *                          |                   | config Daily Tracking manapun.
 *   subscriptionList          | -                | list semua langganan (email + brand + metrik +
 *                          |                   | threshold + pengaman + periode)
 *   subscriptionSave          | object langganan | tambah/update 1 langganan -- lihat uiSaveSubscription_.
 *                          |                   | Email TIDAK BISA diubah saat edit (sertakan `id`).
 *                          |                   | Duplikat email+brand ditolak dengan error yang
 *                          |                   | menyebut id langganan yang sudah ada.
 *   subscriptionDelete        | { id }           | hapus 1 langganan. TIDAK menghapus brand-nya.
 *
 * action `save`   -> payload sama seperti field form: label, sheetUrl,
 *                    tabName, headerRow, dateHeader, boostHeader,
 *                    nonBoostHeader, accountClient, accountType, boostMatch,
 *                    emailOnFailure (sertakan `id` untuk edit yang sudah ada).
 *                    accountType ('MAIN'|'CPAS', default 'MAIN') WAJIB
 *                    disertakan bersama accountClient -- satu brand bisa
 *                    punya akun MAIN dan CPAS dengan client SAMA PERSIS,
 *                    jadi accountClient saja ambigu (lihat findAccount_).
 *                    Ditambah sejak integrasi ATLAS Daily Tracking:
 *                    atlasBrandId (integer, id brand di tabel public.brands
 *                    ATLAS — dipakai untuk (a) mem-filter dropdown "Pilih
 *                    config" di halaman Daily Tracking ATLAS supaya cuma
 *                    menampilkan config brand yang sedang dibuka, dan (b)
 *                    tujuan push otomatis jam 01:00, lihat postToAtlas_ di
 *                    bawah — config TANPA atlasBrandId dilewati saat push,
 *                    tapi tetap jalan normal untuk penulisan ke Sheet).
 *
 *                    Sebuah config bisa untuk akun accountClient BERTIPE
 *                    MAIN atau BERTIPE CPAS (lihat brandSave di bawah) —
 *                    satu brand yang punya keduanya biasanya berarti DUA
 *                    config Daily Tracking terpisah (mis. "Petite Fleur -
 *                    MAIN" dan "Petite Fleur - CPAS"), bukan satu:
 *                    - accountClient BERTIPE MAIN: boostHeader,
 *                      nonBoostHeader, boostMatch WAJIB diisi (klasifikasi
 *                      Boost/Non-Boost seperti biasa). cpasAccountId di
 *                      config ini OPSIONAL — kalau diisi (act_... akun CPAS
 *                      TERPISAH milik brand yang sama), amount spent SEMUA
 *                      campaign akun itu (H-1, TANPA pembagian nama)
 *                      digabung sebagai cpasSpend DI CONFIG MAIN INI (jadi
 *                      satu config sekaligus mengisi ketiganya) — pola ini
 *                      opsional, dua config terpisah di atas lebih umum.
 *                    - accountClient BERTIPE CPAS: boostHeader/
 *                      nonBoostHeader/boostMatch TIDAK DIPAKAI (otomatis
 *                      null) — TIDAK ADA klasifikasi sama sekali, semua
 *                      campaign akun itu dijumlah langsung jadi cpasSpend.
 *                      cpasAccountId di config ini SELALU null (accountClient
 *                      itu sendiri sudah CPAS-nya). cpasHeader (nama kolom
 *                      sheet untuk cpasSpend, default 'CPAS Shopee') WAJIB
 *                      diisi untuk kedua bentuk CPAS di atas.
 *
 *                    Halaman Daily Tracking ATLAS men-sync SEMUA config yang
 *                    atlasBrandId-nya cocok dengan brand yang sedang dibuka
 *                    dalam satu klik "Sync Meta Sekarang" — jadi brand dengan
 *                    dua config (MAIN + CPAS) otomatis mengisi Boost Post,
 *                    Non-Boost Post, DAN CPAS sekaligus, masing-masing dari
 *                    config-nya sendiri.
 *
 * action `brandSave` -> payload: { id (act_..., wajib, unik), client (nama
 *                    brand, wajib, unik), type ('MAIN'|'CPAS'), token (WAJIB
 *                    untuk brand baru; kosongkan saat edit kalau tidak mau
 *                    ganti token). HANYA brand dinamis yang bisa diedit/
 *                    dihapus lewat action ini — brand hardcoded di
 *                    CONFIG.ACCOUNTS (Weekly.gs) sama sekali tidak tersentuh.
 *
 *                    Sejak transisi menjauh dari Google Sheet, payload ini
 *                    JUGA menerima boostMatch (opsional untuk akun MAIN,
 *                    diabaikan untuk CPAS) dan atlasBrandId (integer, id
 *                    brand di public.brands ATLAS — form Brand & Langganan
 *                    ATLAS otomatis mengisi ini dari nama brand yang dipilih,
 *                    sama seperti config Daily Tracking). Begitu KEDUANYA
 *                    terisi (CPAS cukup atlasBrandId saja, boostMatch tidak
 *                    dipakai), brand ini otomatis ikut ditarik & didorong ke
 *                    ATLAS setiap jam 01:00 WIB lewat
 *                    processAutoAccountTracking_ — TANPA perlu config apa pun
 *                    di tab Daily Tracking sama sekali (tab itu tetap
 *                    didukung penuh untuk brand yang masih menulis ke Sheet;
 *                    dua jalur ini independen dan tidak saling menggantikan
 *                    — kalau sebuah accountClient sudah punya config Daily
 *                    Tracking, jalur Brand & Langganan ini dilewati untuk
 *                    akun itu supaya tidak diproses dua kali).
 *
 * action `subscriptionSave` -> payload: { id (opsional, sertakan untuk edit),
 *                    email (wajib saat buat baru, diabaikan saat edit),
 *                    brandId (act_..., wajib),
 *                    weeklyMetrics: [ { id?, field, ruleType:'delta', direction:'up'|'down', threshold } ],
 *                    weeklyGuards: { minSpend, minResults } (opsional),
 *                    dailyMetrics: [ { id?, field, ruleType:'delta'|'zero', direction?, threshold? } ],
 *                    dailyGuards: { minSpendDaily, minBaselineRes } (opsional),
 *                    periods: { weeklyDays, wideDays, baselineDays } (opsional) }.
 *                    field: 'spend'|'results'|'cpr'|'ctr'|'cpm'|'frequency'|'impressions'|'reach'.
 *                    ruleType 'zero' (tanpa direction/threshold) cuma untuk field
 *                    'spend'/'results', dan cuma valid di dailyMetrics (Weekly
 *                    tidak punya konsep "kemarin"). Minimal satu aturan total
 *                    (weekly + daily) wajib ada -- lihat normalizeMetricRules_.
 *
 * PENTING soal action berefek samping nyata (weeklyRun, dailyRun,
 * trackingRunAll, trackingSave/Delete, brandSave/Delete,
 * subscriptionSave/Delete) — semuanya BENERAN mengubah data (tulis
 * sheet / kirim email / simpan token / hapus langganan orang lain
 * lewat cascade brandDelete). Beri konfirmasi di UI ATLAS sebelum
 * memanggilnya — khusus brandDelete, sebutkan jumlah & email
 * langganan yang akan ikut terhapus (frontend sudah punya data ini
 * dari subscriptionList, filter by brandId, SEBELUM memanggil
 * brandDelete).
 *
 * SETUP API_SHARED_KEY (sekali saja, manual, tidak lewat kode):
 *   Editor Apps Script > Project Settings (ikon gerigi) > Script
 *   Properties > Add script property > key "API_SHARED_KEY",
 *   value = string acak panjang buatan sendiri. Simpan value yang
 *   sama di sisi ATLAS (mis. environment variable), jangan pernah
 *   ditaruh di kode frontend / kode yang ke-commit ke repo publik.
 *
 * SETUP ATLAS_INGEST_URL / ATLAS_INGEST_KEY (sekali saja, manual) —
 *   ini ARAH SEBALIKNYA dari API_SHARED_KEY di atas: script ini yang
 *   memanggil KELUAR ke backend ATLAS setiap kali
 *   updateAllDailyTrackingSpend() berhasil menulis satu brand (lihat
 *   postToAtlas_ di bawah), supaya angka Boost Post/Non-Boost/CPAS
 *   yang sama juga masuk ke halaman Daily Tracking ATLAS (Postgres),
 *   bukan cuma ke cell Google Sheet seperti sebelumnya.
 *   Editor Apps Script > Project Settings > Script Properties > Add:
 *     ATLAS_INGEST_URL  = https://<domain-atlas-kamu>/api/daily-tracking/ingest
 *     ATLAS_INGEST_KEY  = string acak panjang, HARUS SAMA PERSIS dengan
 *                         env var DAILY_TRACKING_INGEST_API_KEY di backend
 *                         ATLAS (backend/.env / Vercel env vars).
 *   Kalau salah satu properti ini kosong, atau config yang diproses
 *   tidak punya atlasBrandId, push ke ATLAS dilewati diam-diam (tidak
 *   dianggap error) — penulisan ke Google Sheet tetap jalan seperti
 *   biasa, tidak terpengaruh.
 *
 * CATATAN Content-Type — kirim body sebagai "text/plain" (BUKAN
 * "application/json") dari sisi ATLAS, walau isinya tetap string
 * JSON biasa. Ini kebiasaan umum untuk Apps Script Web App:
 * "application/json" dari luar memicu CORS preflight (OPTIONS)
 * yang tidak ditangani Apps Script (tidak ada doOptions), request-nya
 * gagal sebelum sampai ke doPost. "text/plain" tidak memicu
 * preflight. doPost tetap JSON.parse() isinya seperti biasa di
 * bawah — cuma soal header Content-Type yang dikirim, bukan format
 * isinya.
 *
 * Contoh dari terminal (bukan dari kode ATLAS, cuma buat tes cepat
 * setelah deploy):
 *   curl -X POST "URL_WEB_APP_KAMU" \
 *     -H "Content-Type: text/plain" \
 *     -d '{"action":"trackingList","apiKey":"GANTI_DENGAN_KEY_ASLI"}'
 */
function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    checkApiKey_(body.apiKey);
    var payload = body.payload || {};

    switch (body.action) {
      // --- shared (dipakai ketiga tab) ---
      case 'accounts':
        out = { ok: true, data: getAllAccounts_().map(function (a) {
          return { client: a.client, id: a.id, type: a.type || '' };
        }) };
        break;
      case 'log':
        out = { ok: true, data: getRecentLog_(payload.limit || 20) };
        break;

      // --- Alur 1: kelola Brand (kredensial ad account, TANPA notifikasi) ---
      case 'brandList':
        out = { ok: true, data: uiListBrands_() };
        break;
      case 'brandSave':
        out = { ok: true, data: uiSaveBrand_(payload) };
        break;
      case 'brandDelete':
        out = { ok: true, data: uiDeleteBrand_(payload.id) };
        break;

      // --- Alur 2: kelola Langganan (siapa dinotifikasi, metrik & threshold) ---
      case 'subscriptionList':
        out = { ok: true, data: uiListSubscriptions_() };
        break;
      case 'subscriptionSave':
        out = { ok: true, data: uiSaveSubscription_(payload) };
        break;
      case 'subscriptionDelete':
        out = { ok: true, data: uiDeleteSubscription_(payload.id) };
        break;

      // --- tab Weekly ---
      case 'weeklyRun':
        weeklyRun();
        out = { ok: true, data: { message: 'weeklyRun() selesai — cek tab Weekly Campaign Review / Weekly Adset Drilldown & email.' } };
        break;
      case 'weeklyCheckTokens':
        out = { ok: true, data: checkTokensJson_() };
        break;

      // --- tab Daily ---
      case 'dailyRun':
        dailyUrgentCheck();
        out = { ok: true, data: { message: 'dailyUrgentCheck() selesai — email cuma terkirim kalau ada temuan (atau kalau ada akun gagal ditarik).' } };
        break;
      case 'dailyResetCooldown':
        resetUrgentCooldown();
        out = { ok: true, data: { message: 'Cooldown direset — temuan yang sama akan dikirim ulang di run berikutnya.' } };
        break;

      // --- tab Daily Tracking ---
      case 'trackingList':
        out = { ok: true, data: uiListConfigs() };
        break;
      case 'trackingSave':
        out = { ok: true, data: uiSaveConfig(payload) };
        break;
      case 'trackingDelete':
        out = { ok: true, data: uiDeleteConfig(payload.id) };
        break;
      case 'trackingPreview':
        out = { ok: true, data: uiPreviewConfig(payload.id) };
        break;
      case 'trackingRunAll':
        out = { ok: true, data: updateAllDailyTrackingSpend() };
        break;

      // --- akun Brand & Langganan TANPA config Daily Tracking ---
      case 'accountTrackingPreview':
        out = { ok: true, data: uiPreviewAccountTracking_(payload.client, payload.type) };
        break;
      case 'accountTrackingRun':
        out = { ok: true, data: uiRunAccountTracking_(payload.client, payload.type) };
        break;

      default:
        throw new Error('action tidak dikenal: ' + body.action);
    }
  } catch (err) {
    out = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkApiKey_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_SHARED_KEY');
  if (!expected) {
    throw new Error('API_SHARED_KEY belum di-set di Script Properties — set dulu lewat ' +
      'Project Settings sebelum dipanggil dari luar.');
  }
  if (!key || key !== expected) {
    throw new Error('apiKey tidak valid.');
  }
}

/**
 * Duplikat ringan dari checkTokens() (Weekly.gs) yang MENGEMBALIKAN
 * hasil sebagai data, bukan cuma Logger.log — checkTokens() aslinya
 * sengaja tidak diubah/disentuh sama sekali (biar nol risiko ke
 * automasi weekly yang sudah jalan), fungsi ini cuma reuse
 * CONFIG/fetchJson_/tokenFor_ yang sama.
 */
function checkTokensJson_() {
  return getAllAccounts_().map(function (acct) {
    try {
      var body = fetchJson_('https://graph.facebook.com/' + CONFIG.API_VERSION + '/' +
        acct.id + '?fields=name,account_status,currency,business' +
        '&access_token=' + encodeURIComponent(tokenFor_(acct)));
      return {
        client: acct.client, type: acct.type || 'MAIN', ok: true,
        accountName: body.name, currency: body.currency,
        business: (body.business && body.business.name) || null
      };
    } catch (e) {
      return { client: acct.client, type: acct.type || 'MAIN', ok: false, error: e.message };
    }
  });
}

/**
 * Baca N baris terakhir tab "Automation Log" (CONFIG.TAB_LOG) —
 * dipakai ketiga tab weeklyRun/dailyUrgentCheck/tracking sama-sama
 * menulis ke tab ini. Tiap baris detail-nya diberi prefix [WEEKLY] /
 * [DAILY] / [TRACKING] (lihat writeLog_ di masing-masing file) supaya
 * ATLAS bisa filter per-tab dari satu log yang sama.
 */
function getRecentLog_(limit) {
  var ss = openSpreadsheet_();
  var sheet = ss.getSheetByName(CONFIG.TAB_LOG);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var n = Math.min(limit, lastRow - 1);
  var startRow = lastRow - n + 1;
  var values = sheet.getRange(startRow, 1, n, 4).getValues();
  return values.reverse().map(function (r) {
    return {
      timestamp: Utilities.formatDate(new Date(r[0]), tz_(), 'yyyy-MM-dd HH:mm:ss'),
      durationSec: r[1],
      status: r[2],
      detail: r[3]
    };
  });
}

// ============================================================
// FUNGSI YANG DIPANGGIL SIDEBAR / WEB APP (google.script.run)
// ============================================================

function uiListConfigs() {
  return getTrackingConfigs_();
}

function uiListAccountClients() {
  return getAllAccounts_().map(function (a) { return a.client; });
}

/**
 * Simpan (tambah/edit) satu konfigurasi brand. Memvalidasi
 * langsung ke sheet aslinya SEBELUM menyimpan — supaya salah
 * ketik ketahuan saat itu juga, bukan pas trigger 01:00 gagal
 * diam-diam. Melempar Error kalau ada yang tidak valid; pesan
 * error-nya langsung muncul di sidebar.
 */
function uiSaveConfig(cfg) {
  var sheetId = extractSheetId_(cfg.sheetUrl);
  if (!sheetId) {
    throw new Error('Link Google Sheets tidak valid — pastikan link lengkap (mengandung "/d/ID/").');
  }

  // accountType: WAJIB disertakan bersama accountClient begitu ada payload
  // baru dari form -- satu client bisa punya akun MAIN dan CPAS dengan nama
  // SAMA PERSIS, jadi accountClient saja ambigu (lihat catatan panjang di
  // findAccount_). Default 'MAIN' cuma untuk kompatibilitas config lama yang
  // disimpan sebelum field ini ada.
  var accountType = String(cfg.accountType || 'MAIN').toUpperCase();
  var acct = findAccount_(cfg.accountClient, accountType);
  if (!acct) {
    throw new Error('Akun "' + cfg.accountClient + '" tipe ' + accountType + ' tidak ditemukan (bukan akun hardcoded maupun akun dinamis yang terdaftar).');
  }

  var headerRow = parseInt(cfg.headerRow, 10);
  if (!headerRow || headerRow < 1) headerRow = 3;

  // Config untuk akun bertipe CPAS-nya sendiri (brand dengan MAIN dan CPAS
  // sebagai dua config Daily Tracking terpisah) TIDAK punya klasifikasi
  // Boost/Non-Boost sama sekali -- lihat processTrackingConfig_. Bolt-on
  // cpasAccountId (config MAIN yang menggabungkan CPAS dari akun terpisah)
  // cuma masuk akal kalau akun primer-nya sendiri MAIN.
  var isPrimaryCpas = (acct.type || 'MAIN').toUpperCase() === 'CPAS';

  var cpasAccountId = '';
  var cpasAcct = null;
  if (!isPrimaryCpas) {
    cpasAccountId = String(cfg.cpasAccountId || '').trim();
    if (cpasAccountId) {
      cpasAcct = findAccountById_(cpasAccountId);
      if (!cpasAcct) {
        throw new Error('Akun CPAS "' + cpasAccountId + '" tidak ditemukan.');
      }
      if ((cpasAcct.type || 'MAIN') !== 'CPAS') {
        throw new Error('Akun "' + cpasAccountId + '" bukan bertipe CPAS (tipe: ' + (cpasAcct.type || 'MAIN') + ').');
      }
    }
  }

  // atlasBrandId: opsional (lewat tanpa nilai tetap bisa menulis ke Sheet
  // seperti biasa — cuma tidak akan ikut push otomatis ke ATLAS/muncul di
  // dropdown "Pilih config" Daily Tracking ATLAS).
  var atlasBrandId = (cfg.atlasBrandId === undefined || cfg.atlasBrandId === null || cfg.atlasBrandId === '')
    ? null : parseInt(cfg.atlasBrandId, 10);
  if (atlasBrandId !== null && !isFinite(atlasBrandId)) {
    throw new Error('atlasBrandId harus berupa angka.');
  }

  var needsCpasHeader = isPrimaryCpas || !!cpasAccountId;

  var normalized = {
    id: cfg.id || Utilities.getUuid(),
    label: (cfg.label || '').trim() || cfg.accountClient,
    sheetId: sheetId,
    tabName: (cfg.tabName || '').trim(),
    headerRow: headerRow,
    dateHeader: (cfg.dateHeader || 'Date').trim(),
    boostHeader: isPrimaryCpas ? null : (cfg.boostHeader || 'Boost Post').trim(),
    nonBoostHeader: isPrimaryCpas ? null : (cfg.nonBoostHeader || '').trim(),
    accountClient: cfg.accountClient,
    accountType: accountType,
    boostMatch: isPrimaryCpas ? null : (cfg.boostMatch || 'profile visit').trim().toLowerCase(),
    emailOnFailure: !!cfg.emailOnFailure,
    atlasBrandId: atlasBrandId,
    cpasAccountId: cpasAccountId || null,
    cpasHeader: needsCpasHeader ? ((cfg.cpasHeader || 'CPAS Shopee').trim() || 'CPAS Shopee') : null
  };

  if (!normalized.tabName) throw new Error('Nama tab wajib diisi.');
  if (isPrimaryCpas) {
    if (!normalized.cpasHeader) throw new Error('Nama kolom CPAS wajib diisi.');
  } else {
    if (!normalized.nonBoostHeader) throw new Error('Nama kolom non-boost wajib diisi.');
    if (!normalized.boostMatch) throw new Error('Kata kunci Boost Post wajib diisi.');
  }

  // Validasi: sheet & tab harus ada, dan setiap header yang relevan untuk
  // tipe akun ini (termasuk CPAS kalau berlaku) harus ketemu persis.
  var sheet = openTrackingSheet_(normalized);
  resolveTrackingColumns_(sheet, normalized, isPrimaryCpas);

  var list = getTrackingConfigs_();
  var idx = -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === normalized.id) idx = i;
  }
  if (idx > -1) list[idx] = normalized; else list.push(normalized);
  saveTrackingConfigs_(list);

  return normalized;
}

function uiDeleteConfig(id) {
  var list = getTrackingConfigs_().filter(function (c) { return c.id !== id; });
  saveTrackingConfigs_(list);
  return list;
}

/** Dry run satu konfigurasi (dipanggil tombol "Test" di sidebar). Tidak menulis ke sheet. */
function uiPreviewConfig(id) {
  var cfg = findConfigById_(id);
  if (!cfg) throw new Error('Konfigurasi tidak ditemukan (mungkin baru saja dihapus).');
  return processTrackingConfig_(cfg, true);
}

// ============================================================
// PENYIMPANAN KONFIGURASI (Script Properties, format JSON)
// ============================================================

function getTrackingConfigs_() {
  var raw = PropertiesService.getScriptProperties().getProperty(TRACKING_STORE_KEY);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveTrackingConfigs_(list) {
  PropertiesService.getScriptProperties().setProperty(TRACKING_STORE_KEY, JSON.stringify(list));
}

function findConfigById_(id) {
  var list = getTrackingConfigs_();
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

/** Terima link penuh ATAU ID mentah, kembalikan ID spreadsheet-nya saja. */
function extractSheetId_(urlOrId) {
  var s = (urlOrId || '').trim();
  var m = s.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
  return null;
}

/**
 * Cari akun by NAMA + TIPE (default 'MAIN' kalau type tidak disertakan --
 * mayoritas pemanggilan lama). WAJIB dua-duanya, bukan cuma nama: satu brand
 * bisa punya akun MAIN dan CPAS dengan client SAMA PERSIS (mis. "Crabus" -
 * MAIN dan "Crabus" - CPAS) -- versi lama fungsi ini cuma cocokkan nama, jadi
 * kalau dipanggil dua kali dengan nama yang sama (sekali untuk akun MAIN,
 * sekali untuk akun CPAS) SELALU mengembalikan akun yang sama (yang terakhir
 * ditemukan getAllAccounts_()), diam-diam salah untuk salah satu panggilan.
 * Itu sebabnya Sync Meta Sekarang untuk "Crabus - CPAS" ikut menghasilkan
 * angka Boost/Non-Boost milik akun MAIN, bukan angka CPAS akun CPAS-nya.
 */
function findAccount_(clientName, type) {
  var wantType = String(type || 'MAIN').toUpperCase();
  var found = null;
  getAllAccounts_().forEach(function (a) {
    if (a.client === clientName && (a.type || 'MAIN') === wantType) found = a;
  });
  return found;
}

// ============================================================
// ALUR 1: KELOLA BRAND (kredensial ad account, TANPA notifikasi)
// ============================================================
// getDynamicAccounts_/saveDynamicAccounts_/getAllAccounts_/findAccountById_
// ada di Weekly.gs -- dipakai di sini apa adanya (satu project, satu
// global scope). Brand TIDAK menyimpan threshold/metrik apa pun sejak
// v6 -- itu semua ada di Langganan (bagian di bawah).

/** List semua brand (hardcoded + dinamis). Token asli TIDAK PERNAH dikembalikan, cuma hasToken. */
function uiListBrands_() {
  return getAllAccounts_().map(function (a) {
    return {
      id: a.id,
      client: a.client,
      type: a.type || 'MAIN',
      source: a.source || 'static',
      hasToken: !!(a.tokenKey && PropertiesService.getScriptProperties().getProperty(a.tokenKey)),
      // boostMatch + atlasBrandId: begitu keduanya terisi (CPAS cuma butuh
      // atlasBrandId, tidak butuh boostMatch -- lihat updateAllDailyTrackingSpend),
      // brand ini otomatis ikut ditarik & didorong ke ATLAS setiap jam 01:00
      // WIB TANPA perlu config apa pun di tab Daily Tracking sama sekali.
      // Tab Daily Tracking tetap ada untuk brand yang masih menulis ke Google
      // Sheet -- dua jalur ini independen, salah satu cukup.
      boostMatch: a.boostMatch || null,
      atlasBrandId: a.atlasBrandId || null
    };
  });
}

/**
 * Tambah/edit satu brand DINAMIS. Brand hardcoded (CONFIG.ACCOUNTS di
 * Weekly.gs) sama sekali tidak bisa disentuh lewat sini.
 *
 * payload.id = Meta Ads Ad Account ID (act_...), dipakai juga sebagai
 * kunci untuk tahu ini tambah baru atau edit yang sudah ada. Token
 * cuma wajib diisi saat tambah baru; saat edit, kosongkan kalau tidak
 * mau ganti token yang sudah tersimpan. Nama brand harus unik lintas
 * SEMUA brand (hardcoded + dinamis lain).
 */
function uiSaveBrand_(payload) {
  payload = payload || {};

  var id = String(payload.id || '').trim();
  if (!id) throw new Error('ID akun (act_...) wajib diisi.');
  if (id.indexOf('act_') !== 0) id = 'act_' + id;

  var client = String(payload.client || '').trim();
  if (!client) throw new Error('Nama brand wajib diisi.');

  var type = String(payload.type || 'MAIN').trim().toUpperCase();
  if (type !== 'MAIN' && type !== 'CPAS') {
    throw new Error('Tipe ad account harus MAIN atau CPAS.');
  }

  var isHardcoded = CONFIG.ACCOUNTS.some(function (a) { return a.id === id; });
  if (isHardcoded) {
    throw new Error('Akun "' + id + '" sudah terdaftar sebagai akun hardcoded di kode (CONFIG.ACCOUNTS) — tidak bisa diedit lewat ATLAS, ubah manual di Apps Script kalau perlu.');
  }

  var list = getDynamicAccounts_();
  var idx = -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) idx = i;
  }
  var existing = idx > -1 ? list[idx] : null;

  // Unik per KOMBINASI nama+tipe (bukan nama saja) -- satu brand boleh
  // punya lebih dari satu ad account (mis. MAIN dan CPAS) dengan nama
  // yang sama, dibedakan lewat tipe. Form Langganan di ATLAS memilihnya
  // lewat dua langkah: Brand (nama) lalu Tipe.
  var nameTypeTaken = getAllAccounts_().some(function (a) {
    return a.id !== id && a.client.toLowerCase() === client.toLowerCase() && (a.type || 'MAIN') === type;
  });
  if (nameTypeTaken) {
    throw new Error('Brand "' + client + '" tipe ' + type + ' sudah ada — kombinasi nama+tipe harus unik.');
  }

  var token = String(payload.token || '').trim();
  if (!token && !existing) {
    throw new Error('Token wajib diisi untuk brand baru.');
  }
  var tokenKey = existing ? existing.tokenKey : slugifyForTokenKey_(client);
  if (token) {
    PropertiesService.getScriptProperties().setProperty(tokenKey, token);
  }

  // boostMatch: kata kunci klasifikasi Boost Post, sama persis konsepnya
  // dengan cfg.boostMatch di tab Daily Tracking -- ini yang membuat brand
  // ini ikut diproses otomatis jam 01:00 WIB TANPA perlu config Daily
  // Tracking sama sekali (lihat updateAllDailyTrackingSpend). Opsional:
  // brand yang dipakai cuma untuk Weekly/Daily alert (bukan Daily Tracking)
  // boleh dibiarkan kosong.
  var boostMatch = String(payload.boostMatch || '').trim().toLowerCase();

  // atlasBrandId: opsional juga, tapi WAJIB diisi (dari sisi form ATLAS,
  // yang otomatis mencocokkan `client` ke brand_id ATLAS) supaya boostMatch
  // di atas ada gunanya -- tanpa ini, akun boleh punya boostMatch tapi tidak
  // akan pernah didorong ke ATLAS (tidak tahu ini brand_id berapa).
  var atlasBrandId = (payload.atlasBrandId === undefined || payload.atlasBrandId === null || payload.atlasBrandId === '')
    ? null : parseInt(payload.atlasBrandId, 10);
  if (atlasBrandId !== null && !isFinite(atlasBrandId)) {
    throw new Error('atlasBrandId harus berupa angka.');
  }

  var normalized = {
    id: id, client: client, type: type, tokenKey: tokenKey, source: 'dynamic',
    boostMatch: boostMatch || null, atlasBrandId: atlasBrandId
  };

  if (idx > -1) list[idx] = normalized; else list.push(normalized);
  saveDynamicAccounts_(list);

  return uiListBrands_().filter(function (a) { return a.id === id; })[0];
}

/**
 * Hapus satu brand dinamis + token propertinya. Menolak kalau masih
 * dipakai config Daily Tracking. Kalau lolos, CASCADE hapus semua
 * langganan brand ini juga (sesuai desain: brand tanpa langganan boleh
 * ada, tapi langganan tanpa brand tidak masuk akal) -- daftar email
 * yang kena cascade dikembalikan supaya UI bisa mengonfirmasi.
 */
function uiDeleteBrand_(id) {
  id = String(id || '').trim();
  var list = getDynamicAccounts_();
  var target = null;
  list.forEach(function (a) { if (a.id === id) target = a; });
  if (!target) {
    throw new Error('Brand dinamis dengan id "' + id + '" tidak ditemukan (brand hardcoded tidak bisa dihapus lewat sini).');
  }

  var usedByTracking = getTrackingConfigs_().filter(function (c) { return c.accountClient === target.client; });
  if (usedByTracking.length) {
    throw new Error('Brand "' + target.client + '" masih dipakai ' + usedByTracking.length +
      ' config Daily Tracking (' + usedByTracking.map(function (c) { return c.label; }).join(', ') +
      '). Hapus/ubah config itu dulu sebelum menghapus brand-nya.');
  }

  var subs = getSubscriptions_();
  var removedSubs = subs.filter(function (s) { return s.brandId === id; });
  var remainingSubs = subs.filter(function (s) { return s.brandId !== id; });
  saveSubscriptions_(remainingSubs);

  var remainingAccounts = list.filter(function (a) { return a.id !== id; });
  saveDynamicAccounts_(remainingAccounts);
  if (target.tokenKey) {
    PropertiesService.getScriptProperties().deleteProperty(target.tokenKey);
  }

  return {
    brands: uiListBrands_(),
    removedSubscriptions: removedSubs.length,
    removedSubscriptionEmails: removedSubs.map(function (s) { return s.email; })
  };
}

function slugifyForTokenKey_(label) {
  var slug = String(label || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!slug) slug = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
  return 'META_TOKEN_DYN_' + slug;
}

function isPlainObject_(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

var ZERO_RULE_FIELDS_ = { spend: 1, results: 1 };

/**
 * Validasi & normalisasi satu daftar aturan metrik (weeklyMetrics ATAU
 * dailyMetrics) dari payload ATLAS. Field yang valid diambil langsung
 * dari METRIC_FIELDS (Weekly.gs, satu global scope) -- bukan daftar
 * terpisah di sini, supaya tidak bisa drift kalau field ditambah lagi.
 * Mempertahankan `id` aturan yang sudah ada (dikirim balik dari form
 * edit) supaya sidik jari cooldown (Daily.gs, email|campaignId|ruleId)
 * tidak reset untuk aturan yang tidak diubah -- cuma aturan benar-benar
 * baru (tanpa id) yang dapat uuid baru.
 */
function normalizeMetricRules_(arr, allowZero, label) {
  if (!Array.isArray(arr)) return [];
  return arr.map(function (r) {
    r = r || {};
    var field = String(r.field || '').trim();
    if (!METRIC_FIELDS[field]) {
      throw new Error('Field metrik "' + field + '" tidak dikenal (' + label + ').');
    }
    var ruleType = r.ruleType === 'zero' ? 'zero' : 'delta';
    if (ruleType === 'zero') {
      if (!allowZero) throw new Error('Aturan "berhenti (nol)" cuma bisa dipakai di metrik Daily (' + label + ').');
      if (!ZERO_RULE_FIELDS_[field]) throw new Error('Aturan "berhenti (nol)" cuma berlaku untuk field spend atau results (' + label + ').');
      return { id: String(r.id || Utilities.getUuid()), field: field, ruleType: 'zero' };
    }
    var direction = r.direction === 'up' ? 'up' : (r.direction === 'down' ? 'down' : null);
    if (!direction) throw new Error('Arah aturan (naik/turun) wajib diisi untuk field ' + field + ' (' + label + ').');
    var threshold = Number(r.threshold);
    if (!isFinite(threshold) || threshold <= 0) {
      throw new Error('Threshold aturan ' + field + ' harus angka lebih besar dari 0 (' + label + ').');
    }
    return { id: String(r.id || Utilities.getUuid()), field: field, ruleType: 'delta', direction: direction, threshold: threshold };
  });
}

// ============================================================
// ALUR 2: KELOLA LANGGANAN (siapa dinotifikasi, metrik & threshold)
// ============================================================
// getSubscriptions_/saveSubscriptions_/numOr_/weeklySettingsFor_ ada di
// Weekly.gs, dailySettingsFor_ ada di Daily.gs.

/** List semua langganan, dilengkapi nama brand (brandClient) supaya UI tidak perlu join sendiri. */
function uiListSubscriptions_() {
  var accountsById = {};
  getAllAccounts_().forEach(function (a) { accountsById[a.id] = a; });
  return getSubscriptions_().map(function (s) {
    var brand = accountsById[s.brandId];
    var out = {};
    Object.keys(s).forEach(function (k) { out[k] = s[k]; });
    out.brandClient = brand ? brand.client : '(brand tidak ditemukan)';
    return out;
  });
}

/**
 * Tambah/edit satu langganan. Satu baris = satu kombinasi email+brand.
 *
 * - Tambah baru: payload.email wajib, tanpa payload.id. Duplikat
 *   email+brand ditolak dengan error yang menyebut id langganan yang
 *   sudah ada (supaya UI bisa mengarahkan ke form edit, bukan bikin
 *   baris baru).
 * - Edit: sertakan payload.id. Email TIDAK BISA diubah lewat edit --
 *   payload.email diabaikan, email lama dipertahankan. Untuk pindah
 *   penerima, hapus langganan lalu buat baru.
 * - Minimal satu metrik (weekly ATAU daily) wajib true, langganan
 *   tanpa metrik ditolak.
 */
function uiSaveSubscription_(payload) {
  payload = payload || {};

  var id = String(payload.id || '').trim();
  var list = getSubscriptions_();
  var existing = null, idx = -1;
  if (id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { existing = list[i]; idx = i; }
    }
    if (!existing) throw new Error('Langganan dengan id "' + id + '" tidak ditemukan.');
  }

  var email = existing ? existing.email : String(payload.email || '').trim().toLowerCase();
  if (!email) throw new Error('Email wajib diisi.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Format email tidak valid.');

  var brandId = String(payload.brandId || (existing && existing.brandId) || '').trim();
  if (!brandId) throw new Error('Brand wajib dipilih.');
  var brand = findAccountById_(brandId);
  if (!brand) throw new Error('Brand dengan id "' + brandId + '" tidak ditemukan.');

  if (!existing) {
    var dup = list.filter(function (s) { return s.email === email && s.brandId === brandId; })[0];
    if (dup) {
      throw new Error('Langganan "' + email + '" untuk brand "' + brand.client +
        '" sudah ada (id: ' + dup.id + '). Edit langganan yang sudah ada, jangan buat baru.');
    }
  }

  var weeklyMetrics = normalizeMetricRules_(payload.weeklyMetrics, false, 'Weekly');
  var dailyMetrics = normalizeMetricRules_(payload.dailyMetrics, true, 'Daily');

  if (!weeklyMetrics.length && !dailyMetrics.length) {
    throw new Error('Pilih/tambahkan minimal satu aturan metrik (Weekly atau Daily) — langganan tanpa metrik tidak ada gunanya.');
  }

  var normalized = {
    id: existing ? existing.id : Utilities.getUuid(),
    email: email,
    brandId: brandId,
    weeklyMetrics: weeklyMetrics,
    weeklyGuards: isPlainObject_(payload.weeklyGuards) ? payload.weeklyGuards : {},
    dailyMetrics: dailyMetrics,
    dailyGuards: isPlainObject_(payload.dailyGuards) ? payload.dailyGuards : {},
    periods: isPlainObject_(payload.periods) ? payload.periods : {},
    createdAt: existing ? existing.createdAt : new Date().toISOString()
  };

  if (idx > -1) list[idx] = normalized; else list.push(normalized);
  saveSubscriptions_(list);

  var saved = {};
  Object.keys(normalized).forEach(function (k) { saved[k] = normalized[k]; });
  saved.brandClient = brand.client;
  return saved;
}

/** Hapus satu langganan. TIDAK menghapus brand-nya maupun langganan lain pada brand yang sama. */
function uiDeleteSubscription_(id) {
  var list = getSubscriptions_().filter(function (s) { return s.id !== id; });
  saveSubscriptions_(list);
  return uiListSubscriptions_();
}

// ============================================================
// ENTRY POINT — dipanggil trigger harian
// ============================================================

function updateAllDailyTrackingSpend() {
  var configs = getTrackingConfigs_();
  var ok = [], failed = [];

  configs.forEach(function (cfg) {
    try {
      var r = processTrackingConfig_(cfg, false);
      if (r.status === 'OK') ok.push(r); else failed.push(r);
    } catch (e) {
      var f = { label: cfg.label, status: 'FAILED', error: e.message };
      failed.push(f);
      Logger.log('[%s] Unexpected error: %s', cfg.label, e.message);
    }
    Utilities.sleep(300);
  });

  // --- Brand & Langganan -> ATLAS langsung, TANPA config Daily Tracking ---
  // Transisi menjauh dari Google Sheet: brand yang cuma didaftarkan di
  // Brand & Langganan (uiSaveBrand_) dengan boostMatch terisi (akun CPAS
  // cukup atlasBrandId, tidak butuh boostMatch -- lihat catatan di
  // processAutoAccountTracking_) ikut ditarik & didorong ke ATLAS di sini,
  // TIDAK menulis ke Sheet sama sekali (tidak ada Sheet untuk ditulis). Tab
  // Daily Tracking tetap didukung penuh di atas -- ini jalur TAMBAHAN, bukan
  // pengganti, supaya brand yang sudah pindah pencatatan ke ATLAS tidak
  // perlu isi apa pun di tab Daily Tracking sama sekali. Akun yang SUDAH
  // dicakup satu config Daily Tracking dilewati di sini supaya tidak
  // ditarik & didorong dua kali.
  var configuredClients = {};
  configs.forEach(function (c) { configuredClients[c.accountClient] = true; });

  getAllAccounts_().forEach(function (acct) {
    if (configuredClients[acct.client]) return;
    var isCpas = (acct.type || 'MAIN').toUpperCase() === 'CPAS';
    if (!acct.atlasBrandId || (!isCpas && !acct.boostMatch)) return;
    try {
      var r2 = processAutoAccountTracking_(acct, false);
      if (r2.status === 'OK') ok.push(r2); else failed.push(r2);
    } catch (e) {
      failed.push({ label: acct.client, status: 'FAILED', error: e.message });
      Logger.log('[%s] Unexpected error (auto account): %s', acct.client, e.message);
    }
    Utilities.sleep(300);
  });

  if (!ok.length && !failed.length) {
    Logger.log('Tidak ada brand yang siap diproses -- baik lewat config Daily Tracking ' +
      'maupun lewat Brand & Langganan (boostMatch + atlasBrandId).');
    return { ok: ok, failed: failed };
  }

  try {
    // atlasPush ikut dicantumkan per brand supaya "Sheet OK tapi push ke
    // ATLAS gagal" (a) tidak diam-diam tersembunyi di balik status OK, dan
    // (b) terlihat langsung dari tab Automation Log ATLAS, bukan cuma dari
    // Executions Apps Script yang tidak pernah dibuka dari sisi ATLAS.
    writeLog_(openSpreadsheet_(), new Date(), failed.length ? 'SEBAGIAN GAGAL' : 'OK',
      '[TRACKING] ' + ok.length + ' sukses, ' + failed.length + ' gagal — ' +
      ok.concat(failed).map(function (r) {
        return r.label + ':' + r.status + (r.atlasPush ? ' [ATLAS: ' + r.atlasPush + ']' : '');
      }).join(', '));
  } catch (e) { /* sheet log tidak terjangkau, abaikan */ }

  return { ok: ok, failed: failed };
}

// ============================================================
// LOGIKA INTI — satu konfigurasi, dipakai baik oleh trigger
// maupun tombol Test di sidebar
// ============================================================

function processTrackingConfig_(cfg, dryRun) {
  var startedAt = new Date();
  var tz = tz_();

  var targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - 1);   // H-1
  var dateStr = Utilities.formatDate(targetDate, tz, 'yyyy-MM-dd');
  var dateLabel = Utilities.formatDate(targetDate, tz, 'd MMM yyyy');

  Logger.log('[%s] Processing date: %s', cfg.label, dateStr);

  // cfg.accountType: lihat catatan panjang di findAccount_ -- WAJIB disertakan
  // untuk config yang disimpan setelah perbaikan ini, default 'MAIN' cuma
  // untuk config lama yang belum punya field ini.
  var acct = findAccount_(cfg.accountClient, cfg.accountType);
  if (!acct) {
    return failTracking_(cfg, dateStr, dryRun,
      'Client "' + cfg.accountClient + '" tipe ' + (cfg.accountType || 'MAIN') + ' tidak ditemukan (bukan akun hardcoded maupun akun dinamis yang terdaftar).');
  }

  // Config bisa dibuat untuk akun bertipe MAIN (klasifikasi Boost/Non-Boost
  // lewat boostMatch, seperti semula) ATAU langsung untuk akun bertipe CPAS
  // (satu akun terpisah milik brand yang sama) — kalau primer-nya sendiri
  // CPAS, TIDAK ADA pembagian nama sama sekali: semua spend akun itu
  // dijumlah apa adanya jadi satu angka. Dua bentuk ini independen dari
  // bolt-on cfg.cpasAccountId di bawah (itu untuk kasus SATU config
  // menggabungkan MAIN + CPAS sekaligus; ini untuk kasus CPAS sebagai
  // config-nya sendiri, brand punya dua config terpisah).
  var isPrimaryCpas = (acct.type || 'MAIN').toUpperCase() === 'CPAS';

  // --- 1. Ambil insight campaign untuk tanggal H-1 ---
  var rows;
  try {
    rows = fetchInsights_(tokenFor_(acct), acct.id, 'campaign', { since: dateStr, until: dateStr });
  } catch (e) {
    return failTracking_(cfg, dateStr, dryRun,
      'Gagal menarik data Meta Ads (' + acct.client + '): ' + e.message);
  }

  var boostSpend = null, nonBoostSpend = null, cpasSpend = null, nCampaign = 0;

  if (isPrimaryCpas) {
    // --- 2a. Akun primer CPAS: jumlah SEMUA campaign, tanpa klasifikasi. ---
    cpasSpend = 0;
    Object.keys(rows).forEach(function (id) {
      cpasSpend += num_(rows[id].spend);
      nCampaign++;
    });
    Logger.log('[%s] %s (CPAS) Amount Spent: %s', cfg.label, cfg.cpasHeader, cpasSpend);
  } else {
    // --- 2b. Akun primer MAIN: klasifikasi & jumlahkan seperti semula. ---
    boostSpend = 0; nonBoostSpend = 0;
    Object.keys(rows).forEach(function (id) {
      var name = rows[id].campaign_name || '';
      var spend = num_(rows[id].spend);
      nCampaign++;
      if (name.toLowerCase().indexOf(cfg.boostMatch) > -1) {
        boostSpend += spend;
      } else {
        nonBoostSpend += spend;
      }
    });
    Logger.log('[%s] %s Amount Spent: %s', cfg.label, cfg.boostHeader, boostSpend);
    Logger.log('[%s] %s Amount Spent: %s', cfg.label, cfg.nonBoostHeader, nonBoostSpend);

    // --- 2c. Bolt-on CPAS opsional (akun TERPISAH, lihat catatan atas). ---
    if (cfg.cpasAccountId) {
      var cpasAcct = findAccountById_(cfg.cpasAccountId);
      if (!cpasAcct) {
        return failTracking_(cfg, dateStr, dryRun,
          'Akun CPAS "' + cfg.cpasAccountId + '" tidak ditemukan (mungkin sudah dihapus).');
      }
      var cpasRows;
      try {
        cpasRows = fetchInsights_(tokenFor_(cpasAcct), cpasAcct.id, 'campaign', { since: dateStr, until: dateStr });
      } catch (e) {
        return failTracking_(cfg, dateStr, dryRun,
          'Gagal menarik data Meta Ads CPAS (' + cpasAcct.client + '): ' + e.message);
      }
      cpasSpend = 0;
      Object.keys(cpasRows).forEach(function (id) { cpasSpend += num_(cpasRows[id].spend); });
      Logger.log('[%s] %s (CPAS) Amount Spent: %s', cfg.label, cfg.cpasHeader, cpasSpend);
    }
  }

  if (nCampaign === 0) {
    Logger.log('[%s] Tidak ada baris insight pada %s — API sukses merespons kosong, ' +
      'akan ditulis sebagai 0.', cfg.label, dateStr);
  }

  // --- 3. Cari sheet, kolom (by header name), baris (by tanggal) ---
  var sheet;
  try {
    sheet = openTrackingSheet_(cfg);
  } catch (e) {
    return failTracking_(cfg, dateStr, dryRun, e.message);
  }

  var cols;
  try {
    cols = resolveTrackingColumns_(sheet, cfg, isPrimaryCpas);
  } catch (e) {
    return failTracking_(cfg, dateStr, dryRun, e.message);
  }

  var row = findRowByDate_(sheet, cols.dateCol, dateStr, tz, cfg);
  if (!row) {
    return failTracking_(cfg, dateStr, dryRun,
      'Baris dengan tanggal ' + dateLabel + ' tidak ditemukan di sheet "' + cfg.tabName + '". ' +
      'Tidak ada yang ditulis — periksa apakah blok bulan untuk tanggal ini sudah ada.');
  }

  var result = {
    label: cfg.label, date: dateStr, row: row,
    boostSpend: boostSpend, nonBoostSpend: nonBoostSpend, campaigns: nCampaign,
    cpasSpend: cpasSpend
  };

  // --- 4. Dry run berhenti di sini, tanpa menulis ---
  if (dryRun) {
    if (cols.boostCol) result.existingBoost = sheet.getRange(row, cols.boostCol).getValue();
    if (cols.nonBoostCol) result.existingNonBoost = sheet.getRange(row, cols.nonBoostCol).getValue();
    if (cols.cpasCol) result.existingCpas = sheet.getRange(row, cols.cpasCol).getValue();
    result.status = 'DRY RUN OK';
    Logger.log('[%s] DRY RUN — baris %s (TIDAK ditimpa). existing: %s',
      cfg.label, row, JSON.stringify({ boost: result.existingBoost, nonBoost: result.existingNonBoost, cpas: result.existingCpas }));
    return result;
  }

  // --- 5. Tulis (idempotent — selalu overwrite baris yang sama) ---
  if (cols.boostCol) sheet.getRange(row, cols.boostCol).setValue(boostSpend);
  if (cols.nonBoostCol) sheet.getRange(row, cols.nonBoostCol).setValue(nonBoostSpend);
  if (cols.cpasCol) sheet.getRange(row, cols.cpasCol).setValue(cpasSpend);
  Logger.log('[%s] Status: Success (baris %s)', cfg.label, row);

  result.status = 'OK';

  // --- 6. Push ke ATLAS (best-effort — gagal di sini TIDAK mengubah
  // result.status, Sheet di atas sudah berhasil ditulis dan itu tetap jadi
  // sumber kebenaran utama kalau push ini gagal). Statusnya tetap dicatat di
  // result.atlasPush supaya terlihat di ringkasan [TRACKING] tab Automation
  // Log — itu satu-satunya tempat kegagalan push ini terlihat DARI ATLAS;
  // Logger.log di bawah cuma masuk ke Executions Apps Script yang tidak
  // pernah dibuka dari sisi ATLAS. ---
  result.atlasPush = postToAtlas_(cfg, dateStr, boostSpend, nonBoostSpend, cpasSpend);

  return result;
}

/**
 * Kirim angka hari ini ke POST /api/daily-tracking/ingest ATLAS, supaya
 * halaman Daily Tracking (Postgres) ikut terisi otomatis, bukan cuma cell
 * Google Sheet ini. Kegagalan jaringan/HTTP di sini TIDAK PERNAH dilempar
 * sebagai Error: Sheet sudah berhasil ditulis sebelum fungsi ini dipanggil,
 * jadi itu tetap jadi sumber kebenaran kalau ATLAS lagi down.
 *
 * Selalu mengembalikan sebuah status string singkat (bukan cuma Logger.log,
 * yang cuma masuk ke Executions Apps Script yang tidak terlihat dari ATLAS):
 * dipakai oleh updateAllDailyTrackingSpend() supaya "push ke ATLAS gagal"
 * ikut muncul di ringkasan [TRACKING] tab Automation Log ATLAS, bukan cuma
 * "Sheet: OK" yang menyembunyikan kegagalan tahap ini.
 */
function postToAtlas_(cfg, dateStr, boostSpend, nonBoostSpend, cpasSpend) {
  if (!cfg.atlasBrandId) return 'dilewati (config ini belum ditautkan ke Brand ATLAS)';

  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('ATLAS_INGEST_URL');
  var key = props.getProperty('ATLAS_INGEST_KEY');
  if (!url || !key) {
    var missing = !url && !key ? 'ATLAS_INGEST_URL & ATLAS_INGEST_KEY' : !url ? 'ATLAS_INGEST_URL' : 'ATLAS_INGEST_KEY';
    Logger.log('[%s] Push ke ATLAS dilewati — %s belum di-set di Script Properties.', cfg.label, missing);
    return 'GAGAL — ' + missing + ' belum di-set di Script Properties';
  }

  // boostSpend/nonBoostSpend are null for a config whose PRIMARY account is
  // CPAS (processTrackingConfig_ never computes them in that case); cpasSpend
  // is null unless this config is either primary-CPAS or has the MAIN+CPAS
  // bolt-on. Only send channels this particular config actually produced.
  var entries = [];
  if (boostSpend !== null) entries.push({ channelKey: 'meta_boost_post', amount: boostSpend });
  if (nonBoostSpend !== null) entries.push({ channelKey: 'meta_nonboost_post', amount: nonBoostSpend });
  if (cpasSpend !== null) entries.push({ channelKey: 'cpas_shopee', amount: cpasSpend });
  if (!entries.length) return 'dilewati (tidak ada channel untuk dikirim)';

  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      // 'application/json' di sini, BUKAN 'text/plain' seperti doPost() di
      // atas -- itu 'text/plain' untuk menghindari kuirk Apps Script sendiri
      // (Apps Script butuh Content-Type: text/plain untuk menghindari jalur
      // yang doPost()-nya tidak menangani OPTIONS). Tujuan panggilan INI
      // adalah server Express ATLAS, bukan Apps Script -- Express cuma
      // mengisi req.body kalau Content-Type-nya application/json (lihat
      // express.json() di backend/src/app.js); text/plain di sini membuat
      // req.body kosong, makanya validasi ATLAS sempat menolak dengan
      // "brandId wajib disertakan" walau payload JSON-nya sudah benar.
      contentType: 'application/json',
      payload: JSON.stringify({ brandId: cfg.atlasBrandId, entryDate: dateStr, entries: entries }),
      headers: { 'X-Ingest-Key': key },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      var bodySnippet = res.getContentText().slice(0, 200);
      Logger.log('[%s] Push ke ATLAS gagal (HTTP %s): %s', cfg.label, code, bodySnippet);
      return 'GAGAL — HTTP ' + code + ': ' + bodySnippet;
    }
    Logger.log('[%s] Push ke ATLAS berhasil (brand_id %s, %s).', cfg.label, cfg.atlasBrandId, dateStr);
    return 'OK (' + entries.map(function (e) { return e.channelKey; }).join(', ') + ')';
  } catch (e) {
    Logger.log('[%s] Push ke ATLAS gagal (exception): %s', cfg.label, e.message);
    return 'GAGAL — exception: ' + e.message;
  }
}

/**
 * Versi ringan processTrackingConfig_ untuk brand yang HANYA didaftarkan di
 * Brand & Langganan (uiSaveBrand_), TANPA config Daily Tracking sama sekali
 * -- tidak ada Sheet untuk dicari/ditulis, jadi cuma langkah 1 (ambil
 * insight), 2 (klasifikasi/jumlahkan) dan push ke ATLAS yang jalan. Dipakai
 * baik oleh updateAllDailyTrackingSpend() (semua brand, real run) maupun
 * oleh uiPreviewAccountTracking_/uiRunAccountTracking_ (satu brand, dipicu
 * tombol "Sync Meta Sekarang" ATLAS -- lihat doPost()).
 *
 * Elligibility (acct.atlasBrandId wajib, acct.boostMatch wajib KECUALI akun
 * CPAS) sudah dicek oleh pemanggil; fungsi ini tidak mengecek ulang supaya
 * bisa juga dipanggil untuk dry-run preview sebelum boostMatch tentu terisi.
 */
function processAutoAccountTracking_(acct, dryRun) {
  var tz = tz_();
  var targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - 1); // H-1
  var dateStr = Utilities.formatDate(targetDate, tz, 'yyyy-MM-dd');
  var label = acct.client + ' - ' + (acct.type || 'MAIN') + ' (Brand & Langganan)';

  var rows;
  try {
    rows = fetchInsights_(tokenFor_(acct), acct.id, 'campaign', { since: dateStr, until: dateStr });
  } catch (e) {
    return { label: label, date: dateStr, status: 'FAILED', error: 'Gagal menarik data Meta Ads (' + acct.client + '): ' + e.message };
  }

  var isCpas = (acct.type || 'MAIN').toUpperCase() === 'CPAS';
  var boostSpend = null, nonBoostSpend = null, cpasSpend = null, nCampaign = 0;
  var boostMatch = String(acct.boostMatch || '').toLowerCase();

  if (isCpas) {
    // Sama seperti akun CPAS primer di processTrackingConfig_: TIDAK ADA
    // pembagian nama sama sekali, semua campaign akun ini dijumlah apa adanya.
    cpasSpend = 0;
    Object.keys(rows).forEach(function (id) { cpasSpend += num_(rows[id].spend); nCampaign++; });
  } else {
    boostSpend = 0; nonBoostSpend = 0;
    Object.keys(rows).forEach(function (id) {
      var name = rows[id].campaign_name || '';
      var spend = num_(rows[id].spend);
      nCampaign++;
      if (boostMatch && name.toLowerCase().indexOf(boostMatch) > -1) boostSpend += spend;
      else nonBoostSpend += spend;
    });
  }

  var result = {
    label: label, date: dateStr, status: dryRun ? 'DRY RUN OK' : 'OK',
    boostSpend: boostSpend, nonBoostSpend: nonBoostSpend, cpasSpend: cpasSpend, campaigns: nCampaign
  };

  if (dryRun) return result; // tidak ada Sheet untuk dicek "existing", dan tidak push

  result.atlasPush = postToAtlas_({ label: label, atlasBrandId: acct.atlasBrandId }, dateStr, boostSpend, nonBoostSpend, cpasSpend);
  return result;
}

/**
 * Cari akun (hardcoded/dinamis) yang eligible untuk processAutoAccountTracking_,
 * dipakai action accountTrackingPreview/accountTrackingRun. `type` WAJIB
 * disertakan pemanggil (dari payload ATLAS) -- lihat catatan panjang di
 * findAccount_ soal kenapa client SAJA ambigu kalau brand yang sama punya
 * akun MAIN dan CPAS berdampingan (persis kasus Crabus).
 */
function findEligibleAutoAccount_(client, type) {
  var acct = findAccount_(client, type);
  if (!acct) throw new Error('Akun "' + client + '" tipe ' + (type || 'MAIN') + ' tidak ditemukan.');
  if (!acct.atlasBrandId) {
    throw new Error('Brand "' + client + '" belum ditautkan ke brand ATLAS manapun (isi lewat form Brand & Langganan).');
  }
  var isCpas = (acct.type || 'MAIN').toUpperCase() === 'CPAS';
  if (!isCpas && !acct.boostMatch) {
    throw new Error('Brand "' + client + '" belum diisi Kata Kunci Boost Post (wajib untuk akun MAIN, lihat form Brand & Langganan).');
  }
  return acct;
}

/** Dry run satu akun Brand & Langganan (dipanggil tombol "Sync Meta Sekarang" ATLAS sebelum benar-benar menulis). */
function uiPreviewAccountTracking_(client, type) {
  return processAutoAccountTracking_(findEligibleAutoAccount_(client, type), true);
}

/** Run sungguhan satu akun Brand & Langganan -- push ke ATLAS, TIDAK ada Sheet untuk ditulis sama sekali. */
function uiRunAccountTracking_(client, type) {
  return processAutoAccountTracking_(findEligibleAutoAccount_(client, type), false);
}

function failTracking_(cfg, dateStr, dryRun, message) {
  Logger.log('[%s] Status: FAILED', cfg.label);
  Logger.log('[%s] Error: %s', cfg.label, message);

  if (!dryRun && cfg.emailOnFailure && CONFIG.EMAIL_TO) {
    try {
      MailApp.sendEmail(CONFIG.EMAIL_TO,
        '[Daily Tracking] Gagal isi ' + cfg.label + ' — ' + dateStr,
        'Brand: ' + cfg.label + '\nTanggal diproses: ' + dateStr + '\n\n' + message +
        '\n\nTidak ada nilai yang ditulis ke sheet — nilai existing aman.');
    } catch (e) { /* gagal kirim email, abaikan supaya tidak menutupi error asli */ }
  }

  return { label: cfg.label, date: dateStr, status: 'FAILED', error: message, dryRun: !!dryRun };
}

// ============================================================
// STRUKTUR SHEET — cari sheet/kolom/baris lewat isi, bukan posisi tetap
// ============================================================

function openTrackingSheet_(cfg) {
  var ss = SpreadsheetApp.openById(cfg.sheetId);
  var sheet = ss.getSheetByName(cfg.tabName);
  if (!sheet) {
    throw new Error('Tab "' + cfg.tabName + '" tidak ditemukan di spreadsheet (' + cfg.sheetId + ').');
  }
  return sheet;
}

/**
 * Cocokkan header persis dengan nama (trim + case-insensitive).
 *
 * isPrimaryCpas = true (config untuk akun CPAS-nya sendiri, lihat
 * processTrackingConfig_): cuma dateCol + cpasCol yang dicari/wajib,
 * boostCol/nonBoostCol tidak relevan sama sekali (null).
 *
 * isPrimaryCpas = false (config untuk akun MAIN, seperti semula): dateCol +
 * boostCol + nonBoostCol wajib; cpasCol cuma dicari (dan wajib) kalau
 * cfg.cpasAccountId diisi (bolt-on CPAS lewat akun terpisah).
 */
function resolveTrackingColumns_(sheet, cfg, isPrimaryCpas) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(cfg.headerRow, 1, 1, lastCol).getValues()[0];

  var find = function (label) {
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).trim().toLowerCase() === label.toLowerCase()) return i + 1;
    }
    return null;
  };

  var dateCol = find(cfg.dateHeader);
  var missing = [];
  if (!dateCol) missing.push(cfg.dateHeader);

  var boostCol = null, nonBoostCol = null, cpasCol = null;

  if (isPrimaryCpas) {
    cpasCol = find(cfg.cpasHeader);
    if (!cpasCol) missing.push(cfg.cpasHeader);
  } else {
    boostCol    = find(cfg.boostHeader);
    nonBoostCol = find(cfg.nonBoostHeader);
    if (!boostCol)    missing.push(cfg.boostHeader);
    if (!nonBoostCol) missing.push(cfg.nonBoostHeader);
    if (cfg.cpasAccountId) {
      cpasCol = find(cfg.cpasHeader);
      if (!cpasCol) missing.push(cfg.cpasHeader);
    }
  }

  if (missing.length) {
    throw new Error('Header tidak ditemukan di baris ' + cfg.headerRow + ': ' +
      missing.join(', ') + '. Cek ejaan & baris header di form konfigurasi.');
  }

  return { dateCol: dateCol, boostCol: boostCol, nonBoostCol: nonBoostCol, cpasCol: cpasCol };
}

/**
 * Cari baris dengan tanggal == targetDateStr di kolom tanggal.
 * Baris subtotal/header berulang/divider bulan tidak punya nilai
 * Date valid, jadi otomatis terlewati — tidak perlu whitelist
 * baris data secara manual.
 */
function findRowByDate_(sheet, dateCol, targetDateStr, tz, cfg) {
  var lastRow = sheet.getLastRow();
  var firstDataRow = cfg.headerRow + 1;
  if (lastRow < firstDataRow) return null;

  var values = sheet.getRange(firstDataRow, dateCol, lastRow - firstDataRow + 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var v = values[i][0];
    if (Object.prototype.toString.call(v) !== '[object Date]') continue;
    if (Utilities.formatDate(v, tz, 'yyyy-MM-dd') === targetDateStr) {
      return firstDataRow + i;
    }
  }
  return null;
}

// ============================================================
// SETUP, MIGRASI & TESTING
// ============================================================

/**
 * MIGRASI SATU KALI (v5 -> v6): brand+notifikasi yang sebelumnya
 * tercampur (1 brand = 1 setelan) dipisah jadi Brand (kredensial) +
 * Langganan (notifikasi). Jalankan SEKALI dari editor Apps Script
 * (dropdown fungsi di toolbar) setelah deploy versi v6, SEBELUM
 * weeklyRun()/dailyUrgentCheck() dijalankan lagi -- kalau tidak, brand
 * yang sudah ada tidak akan menghasilkan notifikasi apa pun (tidak ada
 * langganan = tidak diproses).
 *
 * Aman dijalankan berkali-kali (idempotent) -- melewati kombinasi
 * email+brand yang sudah pernah dimigrasikan.
 *
 * Untuk SETIAP brand (hardcoded CONFIG.ACCOUNTS + dinamis lama, dibaca
 * dari Script Properties APA ADANYA sebelum disederhanakan):
 * - Satu langganan dibuat dengan email = CONFIG.EMAIL_TO (pemilik
 *   sistem saat migrasi ini dijalankan).
 * - weeklyMetrics.resultDrop/cprIncrease = true (kecuali brand dinamis
 *   lama punya thresholdChecks yang eksplisit mematikannya).
 * - dailyMetrics.deliveryStop/resultStop = true SELALU (di versi
 *   sebelum v6 keduanya memang selalu aktif tanpa opsi mematikan).
 * - dailyMetrics.cprSpike/spendSpike = true (kecuali brand dinamis
 *   lama punya urgentChecks yang eksplisit mematikannya).
 * - dailyMetrics.resultDrop = FALSE SELALU -- ini metrik BARU di v6,
 *   tidak pernah ada sebelumnya, jadi sengaja tidak diaktifkan.
 * - Threshold/pengaman dibawa dari nilai lama kalau brand dinamis lama
 *   punya override; brand hardcoded (tidak pernah punya override) dan
 *   brand dinamis yang tidak punya override tertentu otomatis ikut
 *   default sistem -- SAMA PERSIS seperti perilaku sebelum migrasi.
 * - Data override metrik per-campaign brand dinamis lama DIBUANG
 *   (fitur itu dihapus di v6, sesuai keputusan produk).
 *
 * Brand dinamis lama juga disederhanakan jadi bentuk baru (id, client,
 * type, tokenKey) -- field threshold/urgentThresholds/thresholdChecks/
 * urgentChecks/resultOverride dibuang dari penyimpanan brand (sudah
 * tidak dibaca kode v6 mana pun, ini cuma kerapian).
 */
function migrateToBrandsAndSubscriptions() {
  var rawDynamic = getDynamicAccounts_();   // bentuk LAMA, sebelum disederhanakan
  var email = CONFIG.EMAIL_TO;
  if (!email) throw new Error('CONFIG.EMAIL_TO kosong -- isi dulu, migrasi butuh alamat email pemilik langganan lama.');

  var subs = getSubscriptions_();
  var existingKey = {};
  subs.forEach(function (s) { existingKey[s.email + '|' + s.brandId] = true; });

  var created = 0, skipped = 0;

  getAllAccounts_().forEach(function (acct) {
    if (existingKey[email + '|' + acct.id]) { skipped++; return; }

    var oldThresholds = acct.thresholds || {};
    var oldUrgentThresholds = acct.urgentThresholds || {};
    var oldChecks = acct.thresholdChecks || {};
    var oldUrgentChecks = acct.urgentChecks || {};

    var weeklyMetrics = [];
    if (oldChecks.resultDrop !== false) {
      weeklyMetrics.push({ id: Utilities.getUuid(), field: 'results', ruleType: 'delta', direction: 'down',
        threshold: numOr_(oldThresholds.resultDrop, CONFIG.THRESHOLDS.resultDrop) });
    }
    if (oldChecks.cprIncrease !== false) {
      weeklyMetrics.push({ id: Utilities.getUuid(), field: 'cpr', ruleType: 'delta', direction: 'up',
        threshold: numOr_(oldThresholds.cprIncrease, CONFIG.THRESHOLDS.cprIncrease) });
    }

    var dailyMetrics = [
      { id: Utilities.getUuid(), field: 'spend', ruleType: 'zero' },
      { id: Utilities.getUuid(), field: 'results', ruleType: 'zero' }
    ];
    if (oldUrgentChecks.cprSpike !== false) {
      dailyMetrics.push({ id: Utilities.getUuid(), field: 'cpr', ruleType: 'delta', direction: 'up',
        threshold: numOr_(oldUrgentThresholds.cprSpike, URGENT.SUGGESTED_CPR_SPIKE) });
    }
    if (oldUrgentChecks.spendSpike !== false) {
      dailyMetrics.push({ id: Utilities.getUuid(), field: 'spend', ruleType: 'delta', direction: 'up',
        threshold: numOr_(oldUrgentThresholds.spendSpike, URGENT.SUGGESTED_SPEND_SPIKE) });
    }
    // dailyMetrics 'results turun (%)' TIDAK ditambahkan -- metrik baru, sengaja tidak aktif.

    var sub = {
      id: Utilities.getUuid(),
      email: email,
      brandId: acct.id,
      weeklyMetrics: weeklyMetrics,
      weeklyGuards: stripUndefined_({ minSpend: oldThresholds.minSpend, minResults: oldThresholds.minResults }),
      dailyMetrics: dailyMetrics,
      dailyGuards: stripUndefined_({ minSpendDaily: oldUrgentThresholds.minSpendDaily, minBaselineRes: oldUrgentThresholds.minBaselineRes }),
      periods: {},
      createdAt: new Date().toISOString()
    };

    subs.push(sub);
    created++;
  });

  saveSubscriptions_(subs);

  var simplifiedDynamic = rawDynamic.map(function (a) {
    return { id: a.id, client: a.client, type: a.type || 'MAIN', tokenKey: a.tokenKey, source: 'dynamic' };
  });
  saveDynamicAccounts_(simplifiedDynamic);

  Logger.log('Migrasi selesai: %s langganan dibuat, %s dilewati (sudah ada). Brand dinamis disederhanakan (%s brand).',
    created, skipped, simplifiedDynamic.length);
}

function stripUndefined_(obj) {
  Object.keys(obj).forEach(function (k) { if (obj[k] === undefined) delete obj[k]; });
  return obj;
}

/**
 * MIGRASI SATU KALI TAMBAHAN (v6 -> v7): metrik langganan berubah dari
 * daftar tetap (boolean per nama metrik + peta threshold terpisah) jadi
 * rule builder bebas (array aturan, threshold di dalam tiap aturan).
 * Jalankan SEKALI dari editor Apps Script setelah deploy versi v7 --
 * SEBELUM weeklyRun()/dailyUrgentCheck() dijalankan lagi, supaya
 * langganan yang SUDAH ADA (dibuat migrateToBrandsAndSubscriptions atau
 * form ATLAS versi lama) tidak diam-diam kehilangan metriknya (kode v7
 * cuma membaca weeklyMetrics/dailyMetrics dalam bentuk array).
 *
 * Aman dijalankan berkali-kali -- langganan yang metriknya SUDAH array
 * (sudah bentuk baru) dilewati apa adanya.
 */
function migrateMetricsToRules() {
  var subs = getSubscriptions_();
  var converted = 0, skipped = 0;

  subs.forEach(function (s) {
    var weeklyIsOld = s.weeklyMetrics && !Array.isArray(s.weeklyMetrics);
    var dailyIsOld = s.dailyMetrics && !Array.isArray(s.dailyMetrics);
    if (!weeklyIsOld && !dailyIsOld) { skipped++; return; }

    if (weeklyIsOld) {
      var wm = s.weeklyMetrics || {};
      var wt = s.weeklyThresholds || {};
      var newWeekly = [];
      if (wm.resultDrop) {
        newWeekly.push({ id: Utilities.getUuid(), field: 'results', ruleType: 'delta', direction: 'down',
          threshold: numOr_(wt.resultDrop, CONFIG.THRESHOLDS.resultDrop) });
      }
      if (wm.cprIncrease) {
        newWeekly.push({ id: Utilities.getUuid(), field: 'cpr', ruleType: 'delta', direction: 'up',
          threshold: numOr_(wt.cprIncrease, CONFIG.THRESHOLDS.cprIncrease) });
      }
      s.weeklyMetrics = newWeekly;
      delete s.weeklyThresholds;
    }

    if (dailyIsOld) {
      var dm = s.dailyMetrics || {};
      var dt = s.dailyThresholds || {};
      var newDaily = [];
      if (dm.deliveryStop) newDaily.push({ id: Utilities.getUuid(), field: 'spend', ruleType: 'zero' });
      if (dm.resultStop) newDaily.push({ id: Utilities.getUuid(), field: 'results', ruleType: 'zero' });
      if (dm.cprSpike) {
        newDaily.push({ id: Utilities.getUuid(), field: 'cpr', ruleType: 'delta', direction: 'up',
          threshold: numOr_(dt.cprSpike, URGENT.SUGGESTED_CPR_SPIKE) });
      }
      if (dm.spendSpike) {
        newDaily.push({ id: Utilities.getUuid(), field: 'spend', ruleType: 'delta', direction: 'up',
          threshold: numOr_(dt.spendSpike, URGENT.SUGGESTED_SPEND_SPIKE) });
      }
      if (dm.resultDrop) {
        newDaily.push({ id: Utilities.getUuid(), field: 'results', ruleType: 'delta', direction: 'down',
          threshold: numOr_(dt.resultDrop, URGENT.SUGGESTED_RESULT_DROP) });
      }
      s.dailyMetrics = newDaily;
      delete s.dailyThresholds;
    }

    converted++;
  });

  saveSubscriptions_(subs);
  Logger.log('Migrasi metrik selesai: %s langganan dikonversi ke rule builder, %s dilewati (sudah bentuk baru).',
    converted, skipped);
}

/**
 * Pasang trigger harian ~01:00, memproses SEMUA brand tersimpan.
 * Time-based trigger Apps Script berjalan dalam rentang waktu
 * (bisa mundur beberapa menit), bukan tepat di menit itu — normal,
 * tidak masalah karena H-1 selalu dihitung eksplisit dari tanggal
 * saat script benar-benar jalan.
 */
function setupDailyTrackingTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'updateAllDailyTrackingSpend') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('updateAllDailyTrackingSpend')
    .timeBased()
    .atHour(1)
    .everyDays(1)
    .inTimezone('Asia/Jakarta')
    .create();
  Logger.log('Trigger terpasang: setiap hari sekitar 01:00 WIB, memproses semua brand tersimpan.');
}

/**
 * Jalankan SEKALI setelah pindah dari versi single-brand ke
 * multi-brand, supaya konfigurasi Petite Fleur yang sudah
 * tervalidasi (lihat riwayat testDailyTrackingSpend() sebelumnya)
 * tidak hilang dan langsung muncul di sidebar.
 */
function seedPetiteFleurConfig() {
  var existing = getTrackingConfigs_();
  var already = existing.some(function (c) { return c.label === 'Petite Fleur - Daily Tracking 2026'; });
  if (already) {
    Logger.log('Konfigurasi Petite Fleur sudah ada, tidak ditambahkan lagi.');
    return;
  }

  existing.push({
    id: Utilities.getUuid(),
    label: 'Petite Fleur - Daily Tracking 2026',
    sheetId: '1GUarO0tYSghgYeViGsAlTKQ6mkRpqempvx9u5VmExng',
    tabName: 'Daily Tracking 2026',
    headerRow: 3,
    dateHeader: 'Date',
    boostHeader: 'Boost Post',
    nonBoostHeader: 'FB Ads',
    accountClient: 'Petite Fleur',
    boostMatch: 'profile visit',
    emailOnFailure: true
  });
  saveTrackingConfigs_(existing);
  Logger.log('Konfigurasi Petite Fleur berhasil dipindahkan ke penyimpanan multi-brand.');
}

/** Uji cepat dari editor Apps Script (tanpa buka sidebar), dry run, by label. */
function testTrackingConfig(label) {
  var list = getTrackingConfigs_();
  var cfg = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i].label === label) cfg = list[i];
  }
  if (!cfg) {
    Logger.log('Konfigurasi dengan label "%s" tidak ditemukan. Label yang tersedia: %s',
      label, list.map(function (c) { return c.label; }).join(', ') || '(belum ada)');
    return;
  }
  var r = processTrackingConfig_(cfg, true);
  Logger.log('%s', JSON.stringify(r, null, 2));
}
