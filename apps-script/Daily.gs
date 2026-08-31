/**
 * ============================================================
 * DAILY URGENT CHECK — pelengkap Weekly Campaign Review
 * ============================================================
 * v6: sama seperti Weekly.gs, dipisah per LANGGANAN (bukan per akun).
 * Berjalan SETIAP HARI, PER BRAND YANG PUNYA LANGGANAN DAILY AKTIF,
 * tapi hanya mengirim email ke orang yang punya temuan mendesak untuk
 * langganannya sendiri. Kalau semua normal untuk semua orang, script
 * diam sepenuhnya.
 *
 * Pembanding: KEMARIN vs rata-rata harian N hari sebelumnya (N =
 * baselineDays milik langganan, default 7). Berbeda dari laporan
 * mingguan karena tujuannya menangkap kejadian mendadak, bukan tren.
 *
 * METRIK sejak v7: BUKAN daftar tetap lagi -- tiap langganan menyusun
 * daftar aturannya sendiri lewat rule builder (field + arah + threshold),
 * lihat "RULE BUILDER METRIK" di Weekly.gs (dipakai bersama, satu global
 * scope). Dua bentuk aturan yang relevan untuk Daily:
 *   - ruleType 'zero'  — field ('spend' atau 'results') kemarin nol
 *     padahal biasanya ada, TANPA threshold (dulu disebut DELIVERY_STOP/
 *     RESULT_STOP). Delivery berhenti (spend nol) membatalkan evaluasi
 *     aturan lain pada campaign itu -- kalau iklannya tidak jalan, tidak
 *     ada metrik lain yang relevan dicek.
 *   - ruleType 'delta'  — field apa pun naik/turun melebihi threshold.
 *     Untuk field 'results'/'cpr': dilewati kalau result kemarin nol
 *     (biar tidak dobel dengan aturan 'zero' pada 'results') dan kalau
 *     baseline result-nya di bawah minBaselineRes.
 *
 * PISAH FETCH VS EVALUASI & COOLDOWN PER LANGGANAN — lihat komentar
 * senada di Weekly.gs; sidik jari cooldown di sini adalah
 * `email|campaignId|ruleId` (id aturan itu sendiri, bukan nama metrik
 * tetap -- karena sekarang bisa ada lebih dari satu aturan pada field
 * yang sama) supaya langganan kedua pada brand yang sama tetap dapat
 * alert-nya sendiri walau langganan pertama sudah menerimanya duluan.
 *
 * PEMASANGAN
 * 1. Buat FILE BARU di project Apps Script yang sama
 *    (klik + di sebelah Files), jangan menimpa file Weekly.gs.
 * 2. Tempel seluruh isi file ini.
 * 3. Jalankan testDailyUrgentCheck() untuk uji coba.
 * 4. Jalankan setupDailyTrigger() satu kali.
 *
 * File ini memakai CONFIG, getAllAccounts_, getSubscriptions_,
 * numOr_, fetchAdsetMeta_, fetchDailyInsights_, sumDailyRange_,
 * resolveResultKey_, dan utilitas lain dari Weekly.gs — jadi kedua
 * file harus ada di project yang sama.
 * ============================================================
 */

var URGENT = {

  // Nilai SARAN untuk placeholder di form ATLAS (bukan fallback otomatis
  // lagi sejak rule builder bebas -- threshold tiap aturan sekarang wajib
  // diisi user sendiri, tidak ada lagi "kosong = pakai ini").
  SUGGESTED_RESULT_DROP: 0.30,
  SUGGESTED_CPR_SPIKE:   0.50,
  SUGGESTED_SPEND_SPIKE: 1.00,

  // Pengaman volume minimum default SISTEM. BUKAN metrik, tidak bisa
  // dimatikan per langganan -- cuma bisa diisi angka lain.
  MIN_SPEND_DAILY:   30000,  // spend kemarin minimal segini
  MIN_BASELINE_RES:  2,      // rata-rata harian result minimal segini

  // Panjang baseline default SISTEM (hari)
  BASELINE_DAYS: 7,

  // Temuan yang sama tidak dikirim ulang selama sekian hari
  COOLDOWN_DAYS: 3,

  // Lewati pengecekan harian pada hari laporan mingguan,
  // supaya tidak dobel email di hari yang sama
  SKIP_ON_WEEKLY_DAY: true,
  WEEKLY_DAY: 1,   // 0=Minggu, 1=Senin

  // Kunci penyimpanan cooldown di Script Properties
  STATE_KEY: 'URGENT_ALERT_STATE'
};

