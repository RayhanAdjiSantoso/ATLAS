// Langkah-langkah installation
// 1. Masuk developers.facebook.com -> buat akun
// 2. Create app -> pilih use case "Create & manage ads with Marketing API" -> pilih business portfolio
// 3. Klik app yang telah dibuat -> klik "Customize the Create & manage ads with Marketing API use case" -> pastikan status ads_read dan business_management adalah "ready for testing"
// 4. Masuk business.facebook.com -> settings -> di sidebar, kategori Accounts -> pilih "Apps" -> klik "Add" -> pilih "Request access to an app ID" -> masukkan "2921621298170644"
// 6. Di sidebar, kategori Users -> pilih "System users" -> klik "Add" -> role-nya Employee -> pilih "Add assets" -> pilih ad account -> pilih "View performance"
// 7. Masih di system users -> pilih tab "Installed apps" -> pilih app yang telah dibuat di langkah 2 -> pilih "Develop app"
// 8. Masih di system users -> klik "Generate token" -> centang ads_read dan business_management -> copy token
// 9. Masuk ke spreadsheets -> klik "Extensions" -> pilih "Apps Script" -> klik "+" dan masukkan script berikut
// 10. Pada sidebar Apps Script -> pilih "Project Settings" -> scroll sampai bawah, sampai bagian "Script Properties" -> tambahkan property bernama token serta value token tersebut yang telah didapatkan dari langkah 8

/**
 * ============================================================
 * META WEEKLY CAMPAIGN REVIEW v6 — MIL Digital
 * ============================================================
 * v6: Brand & Langganan dipisah. Brand (kredensial ad account) dan
 * Langganan (siapa mau dinotifikasi, metrik & threshold apa) adalah
 * dua entitas terpisah, banyak-ke-banyak lewat brandId. Tidak ada lagi
 * "1 brand = 1 setelan notifikasi" -- satu brand bisa dilanggan banyak
 * orang dengan metrik/threshold masing-masing, dan brand tanpa
 * langganan tetap tersimpan tapi tidak memproses apa pun.
 *
 * Alur pengecekan otomatis setiap Senin, PER BRAND YANG PUNYA
 * LANGGANAN WEEKLY AKTIF:
 *
 *   1. Tarik data harian (time_increment=1) SEKALI per brand, cukup
 *      untuk gabungan rentang terpanjang yang dibutuhkan semua
 *      langganan brand itu -- lihat "PISAH FETCH VS EVALUASI" di bawah.
 *   2. Untuk tiap langganan pada brand itu: bandingkan periode Weekly
 *      milik langganan itu sendiri (default 3 hari vs 3 hari),
 *      memakai metrik & threshold & pengaman miliknya sendiri.
 *   3. Campaign dengan result terlalu sedikit pada jendela sempit ->
 *      dievaluasi ulang dengan jendela lebar (default 7 hari).
 *   4. Campaign yang result-nya turun ATAU cost per result-nya naik
 *      melebihi ambang (sesuai metrik yang dipilih langganan itu) ->
 *      di-drill ke level ADSET.
 *   5. Campaign dengan spend berjalan tapi NOL result selama jendela
 *      lebar disorot terpisah.
 *   6. Kelompokkan temuan per EMAIL (satu orang bisa melanggan banyak
 *      brand), kirim SATU email per orang berisi semua brand yang
 *      dia langgan.
 *
 * PISAH FETCH VS EVALUASI (paling penting, paling mudah keliru)
 * Karena banyak orang bisa melanggan brand yang sama dengan periode
 * berbeda-beda, data TIDAK ditarik per langganan (boros & lambat).
 * fetchDailyInsights_() menarik data HARIAN sekali untuk gabungan
 * rentang terpanjang yang dibutuhkan brand itu, lalu sumDailyRange_()
 * menjumlahkan ulang jadi rentang yang dibutuhkan tiap langganan.
 * Drill-down adset TETAP per-subscription (fetchInsights_ biasa) --
 * itu cuma menyasar sejumlah kecil campaign yang SUDAH ke-flag,
 * jadi bukan pemborosan yang sama seperti pull campaign-level.
 *
 * CATATAN
 * Kolom "Results" dan "Cost per result" tidak ada di Marketing
 * API — keduanya dihitung Ads Manager di sisi tampilan. Script
 * ini menirukannya lewat optimization_goal + promoted_object
 * di level adset, ditambah tabel override manual GLOBAL (lintas
 * akun) -- tidak ada lagi override per-brand, dihapus di v6.
 *
 * PENDEKATAN reach/frequency untuk periode gabungan: dijumlahkan/
 * dihitung ulang dari data harian, bukan ditarik sebagai satu angka
 * dari API. reach yang dijumlahkan lintas hari sedikit LEBIH TINGGI
 * dari reach unik sungguhan (orang yang sama kena di >1 hari terhitung
 * >1 kali) -- tidak masalah karena reach/frequency cuma tampilan,
 * TIDAK DIPAKAI di logika flag/threshold mana pun.
 *
 * SETUP:
 * 1. Ganti SELURUH isi file script lama dengan file ini
 * 2. Script Properties (Project Settings):
 *      META_TOKEN_PETITEFLEUR = <token system user Petite Fleur>
 *      META_TOKEN_VALENTINE   = <token system user Valentine>
 * 3. Sesuaikan CONFIG.ACCOUNTS dan CONFIG.EMAIL_TO (EMAIL_TO cuma
 *    kontak admin untuk error skrip total, BUKAN penerima laporan --
 *    penerima laporan selalu dari data Langganan)
 * 4. checkTokens()        -> pastikan semua token hidup
 * 5. diagnoseResultKeys() -> cocokkan dengan Ads Manager
 * 6. Jalankan migrateToBrandsAndSubscriptions() SATU KALI supaya
 *    brand & langganan yang sudah ada tetap jalan (lihat komentar
 *    di fungsinya, ada di DailyTrackingBoostPost.gs).
 * 7. testWeeklyRun()      -> cek email
 * 8. setupWeeklyTrigger() -> pasang jadwal, sekali saja
 * ============================================================
 */

// ============================================================
// KONFIGURASI
// ============================================================

var CONFIG = {

  API_VERSION: 'v23.0',

  // Kosongkan ('') kalau script dipasang di dalam sheet tujuan
  SHEET_ID: '1WyiAkyhLzp00dy7CAq8a3LeWoKYTEpVW1rAz6BKeZIw',

  TAB_CAMPAIGN: 'Weekly Campaign Review',
  TAB_ADSET:    'Weekly Adset Drilldown',
  TAB_LOG:      'Automation Log',

  /**
   * tokenKey merujuk nama Script Property berisi token portfolio
   * bersangkutan. System user adalah aset milik satu portfolio,
   * jadi tokennya tidak bisa membaca portfolio lain.
   */
  ACCOUNTS: [
    { client: 'Petite Fleur', id: 'act_678276314370782',
      type: 'MAIN', tokenKey: 'META_TOKEN_PETITEFLEUR' },

    { client: 'Valentine',    id: 'act_6589844197811528',
      type: 'MAIN', tokenKey: 'META_TOKEN_VALENTINE' },
  ],

  // Nilai default SISTEM, dipakai kalau langganan tidak mengisi
  // field tertentu (bukan lagi per-akun sejak v6 -- per-langganan,
  // lihat weeklySettingsFor_/dailySettingsFor_).
  PERIOD_DAYS: 3,        // jendela Weekly utama
  WIDE_PERIOD_DAYS: 7,   // jendela Weekly cadangan saat volume tipis

  THRESHOLDS: {
    resultDrop:   0.15,   // result turun >= 15% -> flag
    cprIncrease:  0.15,   // cost per result naik >= 15% -> flag
    minSpend:     50000,  // di bawah ini campaign dilewati
    minResults:   3       // di bawah ini -> eskalasi ke jendela lebar
  },

  // Bukan penerima notifikasi -- cuma kontak admin kalau weeklyRun()/
  // dailyUrgentCheck() sendiri crash total sebelum sempat memproses
  // satu pun brand (jadi tidak ada langganan yang bisa dituju).
  EMAIL_TO: 'rayhan.s@mildigital.id',
  EMAIL_ALWAYS: true
};

// ============================================================
// BRAND (kredensial ad account -- TANPA pengaturan notifikasi)
// ============================================================
// Brand ditambah lewat ATLAS "Tambah Brand ke Database", disimpan
// TERPISAH dari CONFIG.ACCOUNTS (Script Property sendiri, bukan
// diedit di kode) supaya akun hardcoded di atas yang sudah production
// tidak pernah tersentuh oleh alur ini. Sejak v6, brand TIDAK
// menyimpan threshold/metrik/override apa pun -- semua itu pindah ke
// Langganan (lihat bawah), karena satu brand bisa dilanggan banyak
// orang dengan setelan berbeda-beda.
//
// Bentuk satu entri brand dinamis:
//   { client, id (act_...), type ('MAIN'|'CPAS'), tokenKey, source: 'dynamic' }

var DYNAMIC_ACCOUNTS_KEY = 'DYNAMIC_ACCOUNTS';

