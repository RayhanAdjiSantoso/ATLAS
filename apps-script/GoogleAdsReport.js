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
 *   3. Dataset tambahan (migration 040) — dikirim lewat
 *      POST /google-ads/ingest/dataset, masing-masing berdiri sendiri: kalau
 *      satu gagal (mis. Google menolak field-nya), dataset lain dan 5 laporan
 *      utama tetap masuk, dan ATLAS menjadwalkan ulang hanya dataset itu.
 *        harian (per bulan, seperti 5 laporan utama):
 *          ads          performa per iklan
 *          conversions  konversi per conversion action per campaign
 *          competitive  impression share (campaign harian + campaign, ad group,
 *                       keyword untuk seluruh rentang job)
 *        snapshot (konfigurasi saat ini, sekali per akun per eksekusi):
 *          campaign_settings   budget, bidding, target, jaringan, lokasi, jadwal
 *          conversion_actions  metadata conversion action
 *          ad_assets           headline, description, final URL, ad strength
 *      Field yang tidak bisa dibaca dikirim sebagai null + dicatat di
 *      `unavailable`, tidak pernah ditebak.
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
 *   4. Frequency: Daily, jam 01:00 (zona waktu akun). Setiap jalan,
 *      cost kemarin masuk ke Daily Tracking › Google Ads. Pada tanggal 1,
 *      jalan itu menutup bulan lalu: ATLAS mengisi Search Terms dan Change
 *      History bulan itu di Pengaturan Brand › Data & file (change history
 *      dikumpulkan dari jalan harian sepanjang bulan, karena Google hanya
 *      menyimpan 30 hari). Akun baru otomatis ditarik mundur sampai tanggal
 *      "Tarik data sejak" di Pengaturan Brand, bertahap kalau satu kali
 *      jalan tidak cukup.
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
  // Dataset per bulan yang bisa dikirim script ini. ATLAS hanya menjadwalkan
  // yang belum lengkap; hapus nama di sini untuk mematikan satu dataset.
  DATASETS: ['core', 'ads', 'conversions', 'competitive'],
  // executeInParallel memproses maksimal 50 akun per eksekusi.
  MAX_ACCOUNTS: 50,
  // Batas aman sebelum batas 30 menit Google Ads Scripts: job yang belum
  // sempat dimulai ditarik pada eksekusi berikutnya.
  TIME_BUDGET_MS: 25 * 60 * 1000,
};

var STARTED_AT = Date.now();

function main() {
  var res = atlas_('get', '/google-ads/ingest/jobs?datasets=' + CONFIG.DATASETS.join(','));
  var jobs = res.jobs || [];
  // Snapshot datasets that ATLAS accepts (an older ATLAS returns none).
  var snapshots = res.snapshots || [];
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
    Logger.log(processJobs_(byCustomer[own], snapshots));
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
  var payload = { snapshots: snapshots, jobs: {} };
  reachable.forEach(function (id) { payload.jobs[id] = byCustomer[id]; });
  AdsManagerApp.accounts()
    .withIds(reachable.map(dashed_))
    .executeInParallel('processAccount', 'allDone', JSON.stringify(payload));
}

// Runs inside each client account (executeInParallel).
function processAccount(payloadJson) {
  var payload = JSON.parse(payloadJson);
  var id = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');
  return processJobs_(payload.jobs[id] || [], payload.snapshots || []);
}

function allDone(results) {
  results.forEach(function (r) {
    Logger.log(r.getCustomerId() + ': ' + r.getStatus() + ' ' + (r.getReturnValue() || r.getError() || ''));
  });
}

function overBudget_() {
  return Date.now() - STARTED_AT > CONFIG.TIME_BUDGET_MS;
}