/**
 * Setelan Daily efektif untuk SATU LANGGANAN -- daftar aturan metrik
 * bebas (array, lihat "RULE BUILDER METRIK" di Weekly.gs), pengaman &
 * panjang baseline. Guard/baseline kosong pakai default sistem
 * (URGENT.*) -- threshold DI DALAM tiap aturan wajib diisi, tidak ada
 * fallback.
 */
function dailySettingsFor_(sub) {
  var dg = sub.dailyGuards || {};
  var p = sub.periods || {};
  return {
    metrics: Array.isArray(sub.dailyMetrics) ? sub.dailyMetrics : [],
    minSpendDaily: numOr_(dg.minSpendDaily, URGENT.MIN_SPEND_DAILY),
    minBaselineRes: numOr_(dg.minBaselineRes, URGENT.MIN_BASELINE_RES),
    baselineDays: numOr_(p.baselineDays, URGENT.BASELINE_DAYS)
  };
}

// ============================================================
// ENTRY POINT
// ============================================================

/**
 * Dijalankan trigger harian. Diam kalau tidak ada temuan untuk
 * siapa pun.
 */
function dailyUrgentCheck() {
  var startedAt = new Date();

  if (URGENT.SKIP_ON_WEEKLY_DAY && new Date().getDay() === URGENT.WEEKLY_DAY) {
    Logger.log('Hari laporan mingguan — pengecekan harian dilewati.');
    return;
  }

  var accountsById = {};
  getAllAccounts_().forEach(function (a) { accountsById[a.id] = a; });

  var subs = getSubscriptions_().filter(function (s) {
    return Array.isArray(s.dailyMetrics) && s.dailyMetrics.length > 0;
  });

  var byBrand = {};
  subs.forEach(function (s) { pushTo_(byBrand, s.brandId, s); });

  var tz = tz_();
  var y = new Date(); y.setDate(y.getDate() - 1);
  var yStr = Utilities.formatDate(y, tz, 'yyyy-MM-dd');

  var log = [];
  var allFindings = [];
  var failuresByEmail = {};

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

      var maxBaseline = URGENT.BASELINE_DAYS;
      brandSubs.forEach(function (s) {
        maxBaseline = Math.max(maxBaseline, dailySettingsFor_(s).baselineDays);
      });

      var baseUntil = new Date(y); baseUntil.setDate(baseUntil.getDate() - 1);
      var baseSince = new Date(baseUntil); baseSince.setDate(baseSince.getDate() - (maxBaseline - 1));
      var byDate = fetchDailyInsights_(token, acct.id, 'campaign',
        Utilities.formatDate(baseSince, tz, 'yyyy-MM-dd'), yStr);

      var brandFindingsCount = 0;
      brandSubs.forEach(function (s) {
        var f = evaluateBrandDailyForSub_(acct, meta, byDate, tz, s, y);
        allFindings = allFindings.concat(f);
        brandFindingsCount += f.length;
      });
      log.push(acct.client + ': ' + brandFindingsCount + ' temuan (' + brandSubs.length + ' langganan)');
    } catch (e) {
      brandSubs.forEach(function (s) {
        pushTo_(failuresByEmail, s.email, { client: acct.client, message: e.message });
      });
      log.push('GAGAL ' + acct.client + ': ' + e.message);
    }
    Utilities.sleep(300);
  });

  // Saring temuan yang masih dalam masa cooldown. Sidik jari per
  // LANGGANAN (email|campaignId|kode) -- lihat catatan di header file.
  var state = loadAlertState_();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var fresh = allFindings.filter(function (f) { return !inCooldown_(state, f.fingerprint, today); });

  var freshByEmail = {};
  fresh.forEach(function (f) { pushTo_(freshByEmail, f.email, f); });

  var emails = uniqStrings_(Object.keys(freshByEmail).concat(Object.keys(failuresByEmail)));
  emails.forEach(function (email) {
    sendUrgentEmailFor_(email, freshByEmail[email] || [], failuresByEmail[email] || [], yStr);
  });

  if (fresh.length) {
    fresh.forEach(function (f) { state[f.fingerprint] = today; });
    saveAlertState_(pruneState_(state, today));
  }

  try {
    writeLog_(openSpreadsheet_(), startedAt,
      fresh.length ? 'URGENT: ' + fresh.length : 'harian — aman',
      '[DAILY] ' + (log.length ? log.join(' | ') : 'tidak ada langganan Daily aktif') +
      (allFindings.length !== fresh.length
        ? ' | ' + (allFindings.length - fresh.length) + ' ditahan cooldown' : ''));
  } catch (e) { /* sheet tidak terjangkau, abaikan */ }
}

