import pool from '../config/db.js';
import { RECONCILE, FRESHNESS, TRACKING_HEALTH, ACCOUNT_HEALTH, RULESET_VERSION } from './googleAdsRules.js';

// Data quality for the Google Ads datasets: reconciliation against the
// campaign totals, date coverage, freshness, conversion-tracking health and
// an account health summary. The report computes these for its period; a
// sync computes and stores them (google_ads_data_quality) for its range.
//
// Statuses: VALID, PARTIAL (dates missing), STALE (not refreshed),
// INCONSISTENT (beyond the critical tolerance), MISSING (no rows where
// the campaigns have spend), UNVERIFIED (between acceptable and critical,
// or nothing to compare against). Nothing is normalised to make numbers
// agree: a mismatch is reported as one, and lowers confidence downstream.

const STATUS_RANK = ['VALID', 'UNVERIFIED', 'PARTIAL', 'STALE', 'INCONSISTENT', 'MISSING'];
export const worstStatus = (list) => list.reduce((a, s) => (STATUS_RANK.indexOf(s) > STATUS_RANK.indexOf(a) ? s : a), 'VALID');

// Relative difference → status, with the configured tolerances.
export function reconcileStatus(expected, observed, tol = RECONCILE) {
  const e = Number(expected) || 0;
  const o = Number(observed) || 0;
  const abs = o - e;
  if (e === 0 && o === 0) return { status: 'VALID', abs_diff: 0, rel_diff: 0 };
  if (e === 0) return { status: 'UNVERIFIED', abs_diff: abs, rel_diff: null };
  const rel = Math.abs(abs) / Math.abs(e);
  const status = rel <= tol.acceptable ? 'VALID' : rel <= tol.critical ? 'UNVERIFIED' : 'INCONSISTENT';
  return { status, abs_diff: abs, rel_diff: rel, level: rel <= tol.exact ? 'exact' : rel <= tol.acceptable ? 'reporting_variance' : rel <= tol.critical ? 'warning' : 'critical' };
}

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

