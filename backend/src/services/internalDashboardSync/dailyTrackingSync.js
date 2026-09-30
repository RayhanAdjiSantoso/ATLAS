import { AppError } from '../../utils/errors.js';
import { FIXED_SALES_LABELS, FIXED_SPEND_LABELS } from '../../config/dailyTrackingChannels.js';
import * as repo from '../../repositories/internalDashboardRepository.js';
import { applyFactPlan, logFailedRun } from './applyFactPlan.js';

// =====================================================================
// ATLAS Daily Tracking -> Internal Dashboard monthly fact tables.
//
// Source of truth (user decision 2026-09-30): the Daily Tracking page's own
// tables (migration 024), not the client Google Sheets.
//
//   field                                  source
//   -------------------------------------  --------------------------------
//   revenue / transaksi / qty_sold          sum of daily_channel_sales
//   sales per channel                       daily_channel_sales
//   amount_spent per ad platform            daily_channel_spend (manual +
//                                           Meta API auto-filled values);
//                                           Meta Ads insights only for a Meta
//                                           platform Daily Tracking lacks
//   Meta funnel (impressions, link clicks,  meta_ads_insights_daily (Pengaturan
//   purchases, value, profile visits, VC,   Brand > Meta Ads Auto Fetch). MAIN
//   ATC, LPV)                               accounts split Boost / Non-boost by
//                                           the account's "Kata Kunci Boost
//                                           Post" (brand_ad_accounts mirror of
//                                           Meta Ads Automation) — same rule as
//                                           the Apps Script: lower-cased
//                                           campaign name contains the keyword.
//                                           CPAS accounts -> meta_cpas.
//
// Kept current automatically: every Daily Tracking write and every Meta
// Ads insights fetch calls refreshInternalDashboard() (no sync button).
// Daily Tracking stores only cells someone saved: a channel with no rows
// (or only NULL cells) in a month is "not entered", never 0; a saved 0 is
// a real 0. Returns may make single days negative — only a negative
// MONTH total is refused (the fact tables hold non-negative amounts).
// =====================================================================

const SOURCE = 'atlas_daily_tracking';
const SOURCE_REF = 'atlas:daily_tracking';
// Rows from the retired Google Sheets sync are replaced/removed when the
// same month is rolled up from Daily Tracking.
const RETIRED_SOURCES = ['google_sheets'];

// Daily Tracking channel_key -> sales_channel enum. Keys not listed land in
// client_channel_sales_other under the channel's own label — including
// chat, which is deliberately not an enum value.
const SALES_KEY_MAP = {
  website: 'website',
  shopee: 'shopee',
  tiktok: 'tiktok_shop',
  tokopedia: 'tokopedia',
  offline_store: 'offline',
  blibli: 'blibli',
  lazada: 'lazada',
};
// chat keeps the lowercase label earlier data already uses ("chat"), so it
// stays one channel in S6 rather than splitting into "chat" + "Chat".
const OTHER_LABEL_OVERRIDE = { chat: 'chat' };

// Daily Tracking spend channel_key -> ad_platform enum. Custom spend
// channels ("+ Tambah Channel Baru") with no enum value are reported with
// their amount, never stored under a guessed platform.
const SPEND_KEY_MAP = {
  meta_boost_post: 'meta_boost',
  meta_nonboost_post: 'meta_nonboost',
  cpas_shopee: 'meta_cpas',
  cpas_tokopedia: 'cpas_tokopedia',
  shopee_iklanku: 'iklanku_shopee',
  gmv_max: 'gmv_max_tiktok',
  ttam: 'ttam_tiktok',
  google_ads: 'google_ads',
};

const n = (v) => (v === null || v === undefined ? null : Number(v));

// Funnel columns rolled up from Meta Ads insights (all additive).
const META_FUNNEL = ['impressions', 'link_clicks', 'purchase', 'purchase_value', 'ig_profile_visit', 'view_content', 'atc', 'lpv'];
// Daily Tracking Meta spend vs Meta API spend for the same platform-month.
const META_SPEND_TOLERANCE = 0.02;

