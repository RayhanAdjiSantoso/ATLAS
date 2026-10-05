import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
import * as brandService from './brandService.js';
import * as gaRepo from '../repositories/googleAdsRepository.js';
import * as optRepo from '../repositories/googleAdsOptimizationRepository.js';
import * as quality from './googleAdsQuality.js';
import { RULESET_VERSION, CALIBRATION_LOG, RULES, ALERT_COOLDOWN_DAYS, RECONCILE, FRESHNESS } from './googleAdsRules.js';

// Internal tools for running the Google Ads rules in production: verdicts
// on findings / recommendations / alerts, the rule-performance table the
// 7- and 30-day calibrations read, and an operations view of the syncs.
// None of this changes a rule by itself — calibration is a person editing
// googleAdsRules.js with a CALIBRATION_LOG entry.

const VERDICTS = ['useful', 'not_useful', 'false_positive', 'needs_more_data'];
const TARGETS = ['finding', 'recommendation', 'alert'];
const todayJakarta = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

async function assertBrand(brandId) {
  const brand = await brandService.getBrandById(brandId);
  if (!brand) throw new AppError('Client tidak ditemukan', 404);
  return brand;
}

export async function saveFeedback({ brandId, input, userId }) {
  await assertBrand(brandId);
  const { target_type: targetType, target_key: targetKey, rule_type: ruleType, verdict } = input;
  if (!TARGETS.includes(targetType)) throw new AppError('target_type tidak dikenal', 400);
  if (!VERDICTS.includes(verdict)) throw new AppError('verdict tidak dikenal', 400);
  if (!targetKey || !ruleType) throw new AppError('target_key dan rule_type wajib diisi', 400);
  const iso = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const { rows } = await pool.query(
    `INSERT INTO google_ads_feedback (brand_id, target_type, target_key, rule_type, verdict, note, ruleset_version, period_start, period_end, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING google_ads_feedback_id AS id, created_at`,
    [brandId, targetType, String(targetKey).slice(0, 300), String(ruleType).slice(0, 120), verdict, input.note ? String(input.note).slice(0, 1000) : null,
      input.ruleset_version || RULESET_VERSION, iso(input.period_start), iso(input.period_end), userId ?? null],
  );
  return rows[0];
}

export async function listFeedback(brandId) {
  await assertBrand(brandId);
  const { rows } = await pool.query(
    `SELECT f.google_ads_feedback_id AS id, f.target_type, f.target_key, f.rule_type, f.verdict, f.note, f.ruleset_version, f.created_at, u.full_name AS created_by_name
     FROM google_ads_feedback f LEFT JOIN users u ON u.user_id = f.created_by
     WHERE f.brand_id = $1 ORDER BY f.created_at DESC LIMIT 200`,
    [brandId],
  );
  return rows;
}

