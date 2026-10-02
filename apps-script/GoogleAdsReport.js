/**
 * ============================================================
 * GOOGLE ADS -> ATLAS (Report Generator › Google Ads)
 * ============================================================
 * Ini Google Ads SCRIPT (Tools > Bulk actions > Scripts di Google Ads),
 * BUKAN Apps Script. Dipasang sekali di Manager Account (MCC) MIL; tidak
 * perlu developer token Google Ads API.
 *
 * Setiap jalan, script ini:
 *   1. Bertanya ke ATLAS akun & rentang tanggal mana yang perlu ditarik
 *      (GET /google-ads/ingest/jobs). Akun didaftarkan di ATLAS:
 *      Pengaturan Brand > Google Ads (Customer ID). Logika "bulan mana
 *      yang kurang" ada di ATLAS (googleAdsService.planJobs), bukan di sini.
 *   2. Untuk tiap job (satu akun x satu bulan) menarik 5 laporan harian:
 *      campaign, ad group, keyword, search term, kota — lalu mengirimnya:
 *        POST /google-ads/ingest/start   -> runId
 *        POST /google-ads/ingest/rows    -> berulang, per 500 baris
 *        POST /google-ads/ingest/finish  -> sukses/gagal
 *      Kalau run mati di tengah, data lama bulan itu TIDAK tersentuh.
 *
 * Script ini sementara. Nanti diganti fetcher Google Ads API di ATLAS yang
 * memakai endpoint & tabel yang sama — jadi jangan taruh logika bisnis di sini.
 *
 * SETUP (sekali)
 *   1. Isi ATLAS_API_BASE_URL dan INGEST_KEY di bawah. INGEST_KEY = nilai
 *      env DAILY_TRACKING_INGEST_API_KEY di ATLAS (sama dengan Script
 *      Property ATLAS_INGEST_KEY milik Apps Script Daily Tracking).
 *   2. Google Ads (MCC) > Tools > Bulk actions > Scripts > + > tempel file
 *      ini > Authorize > Preview sekali untuk cek log.
 *   3. Frequency: Daily (mis. jam 03:00). Akun baru otomatis ditarik
 *      mundur sampai tanggal "Tarik data sejak" di Pengaturan Brand,
 *      bertahap kalau satu kali jalan tidak cukup.
 *
 * Akun yang belum tertaut ke MCC ini akan muncul GAGAL di Pengaturan
 * Brand ("tidak ditemukan di MCC"). Alternatifnya, file yang sama bisa
 * dipasang langsung di akun klien itu: tanpa MCC, script hanya memproses
 * akun tempat ia dipasang.
 */

var CONFIG = {
  ATLAS_API_BASE_URL: 'https://GANTI-DOMAIN-ATLAS/api',
  INGEST_KEY: 'GANTI-DENGAN-INGEST-KEY',
  CHUNK_SIZE: 500,
  // executeInParallel memproses maksimal 50 akun per eksekusi.
  MAX_ACCOUNTS: 50,
  // Batas aman sebelum batas 30 menit Google Ads Scripts: job yang belum
  // sempat dimulai ditarik pada eksekusi berikutnya.
  TIME_BUDGET_MS: 25 * 60 * 1000,
};

var STARTED_AT = Date.now();

function main() {
  var res = atlas_('get', '/google-ads/ingest/jobs');
  var jobs = res.jobs || [];
  Logger.log('ATLAS meminta ' + jobs.length + ' job');
  if (!jobs.length) return;

  var byCustomer = {};
  jobs.forEach(function (job) {
    (byCustomer[job.customerId] = byCustomer[job.customerId] || []).push(job);
  });

  if (typeof AdsManagerApp === 'undefined') {
    // Dipasang langsung di satu akun klien.
    var own = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');
    if (!byCustomer[own]) { Logger.log('Akun ini (' + own + ') tidak punya job di ATLAS'); return; }
    Logger.log(processJobs_(byCustomer[own]));
    return;
  }

  var ids = Object.keys(byCustomer).slice(0, CONFIG.MAX_ACCOUNTS);
  var found = {};
  var it = AdsManagerApp.accounts().withIds(ids.map(dashed_)).get();
  while (it.hasNext()) found[it.next().getCustomerId().replace(/-/g, '')] = true;

  ids.forEach(function (id) {
    if (!found[id]) reportUnreachable_(byCustomer[id][0], 'Customer ID ' + dashed_(id) + ' tidak ditemukan di MCC ini — tautkan akunnya ke MCC MIL atau pasang script di akun itu sendiri');
  });

  var reachable = ids.filter(function (id) { return found[id]; });
  if (!reachable.length) return;
  var payload = {};
  reachable.forEach(function (id) { payload[id] = byCustomer[id]; });
  AdsManagerApp.accounts()
    .withIds(reachable.map(dashed_))
    .executeInParallel('processAccount', 'allDone', JSON.stringify(payload));
}

