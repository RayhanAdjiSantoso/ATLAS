/**
 * ============================================================
 * GOOGLE ADS -> ATLAS (Report Generator › Google Ads)
 * ============================================================
 * Ini Google Ads SCRIPT (Tools > Bulk actions > Scripts di Google Ads),
 * BUKAN Apps Script. Dipasang di SETIAP akun Google Ads klien (satu
 * salinan per akun); tidak perlu developer token Google Ads API.
 *
 * Setiap jalan, script ini:
 *   1. Bertanya ke ATLAS akun & rentang tanggal mana yang perlu ditarik
 *      (GET /google-ads/ingest/jobs). Akun didaftarkan di ATLAS:
 *      Pengaturan Brand > Google Ads (Customer ID). Logika "bulan mana
 *      yang kurang" ada di ATLAS (googleAdsService.planJobs), bukan di sini.
 *   2. Untuk tiap job (satu akun x satu bulan) menarik 5 laporan harian:
 *      campaign, ad group, keyword, search term, kota — plus change
 *      history (hanya 30 hari terakhir; Google tidak menyimpan lebih lama
 *      untuk script/API) — lalu mengirimnya:
 *        POST /google-ads/ingest/start   -> runId
 *        POST /google-ads/ingest/rows    -> berulang, per 500 baris
 *        POST /google-ads/ingest/changes -> change history, per 500 baris
 *        POST /google-ads/ingest/finish  -> sukses/gagal
 *      ATLAS lalu mengisi Pengaturan Brand > Data & file > Google Ads
 *      (Search terms & Change history) untuk bulan itu.
 *      Auction insights TIDAK bisa ditarik script (Google membatasinya ke
 *      developer yang di-allowlist) — unggah manual di Data & file.
 *      Kalau run mati di tengah, data lama bulan itu TIDAK tersentuh.
 *
 * Di akun klien, script hanya memproses akun tempat ia dipasang, walaupun
 * ATLAS mengembalikan job untuk semua akun terdaftar.
 *
 * Script ini sementara. Nanti diganti fetcher Google Ads API di ATLAS yang
 * memakai endpoint & tabel yang sama — jadi jangan taruh logika bisnis di sini.
 *
 * SETUP (per akun klien)
 *   1. Daftarkan Customer ID akun itu di ATLAS: Pengaturan Brand >
 *      Google Ads.
 *   2. Isi ATLAS_API_BASE_URL dan INGEST_KEY di bawah. INGEST_KEY = nilai
 *      env DAILY_TRACKING_INGEST_API_KEY di ATLAS (sama dengan Script
 *      Property ATLAS_INGEST_KEY milik Apps Script Daily Tracking).
 *   3. Buka akun klien itu di Google Ads > Tools > Bulk actions > Scripts
 *      > + > tempel file ini > Authorize > Preview sekali untuk cek log.
 *   4. Frequency: Daily (mis. jam 03:00). Akun baru otomatis ditarik
 *      mundur sampai tanggal "Tarik data sejak" di Pengaturan Brand,
 *      bertahap kalau satu kali jalan tidak cukup.
 *
 * Mode MCC (belum dipakai): file yang sama bisa dipasang di Manager
 * Account; script lalu memproses semua akun terdaftar yang tertaut ke MCC
 * itu dan melaporkan akun yang belum tertaut ("tidak ditemukan di MCC"),
 * kecuali akun itu sudah pernah tersinkron dari script di akunnya sendiri.
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
    if (found[id]) return;
    var note = 'Customer ID ' + dashed_(id) + ' tidak ditemukan di MCC ini — tautkan akunnya ke MCC MIL atau pasang script di akun itu sendiri';
    // Akun yang sudah pernah tersinkron diurus script yang dipasang di akun
    // itu sendiri; melapor gagal di sini hanya akan menimpa status suksesnya.
    if (byCustomer[id][0].hasSyncedBefore) Logger.log(note + ' (dilewati: sudah disinkron dari tempat lain)');
    else reportUnreachable_(byCustomer[id][0], note);
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
    // Change history is extra context: if Google refuses it, the report
    // rows above still count and the note says why history is missing.
    var note = null;
    var changes = [];
    try {
      changes = changeEventRows_(job);
      for (var j = 0; j < changes.length; j += CONFIG.CHUNK_SIZE) {
        atlas_('post', '/google-ads/ingest/changes', { runId: runId, rows: changes.slice(j, j + CONFIG.CHUNK_SIZE) });
      }
    } catch (ce) {
      note = 'Change history tidak terambil: ' + String(ce.message || ce).slice(0, 300);
    }
    atlas_('post', '/google-ads/ingest/finish', { runId: runId, status: 'success', rowCount: sent, note: note });
    return job.startDate + '..' + job.endDate + ' ok (' + sent + ' baris, ' + changes.length + ' perubahan)' + (note ? ' — ' + note : '');
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

// ── Change history ──────────────────────────────────────────────────
// change_event only answers for the last 30 days and at most 10,000 rows
// per query, so the job range is clipped to that window; a month that is
// already older returns nothing here and is filled by a manual upload.
function changeEventRows_(job) {
  var tz = AdsApp.currentAccount().getTimeZone();
  var earliest = Utilities.formatDate(new Date(Date.now() - 29 * 864e5), tz, 'yyyy-MM-dd');
  var from = job.startDate > earliest ? job.startDate : earliest;
  if (from > job.endDate) return [];
  var rows = search_('SELECT change_event.resource_name, change_event.change_date_time, ' +
    'change_event.change_resource_type, change_event.resource_change_operation, change_event.changed_fields, ' +
    'change_event.user_email, change_event.client_type, change_event.old_resource, change_event.new_resource, ' +
    'campaign.name, ad_group.name FROM change_event ' +
    "WHERE change_event.change_date_time >= '" + from + " 00:00:00' " +
    "AND change_event.change_date_time <= '" + job.endDate + " 23:59:59' " +
    'ORDER BY change_event.change_date_time DESC LIMIT 10000');
  return rows.map(function (row) {
    var e = row.changeEvent || {};
    return {
      key: e.resourceName,
      changedAt: String(e.changeDateTime || '').replace('T', ' '),
      userEmail: e.userEmail || '',
      clientType: e.clientType || '',
      resourceType: e.changeResourceType || '',
      operation: e.resourceChangeOperation || '',
      campaignName: (row.campaign && row.campaign.name) || '',
      adGroupName: (row.adGroup && row.adGroup.name) || '',
      changes: describeChange_(e),
    };
  });
}

// "status: PAUSED → ENABLED; cpc bid: 1.2 → 1.5" from the changed field
// paths and the before/after copies of the resource.
function describeChange_(e) {
  var fields = e.changedFields;
  var paths = typeof fields === 'string' ? fields.split(',') : (fields && fields.paths) || [];
  var parts = [];
  paths.slice(0, 8).forEach(function (path) {
    path = String(path).trim();
    if (!path) return;
    var before = valueAt_(e.oldResource, path);
    var after = valueAt_(e.newResource, path);
    var label = path.split('.').slice(-2).join(' ').replace(/_/g, ' ');
    if (before === undefined && after === undefined) parts.push(label);
    else if (before === undefined) parts.push(label + ': ' + show_(path, after));
    else parts.push(label + ': ' + show_(path, before) + ' → ' + show_(path, after));
  });
  if (paths.length > 8) parts.push('+' + (paths.length - 8) + ' field lain');
  return parts.join('; ');
}

// Paths come as snake_case, relative to the resource ("status") or with its
// name in front ("campaign.status"); the JSON is camelCase and wrapped in the
// resource's own key ({ campaign: {...} }). Try both.
function valueAt_(resource, path) {
  if (!resource) return undefined;
  var roots = [resource];
  for (var k in resource) if (resource[k] && typeof resource[k] === 'object') roots.push(resource[k]);
  var keys = path.split('.').map(function (p) { return p.replace(/_([a-z])/g, function (m, c) { return c.toUpperCase(); }); });
  for (var r = 0; r < roots.length; r++) {
    var v = roots[r];
    for (var i = 0; i < keys.length && v !== undefined && v !== null; i++) v = v[keys[i]];
    if (v !== undefined) return v;
  }
  return undefined;
}

function show_(path, v) {
  if (v === null || v === undefined) return '—';
  if (/micros$/i.test(path) && !isNaN(Number(v))) return String(Number(v) / 1e6);
  var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
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