// Meta insights rows -> { 'YYYY-MM': { platform: {spend, …funnel} } }.
// A MAIN account without a Boost keyword cannot be split — its rows are
// reported, not guessed into one bucket.
function metaFunnelByMonth(metaRows, accounts, warnings) {
  const keywordOf = new Map(accounts.filter((a) => a.account_type === 'MAIN').map((a) => [a.ad_account_id, a.boost_keyword]));
  const out = {};
  const missing = new Map();
  for (const r of metaRows) {
    let platform;
    if (r.account_type === 'CPAS') platform = 'meta_cpas';
    else {
      const kw = keywordOf.get(r.ad_account_id);
      if (!kw) {
        const k = `${r.period}|${r.ad_account_id}`;
        missing.set(k, (missing.get(k) ?? 0) + (n(r.spend) ?? 0));
        continue;
      }
      platform = String(r.campaign_name ?? '').toLowerCase().includes(kw) ? 'meta_boost' : 'meta_nonboost';
    }
    const bucket = ((out[r.period] ??= {})[platform] ??= { spend: null });
    const add = (key, v) => { if (v !== null) bucket[key] = (bucket[key] ?? 0) + v; };
    add('spend', n(r.spend));
    for (const key of META_FUNNEL) { if (!(key in bucket)) bucket[key] = null; add(key, n(r[key])); }
  }
  for (const [k, spend] of missing) {
    const [period, account] = k.split('|');
    warnings.push({ code: 'boost_keyword_missing', severity: 'warning', period, message: `Funnel Meta ${period} akun ${account} (spend ${spend}) tidak dipakai: akun belum terdaftar/tertaut di Meta Ads Automation atau Kata Kunci Boost Post kosong.` });
  }
  return out;
}

/**
 * Pure. Builds the monthly write plan from the per-month aggregates.
 * @param {object} o
 * @param {Array} o.salesRows    repo.dailySalesMonthly()
 * @param {Array} o.spendRows    repo.dailySpendMonthly()
 * @param {Array} o.labels       repo.dailyTrackingChannelLabels()
 * @param {string[]} [o.revisitPeriods] months this source wrote before (stale check)
 */