// ============================================================
// PEMINDAIAN — SATU LANGGANAN, memakai data harian yang sudah
// ditarik sekali per brand (byDate) di dailyUrgentCheck()
// ============================================================

function evaluateBrandDailyForSub_(acct, meta, byDate, tz, sub, yesterdayDate) {
  var ds = dailySettingsFor_(sub);

  var yStr = Utilities.formatDate(yesterdayDate, tz, 'yyyy-MM-dd');
  var baseUntil = new Date(yesterdayDate); baseUntil.setDate(baseUntil.getDate() - 1);
  var baseSince = new Date(baseUntil); baseSince.setDate(baseSince.getDate() - (ds.baselineDays - 1));
  var baseSinceStr = Utilities.formatDate(baseSince, tz, 'yyyy-MM-dd');
  var baseUntilStr = Utilities.formatDate(baseUntil, tz, 'yyyy-MM-dd');

  var yst  = sumDailyRange_(byDate, yStr, yStr);
  var base = sumDailyRange_(byDate, baseSinceStr, baseUntilStr);

  var findings = [];

  // Campaign yang aktif kemarin ATAU aktif di periode baseline.
  // Union-nya penting: campaign yang berhenti total tidak muncul
  // di data kemarin, dan justru itulah yang perlu terdeteksi.
  var ids = {};
  Object.keys(yst).forEach(function (id) { ids[id] = true; });
  Object.keys(base).forEach(function (id) { ids[id] = true; });

  Object.keys(ids).forEach(function (id) {
    var a = yst[id]  || null;
    var b = base[id] || null;
    if (!b) return;   // tanpa baseline tidak ada yang bisa dibandingkan

    var name = (a && a.campaign_name) || b.campaign_name;
    var key = resolveResultKey_(name, id, meta, a ? a.actions : {}, b.actions);

    var dc = buildDailyComparison_(a, b, key, ds.baselineDays);

    // baseline spend harus cukup besar agar perbandingan bermakna
    if (dc.spendPrev < ds.minSpendDaily) return;

    var ctx = {
      email: sub.email,
      client: acct.client,
      campaignId: id,
      campaign: name,
      resultKey: key,
      spendNow: dc.spendNow,
      spendBase: dc.spendPrev,
      resNow: dc.resultsNow,
      resBase: dc.resultsPrev,
      cprNow: dc.cprNow,
      cprBase: dc.cprPrev,
      baselineDays: ds.baselineDays,
      proxy: isProxy_(key)
    };

    // Delivery berhenti: kalau spend kemarin nol, cuma aturan 'zero' pada
    // field 'spend' yang relevan -- aturan lain tidak bermakna kalau
    // iklannya tidak jalan sama sekali.
    if (dc.spendNow === 0) {
      ds.metrics.forEach(function (rule) {
        if (rule.ruleType === 'zero' && rule.field === 'spend') {
          findings.push(makeFinding_(ctx, rule, zeroFindingTitle_('spend'), zeroFindingDetail_('spend', ctx), dc));
        }
      });
      return;
    }
    if (dc.spendNow < ds.minSpendDaily) return;

    ds.metrics.forEach(function (rule) {
      if (rule.ruleType === 'zero') {
        if (rule.field !== 'results') return;   // 'spend' sudah ditangani di atas
        if (dc.resultsPrev < ds.minBaselineRes) return;
        if (evaluateZeroRule_(dc, rule)) {
          findings.push(makeFinding_(ctx, rule, zeroFindingTitle_('results'), zeroFindingDetail_('results', ctx), dc));
        }
        return;
      }

      // ruleType 'delta'
      if (rule.field === 'results' && dc.resultsNow === 0) return;   // sudah tercakup aturan 'zero' kalau ada
      if ((rule.field === 'results' || rule.field === 'cpr') && dc.resultsPrev < ds.minBaselineRes) return;
      if (evaluateDeltaRule_(dc, rule)) {
        findings.push(makeFinding_(ctx, rule, ruleTitle_(rule, dc), deltaFindingDetail_(rule, dc), dc));
      }
    });
  });

  return findings;
}