// Runs inside each client account (executeInParallel).
function processAccount(payloadJson) {
  var payload = JSON.parse(payloadJson);
  var id = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');
  return processJobs_(payload[id] || []);
}

function allDone(results) {
  results.forEach(function (r) {
    Logger.log(r.getCustomerId() + ': ' + r.getStatus() + ' ' + (r.getReturnValue() || r.getError() || ''));
  });
}

function processJobs_(jobs) {
  var account = AdsApp.currentAccount();
  var meta = { name: account.getName(), currencyCode: account.getCurrencyCode(), timeZone: account.getTimeZone() };
  var done = [];
  for (var i = 0; i < jobs.length; i++) {
    if (Date.now() - STARTED_AT > CONFIG.TIME_BUDGET_MS) {
      done.push('waktu habis, ' + (jobs.length - i) + ' job dilanjutkan eksekusi berikutnya');
      break;
    }
    done.push(runJob_(jobs[i], meta));
  }
  return done.join(' | ');
}

function runJob_(job, meta) {
  var start = atlas_('post', '/google-ads/ingest/start', {
    customerId: job.customerId, startDate: job.startDate, endDate: job.endDate, source: 'ads_script', account: meta,
  });
  var runId = start.runId;
  var sent = 0;
  try {
    var rows = []
      .concat(campaignRows_(job))
      .concat(adGroupRows_(job))
      .concat(keywordRows_(job))
      .concat(searchTermRows_(job))
      .concat(cityRows_(job));
    for (var i = 0; i < rows.length; i += CONFIG.CHUNK_SIZE) {
      atlas_('post', '/google-ads/ingest/rows', { runId: runId, rows: rows.slice(i, i + CONFIG.CHUNK_SIZE) });
    }
    sent = rows.length;
    atlas_('post', '/google-ads/ingest/finish', { runId: runId, status: 'success', rowCount: sent });
    return job.startDate + '..' + job.endDate + ' ok (' + sent + ' baris)';
  } catch (e) {
    atlas_('post', '/google-ads/ingest/finish', { runId: runId, status: 'failed', rowCount: sent, note: String(e.message || e).slice(0, 480) });
    return job.startDate + '..' + job.endDate + ' GAGAL: ' + e;
  }
}

function reportUnreachable_(job, note) {
  try {
    var start = atlas_('post', '/google-ads/ingest/start', {
      customerId: job.customerId, startDate: job.startDate, endDate: job.endDate, source: 'ads_script',
    });
    atlas_('post', '/google-ads/ingest/finish', { runId: start.runId, status: 'failed', rowCount: 0, note: note });
  } catch (e) {
    Logger.log('Gagal melapor ke ATLAS: ' + e);
  }
  Logger.log(note);
}

// ── Reports ─────────────────────────────────────────────────────────
var METRICS = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, ' +
  'metrics.conversions_value, metrics.all_conversions';

function during_(job) {
  return " WHERE segments.date BETWEEN '" + job.startDate + "' AND '" + job.endDate + "'";
}

function metrics_(m) {
  m = m || {};
  return {
    cost: Number(m.costMicros || 0) / 1e6,
    impressions: Number(m.impressions || 0),
    clicks: Number(m.clicks || 0),
    conversions: Number(m.conversions || 0),
    conversionsValue: Number(m.conversionsValue || 0),
    allConversions: Number(m.allConversions || 0),
  };
}

function base_(row, level) {
  var c = row.campaign || {};
  var g = row.adGroup || {};
  var out = metrics_(row.metrics);
  out.date = row.segments.date;
  out.level = level;
  out.campaignId = String(c.id || '');
  out.campaignName = c.name || '';
  out.channelType = c.advertisingChannelType || '';
  out.adGroupId = String(g.id || '');
  out.adGroupName = g.name || '';
  return out;
}

function search_(query) {
  var out = [];
  var it = AdsApp.search(query);
  while (it.hasNext()) out.push(it.next());
  return out;
}