function processJobs_(jobs, snapshots) {
  var account = AdsApp.currentAccount();
  var meta = { name: account.getName(), currencyCode: account.getCurrencyCode(), timeZone: account.getTimeZone() };
  var done = [];
  for (var i = 0; i < jobs.length; i++) {
    if (overBudget_()) {
      done.push('waktu habis, ' + (jobs.length - i) + ' job dilanjutkan eksekusi berikutnya');
      break;
    }
    // Snapshots describe the account as it is now, not a month: once per
    // execution is enough, so they ride along with the first job.
    done.push(runJob_(jobs[i], meta, i === 0 ? snapshots : []));
  }
  return done.join(' | ');
}

// job.datasets is what ATLAS still needs for this month; an ATLAS from
// before migration 040 sends none, which means the five core reports only.
function runJob_(job, meta, snapshots) {
  var datasets = job.datasets || ['core'];
  var withCore = datasets.indexOf('core') >= 0;
  var extra = datasets.filter(function (d) { return d !== 'core' && DAILY_FETCHERS[d]; });
  var snaps = (snapshots || []).filter(function (d) { return SNAPSHOT_FETCHERS[d]; });
  var startBody = {
    customerId: job.customerId, startDate: job.startDate, endDate: job.endDate, source: 'ads_script', account: meta,
  };
  if (job.datasets) startBody.datasets = datasets.concat(snaps);
  var start = atlas_('post', '/google-ads/ingest/start', startBody);
  var runId = start.runId;
  var sent = 0;
  try {
    var note = null;
    var changes = [];
    var results = {};
    if (withCore) {
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
      try {
        changes = changeEventRows_(job);
        for (var j = 0; j < changes.length; j += CONFIG.CHUNK_SIZE) {
          atlas_('post', '/google-ads/ingest/changes', { runId: runId, rows: changes.slice(j, j + CONFIG.CHUNK_SIZE) });
        }
      } catch (ce) {
        note = 'Change history tidak terambil: ' + String(ce.message || ce).slice(0, 300);
      }
      results.core = { status: 'success', rowCount: sent };
    }
    extra.forEach(function (d) { results[d] = runDataset_(runId, d, DAILY_FETCHERS[d], job); });
    snaps.forEach(function (d) { results[d] = runDataset_(runId, d, SNAPSHOT_FETCHERS[d], job); });
    var finish = { runId: runId, status: 'success', rowCount: sent, note: note };
    if (job.datasets) finish.datasets = results;
    atlas_('post', '/google-ads/ingest/finish', finish);
    var summary = Object.keys(results).filter(function (d) { return d !== 'core'; }).map(function (d) {
      return d + ' ' + (results[d].status === 'success' ? results[d].rowCount : results[d].status);
    });
    var core = withCore ? sent + ' baris, ' + changes.length + ' perubahan' : 'laporan utama sudah lengkap';
    return job.startDate + '..' + job.endDate + ' ok (' + core
      + (summary.length ? '; ' + summary.join(', ') : '') + ')' + (note ? ' — ' + note : '');
  } catch (e) {
    atlas_('post', '/google-ads/ingest/finish', { runId: runId, status: 'failed', rowCount: sent, note: String(e.message || e).slice(0, 480) });
    return job.startDate + '..' + job.endDate + ' GAGAL: ' + e;
  }
}