export function buildDailyTrackingPlan({ salesRows, spendRows, labels, metaRows = [], accounts = [], revisitPeriods = [] }) {
  const warnings = [];
  const metaByMonth = metaFunnelByMonth(metaRows, accounts, warnings);
  const labelOf = (kind, key) => labels.find((l) => l.kind === kind && l.channel_key === key)?.label
    ?? (kind === 'sales' ? FIXED_SALES_LABELS[key] : FIXED_SPEND_LABELS[key]) ?? key;

  const periods = [...new Set([...salesRows.map((r) => r.period), ...spendRows.map((r) => r.period), ...Object.keys(metaByMonth), ...revisitPeriods])].sort();
  const months = [];

  for (const period of periods) {
    const sales = salesRows.filter((r) => r.period === period && r.n_revenue > 0);
    const allSales = salesRows.filter((r) => r.period === period);
    const spend = spendRows.filter((r) => r.period === period && r.n_amount > 0);

    // --- channels ------------------------------------------------------
    const channels = [];
    const otherChannels = [];
    for (const r of sales) {
      const revenue = n(r.revenue);
      const label = labelOf('sales', r.channel_key);
      if (revenue < 0) {
        warnings.push({ code: 'negative_channel_sales', severity: 'warning', period, message: `Sales "${label}" ${period} total negatif (${revenue}) — tidak ditulis ke channel sales.` });
        continue;
      }
      if (SALES_KEY_MAP[r.channel_key]) channels.push({ channel: SALES_KEY_MAP[r.channel_key], sales: revenue });
      else otherChannels.push({ channelLabel: OTHER_LABEL_OVERRIDE[r.channel_key] ?? label, sales: revenue });
    }
    // Two Daily Tracking channels mapping onto one enum value (e.g. a custom
    // "Blibli" next to a future fixed one) would silently collide on the
    // unique key — sum them, and say so.
    const merged = new Map();
    for (const c of channels) merged.set(c.channel, (merged.get(c.channel) ?? 0) + c.sales);
    if (merged.size !== channels.length) warnings.push({ code: 'channels_merged', severity: 'warning', period, message: `${period}: beberapa channel Daily Tracking masuk ke channel yang sama dan dijumlahkan.` });
    const channelsMerged = [...merged].map(([channel, s]) => ({ channel, sales: s }));

    // --- monthly metric ------------------------------------------------
    let metric = null;
    if (sales.length) {
      const revenue = sales.reduce((s, r) => s + n(r.revenue), 0);
      if (revenue < 0) {
        warnings.push({ code: 'negative_revenue', severity: 'warning', period, message: `Revenue ${period} total negatif (${revenue}) — metrik bulanan tidak ditulis.` });
      } else {
        // qty / transaksi only when every day that sold something reported
        // them — otherwise the month total would silently under-count.
        const total = (key, missingKey, nKey, word) => {
          if (!allSales.some((r) => r[nKey] > 0)) return null;
          const incomplete = allSales.filter((r) => r[missingKey] > 0);
          if (incomplete.length) {
            warnings.push({ code: `incomplete_${key}`, severity: 'warning', period, message: `Total ${word} ${period} dikosongkan: ${incomplete.map((r) => `${labelOf('sales', r.channel_key)} (${r[missingKey]} hari)`).join(', ')} punya revenue tanpa ${word}.` });
            return null;
          }
          return allSales.reduce((s, r) => s + (n(r[key]) ?? 0), 0);
        };
        metric = {
          revenue,
          qtySold: total('qty', 'sold_without_qty', 'n_qty', 'kuantitas'),
          transaksi: total('trx', 'sold_without_trx', 'n_trx', 'transaksi'),
        };
      }
    }

    // --- platform spend ------------------------------------------------
    const platformTotals = new Map();
    for (const r of spend) {
      const amount = n(r.amount);
      const platform = SPEND_KEY_MAP[r.channel_key];
      if (!platform) {
        if (amount !== 0) warnings.push({ code: 'unsupported_platform', severity: 'warning', period, message: `Spend "${labelOf('spend', r.channel_key)}" ${period} = ${amount} tidak disimpan: belum ada nilai ad_platform untuk channel ini.`, amount });
        continue;
      }
      if (amount < 0) {
        warnings.push({ code: 'negative_spend', severity: 'warning', period, message: `Spend ${platform} ${period} negatif (${amount}) — tidak ditulis.` });
        continue;
      }
      platformTotals.set(platform, (platformTotals.get(platform) ?? 0) + amount);
    }
    // Meta funnel joins the platform rows; a Meta platform with insights but
    // no Daily Tracking spend takes its spend from the insights.
    const meta = metaByMonth[period] ?? {};
    for (const [platform, m] of Object.entries(meta)) {
      if (!platformTotals.has(platform)) {
        if (m.spend === null) continue;
        platformTotals.set(platform, m.spend);
        warnings.push({ code: 'spend_from_meta_insights', severity: 'info', period, message: `Spend ${platform} ${period} diambil dari Meta Ads insights (${m.spend}) — tidak ada di Daily Tracking.` });
      } else if (m.spend !== null) {
        const daily = platformTotals.get(platform);
        const diff = daily ? Math.abs(daily - m.spend) / daily : null;
        if (diff !== null && diff > META_SPEND_TOLERANCE) {
          warnings.push({ code: 'meta_spend_mismatch', severity: 'warning', period, message: `Spend ${platform} ${period}: Daily Tracking ${daily} vs Meta Ads insights ${m.spend} (selisih ${(diff * 100).toFixed(1)}%). Yang disimpan: Daily Tracking.` });
        }
      }
    }
    const platforms = [...platformTotals].map(([platform, amount]) => {
      const funnel = meta[platform] ? Object.fromEntries(META_FUNNEL.map((k) => [k, meta[platform][k] ?? null])) : {};
      return { platform, metrics: { amount_spent: amount, ...funnel } };
    });

    if (!metric && platforms.some((p) => p.metrics.amount_spent > 0)) {
      warnings.push({ code: 'spend_without_revenue', severity: 'warning', period, message: `${period}: spend sudah diisi di Daily Tracking tapi sales belum — revenue dibiarkan kosong (bukan 0).` });
    }

    months.push({
      period,
      metric,
      writeChannels: true,
      channels: channelsMerged,
      otherChannels,
      platforms,
      days: Math.max(0, ...allSales.map((r) => r.days)),
    });
  }

  return {
    months,
    warnings,
    rowsRead: salesRows.reduce((s, r) => s + r.days, 0),
    rowsSkipped: 0,
  };
}