/**
 * Bangun objek perbandingan generik "kemarin vs rata-rata baseline" --
 * bentuknya SAMA dengan buildComparison_ (Weekly.gs) supaya
 * evaluateDeltaRule_/evaluateZeroRule_/ruleTitle_ bisa dipakai bersama
 * tanpa duplikasi. spend/results/impressions/reach genuinely additive
 * (dijumlahkan lalu dibagi baselineDays); ctr/cpm/frequency di `b` sudah
 * rasio PERIODE (dihitung sumDailyRange_ dari total yang dijumlahkan),
 * jadi TIDAK dibagi baselineDays lagi -- langsung dibandingkan ke rasio
 * kemarin.
 */
function buildDailyComparison_(a, b, key, baselineDays) {
  var spendNow = a ? num_(a.spend) : 0;
  var resNow   = a ? resultValue_(a, key) : 0;
  var impNow   = a ? num_(a.impressions) : 0;
  var reachNow = a ? num_(a.reach) : 0;
  var freqNow  = a ? num_(a.frequency) : 0;
  var ctrNow   = a ? num_(a.ctr) : 0;
  var cpmNow   = a ? num_(a.cpm) : 0;
  var clicksNow = a ? num_(a.clicks) : 0;
  var cpcNow = a ? num_(a.cpc) : 0;
  var uniqueClicksNow = a ? num_(a.unique_clicks) : 0;
  var inlineLinkClicksNow = a ? num_(a.inline_link_clicks) : 0;
  var costPerInlineLinkClickNow = a ? num_(a.cost_per_inline_link_click) : 0;
  var uniqueCtrNow = a ? num_(a.unique_ctr) : 0;
  var costPerUniqueClickNow = a ? num_(a.cost_per_unique_click) : 0;
  var socialSpendNow = a ? num_(a.social_spend) : 0;
  var fullViewImpressionsNow = a ? num_(a.full_view_impressions) : 0;
  var fullViewReachNow = a ? num_(a.full_view_reach) : 0;

  var spendBase = num_(b.spend) / baselineDays;
  var resBase   = resultValue_(b, key) / baselineDays;
  var impBase   = num_(b.impressions) / baselineDays;
  var reachBase = num_(b.reach) / baselineDays;
  var ctrBase   = num_(b.ctr);
  var cpmBase   = num_(b.cpm);
  var freqBase  = num_(b.frequency);
  // Additive (dijumlahkan lalu dibagi baselineDays):
  var clicksBase = num_(b.clicks) / baselineDays;
  var uniqueClicksBase = num_(b.unique_clicks) / baselineDays;
  var inlineLinkClicksBase = num_(b.inline_link_clicks) / baselineDays;
  var socialSpendBase = num_(b.social_spend) / baselineDays;
  var fullViewImpressionsBase = num_(b.full_view_impressions) / baselineDays;
  var fullViewReachBase = num_(b.full_view_reach) / baselineDays;
  // Rasio (sudah dihitung ulang per-periode di sumDailyRange_, TIDAK dibagi lagi):
  var cpcBase = num_(b.cpc);
  var costPerInlineLinkClickBase = num_(b.cost_per_inline_link_click);
  var uniqueCtrBase = num_(b.unique_ctr);
  var costPerUniqueClickBase = num_(b.cost_per_unique_click);

  var cprNow  = resNow  ? spendNow  / resNow  : null;
  var cprBase = resBase ? spendBase / resBase : null;

  return {
    spendNow: spendNow, spendPrev: spendBase, spendDelta: delta_(spendNow, spendBase),
    resultsNow: resNow, resultsPrev: resBase, resultsDelta: delta_(resNow, resBase),
    cprNow: cprNow, cprPrev: cprBase, cprDelta: (cprNow !== null && cprBase !== null) ? delta_(cprNow, cprBase) : null,
    ctrNow: ctrNow, ctrPrev: ctrBase, ctrDelta: delta_(ctrNow, ctrBase),
    cpmNow: cpmNow, cpmPrev: cpmBase, cpmDelta: delta_(cpmNow, cpmBase),
    freqNow: freqNow, freqPrev: freqBase, freqDelta: delta_(freqNow, freqBase),
    impressionsNow: impNow, impressionsPrev: impBase, impressionsDelta: delta_(impNow, impBase),
    reachNow: reachNow, reachPrev: reachBase, reachDelta: delta_(reachNow, reachBase),
    clicksNow: clicksNow, clicksPrev: clicksBase, clicksDelta: delta_(clicksNow, clicksBase),
    cpcNow: cpcNow, cpcPrev: cpcBase, cpcDelta: delta_(cpcNow, cpcBase),
    uniqueClicksNow: uniqueClicksNow, uniqueClicksPrev: uniqueClicksBase, uniqueClicksDelta: delta_(uniqueClicksNow, uniqueClicksBase),
    inlineLinkClicksNow: inlineLinkClicksNow, inlineLinkClicksPrev: inlineLinkClicksBase, inlineLinkClicksDelta: delta_(inlineLinkClicksNow, inlineLinkClicksBase),
    costPerInlineLinkClickNow: costPerInlineLinkClickNow, costPerInlineLinkClickPrev: costPerInlineLinkClickBase, costPerInlineLinkClickDelta: delta_(costPerInlineLinkClickNow, costPerInlineLinkClickBase),
    uniqueCtrNow: uniqueCtrNow, uniqueCtrPrev: uniqueCtrBase, uniqueCtrDelta: delta_(uniqueCtrNow, uniqueCtrBase),
    costPerUniqueClickNow: costPerUniqueClickNow, costPerUniqueClickPrev: costPerUniqueClickBase, costPerUniqueClickDelta: delta_(costPerUniqueClickNow, costPerUniqueClickBase),
    socialSpendNow: socialSpendNow, socialSpendPrev: socialSpendBase, socialSpendDelta: delta_(socialSpendNow, socialSpendBase),
    fullViewImpressionsNow: fullViewImpressionsNow, fullViewImpressionsPrev: fullViewImpressionsBase, fullViewImpressionsDelta: delta_(fullViewImpressionsNow, fullViewImpressionsBase),
    fullViewReachNow: fullViewReachNow, fullViewReachPrev: fullViewReachBase, fullViewReachDelta: delta_(fullViewReachNow, fullViewReachBase)
  };
}