// One extra dataset: fetch, send in chunks, report. A failure here only
// marks this dataset failed (ATLAS keeps its older rows and plans it
// again); it never fails the run or the other datasets.
function runDataset_(runId, name, fetcher, job) {
  if (overBudget_()) return { status: 'skipped', rowCount: 0, note: 'waktu eksekusi habis' };
  var sent = 0;
  try {
    var out = fetcher(job);
    for (var i = 0; i < out.rows.length; i += CONFIG.CHUNK_SIZE) {
      var chunk = out.rows.slice(i, i + CONFIG.CHUNK_SIZE);
      atlas_('post', '/google-ads/ingest/dataset', { runId: runId, dataset: name, rows: chunk });
      sent += chunk.length;
    }
    var result = { status: 'success', rowCount: out.rows.length };
    if (out.levels) result.levels = out.levels;
    if (out.note) result.note = out.note.slice(0, 280);
    return result;
  } catch (e) {
    Logger.log('Dataset ' + name + ' gagal: ' + e);
    return { status: 'failed', rowCount: sent, note: String(e.message || e).slice(0, 280) };
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
  var names = geoNames_(rows.map(function (row) { return row.segments.geoTargetCity; }));
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
function geoNames_(resourceNames) {
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
      Logger.log('Nama lokasi tidak bisa diambil: ' + e);
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

// ── Extra datasets (migration 040) ─────────────────────────────────
// Every fetcher returns { rows, levels?, note? }. Where Google may refuse a
// field (it differs per API version and account), the query is tried with
// fewer fields and the missing ones are listed in `unavailable` so ATLAS
// shows them as unknown — a refused field is never filled with a guess.

var DAILY_FETCHERS = {
  ads: adRows_,
  conversions: conversionRows_,
  competitive: competitiveRows_,
};

var SNAPSHOT_FETCHERS = {
  campaign_settings: campaignSettingRows_,
  conversion_actions: conversionActionRows_,
  ad_assets: adAssetRows_,
};

// The first query Google accepts, and which one it was.
function tryQueries_(queries) {
  var lastError = null;
  for (var i = 0; i < queries.length; i++) {
    try {
      return { rows: search_(queries[i]), index: i };
    } catch (e) {
      lastError = e;
      Logger.log('Query ditolak, coba versi lebih sederhana: ' + String(e.message || e).slice(0, 200));
    }
  }
  throw lastError;
}

var micros_ = function (v) { return v == null || v === '' ? null : Number(v) / 1e6; };
var numOrNull_ = function (v) { return v == null || v === '' ? null : Number(v); };
var idOf_ = function (resourceName) { return String(resourceName || '').split('/').pop(); };

function adRows_(job) {
  var rows = search_('SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    'ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status, ' + METRICS +
    ' FROM ad_group_ad' + during_(job) + ' AND metrics.impressions > 0');
  return {
    rows: rows.map(function (row) {
      var r = metrics_(row.metrics);
      var aga = row.adGroupAd || {};
      r.date = row.segments.date;
      r.campaignId = String(row.campaign.id);
      r.campaignName = row.campaign.name || '';
      r.channelType = row.campaign.advertisingChannelType || '';
      r.adGroupId = String(row.adGroup.id);
      r.adGroupName = row.adGroup.name || '';
      r.adId = String((aga.ad && aga.ad.id) || '');
      r.adType = (aga.ad && aga.ad.type) || '';
      r.adStatus = aga.status || '';
      return r;
    }),
  };
}

// Segmenting by conversion action only allows conversion metrics. Conversions
// counts the action only when it is primary; all conversions counts it
// either way — ATLAS keeps both so primary and secondary stay apart.
function conversionRows_(job) {
  var rows = search_('SELECT segments.date, campaign.id, campaign.name, segments.conversion_action, ' +
    'segments.conversion_action_name, segments.conversion_action_category, metrics.conversions, ' +
    'metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value FROM campaign' + during_(job));
  return {
    rows: rows
      .filter(function (row) { return Number(row.metrics.allConversions || 0) || Number(row.metrics.conversions || 0); })
      .map(function (row) {
        var m = row.metrics || {};
        return {
          date: row.segments.date,
          campaignId: String(row.campaign.id),
          campaignName: row.campaign.name || '',
          conversionActionId: idOf_(row.segments.conversionAction),
          conversionActionName: row.segments.conversionActionName || '',
          conversionCategory: row.segments.conversionActionCategory || '',
          conversions: Number(m.conversions || 0),
          conversionsValue: Number(m.conversionsValue || 0),
          allConversions: Number(m.allConversions || 0),
          allConversionsValue: Number(m.allConversionsValue || 0),
        };
      }),
  };
}

// metrics field (GAQL) -> key ATLAS expects. Budget-lost shares exist at
// campaign level only.
var SHARE_METRICS = [
  ['search_impression_share', 'searchImpressionShare', 'searchImpressionShare'],
  ['search_rank_lost_impression_share', 'searchRankLostImpressionShare', 'searchRankLostIs'],
  ['search_top_impression_share', 'searchTopImpressionShare', 'searchTopIs'],
  ['search_absolute_top_impression_share', 'searchAbsoluteTopImpressionShare', 'searchAbsTopIs'],
  ['search_rank_lost_top_impression_share', 'searchRankLostTopImpressionShare', 'searchRankLostTopIs'],
  ['search_rank_lost_absolute_top_impression_share', 'searchRankLostAbsoluteTopImpressionShare', 'searchRankLostAbsTopIs'],
];
var BUDGET_SHARE_METRICS = [
  ['search_budget_lost_impression_share', 'searchBudgetLostImpressionShare', 'searchBudgetLostIs'],
  ['search_budget_lost_top_impression_share', 'searchBudgetLostTopImpressionShare', 'searchBudgetLostTopIs'],
  ['search_budget_lost_absolute_top_impression_share', 'searchBudgetLostAbsoluteTopImpressionShare', 'searchBudgetLostAbsTopIs'],
];
var MINIMAL_SHARES = ['search_impression_share', 'search_rank_lost_impression_share', 'search_budget_lost_impression_share'];

function shareSelect_(specs, minimal) {
  return specs
    .filter(function (s) { return !minimal || MINIMAL_SHARES.indexOf(s[0]) >= 0; })
    .map(function (s) { return 'metrics.' + s[0]; }).join(', ');
}

function shareValues_(m, specs, out) {
  m = m || {};
  specs.forEach(function (s) { out[s[2]] = numOrNull_(m[s[1]]); });
  return out;
}

// Impression share is a ratio over an eligible-impression count Google does
// not return, so days cannot be added up into a month. Google's figure for
// the job's whole range is fetched as such ('range'); campaigns also get
// daily values ('day') for trends and for periods ATLAS has no range for.
function competitiveRows_(job) {
  var range = " WHERE segments.date BETWEEN '" + job.startDate + "' AND '" + job.endDate + "'";
  var rows = [];
  var levels = [];
  var notes = [];
  var campaignSpecs = SHARE_METRICS.concat(BUDGET_SHARE_METRICS);
  var level = function (name, build) {
    try {
      var got = build();
      rows = rows.concat(got.rows);
      if (got.complete) levels.push(name);
      if (got.note) notes.push(got.note);
    } catch (e) {
      notes.push(name + ': ' + String(e.message || e).slice(0, 120));
    }
  };

  level('campaign', function () {
    var base = 'campaign.id, campaign.name, metrics.impressions';
    var where = " AND campaign.advertising_channel_type IN ('SEARCH', 'SHOPPING')";
    var q = function (minimal, daily) {
      return 'SELECT ' + (daily ? 'segments.date, ' : '') + base + ', ' + shareSelect_(campaignSpecs, minimal) + ' FROM campaign' + range + where;
    };
    var shape = function (row, granularity) {
      var r = {
        level: 'campaign', granularity: granularity, campaignId: String(row.campaign.id), campaignName: row.campaign.name || '',
        impressions: numOrNull_(row.metrics.impressions),
      };
      if (granularity === 'day') r.date = row.segments.date;
      else { r.startDate = job.startDate; r.endDate = job.endDate; }
      return shareValues_(row.metrics, campaignSpecs, r);
    };
    var whole = tryQueries_([q(false, false), q(true, false)]);
    var out = whole.rows.map(function (row) { return shape(row, 'range'); });
    var dailyOk = true;
    try {
      out = out.concat(tryQueries_([q(false, true), q(true, true)]).rows.map(function (row) { return shape(row, 'day'); }));
    } catch (e) {
      dailyOk = false;
    }
    // Without the daily rows, older daily rows of this range must survive:
    // the level is not reported complete, so ATLAS deletes nothing for it.
    return { rows: out, complete: dailyOk, note: dailyOk ? null : 'campaign harian tidak terambil' };
  });

  level('ad_group', function () {
    var q = function (minimal) {
      return 'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.impressions, ' +
        shareSelect_(SHARE_METRICS, minimal) + " FROM ad_group" + range + " AND campaign.advertising_channel_type = 'SEARCH'";
    };
    var got = tryQueries_([q(false), q(true)]);
    return {
      complete: true,
      rows: got.rows.map(function (row) {
        return shareValues_(row.metrics, SHARE_METRICS, {
          level: 'ad_group', granularity: 'range', startDate: job.startDate, endDate: job.endDate,
          campaignId: String(row.campaign.id), campaignName: row.campaign.name || '',
          adGroupId: String(row.adGroup.id), adGroupName: row.adGroup.name || '', impressions: numOrNull_(row.metrics.impressions),
        });
      }),
    };
  });

  level('keyword', function () {
    var q = function (minimal) {
      return 'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ' +
        'ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, metrics.impressions, ' +
        shareSelect_(SHARE_METRICS, minimal) + ' FROM keyword_view' + range + ' AND metrics.impressions > 0';
    };
    var got = tryQueries_([q(false), q(true)]);
    return {
      complete: true,
      rows: got.rows.map(function (row) {
        var crit = row.adGroupCriterion || {};
        var kw = crit.keyword || {};
        return shareValues_(row.metrics, SHARE_METRICS, {
          level: 'keyword', granularity: 'range', startDate: job.startDate, endDate: job.endDate,
          campaignId: String(row.campaign.id), campaignName: row.campaign.name || '',
          adGroupId: String(row.adGroup.id), adGroupName: row.adGroup.name || '',
          criterionId: String(crit.criterionId || ''), keyword: kw.text || '', matchType: kw.matchType || '',
          impressions: numOrNull_(row.metrics.impressions),
        });
      }),
    };
  });

  if (!rows.length && !levels.length) throw new Error('Impression share tidak terambil di level mana pun: ' + notes.join('; '));
  return { rows: rows, levels: levels, note: notes.length ? notes.join('; ') : null };
}

// ── Snapshots ───────────────────────────────────────────────────────
function campaignSettingRows_() {
  var byId = {};
  var order = [];
  search_('SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
    'campaign.advertising_channel_sub_type, campaign.bidding_strategy_type, campaign.bidding_strategy, ' +
    'campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, ' +
    'campaign_budget.delivery_method, campaign.network_settings.target_google_search, ' +
    'campaign.network_settings.target_search_network, campaign.network_settings.target_content_network, ' +
    'campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type ' +
    "FROM campaign WHERE campaign.status != 'REMOVED'").forEach(function (row) {
    var c = row.campaign;
    var b = row.campaignBudget || {};
    var ns = c.networkSettings || {};
    var geo = c.geoTargetTypeSetting || {};
    var id = String(c.id);
    order.push(id);
    byId[id] = {
      campaignId: id, campaignName: c.name || '', status: c.status || null,
      channelType: c.advertisingChannelType || null, channelSubType: c.advertisingChannelSubType || null,
      budgetId: b.id ? String(b.id) : null, budgetName: b.name || null, budgetAmount: micros_(b.amountMicros),
      budgetShared: b.explicitlyShared == null ? null : Boolean(b.explicitlyShared), budgetDeliveryMethod: b.deliveryMethod || null,
      biddingStrategyType: c.biddingStrategyType || null,
      biddingStrategySource: c.biddingStrategy ? 'PORTFOLIO' : 'CAMPAIGN',
      portfolio: c.biddingStrategy || null,
      networkGoogleSearch: ns.targetGoogleSearch == null ? null : Boolean(ns.targetGoogleSearch),
      networkSearchPartners: ns.targetSearchNetwork == null ? null : Boolean(ns.targetSearchNetwork),
      networkDisplay: ns.targetContentNetwork == null ? null : Boolean(ns.targetContentNetwork),
      positiveGeoTargetType: geo.positiveGeoTargetType || null,
      negativeGeoTargetType: geo.negativeGeoTargetType || null,
      targetCpa: null, targetRoas: null, targetImpressionShare: null, targetImpressionShareLocation: null, targetIsCpcCeiling: null,
      unavailable: [],
    };
  });
  var each = function (fn) { order.forEach(function (id) { fn(byId[id]); }); };
  var mark = function (field) { each(function (r) { r.unavailable.push(field); }); };

  // Targets of a campaign's own strategy. A field of a strategy the
  // campaign does not use comes back unset, which stays null.
  try {
    search_('SELECT campaign.id, campaign.target_cpa.target_cpa_micros, campaign.maximize_conversions.target_cpa_micros, ' +
      'campaign.target_roas.target_roas, campaign.maximize_conversion_value.target_roas, ' +
      'campaign.target_impression_share.location, campaign.target_impression_share.location_fraction_micros, ' +
      "campaign.target_impression_share.cpc_bid_ceiling_micros FROM campaign WHERE campaign.status != 'REMOVED'").forEach(function (row) {
      var r = byId[String(row.campaign.id)];
      if (!r) return;
      var c = row.campaign;
      r.targetCpa = micros_((c.targetCpa && c.targetCpa.targetCpaMicros) || (c.maximizeConversions && c.maximizeConversions.targetCpaMicros));
      r.targetRoas = numOrNull_((c.targetRoas && c.targetRoas.targetRoas) || (c.maximizeConversionValue && c.maximizeConversionValue.targetRoas));
      var tis = c.targetImpressionShare || {};
      r.targetImpressionShare = micros_(tis.locationFractionMicros);
      r.targetImpressionShareLocation = tis.location || null;
      r.targetIsCpcCeiling = micros_(tis.cpcBidCeilingMicros);
    });
  } catch (e) {
    mark('targets');
  }

  // Portfolio strategies keep their targets on the strategy: the account's
  // own first, then ones shared from a manager account.
  var portfolios = {};
  var portfolioQuery = function (resource) {
    var p = resource;
    return 'SELECT ' + p + '.id, ' + p + '.name, ' + p + '.type, ' + p + '.target_cpa.target_cpa_micros, ' +
      p + '.target_roas.target_roas, ' + p + '.maximize_conversions.target_cpa_micros, ' +
      p + '.maximize_conversion_value.target_roas, ' + p + '.target_impression_share.location_fraction_micros FROM ' + resource;
  };
  if (order.some(function (id) { return byId[id].portfolio; })) {
    [['bidding_strategy', 'biddingStrategy'], ['accessible_bidding_strategy', 'accessibleBiddingStrategy']].forEach(function (spec) {
      try {
        search_(portfolioQuery(spec[0])).forEach(function (row) {
          var s = row[spec[1]] || {};
          if (!portfolios[String(s.id)]) portfolios[String(s.id)] = s;
        });
      } catch (e) {
        Logger.log(spec[0] + ' tidak terbaca: ' + e);
      }
    });
    each(function (r) {
      if (!r.portfolio) return;
      var s = portfolios[idOf_(r.portfolio)];
      if (!s) { r.unavailable.push('portfolio_targets'); return; }
      r.biddingStrategyName = s.name || null;
      r.targetCpa = micros_((s.targetCpa && s.targetCpa.targetCpaMicros) || (s.maximizeConversions && s.maximizeConversions.targetCpaMicros));
      r.targetRoas = numOrNull_((s.targetRoas && s.targetRoas.targetRoas) || (s.maximizeConversionValue && s.maximizeConversionValue.targetRoas));
      r.targetImpressionShare = micros_(s.targetImpressionShare && s.targetImpressionShare.locationFractionMicros);
    });
  }

  // Newer API versions name the dates start_date_time / end_date_time.
  try {
    var dates = tryQueries_([
      "SELECT campaign.id, campaign.start_date_time, campaign.end_date_time FROM campaign WHERE campaign.status != 'REMOVED'",
      "SELECT campaign.id, campaign.start_date, campaign.end_date FROM campaign WHERE campaign.status != 'REMOVED'",
    ]);
    dates.rows.forEach(function (row) {
      var r = byId[String(row.campaign.id)];
      if (!r) return;
      r.startDate = String(row.campaign.startDateTime || row.campaign.startDate || '').slice(0, 10) || null;
      r.endDate = String(row.campaign.endDateTime || row.campaign.endDate || '').slice(0, 10) || null;
    });
  } catch (e) {
    mark('start_date');
    mark('end_date');
  }

  // What each campaign bids toward (account-default goals are copied into
  // campaign_conversion_goal by Google, so this covers both).
  try {
    each(function (r) { r.conversionGoals = []; });
    search_('SELECT campaign.id, campaign_conversion_goal.category, campaign_conversion_goal.origin, ' +
      'campaign_conversion_goal.biddable FROM campaign_conversion_goal').forEach(function (row) {
      var r = byId[String(row.campaign.id)];
      var g = row.campaignConversionGoal || {};
      if (r && g.biddable) r.conversionGoals.push({ category: g.category, origin: g.origin, biddable: true });
    });
  } catch (e) {
    each(function (r) { delete r.conversionGoals; });
    mark('conversion_goals');
  }

  // Location targets. An empty list means the campaign targets all locations.
  try {
    var crit = search_('SELECT campaign.id, campaign_criterion.negative, campaign_criterion.location.geo_target_constant ' +
      "FROM campaign_criterion WHERE campaign_criterion.type = 'LOCATION' AND campaign_criterion.status != 'REMOVED'");
    var names = geoNames_(crit.map(function (row) { return row.campaignCriterion.location && row.campaignCriterion.location.geoTargetConstant; }));
    each(function (r) { r.locationsIncluded = []; r.locationsExcluded = []; });
    crit.forEach(function (row) {
      var r = byId[String(row.campaign.id)];
      var cc = row.campaignCriterion || {};
      var geo = cc.location && cc.location.geoTargetConstant;
      if (!r || !geo) return;
      (cc.negative ? r.locationsExcluded : r.locationsIncluded).push(names[geo] || geo);
    });
    try {
      search_('SELECT campaign.id, campaign_criterion.negative, campaign_criterion.proximity.radius, ' +
        'campaign_criterion.proximity.radius_units, campaign_criterion.proximity.address.city_name FROM campaign_criterion ' +
        "WHERE campaign_criterion.type = 'PROXIMITY' AND campaign_criterion.status != 'REMOVED'").forEach(function (row) {
        var r = byId[String(row.campaign.id)];
        var p = (row.campaignCriterion && row.campaignCriterion.proximity) || {};
        if (!r) return;
        var label = 'Radius ' + (p.radius || '?') + ' ' + String(p.radiusUnits || '').toLowerCase() + (p.address && p.address.cityName ? ' · ' + p.address.cityName : '');
        (row.campaignCriterion.negative ? r.locationsExcluded : r.locationsIncluded).push(label);
      });
    } catch (pe) {
      Logger.log('Target radius tidak terbaca: ' + pe);
    }
  } catch (e) {
    each(function (r) { delete r.locationsIncluded; delete r.locationsExcluded; });
    mark('locations');
  }

  return { rows: order.map(function (id) { var r = byId[id]; delete r.portfolio; return r; }) };
}

function conversionActionRows_() {
  var full = ['id', 'name', 'category', 'status', 'type', 'origin', 'primary_for_goal', 'include_in_conversions_metric',
    'counting_type', 'attribution_model_settings.attribution_model', 'click_through_lookback_window_days',
    'view_through_lookback_window_days'];
  var minimal = ['id', 'name', 'category', 'status', 'type'];
  var q = function (fields) {
    return 'SELECT ' + fields.map(function (f) { return 'conversion_action.' + f; }).join(', ') + ' FROM conversion_action';
  };
  var got = tryQueries_([q(full), q(minimal)]);
  var missing = got.index === 0 ? [] : ['origin', 'primary_for_goal', 'include_in_conversions', 'counting_type', 'attribution_model', 'click_through_window_days', 'view_through_window_days'];
  return {
    rows: got.rows.map(function (row) {
      var a = row.conversionAction || {};
      var attr = a.attributionModelSettings || {};
      return {
        conversionActionId: String(a.id), name: a.name || '', category: a.category || null, status: a.status || null,
        type: a.type || null, origin: a.origin || null,
        primaryForGoal: a.primaryForGoal == null ? null : Boolean(a.primaryForGoal),
        includeInConversions: a.includeInConversionsMetric == null ? null : Boolean(a.includeInConversionsMetric),
        countingType: a.countingType || null, attributionModel: attr.attributionModel || null,
        clickThroughWindowDays: numOrNull_(a.clickThroughLookbackWindowDays),
        viewThroughWindowDays: numOrNull_(a.viewThroughLookbackWindowDays),
        unavailable: missing,
      };
    }),
  };
}

// Ad copy of the ads that are not removed. Google's per-asset performance
// label (Best/Good/Low) is a rating, not conversions per headline — ATLAS
// shows it as such and never attributes results to one headline.
function adAssetRows_() {
  var fields = 'campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.ad.type, ' +
    'ad_group_ad.status, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ' +
    'ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ' +
    'ad_group_ad.ad.responsive_search_ad.path2';
  var where = " FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' AND ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'";
  var got = tryQueries_(['SELECT ' + fields + ', ad_group_ad.ad_strength' + where, 'SELECT ' + fields + where]);
  var unavailable = got.index === 0 ? [] : ['ad_strength'];

  var labels = {};
  try {
    search_('SELECT ad_group_ad_asset_view.ad_group_ad, ad_group_ad_asset_view.field_type, ' +
      'ad_group_ad_asset_view.performance_label, asset.text_asset.text FROM ad_group_ad_asset_view ' +
      "WHERE ad_group_ad_asset_view.field_type IN ('HEADLINE', 'DESCRIPTION') AND ad_group_ad_asset_view.enabled = TRUE").forEach(function (row) {
      var v = row.adGroupAdAssetView || {};
      var t = row.asset && row.asset.textAsset && row.asset.textAsset.text;
      if (t) labels[idOf_(v.adGroupAd) + '|' + v.fieldType + '|' + t] = v.performanceLabel || null;
    });
  } catch (e) {
    unavailable.push('performance_label');
  }

  return {
    rows: got.rows.map(function (row) {
      var aga = row.adGroupAd || {};
      var ad = aga.ad || {};
      var rsa = ad.responsiveSearchAd || {};
      var key = String(row.adGroup.id) + '~' + String(ad.id);
      var asset = function (type) {
        return function (a) { return { text: a.text || '', pinned: a.pinnedField || null, label: labels[key + '|' + type + '|' + a.text] || null }; };
      };
      return {
        campaignId: String(row.campaign.id), campaignName: row.campaign.name || '',
        adGroupId: String(row.adGroup.id), adGroupName: row.adGroup.name || '',
        adId: String(ad.id), adType: ad.type || null, adStatus: aga.status || null, adStrength: aga.adStrength || null,
        finalUrls: ad.finalUrls || [],
        headlines: (rsa.headlines || []).map(asset('HEADLINE')),
        descriptions: (rsa.descriptions || []).map(asset('DESCRIPTION')),
        path1: rsa.path1 || null, path2: rsa.path2 || null,
        unavailable: unavailable,
      };
    }),
  };
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