function getDynamicAccounts_() {
  var raw = PropertiesService.getScriptProperties().getProperty(DYNAMIC_ACCOUNTS_KEY);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveDynamicAccounts_(list) {
  PropertiesService.getScriptProperties().setProperty(DYNAMIC_ACCOUNTS_KEY, JSON.stringify(list));
}

/** Semua brand: hardcoded (CONFIG.ACCOUNTS) + yang ditambah dinamis lewat ATLAS. */
function getAllAccounts_() {
  return CONFIG.ACCOUNTS.concat(getDynamicAccounts_());
}

function findAccountById_(id) {
  var found = null;
  getAllAccounts_().forEach(function (a) { if (a.id === id) found = a; });
  return found;
}

// ============================================================
// LANGGANAN (SUBSCRIPTIONS)
// ============================================================
// Satu baris = satu kombinasi email + brand. Menyimpan metrik yang
// dipantau, threshold, pengaman volume minimum, dan pengaturan
// periode -- semuanya MILIK LANGGANAN INI SENDIRI, bukan brand.
//
// Bentuk satu entri langganan:
//   {
//     id, email, brandId (act_..., FK ke Brand.id -- BUKAN nama,
//       supaya tidak putus kalau nama brand diedit),
//     weeklyMetrics: [ { id, field, ruleType: 'delta', direction, threshold } ],
//       -- array aturan bebas, lihat "RULE BUILDER METRIK" di bawah.
//       Weekly cuma boleh ruleType 'delta' (tidak ada konsep "kemarin").
//     weeklyGuards: { minSpend, minResults },                 // opsional
//     dailyMetrics: [ { id, field, ruleType: 'delta'|'zero', direction, threshold } ],
//       -- 'zero' cuma untuk field 'spend'/'results' (delivery/result berhenti).
//     dailyGuards: { minSpendDaily, minBaselineRes },          // opsional
//     periods: { weeklyDays, wideDays, baselineDays },         // opsional
//     createdAt: ISOString
//   }

var SUBSCRIPTIONS_KEY = 'SUBSCRIPTIONS';

function getSubscriptions_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SUBSCRIPTIONS_KEY);
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveSubscriptions_(list) {
  PropertiesService.getScriptProperties().setProperty(SUBSCRIPTIONS_KEY, JSON.stringify(list));
}

/** undefined/null/'' -> pakai default; selain itu Number(v). */
function numOr_(v, def) {
  return (v === undefined || v === null || v === '') ? def : Number(v);
}

/**
 * Setelan Weekly efektif untuk SATU LANGGANAN (bukan brand) -- daftar
 * aturan metrik bebas (lihat "RULE BUILDER METRIK" di bawah), pengaman
 * & periode. Guard/periode kosong otomatis pakai default sistem
 * (CONFIG.THRESHOLDS/PERIOD_DAYS/WIDE_PERIOD_DAYS) -- threshold di
 * DALAM tiap aturan TIDAK punya fallback default lagi sejak rule
 * builder bebas (lihat catatan di validateRule_).
 */
function weeklySettingsFor_(sub) {
  var wg = sub.weeklyGuards || {};
  var p = sub.periods || {};
  return {
    metrics: Array.isArray(sub.weeklyMetrics) ? sub.weeklyMetrics : [],
    minSpend: numOr_(wg.minSpend, CONFIG.THRESHOLDS.minSpend),
    minResults: numOr_(wg.minResults, CONFIG.THRESHOLDS.minResults),
    periodDays: numOr_(p.weeklyDays, CONFIG.PERIOD_DAYS),
    widePeriodDays: numOr_(p.wideDays, CONFIG.WIDE_PERIOD_DAYS)
  };
}

// ============================================================
// RULE BUILDER METRIK
// ============================================================
// Sejak v7, metrik TIDAK LAGI daftar tetap (resultDrop/cprIncrease/dst)
// -- user bebas menyusun aturan sendiri: field apa yang dipantau, arah
// (naik/turun), dan threshold-nya. Satu aturan:
//   { id, field, ruleType: 'delta'|'zero', direction: 'up'|'down' (delta saja), threshold (pecahan, delta saja) }
// 'zero' (field kemarin nol, padahal biasanya ada) cuma masuk akal untuk
// field 'spend'/'results', dan cuma dipakai di dailyMetrics (Weekly tidak
// punya konsep "kemarin", dia bicara periode, bukan satu hari) --
// divalidasi di uiSaveSubscription_ (DailyTrackingBoostPost.gs).

var METRIC_FIELDS = {
  spend:                  { now: 'spendNow',                   prev: 'spendPrev',                   delta: 'spendDelta',                   format: 'currency' },
  results:                { now: 'resultsNow',                 prev: 'resultsPrev',                 delta: 'resultsDelta',                 format: 'number' },
  cpr:                    { now: 'cprNow',                     prev: 'cprPrev',                     delta: 'cprDelta',                     format: 'currency' },
  ctr:                    { now: 'ctrNow',                     prev: 'ctrPrev',                     delta: 'ctrDelta',                     format: 'percent' },
  cpm:                    { now: 'cpmNow',                     prev: 'cpmPrev',                     delta: 'cpmDelta',                     format: 'currency' },
  frequency:               { now: 'freqNow',                    prev: 'freqPrev',                    delta: 'freqDelta',                    format: 'number' },
  impressions:             { now: 'impressionsNow',             prev: 'impressionsPrev',             delta: 'impressionsDelta',             format: 'number' },
  reach:                   { now: 'reachNow',                   prev: 'reachPrev',                   delta: 'reachDelta',                   format: 'number' },
  clicks:                  { now: 'clicksNow',                  prev: 'clicksPrev',                  delta: 'clicksDelta',                  format: 'number' },
  cpc:                     { now: 'cpcNow',                     prev: 'cpcPrev',                     delta: 'cpcDelta',                     format: 'currency' },
  uniqueClicks:            { now: 'uniqueClicksNow',            prev: 'uniqueClicksPrev',            delta: 'uniqueClicksDelta',            format: 'number' },
  inlineLinkClicks:        { now: 'inlineLinkClicksNow',        prev: 'inlineLinkClicksPrev',        delta: 'inlineLinkClicksDelta',        format: 'number' },
  costPerInlineLinkClick:  { now: 'costPerInlineLinkClickNow',  prev: 'costPerInlineLinkClickPrev',  delta: 'costPerInlineLinkClickDelta',  format: 'currency' },
  uniqueCtr:               { now: 'uniqueCtrNow',               prev: 'uniqueCtrPrev',               delta: 'uniqueCtrDelta',               format: 'percent' },
  costPerUniqueClick:      { now: 'costPerUniqueClickNow',      prev: 'costPerUniqueClickPrev',      delta: 'costPerUniqueClickDelta',      format: 'currency' },
  socialSpend:             { now: 'socialSpendNow',             prev: 'socialSpendPrev',             delta: 'socialSpendDelta',             format: 'currency' },
  fullViewImpressions:     { now: 'fullViewImpressionsNow',     prev: 'fullViewImpressionsPrev',     delta: 'fullViewImpressionsDelta',     format: 'number' },
  fullViewReach:           { now: 'fullViewReachNow',           prev: 'fullViewReachPrev',           delta: 'fullViewReachDelta',           format: 'number' }
};

var FIELD_LABELS = {
  spend: 'Spend', results: 'Result', cpr: 'Cost per Result', ctr: 'CTR', cpm: 'CPM',
  frequency: 'Frequency', impressions: 'Impressions', reach: 'Reach',
  clicks: 'Clicks', cpc: 'CPC', uniqueClicks: 'Unique Clicks',
  inlineLinkClicks: 'Link Clicks', costPerInlineLinkClick: 'Cost per Link Click',
  uniqueCtr: 'Unique CTR', costPerUniqueClick: 'Cost per Unique Click',
  socialSpend: 'Social Spend', fullViewImpressions: 'Full View Impressions', fullViewReach: 'Full View Reach'
};

function formatFieldValue_(field, value) {
  var fmt = (METRIC_FIELDS[field] || {}).format;
  if (fmt === 'currency') return rupiah_(value);
  if (fmt === 'percent') return fmt_(value) + '%';
  return fmt_(value);
}

/** true kalau aturan delta terpicu pada satu baris perbandingan (c = hasil buildComparison_). */
function evaluateDeltaRule_(c, rule) {
  var f = METRIC_FIELDS[rule.field];
  if (!f) return false;
  var d = c[f.delta];
  if (d === null || d === undefined) return false;
  if (rule.direction === 'up') return d >= rule.threshold;
  return d <= -rule.threshold;
}

/** true kalau nilai "now" field ini persis nol -- dipakai aturan ruleType 'zero' (Daily saja). */
function evaluateZeroRule_(c, rule) {
  var f = METRIC_FIELDS[rule.field];
  if (!f) return false;
  return c[f.now] === 0;
}

/** Judul singkat untuk satu aturan delta yang terpicu, mis. "Cost per Result naik +23%". */
function ruleTitle_(rule, c) {
  var label = FIELD_LABELS[rule.field] || rule.field;
  var d = c[METRIC_FIELDS[rule.field].delta];
  return label + (rule.direction === 'up' ? ' naik ' : ' turun ') + pct_(d);
}