// Google can return the same key more than once (a search term matched by
// several keywords, a city split by location type): sum them here so ATLAS
// gets one row per key.
function sumByKey_(rows) {
  var map = {};
  var keys = [];
  rows.forEach(function (r) {
    var k = [r.date, r.level, r.campaignId, r.adGroupId, r.item || '', r.matchType || ''].join('|');
    if (!map[k]) { map[k] = r; keys.push(k); return; }
    ['cost', 'impressions', 'clicks', 'conversions', 'conversionsValue', 'allConversions'].forEach(function (f) { map[k][f] += r[f]; });
  });
  return keys.map(function (k) { return map[k]; });
}

function campaignRows_(job) {
  return search_('SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    'campaign_budget.amount_micros, ' + METRICS + ' FROM campaign' + during_(job))
    .map(function (row) {
      var r = base_(row, 'campaign');
      var budget = row.campaignBudget && row.campaignBudget.amountMicros;
      r.budget = budget == null ? null : Number(budget) / 1e6;
      return r;
    });
}

function adGroupRows_(job) {
  return search_('SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    'ad_group.id, ad_group.name, ' + METRICS + ' FROM ad_group' + during_(job))
    .map(function (row) { return base_(row, 'ad_group'); });
}

function keywordRows_(job) {
  return sumByKey_(search_('SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    'ad_group.id, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ' +
    METRICS + ', metrics.absolute_top_impression_percentage, metrics.search_rank_lost_top_impression_share ' +
    'FROM keyword_view' + during_(job))
    .map(function (row) {
      var r = base_(row, 'keyword');
      var kw = (row.adGroupCriterion && row.adGroupCriterion.keyword) || {};
      r.item = kw.text || '';
      r.matchType = kw.matchType || '';
      var m = row.metrics || {};
      r.absTopImpressionPct = m.absoluteTopImpressionPercentage == null ? null : Number(m.absoluteTopImpressionPercentage);
      r.searchLostTopIsRank = m.searchRankLostTopImpressionShare == null ? null : Number(m.searchRankLostTopImpressionShare);
      return r;
    }));
}

function searchTermRows_(job) {
  return sumByKey_(search_('SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    'ad_group.id, ad_group.name, search_term_view.search_term, segments.search_term_match_type, ' +
    METRICS + ' FROM search_term_view' + during_(job))
    .map(function (row) {
      var r = base_(row, 'search_term');
      r.item = (row.searchTermView && row.searchTermView.searchTerm) || '';
      r.matchType = (row.segments && row.segments.searchTermMatchType) || '';
      return r;
    }));
}

// Where the users physically were, per city — Looker's "City" table.
function cityRows_(job) {
  var rows = search_('SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    'segments.geo_target_city, ' + METRICS + ' FROM user_location_view' + during_(job));
  var names = cityNames_(rows.map(function (row) { return row.segments.geoTargetCity; }));
  return sumByKey_(rows
    .filter(function (row) { return row.segments.geoTargetCity; })
    .map(function (row) {
      var r = base_(row, 'city');
      r.item = names[row.segments.geoTargetCity] || row.segments.geoTargetCity;
      return r;
    }));
}

// 'geoTargetConstants/1009899' -> 'Kuala Lumpur'. Unresolved ids fall back
// to the resource name, so a lookup failure loses the label, not the numbers.
function cityNames_(resourceNames) {
  var unique = {};
  resourceNames.forEach(function (n) { if (n) unique[n] = true; });
  var list = Object.keys(unique);
  var out = {};
  for (var i = 0; i < list.length; i += 200) {
    var batch = list.slice(i, i + 200).map(function (n) { return "'" + n + "'"; }).join(', ');
    try {
      search_('SELECT geo_target_constant.resource_name, geo_target_constant.name FROM geo_target_constant ' +
        'WHERE geo_target_constant.resource_name IN (' + batch + ')')
        .forEach(function (row) { out[row.geoTargetConstant.resourceName] = row.geoTargetConstant.name; });
    } catch (e) {
      Logger.log('Nama kota tidak bisa diambil: ' + e);
    }
  }
  return out;
}

// ── ATLAS ───────────────────────────────────────────────────────────
function atlas_(method, path, body) {
  var options = {
    method: method,
    contentType: 'application/json',
    headers: { 'X-Ingest-Key': CONFIG.INGEST_KEY },
    muteHttpExceptions: true,
  };
  if (body) options.payload = JSON.stringify(body);
  var res = UrlFetchApp.fetch(CONFIG.ATLAS_API_BASE_URL.replace(/\/$/, '') + path, options);
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code >= 300) throw new Error('ATLAS ' + path + ' ' + code + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

function dashed_(id) {
  return id.slice(0, 3) + '-' + id.slice(3, 6) + '-' + id.slice(6);
}