// ── reconciliation & coverage ───────────────────────────────────────
// Only scope-compatible comparisons: devices and hours split every
// campaign, so they must add up to the campaign total; ad groups and ads
// exist only for some campaign types (not Performance Max), so they are
// compared with the campaigns they cover; keywords, search terms and
// landing pages never cover all spend and are reported as coverage only.
export async function computeDataQuality(brandId, start, end, db = pool) {
  const { rows: [base] } = await db.query(
    `SELECT coalesce(sum(cost), 0)::float AS cost, coalesce(sum(conversions), 0)::float AS conversions,
            to_char(min(entry_date), 'YYYY-MM-DD') AS first_date, to_char(max(entry_date), 'YYYY-MM-DD') AS last_date,
            count(DISTINCT entry_date)::int AS days
     FROM google_ads_daily WHERE brand_id = $1 AND level = 'campaign' AND entry_date BETWEEN $2 AND $3`,
    [brandId, start, end],
  );
  const checks = [];
  if (!base.days) return { checks, datasets: {}, campaign: base };

  const sumCost = async (table, extraWhere = '') => (await db.query(
    `SELECT coalesce(sum(cost), 0)::float AS cost, count(*)::int AS n,
            to_char(min(entry_date), 'YYYY-MM-DD') AS first_date, to_char(max(entry_date), 'YYYY-MM-DD') AS last_date
     FROM ${table} WHERE brand_id = $1 AND entry_date BETWEEN $2 AND $3 ${extraWhere}`, [brandId, start, end])).rows[0];
  // Campaign cost of just the campaigns a dataset covers.
  const coveredCampaignCost = async (table, extraWhere = '') => (await db.query(
    `SELECT coalesce(sum(d.cost), 0)::float AS cost FROM google_ads_daily d
     WHERE d.brand_id = $1 AND d.level = 'campaign' AND d.entry_date BETWEEN $2 AND $3
       AND (d.customer_id, d.campaign_id) IN (SELECT DISTINCT customer_id, campaign_id FROM ${table} WHERE brand_id = $1 AND entry_date BETWEEN $2 AND $3 ${extraWhere})`,
    [brandId, start, end])).rows[0].cost;

  const reconcile = (key, dataset, expected, observed, note) => checks.push({ check_key: key, dataset, expected, observed, ...reconcileStatus(expected, observed), note });
  const coverage = (dataset, got) => {
    if (!got.n) {
      checks.push({ check_key: `coverage:${dataset}`, dataset, expected: base.days, observed: 0, abs_diff: -base.days, rel_diff: 1, status: 'MISSING', note: `Tidak ada data ${dataset} pada periode ini` });
      return false;
    }
    const partial = got.first_date > base.first_date || got.last_date < base.last_date;
    checks.push({
      check_key: `coverage:${dataset}`, dataset, expected: null, observed: null, abs_diff: null, rel_diff: null,
      status: partial ? 'PARTIAL' : 'VALID',
      note: partial ? `Data ${dataset} ${got.first_date}–${got.last_date}, campaign ${base.first_date}–${base.last_date}` : null,
    });
    return true;
  };

  for (const [dataset, table] of [['devices', 'google_ads_device_daily'], ['hourly', 'google_ads_hourly']]) {
    const got = await sumCost(table);
    if (coverage(dataset, got)) reconcile(`cost:${dataset}`, dataset, base.cost, got.cost, 'Total biaya harus sama dengan total campaign');
  }
  const adGroups = await sumCost('google_ads_daily', "AND level = 'ad_group'");
  if (adGroups.n) reconcile('cost:ad_groups', 'ad_groups', await coveredCampaignCost('google_ads_daily', "AND level = 'ad_group'"), adGroups.cost, 'Dibandingkan dengan campaign yang punya ad group');
  const ads = await sumCost('google_ads_ads_daily');
  if (coverage('ads', ads)) reconcile('cost:ads', 'ads', await coveredCampaignCost('google_ads_ads_daily'), ads.cost, 'Dibandingkan dengan campaign yang punya iklan (iklan tanpa impresi tidak ditarik)');

  // Conversions: per-action primary conversions must equal the campaign total.
  const { rows: [conv] } = await db.query(
    `SELECT coalesce(sum(conversions), 0)::float AS conversions, count(*)::int AS n
     FROM google_ads_conversion_daily WHERE brand_id = $1 AND entry_date BETWEEN $2 AND $3`, [brandId, start, end]);
  if (conv.n) reconcile('conversions:actions', 'conversions', base.conversions, conv.conversions, 'Konversi primer per action = kolom Conversions campaign');
  else if (base.conversions > 0) checks.push({ check_key: 'conversions:actions', dataset: 'conversions', expected: base.conversions, observed: null, abs_diff: null, rel_diff: null, status: 'MISSING', note: 'Konversi per action belum tersedia untuk periode ini' });

  for (const [dataset, table] of [['landing_pages', 'google_ads_landing_pages_daily']]) {
    const got = await sumCost(table);
    if (coverage(dataset, got)) {
      checks.push({ check_key: `share:${dataset}`, dataset, expected: base.cost, observed: got.cost, abs_diff: got.cost - base.cost, rel_diff: base.cost ? got.cost / base.cost : null, status: 'VALID', note: 'Cakupan saja — tidak semua jenis campaign punya laporan landing page' });
    }
  }
  const datasets = {};
  for (const c of checks) (datasets[c.dataset] ??= []).push(c.status);
  return {
    campaign: base,
    checks: checks.map((c) => ({ ...c, period_start: start, period_end: end })),
    datasets: Object.fromEntries(Object.entries(datasets).map(([k, v]) => [k, worstStatus(v)])),
  };
}