/**
 * Rolls one brand's Daily Tracking data up into the fact tables.
 * `opts.dryRun` computes and applies inside a transaction, then rolls back.
 */
export async function syncBrandFromDailyTracking(brandId, userId, opts = {}) {
  const { dryRun = false, now = Date.now() } = opts;
  let plan;
  try {
    const [salesRows, spendRows, labels, metaRows, accounts, revisitPeriods] = await Promise.all([
      repo.dailySalesMonthly(brandId),
      repo.dailySpendMonthly(brandId),
      repo.dailyTrackingChannelLabels(brandId),
      repo.metaInsightsMonthly(brandId),
      repo.listBrandAdAccounts(brandId),
      repo.factPeriodsBySource(brandId, [SOURCE]),
    ]);
    if (!salesRows.length && !spendRows.length && !metaRows.length && !revisitPeriods.length) {
      throw new AppError('Brand ini belum punya data di halaman Daily Tracking', 404);
    }
    plan = buildDailyTrackingPlan({ salesRows, spendRows, labels, metaRows, accounts, revisitPeriods });
  } catch (err) {
    if (!dryRun && err.statusCode !== 404) {
      await logFailedRun({ brandId, userId, source: SOURCE, runTarget: 'daily_tracking_sync_run', method: 'daily tracking sync', error: err.message });
    }
    throw err;
  }

  return applyFactPlan({
    brandId, userId, plan, source: SOURCE, sourceRef: SOURCE_REF, retiredSources: RETIRED_SOURCES,
    spendMode: 'full', runTarget: 'daily_tracking_sync_run', method: 'daily tracking sync',
    note: 'ATLAS Daily Tracking', dryRun, now,
  });
}

// Called after every write to the brand's Daily Tracking / Meta insights
// data, so the Internal Dashboard never needs a sync button. Awaited (the
// API runs serverless — work after the response may never happen), but it
// never fails the caller's write: an error is logged by the run itself
// (S8 shows "sync gagal") and swallowed here.
export async function refreshInternalDashboard(brandId) {
  try {
    return await syncBrandFromDailyTracking(brandId, null);
  } catch (err) {
    if (err.statusCode !== 404) console.error(`[internal-dashboard] roll-up brand ${brandId} gagal:`, err.message);
    return null;
  }
}

// Every brand with Daily Tracking data (or only `opts.brandIds`), one after
// another. A brand that fails is reported and skipped; the others still sync.
export async function syncAllFromDailyTracking(userId, opts = {}) {
  const all = await repo.dailyTrackingBrands();
  const brands = opts.brandIds ? all.filter((b) => opts.brandIds.includes(b.brand_id)) : all;
  const results = [];
  for (const b of brands) {
    try {
      results.push({ brandId: b.brand_id, brandName: b.brand_name, ok: true, result: await syncBrandFromDailyTracking(b.brand_id, userId, opts) });
    } catch (err) {
      results.push({ brandId: b.brand_id, brandName: b.brand_name, ok: false, error: err.message });
    }
  }
  return {
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