/**
 * Override result type per campaign. Pencocokan substring pada
 * nama campaign, tidak case-sensitive. Diperiksa sebelum
 * deteksi otomatis. GLOBAL, berlaku lintas brand -- sejak v6 tidak
 * ada lagi override per-brand (dihapus, lihat handoff perubahan).
 *
 * Saat menambah brand baru, jalankan diagnoseResultKeys() dan
 * periksa kolom "sumber" — kalau ada campaign yang tertulis OVERRIDE
 * padahal seharusnya otomatis, berarti ada kunci yang cocok tidak
 * sengaja.
 */
var CAMPAIGN_RESULT_OVERRIDE = {
  'Traffic - Profile Visit': 'link_click',
  'Sales - VC':              'offsite_conversion.fb_pixel_view_content',
  'Sales - ATC':             'offsite_conversion.fb_pixel_add_to_cart',
  'Sales - Purchase':        'offsite_conversion.fb_pixel_purchase'
  // 'Engagement - Send Message' dan 'Lead - Send WA' dibiarkan
  // otomatis — custom conversion & messaging terdeteksi sendiri
};

/**
 * Action type yang dipakai sebagai PENDEKATAN, bukan metrik
 * sebenarnya. Campaign yang memakainya diberi label PROXY di
 * laporan.
 *
 * link_click: Marketing API tidak mengembalikan metrik
 * "Instagram profile visits" pada parameter apa pun yang diuji
 * (6 varian attribution window & action report time). link_click
 * konsisten 3–8% lebih rendah karena profile visit juga terjadi
 * lewat klik nama akun/foto profil, bukan hanya tombol CTA.
 *
 * Konsisten di kedua periode, jadi ARAH perubahannya tetap
 * benar — cukup untuk deteksi mingguan, tidak untuk angka
 * laporan klien.
 */
var PROXY_KEYS = {
  'link_click': 'pendekatan untuk Instagram profile visits — angka API 3–8% lebih rendah dari Ads Manager'
};

// ============================================================
// PEMETAAN RESULT TYPE
// ============================================================

var OPT_GOAL_MAP = {
  OFFSITE_CONVERSIONS:     null,   // ditentukan dari promoted_object
  VALUE:                   null,
  CONVERSATIONS:           ['onsite_conversion.messaging_conversation_started_7d'],
  LINK_CLICKS:             ['link_click'],
  LANDING_PAGE_VIEWS:      ['landing_page_view'],
  PROFILE_VISIT:           ['link_click'],
  VISIT_INSTAGRAM_PROFILE: ['link_click'],
  LEAD_GENERATION:         ['lead'],
  QUALITY_LEAD:            ['lead'],
  QUALITY_CALL:            ['onsite_conversion.call_confirm'],
  POST_ENGAGEMENT:         ['post_engagement'],
  PAGE_LIKES:              ['like'],
  EVENT_RESPONSES:         ['rsvp'],
  THRUPLAY:                ['video_view'],
  TWO_SECOND_CONTINUOUS_VIDEO_VIEWS: ['video_view'],
  APP_INSTALLS:            ['omni_app_install', 'app_install'],
  REACH:                   ['reach'],
  IMPRESSIONS:             ['impressions'],
  AD_RECALL_LIFT:          ['estimated_ad_recallers']
};

var EVENT_MAP = {
  PURCHASE:              ['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase'],
  ADD_TO_CART:           ['offsite_conversion.fb_pixel_add_to_cart', 'omni_add_to_cart'],
  CONTENT_VIEW:          ['offsite_conversion.fb_pixel_view_content', 'omni_view_content'],
  INITIATED_CHECKOUT:    ['offsite_conversion.fb_pixel_initiate_checkout', 'omni_initiated_checkout'],
  ADD_PAYMENT_INFO:      ['offsite_conversion.fb_pixel_add_payment_info'],
  CONTACT:               ['offsite_conversion.fb_pixel_contact'],
  LEAD:                  ['offsite_conversion.fb_pixel_lead', 'lead'],
  COMPLETE_REGISTRATION: ['offsite_conversion.fb_pixel_complete_registration'],
  SEARCH:                ['offsite_conversion.fb_pixel_search'],
  ADD_TO_WISHLIST:       ['offsite_conversion.fb_pixel_add_to_wishlist'],
  SUBSCRIBE:             ['offsite_conversion.fb_pixel_subscribe'],
  START_TRIAL:           ['offsite_conversion.fb_pixel_start_trial'],
  SUBMIT_APPLICATION:    ['offsite_conversion.fb_pixel_submit_application'],
  SCHEDULE:              ['offsite_conversion.fb_pixel_schedule'],
  DONATE:                ['offsite_conversion.fb_pixel_donate']
};

// ============================================================
// STRUKTUR SHEET
// ============================================================

var CAMPAIGN_HEADERS = [
  'Run Date', 'Client', 'Email Langganan', 'Campaign', 'Objective', 'Status', 'Jendela',
  'Periode Sekarang', 'Periode Sebelumnya',
  'Spend Now', 'Spend Prev', 'Δ Spend %',
  'Results Now', 'Results Prev', 'Δ Results %',
  'CPR Now', 'CPR Prev', 'Δ CPR %',
  'CTR Now', 'CTR Prev', 'Δ CTR %',
  'CPM Now', 'CPM Prev', 'Δ CPM %',
  'Result Type', 'Proxy?', 'Flag'
];

var ADSET_HEADERS = [
  'Run Date', 'Client', 'Email Langganan', 'Campaign', 'Adset', 'Status', 'Jendela',
  'Spend Now', 'Spend Prev', 'Δ Spend %',
  'Results Now', 'Results Prev', 'Δ Results %',
  'CPR Now', 'CPR Prev', 'Δ CPR %',
  'CTR Now', 'CTR Prev', 'Δ CTR %',
  'Frequency Now', 'Frequency Prev',
  'Result Type', 'Proxy?', 'Flag'
];

// ============================================================
// ENTRY POINT
// ============================================================

function weeklyRun() {
  var startedAt = new Date();

  try {
    var ss = openSpreadsheet_();
    var accountsById = {};
    getAllAccounts_().forEach(function (a) { accountsById[a.id] = a; });

    var subs = getSubscriptions_().filter(function (s) {
      return Array.isArray(s.weeklyMetrics) && s.weeklyMetrics.length > 0;
    });

    var byBrand = {};
    subs.forEach(function (s) {
      if (!byBrand[s.brandId]) byBrand[s.brandId] = [];
      byBrand[s.brandId].push(s);
    });

    var log = [];
    var campaignRows = [], adsetRows = [];
    var reportsByEmail = {};   // email -> [ hasil evaluasi per brand ]
    var failuresByEmail = {};  // email -> [ { client, message } ]

    Object.keys(byBrand).forEach(function (brandId) {
      var brandSubs = byBrand[brandId];
      var acct = accountsById[brandId];

      if (!acct || !acct.id || acct.id.indexOf('XXXX') > -1) {
        brandSubs.forEach(function (s) {
          pushTo_(failuresByEmail, s.email, { client: brandId, message: 'Brand tidak ditemukan atau belum dikonfigurasi penuh.' });
        });
        log.push('GAGAL brand ' + brandId + ': tidak ditemukan');
        return;
      }

      try {
        var token = tokenFor_(acct);
        var meta = fetchAdsetMeta_(token, acct.id);
        var tz = tz_();

        var maxSpan = CONFIG.PERIOD_DAYS;
        brandSubs.forEach(function (s) {
          var ws = weeklySettingsFor_(s);
          maxSpan = Math.max(maxSpan, ws.periodDays, ws.widePeriodDays);
        });

        var until = new Date(); until.setDate(until.getDate() - 1);
        var since = new Date(until); since.setDate(since.getDate() - (2 * maxSpan - 1));
        var byDate = fetchDailyInsights_(token, acct.id, 'campaign',
          Utilities.formatDate(since, tz, 'yyyy-MM-dd'), Utilities.formatDate(until, tz, 'yyyy-MM-dd'));

        brandSubs.forEach(function (s) {
          var r = evaluateBrandWeeklyForSub_(acct, token, meta, byDate, tz, s);
          campaignRows = campaignRows.concat(r.campaignRows);
          adsetRows = adsetRows.concat(r.adsetRows);
          pushTo_(reportsByEmail, s.email, r);
          log.push(acct.client + ' [' + s.email + ']: ' + r.campaigns.length + ' campaign, ' +
                   r.flagged.length + ' perlu dicek, ' + r.zeroResult.length + ' nol result, ' +
                   r.escalated + ' dieskalasi');
        });
      } catch (e) {
        brandSubs.forEach(function (s) {
          pushTo_(failuresByEmail, s.email, { client: acct.client, type: acct.type, message: e.message });
        });
        log.push('GAGAL ' + acct.client + ': ' + e.message);
      }
      Utilities.sleep(400);
    });

    if (campaignRows.length) {
      appendRows_(ensureSheet_(ss, CONFIG.TAB_CAMPAIGN, CAMPAIGN_HEADERS), campaignRows);
    }
    if (adsetRows.length) {
      appendRows_(ensureSheet_(ss, CONFIG.TAB_ADSET, ADSET_HEADERS), adsetRows);
    }

    var emails = uniqStrings_(Object.keys(reportsByEmail).concat(Object.keys(failuresByEmail)));
    emails.forEach(function (email) {
      sendWeeklyReportFor_(email, reportsByEmail[email] || [], failuresByEmail[email] || []);
    });

    writeLog_(ss, startedAt, 'OK',
      '[WEEKLY] ' + (log.length ? log.join(' | ') : 'tidak ada langganan Weekly aktif'));

  } catch (err) {
    try {
      writeLog_(openSpreadsheet_(), startedAt, 'ERROR', '[WEEKLY] ' + err.message);
    } catch (e) { /* sheet tidak terjangkau */ }
    if (CONFIG.EMAIL_TO) {
      MailApp.sendEmail(CONFIG.EMAIL_TO,
        '[Weekly Campaign Review] Script gagal total',
        'Error: ' + err.message + '\n\n' + (err.stack || '') +
        '\n\n(Ini email ke kontak admin, BUKAN ke langganan manapun — ' +
        'skrip gagal total sebelum sempat memproses satu pun brand.)');
    }
  }
}