// Rule performance: how often each rule fired (distinct findings logged by
// reports, alert openings) against the verdicts it received. brandId null =
// every brand (the cross-brand view is for the internal team).
export async function rulePerformance({ brandId = null, from, to }) {
  if (brandId) await assertBrand(brandId);
  const params = [brandId, from, to];
  const { rows: findings } = await pool.query(
    `SELECT type AS rule, ruleset_version, count(*)::int AS triggers,
            count(*) FILTER (WHERE status = 'monitoring')::int AS monitoring,
            count(*) FILTER (WHERE confidence = 'low')::int AS low_confidence
     FROM google_ads_finding_log
     WHERE ($1::int IS NULL OR brand_id = $1) AND last_seen_at::date BETWEEN $2 AND $3
     GROUP BY type, ruleset_version`, params);
  const { rows: alerts } = await pool.query(
    `SELECT type AS rule, sum(occurrence_count)::int AS openings, count(*)::int AS keys
     FROM google_ads_alerts WHERE ($1::int IS NULL OR brand_id = $1) AND last_seen_at::date BETWEEN $2 AND $3
     GROUP BY type`, params);
  const { rows: feedback } = await pool.query(
    `SELECT rule_type AS rule, ruleset_version,
            count(*) FILTER (WHERE verdict = 'useful')::int AS useful,
            count(*) FILTER (WHERE verdict = 'not_useful')::int AS not_useful,
            count(*) FILTER (WHERE verdict = 'false_positive')::int AS false_positive,
            count(*) FILTER (WHERE verdict = 'needs_more_data')::int AS needs_more_data
     FROM google_ads_feedback WHERE ($1::int IS NULL OR brand_id = $1) AND created_at::date BETWEEN $2 AND $3
     GROUP BY rule_type, ruleset_version`, params);
  const { rows: recs } = await pool.query(
    `SELECT coalesce(category, '?') || ':' || coalesce(action_type, 'other') AS rule, count(*)::int AS created,
            count(*) FILTER (WHERE status = 'dismissed')::int AS dismissed,
            count(*) FILTER (WHERE status IN ('planned', 'in_progress', 'monitoring', 'completed'))::int AS acted_on,
            count(*) FILTER (WHERE status = 'resolved_by_data')::int AS resolved_by_data
     FROM google_ads_recommendations WHERE ($1::int IS NULL OR brand_id = $1) AND first_seen_at::date BETWEEN $2 AND $3
     GROUP BY 1`, params);
  const rules = new Map();
  const row = (rule) => {
    if (!rules.has(rule)) rules.set(rule, { rule, triggers: 0, monitoring: 0, low_confidence: 0, alert_openings: 0, useful: 0, not_useful: 0, false_positive: 0, needs_more_data: 0, versions: new Set() });
    return rules.get(rule);
  };
  for (const f of findings) { const r = row(f.rule); r.triggers += f.triggers; r.monitoring += f.monitoring; r.low_confidence += f.low_confidence; r.versions.add(f.ruleset_version); }
  for (const a of alerts) row(a.rule).alert_openings += a.openings;
  for (const f of feedback) { const r = row(f.rule); for (const k of ['useful', 'not_useful', 'false_positive', 'needs_more_data']) r[k] += f[k]; r.versions.add(f.ruleset_version); }
  const table = [...rules.values()].map((r) => {
    const reviewed = r.useful + r.not_useful + r.false_positive + r.needs_more_data;
    return {
      ...r, versions: [...r.versions].filter(Boolean),
      reviewed, false_positive_rate: reviewed ? r.false_positive / reviewed : null,
      flag: reviewed >= 5 && r.false_positive / reviewed >= 0.3 ? 'Banyak false positive — kandidat kalibrasi'
        : r.triggers >= 20 && reviewed === 0 ? 'Sering muncul, belum direview'
          : null,
    };
  }).sort((a, b) => (b.false_positive_rate ?? -1) - (a.false_positive_rate ?? -1) || b.triggers - a.triggers);
  return { from, to, ruleset_version: RULESET_VERSION, rules: table, recommendations: recs, calibration_log: CALIBRATION_LOG };
}

// Sync operations for one brand: each run with its duration, datasets,
// retries of the same range, the latest reconciliation and freshness.
// No secrets: ingest keys and credentials never leave the server.
export async function operations(brandId) {
  await assertBrand(brandId);
  const runs = await gaRepo.listRecentRuns(brandId, 40);
  const attempts = new Map();
  for (const r of runs) {
    const k = `${r.customerId}|${r.startDate}|${r.endDate}|${String(r.startedAt).slice(0, 10)}`;
    attempts.set(k, (attempts.get(k) ?? 0) + 1);
  }
  const finished = runs.filter((r) => r.status !== 'running');
  const [dq, fresh, alerts] = await Promise.all([
    quality.latestDataQuality(brandId), quality.freshness(brandId, todayJakarta()), optRepo.listAlerts(brandId),
  ]);
  return {
    ruleset_version: RULESET_VERSION,
    config: { reconcile: RECONCILE, freshness: FRESHNESS, alert_cooldown_days: ALERT_COOLDOWN_DAYS, rules: RULES },
    success_rate: finished.length ? finished.filter((r) => r.status === 'success').length / finished.length : null,
    runs: runs.map((r) => ({
      ...r,
      duration_ms: r.finishedAt ? new Date(r.finishedAt) - new Date(r.startedAt) : null,
      attempts_same_day: attempts.get(`${r.customerId}|${r.startDate}|${r.endDate}|${String(r.startedAt).slice(0, 10)}`) ?? 1,
      stuck: r.status === 'running' && Date.now() - new Date(r.startedAt).getTime() > 45 * 60 * 1000,
    })),
    data_quality: dq,
    freshness: fresh,
    open_alerts: alerts.filter((a) => a.status !== 'resolved').length,
  };
}