function zeroFindingTitle_(field) {
  return field === 'spend' ? 'Delivery berhenti' : 'Berhenti menghasilkan result';
}

function zeroFindingDetail_(field, ctx) {
  if (field === 'spend') {
    return 'Tidak ada spend kemarin, padahal rata-rata ' + rupiah_(ctx.spendBase) +
      '/hari selama ' + ctx.baselineDays + ' hari sebelumnya.';
  }
  return 'Nol result kemarin dengan spend ' + rupiah_(ctx.spendNow) +
    ', padahal rata-rata ' + fmt_(ctx.resBase) + ' result/hari sebelumnya.';
}

function deltaFindingDetail_(rule, dc) {
  var f = METRIC_FIELDS[rule.field];
  return formatFieldValue_(rule.field, dc[f.now]) + ' kemarin vs rata-rata ' +
    formatFieldValue_(rule.field, dc[f.prev]) + '/hari sebelumnya.';
}

function makeFinding_(ctx, rule, title, detail, dc) {
  var f = METRIC_FIELDS[rule.field];
  return {
    ruleId: rule.id,
    field: rule.field,
    ruleType: rule.ruleType,
    title: title,
    detail: detail,
    email: ctx.email,
    client: ctx.client,
    campaign: ctx.campaign,
    resultKey: ctx.resultKey,
    proxy: ctx.proxy,
    spendNow: ctx.spendNow,
    spendBase: ctx.spendBase,
    resNow: ctx.resNow,
    resBase: ctx.resBase,
    cprNow: ctx.cprNow,
    cprBase: ctx.cprBase,
    valueNow: f ? dc[f.now] : null,
    valueBase: f ? dc[f.prev] : null,
    baselineDays: ctx.baselineDays,
    // Sidik jari cooldown PER LANGGANAN PER ATURAN -- id aturan itu sendiri
    // (bukan nama metrik tetap), karena sekarang bisa ada >1 aturan pada
    // field yang sama dengan threshold berbeda.
    fingerprint: ctx.email + '|' + ctx.campaignId + '|' + rule.id
  };
}