function pushTo_(map, key, value) {
  if (!map[key]) map[key] = [];
  map[key].push(value);
}

function uniqStrings_(arr) {
  var seen = {}, out = [];
  arr.forEach(function (s) { if (!seen[s]) { seen[s] = true; out.push(s); } });
  return out;
}

// ============================================================
// LOGIKA REVIEW — SATU LANGGANAN, memakai data harian yang SUDAH
// ditarik sekali per brand (byDate) di weeklyRun()
// ============================================================

function evaluateBrandWeeklyForSub_(acct, token, meta, byDate, tz, sub) {
  var ws = weeklySettingsFor_(sub);
  var runDate = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

  var pn = buildPair_(tz, ws.periodDays);
  var pw = buildPair_(tz, ws.widePeriodDays);

  // --- Tahap 1: jendela sempit (dari data harian, bukan fetch baru) ---
  var narrowNow  = sumDailyRange_(byDate, pn.current.since, pn.current.until);
  var narrowPrev = sumDailyRange_(byDate, pn.previous.since, pn.previous.until);

  var campaigns = [], needWide = false;

  Object.keys(narrowNow).forEach(function (id) {
    var a = narrowNow[id];
    var b = narrowPrev[id] || null;
    var key = resolveResultKey_(a.campaign_name, id, meta, a.actions, b ? b.actions : {});

    var c = buildComparison_(a, b, key);
    decorateWeekly_(c, id, a, acct, key, 'narrow', ws);

    if (!b) {
      c.flag = 'BARU';
    } else if (c.spendNow < ws.minSpend) {
      c.flag = 'SPEND KECIL';
    } else if (!(c.resultsNow >= ws.minResults || c.resultsPrev >= ws.minResults)) {
      c.flag = 'PENDING';
      needWide = true;
    } else {
      c.flag = evaluateWeeklyFlag_(c, ws);
    }

    campaigns.push(c);
  });

  // --- Tahap 2: eskalasi ke jendela lebar (masih dari data harian yang sama) ---
  var escalated = 0;
  if (needWide) {
    var wideNow  = sumDailyRange_(byDate, pw.current.since, pw.current.until);
    var widePrev = sumDailyRange_(byDate, pw.previous.since, pw.previous.until);

    campaigns.forEach(function (c) {
      if (c.flag !== 'PENDING') return;
      escalated++;

      var a = wideNow[c.id];
      if (!a) { c.flag = 'TIDAK ADA DATA'; return; }
      var b = widePrev[c.id] || null;

      var key = resolveResultKey_(c.name, c.id, meta, a.actions, b ? b.actions : {});
      var w = buildComparison_(a, b, key);
      decorateWeekly_(w, c.id, a, acct, key, 'wide', ws);
      copyInto_(c, w);

      if (!b) {
        c.flag = 'BARU';
      } else if (!(c.resultsNow >= ws.minResults || c.resultsPrev >= ws.minResults)) {
        // Spend berjalan tanpa satu pun result selama jendela lebar:
        // tidak bisa dibandingkan secara statistik, tapi justru
        // inilah temuan yang paling mendesak.
        c.flag = (c.resultsNow === 0 && c.resultsPrev === 0 &&
                  c.spendNow >= ws.minSpend)
               ? 'NOL RESULT' : 'VOLUME KECIL';
      } else {
        c.flag = evaluateWeeklyFlag_(c, ws);
      }
    });
  }

  var flagged    = campaigns.filter(function (c) { return c.flag === 'PERLU DICEK'; });
  var zeroResult = campaigns.filter(function (c) { return c.flag === 'NOL RESULT'; });

  var periodsForRow = { narrow: pn, wide: pw };
  var campaignRows = campaigns.map(function (c) { return campaignRowOf_(runDate, sub.email, c, periodsForRow); });

  // --- Tahap 3: drill-down adset -- per langganan (cuma campaign yang
  // sudah ke-flag untuk langganan INI, jadi tetap murah walau
  // dievaluasi berkali-kali untuk brand yang sama). ---
  var adsetRows = [];
  if (flagged.length) {
    var windowsNeeded = {};
    flagged.forEach(function (c) { windowsNeeded[c.window] = true; });

    var adsetData = {};
    Object.keys(windowsNeeded).forEach(function (w) {
      var per = periodsForRow[w];
      adsetData[w] = {
        now:  fetchInsights_(token, acct.id, 'adset', per.current),
        prev: fetchInsights_(token, acct.id, 'adset', per.previous)
      };
    });

    flagged.forEach(function (parent) {
      var data = adsetData[parent.window];

      Object.keys(data.now).forEach(function (sid) {
        var a = data.now[sid];
        if (a.campaign_id !== parent.id) return;

        var b = data.prev[sid] || null;
        var am = meta.byAdset[sid];
        var key = matchOverride_(parent.name)
               || ((am && am.candidates.length) ? am.candidates[0] : parent.resultKey);

        var d = buildComparison_(a, b, key);
        d.id = sid;
        d.name = a.adset_name;
        d.campaignName = a.campaign_name;
        d.client = acct.client;
        d.resultKey = key;
        d.window = parent.window;
        d.flag = !b ? 'BARU'
               : (d.spendNow < ws.minSpend ? 'SPEND KECIL'
               : evaluateWeeklyFlag_(d, ws));

        adsetRows.push(adsetRowOf_(runDate, sub.email, d));
        if (!parent.adsets) parent.adsets = [];
        parent.adsets.push(d);
      });

      // paling bermasalah di atas; CPR kosong ditaruh terakhir
      if (parent.adsets) {
        parent.adsets.sort(function (x, y) {
          return (y.cprDelta === null ? -Infinity : y.cprDelta) -
                 (x.cprDelta === null ? -Infinity : x.cprDelta);
        });
      }
    });
  }

  return {
    client: acct.client,
    type: acct.type,
    email: sub.email,
    metrics: ws.metrics,
    minSpend: ws.minSpend,
    minResults: ws.minResults,
    periodDays: ws.periodDays,
    widePeriodDays: ws.widePeriodDays,
    periods: periodsForRow,
    campaigns: campaigns,
    flagged: flagged,
    zeroResult: zeroResult,
    escalated: escalated,
    campaignRows: campaignRows,
    adsetRows: adsetRows
  };
}

function decorateWeekly_(c, id, a, acct, key, window, ws) {
  c.id = id;
  c.name = a.campaign_name;
  c.objective = a.objective || '';
  c.client = acct.client;
  c.resultKey = key;
  c.window = window;
  c.narrowDays = ws.periodDays;
  c.wideDays = ws.widePeriodDays;
}

function copyInto_(target, source) {
  Object.keys(source).forEach(function (k) {
    if (k === 'flag' || k === 'adsets') return;
    target[k] = source[k];
  });
}

/**
 * Evaluasi semua aturan Weekly langganan ini terhadap satu campaign.
 * Menyimpan aturan yang terpicu di c.matchedRules (dipakai email untuk
 * menjelaskan "terpicu karena ...") dan mengembalikan flag akhirnya.
 */
function evaluateWeeklyFlag_(c, ws) {
  var matched = [];
  ws.metrics.forEach(function (rule) {
    if (evaluateDeltaRule_(c, rule)) matched.push(rule);
  });
  c.matchedRules = matched;
  return matched.length ? 'PERLU DICEK' : 'AMAN';
}

/**
 * Cost per result bernilai null (bukan 0) saat result nol —
 * CPR-nya tidak terdefinisi, dan menuliskannya sebagai 0 akan
 * terbaca "biaya turun 100%", kebalikan dari keadaan sebenarnya.
 */