export async function storeDataQuality(brandId, customerId, runId, result, db = pool) {
  for (const c of result.checks) {
    await db.query(
      `INSERT INTO google_ads_data_quality (brand_id, customer_id, fetch_run_id, check_key, dataset, period_start, period_end, expected, observed, abs_diff, rel_diff, status, note, ruleset_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [brandId, customerId, runId, c.check_key, c.dataset, c.period_start, c.period_end, c.expected, c.observed, c.abs_diff, c.rel_diff, c.status, c.note ?? null, RULESET_VERSION],
    );
  }
}

export async function latestDataQuality(brandId, limit = 60, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (check_key) check_key, dataset, to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end,
            expected::float AS expected, observed::float AS observed, abs_diff::float AS abs_diff, rel_diff::float AS rel_diff, status, note, ruleset_version, checked_at
     FROM google_ads_data_quality WHERE brand_id = $1 ORDER BY check_key, checked_at DESC LIMIT $2`,
    [brandId, limit],
  );
  return rows;
}

// ── freshness ───────────────────────────────────────────────────────
const DAILY = ['campaign', 'ad_group', 'keyword', 'search_term', 'city'];

export async function freshness(brandId, today, cfg = FRESHNESS, db = pool) {
  const { rows: core } = await db.query(
    `SELECT level AS dataset, to_char(max(entry_date), 'YYYY-MM-DD') AS last_date, max(fetched_at) AS fetched_at
     FROM google_ads_daily WHERE brand_id = $1 GROUP BY level`, [brandId]);
  const q = async (sql) => (await db.query(sql, [brandId])).rows[0];
  const extra = {
    ads: await q(`SELECT to_char(max(entry_date), 'YYYY-MM-DD') AS last_date, max(fetched_at) AS fetched_at FROM google_ads_ads_daily WHERE brand_id = $1`),
    conversions: await q(`SELECT to_char(max(entry_date), 'YYYY-MM-DD') AS last_date, max(fetched_at) AS fetched_at FROM google_ads_conversion_daily WHERE brand_id = $1`),
    competitive: await q(`SELECT to_char(max(end_date), 'YYYY-MM-DD') AS last_date, max(fetched_at) AS fetched_at FROM google_ads_competitive_metrics WHERE brand_id = $1`),
    devices: await q(`SELECT to_char(max(entry_date), 'YYYY-MM-DD') AS last_date, max(fetched_at) AS fetched_at FROM google_ads_device_daily WHERE brand_id = $1`),
    hourly: await q(`SELECT to_char(max(entry_date), 'YYYY-MM-DD') AS last_date, max(fetched_at) AS fetched_at FROM google_ads_hourly WHERE brand_id = $1`),
    landing_pages: await q(`SELECT to_char(max(entry_date), 'YYYY-MM-DD') AS last_date, max(fetched_at) AS fetched_at FROM google_ads_landing_pages_daily WHERE brand_id = $1`),
    change_history: await q(`SELECT to_char(max(change_date), 'YYYY-MM-DD') AS last_date, max(fetched_at) AS fetched_at FROM google_ads_change_events WHERE brand_id = $1`),
    campaign_settings: await q(`SELECT NULL AS last_date, max(last_seen_at) AS fetched_at FROM google_ads_campaign_settings WHERE brand_id = $1`),
    conversion_actions: await q(`SELECT NULL AS last_date, max(last_seen_at) AS fetched_at FROM google_ads_conversion_actions WHERE brand_id = $1`),
    keyword_quality: await q(`SELECT to_char(max(snapshot_date), 'YYYY-MM-DD') AS last_date, max(fetched_at) AS fetched_at FROM google_ads_keyword_quality WHERE brand_id = $1`),
    ad_assets: await q(`SELECT NULL AS last_date, max(last_seen_at) AS fetched_at FROM google_ads_ad_assets WHERE brand_id = $1`),
    auction_insights: await q(`SELECT to_char(max(period_month), 'YYYY-MM-DD') AS last_date, max(uploaded_at) AS fetched_at
                               FROM ads_reports.brand_library_files WHERE brand_id = $1 AND platform = 'google' AND channel = 'auction_insights'`),
  };
  const lagLimit = new Date(`${today}T00:00:00Z`);
  lagLimit.setUTCDate(lagLimit.getUTCDate() - cfg.dailyLagDays);
  const lagIso = iso(lagLimit);
  const now = Date.now();
  const out = {};
  const put = (dataset, row, kind) => {
    if (!row || (!row.last_date && !row.fetched_at)) { out[dataset] = { dataset, kind, last_date: null, fetched_at: null, status: 'MISSING' }; return; }
    let stale = false;
    if (kind === 'daily') stale = Boolean(row.last_date && row.last_date < lagIso);
    else if (kind === 'snapshot') stale = Boolean(row.fetched_at && now - new Date(row.fetched_at).getTime() > cfg.snapshotHours * 36e5);
    else if (kind === 'manual') stale = Boolean(row.last_date && (now - new Date(`${row.last_date}T00:00:00Z`).getTime()) / 864e5 > cfg.auctionInsightsDays);
    out[dataset] = { dataset, kind, last_date: row.last_date ?? null, fetched_at: row.fetched_at ?? null, status: stale ? 'STALE' : 'VALID' };
  };
  for (const level of DAILY) put(level, core.find((r) => r.dataset === level), 'daily');
  for (const d of ['ads', 'conversions', 'competitive', 'devices', 'hourly', 'landing_pages']) put(d, extra[d], 'daily');
  put('change_history', extra.change_history, 'event');
  for (const d of ['campaign_settings', 'conversion_actions', 'keyword_quality', 'ad_assets']) put(d, extra[d], 'snapshot');
  put('auction_insights', extra.auction_insights, 'manual');
  return out;
}

// ── conversion tracking health ──────────────────────────────────────
const CONVERSION_BIDDING = new Set(['MAXIMIZE_CONVERSIONS', 'TARGET_CPA', 'MAXIMIZE_CONVERSION_VALUE', 'TARGET_ROAS']);

// 0–100 per campaign and for the account, each deduction with its reason.
// An internal indicator: "healthy" (≥ 70) only says no tracking rule fired.
// inputs: campaigns (period rows with conversions / all_conversions / cost),
// settings, actions (conversion action metadata), unverified (count of
// active actions still on the default goal), recent (Map key → conversions
// over the last 7 days of data), now (ms).
export function trackingHealth({ campaigns, settings = [], actions = [], unverified = 0, recent = new Map(), now = Date.now() }, w = TRACKING_HEALTH) {
  const settingOf = new Map(settings.map((s) => [`${s.customer_id}|${s.campaign_id}`, s]));
  const primary = actions.filter((a) => a.include_in_conversions);
  const allPrimaryInactive = primary.length > 0 && primary.every((a) => a.status && a.status !== 'ENABLED');
  const lastMeta = actions.reduce((m, a) => Math.max(m, a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0), 0);
  const staleMeta = actions.length > 0 && now - lastMeta > 48 * 36e5;
  const shared = [];
  if (allPrimaryInactive) shared.push({ points: w.primaryActionsInactive, reason: 'Semua conversion action primer tidak aktif (dihapus/disembunyikan)' });
  if (unverified > 0) shared.push({ points: w.unverifiedMapping, reason: `${unverified} conversion action aktif belum diklasifikasikan tujuannya` });
  if (staleMeta) shared.push({ points: w.staleConfiguration, reason: 'Metadata conversion action tidak diperbarui lebih dari 48 jam' });

  const byCampaign = new Map();
  let anyNoPrimary = false;
  for (const c of campaigns) {
    const key = `${c.customer_id}|${c.campaign_id}`;
    const s = settingOf.get(key);
    const deductions = [...shared];
    const conversionBidding = s ? CONVERSION_BIDDING.has(s.bidding_strategy_type) : false;
    if (c.cost > 0 && c.conversions === 0 && (conversionBidding || c.all_conversions > 0)) {
      deductions.push({ points: w.noPrimaryConversion, reason: conversionBidding ? `Memakai ${s.bidding_strategy_type} tanpa satu pun primary conversion` : 'Tidak ada primary conversion meski ada konversi sekunder' });
      if (conversionBidding) anyNoPrimary = true;
    }
    if (c.conversions > 0 && recent.has(key) && recent.get(key) === 0) deductions.push({ points: w.noRecentConversions, reason: 'Ada konversi di periode ini tetapi tidak ada dalam 7 hari terakhir' });
    const score = Math.max(0, 100 - deductions.reduce((a, d) => a + d.points, 0));
    byCampaign.set(key, { campaign_id: c.campaign_id, campaign_name: c.campaign_name, bidding: s?.bidding_strategy_type ?? null, score, healthy: score >= 70, deductions });
  }
  const accountDeductions = [...shared];
  if (anyNoPrimary) accountDeductions.push({ points: w.noPrimaryConversion, reason: 'Ada campaign Smart Bidding tanpa primary conversion' });
  const accountScore = Math.max(0, 100 - accountDeductions.reduce((a, d) => a + d.points, 0));
  return {
    account: { score: accountScore, healthy: accountScore >= 70, deductions: accountDeductions },
    campaigns: [...byCampaign.values()].sort((a, b) => a.score - b.score),
    map: new Map([...byCampaign].map(([k, v]) => [k, v]).concat([['account', { score: accountScore, healthy: accountScore >= 70 }]])),
  };
}

// ── account health ──────────────────────────────────────────────────
// A summary of the parts above, 0–100 with its breakdown. Never a decision
// on its own — the breakdown says where to look.
export function accountHealth({ tracking, freshnessMap, runs = [], unverified = 0, actions = 0, findings = [], alerts = [] }, w = ACCOUNT_HEALTH) {
  const fresh = Object.values(freshnessMap ?? {}).filter((f) => f.kind === 'daily' && f.status !== 'MISSING');
  const finished = runs.filter((r) => r.status !== 'running').slice(0, 14);
  const parts = {
    tracking: tracking?.account?.score ?? 100,
    freshness: fresh.length ? Math.round((fresh.filter((f) => f.status === 'VALID').length / fresh.length) * 100) : 0,
    sync: finished.length ? Math.round((finished.filter((r) => r.status === 'success').length / finished.length) * 100) : 0,
    configuration: actions ? Math.round(((actions - unverified) / actions) * 100) : 100,
    diagnostics: Math.max(0, 100 - findings.filter((f) => f.status !== 'monitoring').reduce((a, f) => a + ({ critical: 40, high: 20, medium: 5, low: 0 }[f.severity] ?? 0), 0)),
    alerts: Math.max(0, 100 - alerts.filter((a) => a.status !== 'resolved').reduce((s, a) => s + ({ critical: 50, high: 20 }[a.severity] ?? 0), 0)),
  };
  const score = Math.round(Object.entries(w).reduce((a, [k, weight]) => a + (parts[k] * weight) / 100, 0));
  return { score, label: score >= 80 ? 'Sehat' : score >= 60 ? 'Perlu perhatian' : 'Bermasalah', parts, weights: w, ruleset_version: RULESET_VERSION };
}

// Primary conversions per campaign over the last 7 days of data up to `end`.
export async function recentCampaignConversions(brandId, end, db = pool) {
  const { rows } = await db.query(
    `SELECT customer_id, campaign_id, sum(conversions)::float AS conversions
     FROM google_ads_daily WHERE brand_id = $1 AND level = 'campaign' AND entry_date BETWEEN ($2::date - 6) AND $2
     GROUP BY customer_id, campaign_id`,
    [brandId, end],
  );
  return new Map(rows.map((r) => [`${r.customer_id}|${r.campaign_id}`, r.conversions]));
}

// One row per distinct finding per period and ruleset version; a repeat
// moves last_seen_at — the trigger counts of the rule-performance review.
export async function logFindings(brandId, start, end, findings, db = pool) {
  for (const f of findings) {
    await db.query(
      `INSERT INTO google_ads_finding_log (brand_id, finding_id, type, entity_type, entity_name, severity, status, confidence, confidence_score, period_start, period_end, ruleset_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (brand_id, finding_id, period_start, period_end, ruleset_version) DO UPDATE SET
         severity = EXCLUDED.severity, status = EXCLUDED.status, confidence = EXCLUDED.confidence,
         confidence_score = EXCLUDED.confidence_score, last_seen_at = now(), times_seen = google_ads_finding_log.times_seen + 1`,
      [brandId, f.id, f.type, f.entity_type, f.entity_name ?? null, f.severity, f.status ?? 'diagnosis', f.confidence ?? null, f.confidence_score ?? null, start, end, f.ruleset_version ?? RULESET_VERSION],
    );
  }
}