// ============================================================
// COOLDOWN
// ============================================================

function loadAlertState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(URGENT.STATE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function saveAlertState_(state) {
  PropertiesService.getScriptProperties()
    .setProperty(URGENT.STATE_KEY, JSON.stringify(state));
}

function inCooldown_(state, fingerprint, today) {
  var last = state[fingerprint];
  if (!last) return false;
  return daysBetween_(last, today) < URGENT.COOLDOWN_DAYS;
}

/** Buang catatan yang sudah lewat masa cooldown agar tidak menumpuk. */
function pruneState_(state, today) {
  var out = {};
  Object.keys(state).forEach(function (k) {
    if (daysBetween_(state[k], today) <= URGENT.COOLDOWN_DAYS * 3) {
      out[k] = state[k];
    }
  });
  return out;
}

function daysBetween_(a, b) {
  var da = new Date(a + 'T00:00:00');
  var db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}

/** Kosongkan cooldown — berguna saat menguji coba. Global untuk semua langganan. */
function resetUrgentCooldown() {
  PropertiesService.getScriptProperties().deleteProperty(URGENT.STATE_KEY);
  Logger.log('Cooldown direset. Semua temuan akan dikirim lagi pada run berikutnya.');
}

// ============================================================
// EMAIL — satu email per LANGGANAN (email) yang punya temuan/gagal
// ============================================================

function sendUrgentEmailFor_(email, findings, failures, yStr) {
  if (!findings.length && !failures.length) return;

  var tz = tz_();
  var yLabel = Utilities.formatDate(new Date(yStr + 'T00:00:00'), tz, 'd MMM yyyy');

  var subject = '[URGENT] ' + yLabel + ' — ';
  if (findings.length) {
    subject += findings.length + ' temuan pada ' + countCampaigns_(findings) + ' campaign';
  } else {
    subject += failures.length + ' brand gagal ditarik';
  }

  MailApp.sendEmail({
    to: email,
    subject: subject,
    htmlBody: buildUrgentHtml_(findings, failures, yLabel)
  });
}

function countCampaigns_(findings) {
  var seen = {};
  findings.forEach(function (f) { seen[f.campaign] = true; });
  return Object.keys(seen).length;
}

function buildUrgentHtml_(findings, failures, yLabel) {
  var h = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1c1e21;max-width:720px">';

  h += '<h2 style="margin:0 0 2px">Pengecekan Harian — Temuan Mendesak</h2>';
  h += '<p style="margin:0 0 18px;color:#65676b">' + yLabel + ' dibandingkan rata-rata harian sebelumnya</p>';

  if (failures && failures.length) {
    h += '<div style="border-left:4px solid #8a8d91;background:#f5f6f7;padding:10px 14px;margin:12px 0">';
    h += '<div style="font-weight:bold;margin-bottom:6px">Brand gagal ditarik</div>';
    failures.forEach(function (f) {
      h += '<div style="font-size:13px;margin:3px 0">' + f.client +
           ' — <span style="color:#65676b">' + f.message + '</span></div>';
    });
    h += '</div>';
  }

  // kelompokkan per brand
  var byClient = {};
  findings.forEach(function (f) {
    if (!byClient[f.client]) byClient[f.client] = [];
    byClient[f.client].push(f);
  });

  Object.keys(byClient).forEach(function (client) {
    h += '<h3 style="margin:20px 0 6px;padding-bottom:4px;border-bottom:2px solid #e4e6eb">' +
         client + '</h3>';

    // urutkan: aturan 'zero' (berhenti total) dianggap paling mendesak
    byClient[client].sort(function (a, b) {
      var rank = function (f) { return f.ruleType === 'zero' ? 0 : 1; };
      return rank(a) - rank(b);
    });

    byClient[client].forEach(function (f) {
      var color = urgentColor_(f);
      h += '<div style="border-left:4px solid ' + color +
           ';background:#fbfbfb;padding:10px 14px;margin:10px 0">';
      h += '<div style="font-weight:bold;color:' + color + '">' + f.title + '</div>';
      h += '<div style="font-size:14px;margin:2px 0 6px">' + f.campaign +
           (f.proxy ? ' <span style="background:#fff3cd;color:#8a6d00;padding:1px 5px;' +
                      'border-radius:3px;font-size:10px">PROXY</span>' : '') + '</div>';
      h += '<div style="font-size:13px;color:#444">' + f.detail + '</div>';

      var rows = row_('Spend', rupiah_(f.spendNow), rupiah_(f.spendBase)) +
                 row_('Results', fmt_(f.resNow), fmt_(f.resBase));
      if (f.field !== 'spend' && f.field !== 'results') {
        rows += row_(FIELD_LABELS[f.field] || f.field, formatFieldValue_(f.field, f.valueNow), formatFieldValue_(f.field, f.valueBase));
      }

      h += '<table style="border-collapse:collapse;font-size:12px;margin-top:8px">' +
           '<tr style="color:#65676b">' +
           '<td style="padding:2px 14px 2px 0"></td>' +
           '<td style="padding:2px 14px 2px 0">Kemarin</td>' +
           '<td style="padding:2px 0">Rata-rata harian (' + f.baselineDays + ' hari)</td></tr>' +
           rows +
           '</table>';

      h += '</div>';
    });
  });

  h += '<p style="font-size:11px;color:#8a8d91;margin-top:22px;border-top:1px solid #e4e6eb;padding-top:8px">' +
       'Email ini hanya dikirim kalau ada temuan mendesak untuk langganan Anda. Laporan lengkap tetap ' +
       'datang setiap Senin untuk brand yang Anda langgan Weekly-nya. Temuan yang sama tidak dikirim ulang selama ' +
       URGENT.COOLDOWN_DAYS + ' hari — kalau masalahnya belum selesai, ia akan ' +
       'muncul lagi setelah itu.</p>';

  return h + '</div>';
}

function row_(label, now, base) {
  return '<tr>' +
    '<td style="padding:2px 14px 2px 0;color:#65676b">' + label + '</td>' +
    '<td style="padding:2px 14px 2px 0"><strong>' + now + '</strong></td>' +
    '<td style="padding:2px 0;color:#8a8d91">' + base + '</td></tr>';
}

function urgentColor_(f) {
  if (f.ruleType === 'zero' && f.field === 'spend') return '#8a8d91';
  if (f.ruleType === 'delta' && f.field === 'spend') return '#c47f00';
  return '#e41e3f';
}

// ============================================================
// SETUP & TESTING
// ============================================================

/**
 * Pasang trigger harian jam 09:00 WIB — satu jam setelah
 * laporan mingguan, supaya tidak berebut kuota eksekusi.
 */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyUrgentCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyUrgentCheck')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .inTimezone('Asia/Jakarta')
    .create();
  Logger.log('Trigger harian terpasang: setiap hari 09:00 WIB.');
}

/**
 * Uji coba: menjalankan dailyUrgentCheck() sungguhan (per langganan
 * Daily aktif). Cek Automation Log dan email masing-masing langganan
 * untuk hasilnya -- kalau mau lihat temuan MENTAH tanpa cooldown per
 * brand tertentu dulu, jalankan evaluateBrandDailyForSub_ manual dari
 * editor dengan acct/sub yang diinginkan.
 */
function testDailyUrgentCheck() {
  Logger.log('Menjalankan dailyUrgentCheck() sungguhan (per langganan Daily aktif)...');
  dailyUrgentCheck();
}