function buildComparison_(a, b, resultKey) {
  var spendNow  = num_(a.spend);
  var spendPrev = b ? num_(b.spend) : 0;

  var resNow  = resultValue_(a, resultKey);
  var resPrev = b ? resultValue_(b, resultKey) : 0;

  var cprNow  = resNow  ? spendNow  / resNow  : null;
  var cprPrev = resPrev ? spendPrev / resPrev : null;

  return {
    spendNow: spendNow,
    spendPrev: spendPrev,
    spendDelta: delta_(spendNow, spendPrev),

    resultsNow: resNow,
    resultsPrev: resPrev,
    resultsDelta: delta_(resNow, resPrev),

    cprNow: cprNow,
    cprPrev: cprPrev,
    cprDelta: (cprNow !== null && cprPrev !== null) ? delta_(cprNow, cprPrev) : null,

    ctrNow: num_(a.ctr),
    ctrPrev: b ? num_(b.ctr) : 0,
    ctrDelta: delta_(num_(a.ctr), b ? num_(b.ctr) : 0),

    cpmNow: num_(a.cpm),
    cpmPrev: b ? num_(b.cpm) : 0,
    cpmDelta: delta_(num_(a.cpm), b ? num_(b.cpm) : 0),

    freqNow: num_(a.frequency),
    freqPrev: b ? num_(b.frequency) : 0,
    freqDelta: delta_(num_(a.frequency), b ? num_(b.frequency) : 0),

    impressionsNow: num_(a.impressions),
    impressionsPrev: b ? num_(b.impressions) : 0,
    impressionsDelta: delta_(num_(a.impressions), b ? num_(b.impressions) : 0),

    reachNow: num_(a.reach),
    reachPrev: b ? num_(b.reach) : 0,
    reachDelta: delta_(num_(a.reach), b ? num_(b.reach) : 0),

    clicksNow: num_(a.clicks),
    clicksPrev: b ? num_(b.clicks) : 0,
    clicksDelta: delta_(num_(a.clicks), b ? num_(b.clicks) : 0),

    cpcNow: num_(a.cpc),
    cpcPrev: b ? num_(b.cpc) : 0,
    cpcDelta: delta_(num_(a.cpc), b ? num_(b.cpc) : 0),

    uniqueClicksNow: num_(a.unique_clicks),
    uniqueClicksPrev: b ? num_(b.unique_clicks) : 0,
    uniqueClicksDelta: delta_(num_(a.unique_clicks), b ? num_(b.unique_clicks) : 0),

    inlineLinkClicksNow: num_(a.inline_link_clicks),
    inlineLinkClicksPrev: b ? num_(b.inline_link_clicks) : 0,
    inlineLinkClicksDelta: delta_(num_(a.inline_link_clicks), b ? num_(b.inline_link_clicks) : 0),

    costPerInlineLinkClickNow: num_(a.cost_per_inline_link_click),
    costPerInlineLinkClickPrev: b ? num_(b.cost_per_inline_link_click) : 0,
    costPerInlineLinkClickDelta: delta_(num_(a.cost_per_inline_link_click), b ? num_(b.cost_per_inline_link_click) : 0),

    uniqueCtrNow: num_(a.unique_ctr),
    uniqueCtrPrev: b ? num_(b.unique_ctr) : 0,
    uniqueCtrDelta: delta_(num_(a.unique_ctr), b ? num_(b.unique_ctr) : 0),

    costPerUniqueClickNow: num_(a.cost_per_unique_click),
    costPerUniqueClickPrev: b ? num_(b.cost_per_unique_click) : 0,
    costPerUniqueClickDelta: delta_(num_(a.cost_per_unique_click), b ? num_(b.cost_per_unique_click) : 0),

    socialSpendNow: num_(a.social_spend),
    socialSpendPrev: b ? num_(b.social_spend) : 0,
    socialSpendDelta: delta_(num_(a.social_spend), b ? num_(b.social_spend) : 0),

    fullViewImpressionsNow: num_(a.full_view_impressions),
    fullViewImpressionsPrev: b ? num_(b.full_view_impressions) : 0,
    fullViewImpressionsDelta: delta_(num_(a.full_view_impressions), b ? num_(b.full_view_impressions) : 0),

    fullViewReachNow: num_(a.full_view_reach),
    fullViewReachPrev: b ? num_(b.full_view_reach) : 0,
    fullViewReachDelta: delta_(num_(a.full_view_reach), b ? num_(b.full_view_reach) : 0),

    status: a.effective_status || ''
  };
}

// ============================================================
// PENENTUAN RESULT TYPE
// ============================================================

function resolveResultKey_(campaignName, campaignId, meta, actionsNow, actionsPrev) {
  var ovr = matchOverride_(campaignName);
  if (ovr) return ovr;

  var available = {};
  Object.keys(actionsNow || {}).forEach(function (k) { available[k] = true; });
  Object.keys(actionsPrev || {}).forEach(function (k) { available[k] = true; });

  var candidates = (meta && meta.byCampaign[campaignId]) || [];
  for (var i = 0; i < candidates.length; i++) {
    if (available[candidates[i]] ||
        candidates[i] === 'reach' || candidates[i] === 'impressions') {
      return candidates[i];
    }
  }
  // kandidat pertama tetap dipakai walau nilainya nol —
  // campaign memang belum menghasilkan result, bukan salah peta
  if (candidates.length) return candidates[0];

  var generic = [
    'offsite_conversion.fb_pixel_purchase', 'omni_purchase',
    'onsite_conversion.messaging_conversation_started_7d',
    'lead', 'landing_page_view', 'link_click', 'post_engagement'
  ];
  for (var j = 0; j < generic.length; j++) {
    if (available[generic[j]]) return generic[j];
  }
  return 'link_click';
}

function matchOverride_(campaignName) {
  var name = (campaignName || '').toLowerCase();
  var keys = Object.keys(CAMPAIGN_RESULT_OVERRIDE);
  for (var i = 0; i < keys.length; i++) {
    if (name.indexOf(keys[i].toLowerCase()) > -1) {
      return CAMPAIGN_RESULT_OVERRIDE[keys[i]];
    }
  }
  return null;
}

function resultValue_(row, key) {
  if (key === 'reach') return num_(row.reach);
  if (key === 'impressions') return num_(row.impressions);
  return (row.actions && row.actions[key]) ? row.actions[key] : 0;
}

function isProxy_(key) {
  return !!PROXY_KEYS[key];
}

// ============================================================
// PENGAMBILAN DATA
// ============================================================

/**
 * Metadata konfigurasi adset — tidak tersedia di endpoint
 * insights. Inilah yang memungkinkan custom conversion
 * terdeteksi (action type-nya berupa ID unik).
 */
function fetchAdsetMeta_(token, accountId) {
  var fields = 'id,name,campaign_id,optimization_goal,' +
    'promoted_object{custom_event_type,custom_conversion_id,pixel_id,application_id}';

  var url = 'https://graph.facebook.com/' + CONFIG.API_VERSION + '/' +
    accountId + '/adsets' +
    '?fields=' + encodeURIComponent(fields) +
    '&limit=200&access_token=' + encodeURIComponent(token);

  var byCampaign = {}, byAdset = {}, guard = 0;

  while (url && guard < 25) {
    guard++;
    var body = fetchJson_(url);
    (body.data || []).forEach(function (s) {
      var cand = candidatesFromAdset_(s);
      byAdset[s.id] = {
        name: s.name,
        goal: s.optimization_goal || '',
        event: (s.promoted_object && s.promoted_object.custom_event_type) || '',
        customId: (s.promoted_object && s.promoted_object.custom_conversion_id) || '',
        candidates: cand
      };
      if (cand.length && !byCampaign[s.campaign_id]) byCampaign[s.campaign_id] = cand;
    });
    url = (body.paging && body.paging.next) ? body.paging.next : null;
  }

  return { byCampaign: byCampaign, byAdset: byAdset };
}

function candidatesFromAdset_(s) {
  var goal = s.optimization_goal || '';
  var po = s.promoted_object || {};

  if (po.custom_conversion_id) {
    return ['offsite_conversion.custom.' + po.custom_conversion_id];
  }
  if (OPT_GOAL_MAP.hasOwnProperty(goal)) {
    var mapped = OPT_GOAL_MAP[goal];
    if (mapped) return mapped.slice();
    var ev = po.custom_event_type || '';
    if (EVENT_MAP[ev]) return EVENT_MAP[ev].slice();
  }
  return [];
}

/** Satu range, satu request -- dipakai drill-down adset (per langganan, volume kecil) dan Daily Tracking (H-1). */
function fetchInsights_(token, accountId, level, period) {
  var fields = [
    'campaign_id', 'campaign_name', 'objective',
    'spend', 'impressions', 'reach', 'frequency',
    'clicks', 'ctr', 'cpc', 'cpm', 'actions',
    // Field angka datar tambahan (tanpa breakdown) -- lihat METRIC_FIELDS.
    'unique_clicks', 'inline_link_clicks', 'cost_per_inline_link_click',
    'unique_ctr', 'cost_per_unique_click', 'social_spend',
    'full_view_impressions', 'full_view_reach'
  ];
  if (level === 'adset') fields.push('adset_id', 'adset_name');

  var url = 'https://graph.facebook.com/' + CONFIG.API_VERSION + '/' +
    accountId + '/insights' +
    '?fields=' + encodeURIComponent(fields.join(',')) +
    '&level=' + level +
    '&time_range=' + encodeURIComponent(JSON.stringify({
      since: period.since, until: period.until })) +
    '&limit=300&access_token=' + encodeURIComponent(token);

  var out = {}, guard = 0;

  while (url && guard < 25) {
    guard++;
    var body = fetchJson_(url);
    (body.data || []).forEach(function (d) {
      d.actions = mapActions_(d.actions);
      out[(level === 'adset') ? d.adset_id : d.campaign_id] = d;
    });
    url = (body.paging && body.paging.next) ? body.paging.next : null;
  }

  return out;
}

/**
 * Insight HARIAN (time_increment=1) satu akun, mencakup [since,until],
 * dikembalikan sebagai { 'YYYY-MM-DD': { campaignId/adsetId: row } }.
 * Ini yang memungkinkan satu brand cukup ditarik SEKALI walau banyak
 * langganan minta panjang periode berbeda -- lihat sumDailyRange_
 * untuk menjumlahkan ulang jadi rentang yang dibutuhkan tiap langganan.
 */
function fetchDailyInsights_(token, accountId, level, since, until) {
  var fields = [
    'campaign_id', 'campaign_name', 'objective',
    'spend', 'impressions', 'reach', 'frequency',
    'clicks', 'ctr', 'cpc', 'cpm', 'actions',
    // Field angka datar tambahan (tanpa breakdown) -- lihat METRIC_FIELDS.
    'unique_clicks', 'inline_link_clicks', 'cost_per_inline_link_click',
    'unique_ctr', 'cost_per_unique_click', 'social_spend',
    'full_view_impressions', 'full_view_reach'
  ];
  if (level === 'adset') fields.push('adset_id', 'adset_name');

  var url = 'https://graph.facebook.com/' + CONFIG.API_VERSION + '/' +
    accountId + '/insights' +
    '?fields=' + encodeURIComponent(fields.join(',')) +
    '&level=' + level +
    '&time_increment=1' +
    '&time_range=' + encodeURIComponent(JSON.stringify({ since: since, until: until })) +
    '&limit=300&access_token=' + encodeURIComponent(token);

  var byDate = {}, guard = 0;

  while (url && guard < 60) {
    guard++;
    var body = fetchJson_(url);
    (body.data || []).forEach(function (d) {
      d.actions = mapActions_(d.actions);
      var date = d.date_start;
      if (!byDate[date]) byDate[date] = {};
      byDate[date][(level === 'adset') ? d.adset_id : d.campaign_id] = d;
    });
    url = (body.paging && body.paging.next) ? body.paging.next : null;
  }

  return byDate;
}

/**
 * Jumlahkan hasil fetchDailyInsights_ untuk rentang [sinceStr,untilStr]
 * jadi satu baris per campaign/adset, meniru bentuk fetchInsights_ biasa
 * supaya sisa logika (buildComparison_, dst.) tidak perlu tahu bedanya.
 * spend/impressions/clicks/actions genuinely additive lintas hari;
 * ctr/cpm dihitung ulang dari angka yang sudah dijumlahkan (lebih akurat
 * daripada rata-rata ctr/cpm harian); reach dijumlahkan sebagai
 * pendekatan (lihat catatan di header file) -- tidak dipakai flag apa pun.
 */
function sumDailyRange_(byDate, sinceStr, untilStr) {
  var out = {};

  Object.keys(byDate).forEach(function (date) {
    if (date < sinceStr || date > untilStr) return;
    var dayRows = byDate[date];

    Object.keys(dayRows).forEach(function (id) {
      var row = dayRows[id];
      if (!out[id]) {
        out[id] = {
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name,
          objective: row.objective || '',
          adset_id: row.adset_id,
          adset_name: row.adset_name,
          effective_status: row.effective_status || '',
          spend: 0, impressions: 0, reach: 0, clicks: 0,
          unique_clicks: 0, inline_link_clicks: 0, social_spend: 0,
          full_view_impressions: 0, full_view_reach: 0,
          actions: {}
        };
      }
      var acc = out[id];
      acc.spend += num_(row.spend);
      acc.impressions += num_(row.impressions);
      acc.reach += num_(row.reach);
      acc.clicks += num_(row.clicks);
      acc.unique_clicks += num_(row.unique_clicks);
      acc.inline_link_clicks += num_(row.inline_link_clicks);
      acc.social_spend += num_(row.social_spend);
      acc.full_view_impressions += num_(row.full_view_impressions);
      acc.full_view_reach += num_(row.full_view_reach);
      Object.keys(row.actions || {}).forEach(function (k) {
        acc.actions[k] = (acc.actions[k] || 0) + row.actions[k];
      });
    });
  });

  // Field rasio TIDAK dijumlahkan lintas hari -- dihitung ulang dari
  // komponen additive yang sudah dijumlahkan (sama prinsipnya dengan
  // ctr/cpm/frequency).
  Object.keys(out).forEach(function (id) {
    var acc = out[id];
    acc.ctr = acc.impressions ? (acc.clicks / acc.impressions * 100) : 0;
    acc.cpm = acc.impressions ? (acc.spend / acc.impressions * 1000) : 0;
    acc.frequency = acc.reach ? (acc.impressions / acc.reach) : 0;
    acc.cpc = acc.clicks ? (acc.spend / acc.clicks) : 0;
    acc.cost_per_inline_link_click = acc.inline_link_clicks ? (acc.spend / acc.inline_link_clicks) : 0;
    acc.unique_ctr = acc.impressions ? (acc.unique_clicks / acc.impressions * 100) : 0;
    acc.cost_per_unique_click = acc.unique_clicks ? (acc.spend / acc.unique_clicks) : 0;
  });

  return out;
}

/**
 * Error sementara dari Meta cukup sering terjadi, terutama pada
 * akun dengan banyak campaign. Diulang dengan jeda yang makin
 * panjang sebelum benar-benar dianggap gagal.
 */
var RETRYABLE_CODES = {
  1: true,      // API Unknown — masalah sementara di sisi Meta
  2: true,      // API Service — server sedang bermasalah
  4: true,      // rate limit aplikasi
  17: true,     // rate limit pengguna
  32: true,     // rate limit halaman
  341: true,    // batas sementara
  613: true,    // rate limit permintaan
  80004: true   // rate limit khusus Ads Insights
};

function fetchJson_(url) {
  var maxAttempts = 4;
  var lastError = null;

  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var text = res.getContentText();
    var body;

    try {
      body = JSON.parse(text);
    } catch (e) {
      // respons bukan JSON (mis. halaman error HTML) — layak diulang
      lastError = new Error('Respons tidak valid (HTTP ' + res.getResponseCode() + ')');
      Utilities.sleep(backoffMs_(attempt));
      continue;
    }

    if (!body.error) return body;

    var code = body.error.code;
    lastError = new Error(body.error.message + ' (code ' + code + ')');

    if (!RETRYABLE_CODES[code] || attempt === maxAttempts) {
      throw lastError;   // error permanen, atau percobaan sudah habis
    }

    Utilities.sleep(backoffMs_(attempt));
  }

  throw lastError;
}

/** Jeda bertambah: 2 detik, 5 detik, 12 detik. */
function backoffMs_(attempt) {
  return [2000, 5000, 12000][attempt - 1] || 12000;
}

function mapActions_(arr) {
  var out = {};
  (arr || []).forEach(function (x) { out[x.action_type] = num_(x.value); });
  return out;
}

// ============================================================
// TOKEN
// ============================================================

function tokenFor_(acct) {
  return getToken_(acct.tokenKey || 'META_TOKEN');
}

function getToken_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) {
    throw new Error('Script Property "' + key + '" belum diisi. ' +
      'Buka Project Settings > Script Properties untuk menambahkannya.');
  }
  return v;
}

// ============================================================
// PENULISAN KE SHEET
// ============================================================

function campaignRowOf_(runDate, email, c, p) {
  var w = p[c.window];
  return [
    runDate, c.client, email, c.name, c.objective, c.status, windowLabel2_(c),
    w.current.label, w.previous.label,
    c.spendNow, c.spendPrev, cell_(c.spendDelta),
    c.resultsNow, c.resultsPrev, cell_(c.resultsDelta),
    cell_(c.cprNow), cell_(c.cprPrev), cell_(c.cprDelta),
    c.ctrNow, c.ctrPrev, cell_(c.ctrDelta),
    c.cpmNow, c.cpmPrev, cell_(c.cpmDelta),
    c.resultKey, isProxy_(c.resultKey) ? 'PROXY' : '', c.flag
  ];
}

function adsetRowOf_(runDate, email, d) {
  return [
    runDate, d.client, email, d.campaignName, d.name, d.status, windowLabel2_(d),
    d.spendNow, d.spendPrev, cell_(d.spendDelta),
    d.resultsNow, d.resultsPrev, cell_(d.resultsDelta),
    cell_(d.cprNow), cell_(d.cprPrev), cell_(d.cprDelta),
    d.ctrNow, d.ctrPrev, cell_(d.ctrDelta),
    d.freqNow, d.freqPrev,
    d.resultKey, isProxy_(d.resultKey) ? 'PROXY' : '', d.flag
  ];
}

/** null -> sel kosong, bukan 0 */
function cell_(v) {
  return (v === null || v === undefined) ? '' : v;
}

function appendRows_(sheet, rows) {
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

// ============================================================
// LAPORAN EMAIL — satu email per EMAIL LANGGANAN, berisi semua
// brand yang dia langgan
// ============================================================

function sendWeeklyReportFor_(email, reports, failures) {
  var flagged = reports.reduce(function (n, r) { return n + r.flagged.length; }, 0);
  var zero    = reports.reduce(function (n, r) { return n + r.zeroResult.length; }, 0);
  failures = failures || [];

  if (!reports.length && !failures.length) return;
  if (!CONFIG.EMAIL_ALWAYS && !flagged && !zero && !failures.length) return;

  var parts = [];
  if (flagged) parts.push(flagged + ' perlu dicek');
  if (zero)    parts.push(zero + ' nol result');
  if (failures.length) parts.push(failures.length + ' brand gagal');

  var subjectPeriod = reports.length ? reports[0].periods.narrow.current.label : '';

  MailApp.sendEmail({
    to: email,
    subject: '[Weekly Review] ' + subjectPeriod + ' — ' +
             (parts.length ? parts.join(', ') : 'semua aman'),
    htmlBody: buildReportHtml_(reports, flagged, zero, failures)
  });
}

function buildReportHtml_(reports, flagged, zero, failures) {
  var h = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c1e21;max-width:780px">';

  h += '<h2 style="margin:0 0 12px">Weekly Campaign Review</h2>';

  if (failures && failures.length) {
    h += '<div style="border-left:4px solid #8a8d91;background:#f5f6f7;padding:10px 14px;margin:12px 0">';
    h += '<div style="font-weight:bold;margin-bottom:6px">Brand yang gagal ditarik</div>';
    failures.forEach(function (f) {
      h += '<div style="margin:3px 0;font-size:13px">' + f.client + typeBadge_(f.type) +
           ' — <span style="color:#65676b">' + f.message + '</span></div>';
    });
    h += '<div style="font-size:12px;color:#65676b;margin-top:6px">' +
         'Data brand ini tidak ada di laporan. Periksa token dan assignment aset ' +
         'system user.</div></div>';
  }

  if (!flagged && !zero && !reports.length) {
    h += '<p>Tidak ada brand yang berhasil diproses untuk langganan Anda.</p>';
  } else if (!flagged && !zero) {
    h += '<p>Tidak ada campaign yang melewati ambang, dan tidak ada campaign ' +
         'yang berjalan tanpa result.</p>';
  }

  reports.forEach(function (r) {
    h += '<h3 style="margin:22px 0 4px;padding-bottom:4px;border-bottom:2px solid #e4e6eb">' +
         r.client + typeBadge_(r.type) + '</h3>';
    h += '<p style="margin:0 0 4px;color:#65676b;font-size:12px">Jendela: ' +
         r.periods.narrow.current.label + ' vs ' + r.periods.narrow.previous.label + '</p>';

    var noteBits = r.metrics.map(function (rule) {
      return (FIELD_LABELS[rule.field] || rule.field) + ' ' + (rule.direction === 'up' ? 'naik' : 'turun') +
             ' &ge; ' + Math.round(rule.threshold * 100) + '%';
    });
    if (noteBits.length) {
      h += '<p style="font-size:11px;color:#8a8d91;margin:0 0 10px">' +
           'Ambang langganan ini: ' + noteBits.join(' atau ') + '. Campaign dengan result &lt; ' +
           r.minResults + ' pada jendela ' + r.periodDays + ' hari dievaluasi ulang dengan jendela ' +
           r.widePeriodDays + ' hari.</p>';
    }

    // --- nol result: paling mendesak ---
    if (r.zeroResult.length) {
      h += '<div style="border-left:4px solid #f7b928;background:#fffbf0;padding:10px 14px;margin:12px 0">';
      h += '<div style="font-weight:bold;margin-bottom:2px">Spend berjalan tanpa result</div>';
      h += '<div style="font-size:12px;color:#65676b;margin-bottom:8px">' +
           'Tidak ada satu pun konversi tercatat. Periksa pengiriman event pixel ' +
           'sebelum menyimpulkan performa iklannya.</div>';
      r.zeroResult.forEach(function (c) {
        h += '<div style="margin:3px 0">' + c.name +
             ' — <strong>' + rupiah_(c.spendNow) + '</strong>' +
             ' <span style="color:#8a8d91;font-size:12px">(' + c.resultKey + ')</span></div>';
      });
      h += '</div>';
    }

    // --- perlu dicek ---
    r.flagged.forEach(function (c) {
      h += '<div style="border-left:4px solid #e41e3f;background:#fbfbfb;padding:10px 14px;margin:12px 0">';
      h += '<div style="font-weight:bold;font-size:15px">' + c.name + '</div>';
      h += '<div style="color:#65676b;font-size:12px;margin-bottom:8px">' +
           windowBadge_(c) + 'result: <code>' + c.resultKey + '</code>' +
           (isProxy_(c.resultKey) ? proxyBadge_() : '') + '</div>';

      if (c.matchedRules && c.matchedRules.length) {
        h += '<div style="font-size:12px;color:#e41e3f;font-weight:bold;margin-bottom:6px">Terpicu: ' +
             c.matchedRules.map(function (rule) { return ruleTitle_(rule, c); }).join(', ') + '</div>';
      }

      h += metricLine_('Results', c.resultsNow, c.resultsPrev, c.resultsDelta, 'lower_is_bad');
      h += metricLine_('Cost per Result', c.cprNow, c.cprPrev, c.cprDelta, 'higher_is_bad', true);
      h += metricLine_('Spend', c.spendNow, c.spendPrev, c.spendDelta, 'neutral', true);
      h += metricLine_('CTR', c.ctrNow, c.ctrPrev, c.ctrDelta, 'lower_is_bad');
      h += metricLine_('CPM', c.cpmNow, c.cpmPrev, c.cpmDelta, 'higher_is_bad', true);

      if (c.adsets && c.adsets.length) {
        h += '<div style="margin-top:12px;padding-top:8px;border-top:1px dashed #ccd0d5">';
        h += '<div style="font-weight:bold;font-size:13px;margin-bottom:6px">Drill-down adset</div>';
        h += '<table style="border-collapse:collapse;width:100%;font-size:12px">' +
             '<tr style="background:#f0f2f5">' +
             '<th style="text-align:left;padding:5px">Adset</th>' +
             '<th style="text-align:right;padding:5px">Spend</th>' +
             '<th style="text-align:right;padding:5px">Results</th>' +
             '<th style="text-align:right;padding:5px">Δ Res</th>' +
             '<th style="text-align:right;padding:5px">CPR</th>' +
             '<th style="text-align:right;padding:5px">Δ CPR</th></tr>';
        c.adsets.forEach(function (d) {
          var bg = d.flag === 'PERLU DICEK' ? '#fff4f4' : '#ffffff';
          var td = 'padding:5px;border-top:1px solid #e4e6eb';
          h += '<tr style="background:' + bg + '">' +
               '<td style="' + td + '">' + d.name + '</td>' +
               '<td style="' + td + ';text-align:right">' + rupiah_(d.spendNow) + '</td>' +
               '<td style="' + td + ';text-align:right">' + fmt_(d.resultsNow) + '</td>' +
               '<td style="' + td + ';text-align:right;color:' + deltaColor_(d.resultsDelta, 'lower_is_bad') + '">' + pct_(d.resultsDelta) + '</td>' +
               '<td style="' + td + ';text-align:right">' + rupiah_(d.cprNow) + '</td>' +
               '<td style="' + td + ';text-align:right;color:' + deltaColor_(d.cprDelta, 'higher_is_bad') + '">' + pct_(d.cprDelta) + '</td>' +
               '</tr>';
        });
        h += '</table></div>';
      }
      h += '</div>';
    });

    h += buildSummaryTable_(r);
  });

  h += '<p style="font-size:11px;color:#8a8d91;margin-top:24px;border-top:1px solid #e4e6eb;padding-top:8px">' +
       'Tanda &mdash; berarti cost per result tidak terdefinisi karena result nol.</p>';

  // keterangan proxy — hanya untuk metrik yang benar-benar dipakai
  var proxyUsed = {};
  reports.forEach(function (r) {
    r.campaigns.forEach(function (c) {
      if (isProxy_(c.resultKey)) proxyUsed[c.resultKey] = true;
    });
  });
  Object.keys(proxyUsed).forEach(function (k) {
    h += '<p style="font-size:11px;color:#8a6d00;margin:4px 0">' +
         '<strong>PROXY</strong> <code>' + k + '</code>: ' + PROXY_KEYS[k] +
         '. Pakai untuk melihat tren, jangan disalin ke laporan klien.</p>';
  });

  return h + '</div>';
}

/** Ringkasan seluruh campaign, supaya tidak ada yang hilang diam-diam. */
function buildSummaryTable_(r) {
  var h = '<table style="border-collapse:collapse;width:100%;font-size:12px;margin-top:10px">';
  h += '<tr style="background:#f0f2f5">' +
       '<th style="text-align:left;padding:5px">Campaign</th>' +
       '<th style="text-align:center;padding:5px">Jendela</th>' +
       '<th style="text-align:right;padding:5px">Spend</th>' +
       '<th style="text-align:right;padding:5px">Results</th>' +
       '<th style="text-align:right;padding:5px">CPR</th>' +
       '<th style="text-align:right;padding:5px">Δ CPR</th>' +
       '<th style="text-align:left;padding:5px">Status</th></tr>';

  r.campaigns.slice().sort(function (a, b) { return b.spendNow - a.spendNow; })
    .forEach(function (c) {
      var td = 'padding:5px;border-top:1px solid #e4e6eb';
      h += '<tr>' +
           '<td style="' + td + '">' + c.name +
             (isProxy_(c.resultKey)
               ? ' <span style="color:#8a6d00;font-size:10px">PROXY</span>' : '') + '</td>' +
           '<td style="' + td + ';text-align:center;color:#8a8d91">' +
             (c.window === 'wide' ? c.wideDays : c.narrowDays) + 'h</td>' +
           '<td style="' + td + ';text-align:right">' + rupiah_(c.spendNow) + '</td>' +
           '<td style="' + td + ';text-align:right">' + fmt_(c.resultsNow) + '</td>' +
           '<td style="' + td + ';text-align:right">' + rupiah_(c.cprNow) + '</td>' +
           '<td style="' + td + ';text-align:right;color:' + deltaColor_(c.cprDelta, 'higher_is_bad') + '">' + pct_(c.cprDelta) + '</td>' +
           '<td style="' + td + ';color:' + flagColor_(c.flag) + '">' + c.flag + '</td>' +
           '</tr>';
    });

  return h + '</table>';
}

function proxyBadge_() {
  return '<span style="background:#fff3cd;color:#8a6d00;padding:1px 6px;' +
         'border-radius:3px;font-size:11px;margin-left:6px">PROXY</span>';
}

// Beberapa brand punya lebih dari satu ad account dengan nama sama (mis.
// "Crabus" MAIN dan "Crabus" CPAS) -- tanpa ini, judul section di email
// tidak bisa dibedakan satu sama lain.
function typeBadge_(type) {
  if (!type) return '';
  return ' <span style="background:#e7ecf5;color:#3c4a63;padding:1px 6px;' +
         'border-radius:3px;font-size:11px;font-weight:normal;vertical-align:middle">' + type + '</span>';
}

function metricLine_(label, now, prev, d, mode, isCurrency) {
  var fn = isCurrency ? rupiah_ : fmt_;
  return '<div style="margin:2px 0">' +
    '<span style="display:inline-block;width:130px;color:#65676b">' + label + '</span>' +
    '<strong>' + fn(now) + '</strong> ' +
    '<span style="color:#8a8d91">(dari ' + fn(prev) + ')</span> ' +
    '<span style="color:' + deltaColor_(d, mode) + ';font-weight:bold">' + pct_(d) + '</span></div>';
}

function deltaColor_(d, mode) {
  if (d === null || d === undefined || !d || mode === 'neutral') return '#65676b';
  var bad = (mode === 'higher_is_bad') ? d > 0 : d < 0;
  return bad ? '#e41e3f' : '#31a24c';
}

function flagColor_(flag) {
  if (flag === 'PERLU DICEK') return '#e41e3f';
  if (flag === 'NOL RESULT')  return '#c47f00';
  if (flag === 'AMAN')        return '#31a24c';
  return '#8a8d91';
}

/** Label "N hari" untuk satu baris campaign/adset, memakai periode MILIK LANGGANAN pemilik baris itu (bukan konstanta global). */
function windowLabel2_(c) {
  return (c.window === 'wide' ? c.wideDays : c.narrowDays) + ' hari';
}

function windowBadge_(c) {
  var bg = c.window === 'wide' ? '#fff3cd' : '#e7f3ff';
  var fg = c.window === 'wide' ? '#8a6d00' : '#0064d1';
  return '<span style="background:' + bg + ';color:' + fg +
         ';padding:1px 6px;border-radius:3px;font-size:11px;margin-right:6px">' +
         windowLabel2_(c) + '</span>';
}

// ============================================================
// PERIODE
// ============================================================

function buildPair_(tz, days) {
  var curUntil = new Date();
  curUntil.setDate(curUntil.getDate() - 1);        // kemarin
  var curSince = new Date(curUntil);
  curSince.setDate(curSince.getDate() - (days - 1));

  var prevUntil = new Date(curSince);
  prevUntil.setDate(prevUntil.getDate() - 1);
  var prevSince = new Date(prevUntil);
  prevSince.setDate(prevSince.getDate() - (days - 1));

  var f = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var lbl = function (a, b) {
    return Utilities.formatDate(a, tz, 'd MMM') + '–' +
           Utilities.formatDate(b, tz, 'd MMM yyyy');
  };

  return {
    current:  { since: f(curSince),  until: f(curUntil),  label: lbl(curSince, curUntil) },
    previous: { since: f(prevSince), until: f(prevUntil), label: lbl(prevSince, prevUntil) }
  };
}

// ============================================================
// UTILITAS
// ============================================================

function delta_(now, prev) {
  if (!prev || !isFinite(prev) || prev === 0) return 0;
  return (now - prev) / prev;
}

function openSpreadsheet_() {
  return CONFIG.SHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
         .setFontWeight('bold').setBackground('#f0f2f5');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function writeLog_(ss, startedAt, status, detail) {
  var sheet = ss.getSheetByName(CONFIG.TAB_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.TAB_LOG);
    sheet.appendRow(['Timestamp', 'Durasi (dtk)', 'Status', 'Detail']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([startedAt, Math.round((new Date() - startedAt) / 1000), status, detail]);
}

function tz_() { return Session.getScriptTimeZone() || 'Asia/Jakarta'; }

function num_(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

function fmt_(v) {
  if (v === null || v === undefined) return '—';
  return (Math.round(v * 100) / 100).toLocaleString('id-ID');
}

function pct_(v) {
  if (v === null || v === undefined) return '—';
  if (!v) return '0%';
  return (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
}

function rupiah_(v) {
  if (v === null || v === undefined) return '—';
  return 'Rp' + Math.round(v).toLocaleString('id-ID');
}

// ============================================================
// SETUP & DIAGNOSTIK
// ============================================================

function setupWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyRun') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyRun')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .inTimezone('Asia/Jakarta')
    .create();
  Logger.log('Trigger terpasang: setiap Senin 09:00 WIB.');
}

/** Cek cepat apakah tiap brand bisa dijangkau tokennya. */
function checkTokens() {
  getAllAccounts_().forEach(function (acct) {
    try {
      var body = fetchJson_('https://graph.facebook.com/' + CONFIG.API_VERSION + '/' +
        acct.id + '?fields=name,account_status,currency,business' +
        '&access_token=' + encodeURIComponent(tokenFor_(acct)));
      Logger.log('OK  %s (%s) | akun: %s | %s | business: %s',
        acct.client, acct.tokenKey || 'META_TOKEN', body.name, body.currency,
        (body.business && body.business.name) || '-');
    } catch (e) {
      Logger.log('ERR %s (%s) | %s', acct.client, acct.tokenKey || 'META_TOKEN', e.message);
    }
  });
}

/** Uji coba tanpa menunggu Senin. Tetap menulis sheet & kirim email ke tiap langganan aktif. */
function testWeeklyRun() {
  Logger.log('Menjalankan weeklyRun() sungguhan (per langganan Weekly aktif)...');
  weeklyRun();
}

/** Verifikasi result type — cocokkan dengan kolom Results di Ads Manager. Memakai jendela 3 hari default sistem. */
function diagnoseResultKeys() {
  var tz = tz_();
  var p = buildPair_(tz, CONFIG.PERIOD_DAYS);

  getAllAccounts_().forEach(function (acct) {
    Logger.log('\n===== %s (%s) =====', acct.client, acct.id);
    try {
      var token = tokenFor_(acct);
      var meta = fetchAdsetMeta_(token, acct.id);
      var now = fetchInsights_(token, acct.id, 'campaign', p.current);

      Object.keys(now).forEach(function (id) {
        var a = now[id];
        var key = resolveResultKey_(a.campaign_name, id, meta, a.actions, {});
        var res = resultValue_(a, key);
        var spend = num_(a.spend);

        Logger.log('\n■ %s', a.campaign_name);
        Logger.log('   sumber     : %s%s',
          matchOverride_(a.campaign_name) ? 'OVERRIDE' : 'otomatis',
          isProxy_(key) ? '  [PROXY]' : '');
        Logger.log('   result key : %s = %s', key, fmt_(res));
        Logger.log('   spend      : %s', rupiah_(spend));
        Logger.log('   CPR        : %s', res ? rupiah_(spend / res) : '—');

        var lines = [];
        Object.keys(a.actions || {}).forEach(function (k) {
          if (a.actions[k] > 0) lines.push('      ' + k + ' = ' + fmt_(a.actions[k]));
        });
        Logger.log('   action type tersedia:\n%s', lines.join('\n') || '      (tidak ada)');
      });
    } catch (e) {
      Logger.log('GAGAL: %s', e.message);
    }
  });
}

/** Menampilkan ad account yang bisa dijangkau tiap token. */
function listAdAccounts() {
  var seen = {};
  getAllAccounts_().forEach(function (acct) {
    var key = acct.tokenKey || 'META_TOKEN';
    if (seen[key]) return;
    seen[key] = true;

    Logger.log('\n===== token: %s =====', key);
    try {
      var body = fetchJson_('https://graph.facebook.com/' + CONFIG.API_VERSION +
        '/me/adaccounts?fields=account_id,name,currency,account_status' +
        '&limit=200&access_token=' + encodeURIComponent(getToken_(key)));
      (body.data || []).forEach(function (a) {
        Logger.log('act_%s | %s | %s | status %s',
          a.account_id, a.name, a.currency, a.account_status);
      });
      Logger.log('Total: %s akun', (body.data || []).length);
    } catch (e) {
      Logger.log('GAGAL: %s', e.message);
    }
  });
}
