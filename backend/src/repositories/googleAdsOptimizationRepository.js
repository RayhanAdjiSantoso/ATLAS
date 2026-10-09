import pool from '../config/db.js';

// Tables of migration 042: recommendations, experiments, alerts.

// ---------------------------------------------------------------------
// recommendations
// ---------------------------------------------------------------------
const REC_COLUMNS = `
  r.google_ads_recommendation_id AS id, r.brand_id, r.customer_id, r.fingerprint, r.entity_type, r.entity_id, r.entity_name,
  r.category, r.title, r.finding, r.evidence, r.possible_cause, r.recommended_action, r.expected_direction, r.priority,
  r.confidence, r.risk, r.success_metric, r.monitoring_period, r.status, r.notes, r.source, r.model,
  to_char(r.period_start, 'YYYY-MM-DD') AS period_start, to_char(r.period_end, 'YYYY-MM-DD') AS period_end,
  r.times_seen, r.first_seen_at, r.last_seen_at, r.status_updated_at, r.task_minute_id, r.task_key,
  r.ruleset_version, r.action_type, r.validation_notes, r.missed_generations,
  u.full_name AS status_updated_by_name,
  (r.task_key IS NOT NULL AND m.completed_task_keys ? r.task_key) AS task_done,
  to_char(m.meeting_date, 'YYYY-MM-DD') AS task_meeting_date`;
const REC_FROM = `
  FROM google_ads_recommendations r
  LEFT JOIN users u ON u.user_id = r.status_updated_by
  LEFT JOIN brand_minutes m ON m.id = r.task_minute_id`;

export async function listRecommendations(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${REC_COLUMNS} ${REC_FROM} WHERE r.brand_id = $1
     ORDER BY (r.status IN ('completed', 'dismissed', 'resolved_by_data')), array_position(ARRAY['critical','high','medium','low'], r.priority), r.last_seen_at DESC
     LIMIT 200`,
    [brandId],
  );
  return rows;
}

export async function getRecommendation(id, brandId, db = pool) {
  const { rows } = await db.query(`SELECT ${REC_COLUMNS} ${REC_FROM} WHERE r.google_ads_recommendation_id = $1 AND r.brand_id = $2`, [id, brandId]);
  return rows[0] ?? null;
}

// The newest recommendation per fingerprint — the dedupe decision reads it.
export async function latestByFingerprint(brandId, fingerprints, db = pool) {
  if (!fingerprints.length) return [];
  const { rows } = await db.query(
    `SELECT DISTINCT ON (fingerprint) google_ads_recommendation_id AS id, fingerprint, status, status_updated_at, last_seen_at
     FROM google_ads_recommendations WHERE brand_id = $1 AND fingerprint = ANY($2)
     ORDER BY fingerprint, first_seen_at DESC, google_ads_recommendation_id DESC`,
    [brandId, fingerprints],
  );
  return rows;
}

const REC_FIELDS = ['customer_id', 'entity_type', 'entity_id', 'entity_name', 'category', 'title', 'finding', 'evidence', 'possible_cause',
  'recommended_action', 'expected_direction', 'priority', 'confidence', 'risk', 'success_metric', 'monitoring_period', 'source', 'model',
  'period_start', 'period_end', 'ruleset_version', 'action_type', 'validation_notes'];

export async function insertRecommendation(brandId, rec, userId, db = pool) {
  const cols = ['brand_id', 'fingerprint', ...REC_FIELDS, 'created_by'];
  const json = (f) => ['evidence', 'validation_notes'].includes(f);
  const vals = [brandId, rec.fingerprint, ...REC_FIELDS.map((f) => (json(f) ? JSON.stringify(rec[f] ?? []) : rec[f] ?? null)), userId ?? null];
  const { rows } = await db.query(
    `INSERT INTO google_ads_recommendations (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING google_ads_recommendation_id AS id`,
    vals,
  );
  return rows[0].id;
}

// A repeat refreshes the content and keeps the status the team gave it.
export async function refreshRecommendation(id, rec, db = pool) {
  const fields = REC_FIELDS.filter((f) => !['source', 'entity_type', 'entity_id', 'category', 'action_type'].includes(f));
  await db.query(
    `UPDATE google_ads_recommendations SET ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')},
       times_seen = times_seen + 1, last_seen_at = now(), missed_generations = 0
     WHERE google_ads_recommendation_id = $1`,
    [id, ...fields.map((f) => (['evidence', 'validation_notes'].includes(f) ? JSON.stringify(rec[f] ?? []) : rec[f] ?? null))],
  );
}

// Open, untouched AI recommendations not produced again: count the miss;
// on the second consecutive miss they become resolved_by_data. Ones the
// team already planned or started are left alone.
export async function markMissed(brandId, producedFingerprints, db = pool) {
  const { rows } = await db.query(
    `UPDATE google_ads_recommendations SET
       missed_generations = missed_generations + 1,
       status = CASE WHEN missed_generations + 1 >= 2 THEN 'resolved_by_data' ELSE status END,
       status_updated_at = CASE WHEN missed_generations + 1 >= 2 THEN now() ELSE status_updated_at END
     WHERE brand_id = $1 AND source = 'ai' AND status IN ('new', 'reviewed') AND NOT (fingerprint = ANY($2))
     RETURNING status`,
    [brandId, producedFingerprints],
  );
  return rows.filter((r) => r.status === 'resolved_by_data').length;
}

export async function updateRecommendation(id, brandId, { status, notes, userId }, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE google_ads_recommendations SET
       status = COALESCE($3, status),
       notes = CASE WHEN $4::boolean THEN $5 ELSE notes END,
       status_updated_at = CASE WHEN $3 IS NOT NULL AND $3 <> status THEN now() ELSE status_updated_at END,
       status_updated_by = CASE WHEN $3 IS NOT NULL AND $3 <> status THEN $6 ELSE status_updated_by END
     WHERE google_ads_recommendation_id = $1 AND brand_id = $2`,
    [id, brandId, status ?? null, notes !== undefined, notes ?? null, userId ?? null],
  );
  return rowCount;
}

export async function linkTask(id, { minuteId, taskKey, userId }, db = pool) {
  await db.query(
    `UPDATE google_ads_recommendations SET task_minute_id = $2, task_key = $3,
       status = CASE WHEN status IN ('new', 'reviewed') THEN 'planned' ELSE status END,
       status_updated_at = now(), status_updated_by = $4
     WHERE google_ads_recommendation_id = $1`,
    [id, minuteId, taskKey, userId ?? null],
  );
}

// ---------------------------------------------------------------------
// MOM (brand_minutes) — where recommendation tasks land
// ---------------------------------------------------------------------
export async function latestMinute(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, to_char(meeting_date, 'YYYY-MM-DD') AS meeting_date, todo_mil
     FROM brand_minutes WHERE brand_id = $1 ORDER BY meeting_date DESC, id DESC LIMIT 1`,
    [brandId],
  );
  return rows[0] ?? null;
}

export async function setMinuteTodoMil(minuteId, todoMil, userId, db = pool) {
  await db.query(
    'UPDATE brand_minutes SET todo_mil = $2, updated_by = $3, updated_at = now() WHERE id = $1',
    [minuteId, todoMil, userId ?? null],
  );
}

// ---------------------------------------------------------------------
// experiments
// ---------------------------------------------------------------------
const EXP_COLUMNS = `
  e.google_ads_experiment_id AS id, e.brand_id, e.customer_id, e.campaign_id, e.campaign_name, e.recommendation_id, e.hypothesis,
  e.planned_action, e.actual_change, e.pic, to_char(e.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(e.evaluation_date, 'YYYY-MM-DD') AS evaluation_date, to_char(e.baseline_start, 'YYYY-MM-DD') AS baseline_start,
  to_char(e.baseline_end, 'YYYY-MM-DD') AS baseline_end, to_char(e.eval_start, 'YYYY-MM-DD') AS eval_start,
  to_char(e.eval_end, 'YYYY-MM-DD') AS eval_end, e.success_metric, e.expected_direction, e.baseline_snapshot, e.status, e.result,
  e.notes, e.created_at, e.updated_at, u.full_name AS created_by_name,
  (SELECT row_to_json(x) FROM (
     SELECT evaluated_at, metric, baseline, evaluation, change::float AS change, verdict, limitations, quality, ruleset_version
     FROM google_ads_experiment_results WHERE experiment_id = e.google_ads_experiment_id
     ORDER BY evaluated_at DESC LIMIT 1) x) AS last_result`;

export async function listExperiments(brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${EXP_COLUMNS} FROM google_ads_experiments e LEFT JOIN users u ON u.user_id = e.created_by
     WHERE e.brand_id = $1 ORDER BY e.start_date DESC, e.google_ads_experiment_id DESC`,
    [brandId],
  );
  return rows;
}

export async function getExperiment(id, brandId, db = pool) {
  const { rows } = await db.query(
    `SELECT ${EXP_COLUMNS} FROM google_ads_experiments e LEFT JOIN users u ON u.user_id = e.created_by
     WHERE e.google_ads_experiment_id = $1 AND e.brand_id = $2`,
    [id, brandId],
  );
  return rows[0] ?? null;
}

const EXP_FIELDS = ['customer_id', 'campaign_id', 'campaign_name', 'recommendation_id', 'hypothesis', 'planned_action', 'actual_change', 'pic',
  'start_date', 'evaluation_date', 'baseline_start', 'baseline_end', 'eval_start', 'eval_end', 'success_metric', 'expected_direction',
  'status', 'notes'];

export async function insertExperiment(brandId, exp, userId, db = pool) {
  const cols = ['brand_id', ...EXP_FIELDS, 'baseline_snapshot', 'created_by'];
  const vals = [brandId, ...EXP_FIELDS.map((f) => exp[f] ?? null), JSON.stringify(exp.baseline_snapshot ?? null), userId ?? null];
  const { rows } = await db.query(
    `INSERT INTO google_ads_experiments (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING google_ads_experiment_id AS id`,
    vals,
  );
  return rows[0].id;
}

export async function updateExperiment(id, brandId, patch, db = pool) {
  const fields = [...EXP_FIELDS, 'result', 'baseline_snapshot'].filter((f) => patch[f] !== undefined);
  if (!fields.length) return 0;
  const { rowCount } = await db.query(
    `UPDATE google_ads_experiments SET ${fields.map((f, i) => `${f} = $${i + 3}`).join(', ')}, updated_at = now()
     WHERE google_ads_experiment_id = $1 AND brand_id = $2`,
    [id, brandId, ...fields.map((f) => (f === 'baseline_snapshot' ? JSON.stringify(patch[f]) : patch[f]))],
  );
  return rowCount;
}

export async function deleteExperiment(id, brandId, db = pool) {
  const { rowCount } = await db.query('DELETE FROM google_ads_experiments WHERE google_ads_experiment_id = $1 AND brand_id = $2', [id, brandId]);
  return rowCount;
}

export async function insertExperimentResult(experimentId, r, userId, db = pool) {
  await db.query(
    `INSERT INTO google_ads_experiment_results (experiment_id, evaluated_by, metric, baseline, evaluation, change, verdict, limitations, quality, ruleset_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [experimentId, userId ?? null, r.metric, JSON.stringify(r.baseline), JSON.stringify(r.evaluation), r.change, r.verdict, JSON.stringify(r.limitations), r.quality ?? null, r.ruleset_version ?? null],
  );
}

// Sums of one campaign (or the account) over a range, from the campaign
// level of google_ads_daily — the level account totals always come from.
export async function campaignMetrics(brandId, campaign, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT sum(cost)::float AS cost, sum(impressions)::float AS impressions, sum(clicks)::float AS clicks,
            sum(conversions)::float AS conversions, sum(conversions_value)::float AS conversions_value,
            sum(all_conversions)::float AS all_conversions, count(DISTINCT entry_date)::int AS days_with_data
     FROM google_ads_daily
     WHERE brand_id = $1 AND level = 'campaign' AND entry_date BETWEEN $2 AND $3
       AND ($4::text IS NULL OR (customer_id = $5 AND campaign_id = $4))`,
    [brandId, start, end, campaign?.campaign_id ?? null, campaign?.customer_id ?? null],
  );
  return rows[0];
}

// Change history around a range for one campaign (by name, as Google's
// change events carry it) or for the whole account.
export async function changesBetween(brandId, campaignName, start, end, db = pool) {
  const { rows } = await db.query(
    `SELECT to_char(changed_at, 'YYYY-MM-DD HH24:MI') AS changed_at, user_email, resource_type, operation, campaign_name, changes
     FROM google_ads_change_events
     WHERE brand_id = $1 AND change_date BETWEEN $2 AND $3 AND ($4::text IS NULL OR campaign_name = $4)
     ORDER BY changed_at`,
    [brandId, start, end, campaignName ?? null],
  );
  return rows;
}

// ---------------------------------------------------------------------
// alerts
// ---------------------------------------------------------------------
const ALERT_COLUMNS = `google_ads_alert_id AS id, brand_id, customer_id, alert_key, type, severity, title, message, data, status,
  first_seen_at, last_seen_at, resolved_at, cooldown_until, acknowledged_at, occurrence_count, last_notified_at, ruleset_version`;

export async function listAlerts(brandId, { includeResolved = false } = {}, db = pool) {
  const { rows } = await db.query(
    `SELECT ${ALERT_COLUMNS} FROM google_ads_alerts
     WHERE brand_id = $1 AND ($2 OR status <> 'resolved')
     ORDER BY (status = 'resolved'), array_position(ARRAY['critical','high','medium','low'], severity), last_seen_at DESC
     LIMIT 100`,
    [brandId, includeResolved],
  );
  return rows;
}

export async function applyAlertChanges(brandId, { open, refresh, resolve }, db = pool) {
  for (const a of open) {
    await db.query(
      `INSERT INTO google_ads_alerts (brand_id, customer_id, alert_key, type, severity, title, message, data, ruleset_version, last_notified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (brand_id, alert_key) DO UPDATE SET
         customer_id = EXCLUDED.customer_id, type = EXCLUDED.type, severity = EXCLUDED.severity, title = EXCLUDED.title,
         message = EXCLUDED.message, data = EXCLUDED.data, status = 'open', first_seen_at = now(), last_seen_at = now(),
         resolved_at = NULL, cooldown_until = NULL, acknowledged_by = NULL, acknowledged_at = NULL,
         occurrence_count = google_ads_alerts.occurrence_count + 1, last_notified_at = now(), ruleset_version = EXCLUDED.ruleset_version`,
      [brandId, a.customer_id ?? null, a.alert_key, a.type, a.severity, a.title, a.message, JSON.stringify(a.data ?? {}), a.data?.ruleset_version ?? null],
    );
  }
  for (const a of refresh) {
    await db.query(
      `UPDATE google_ads_alerts SET severity = $3, title = $4, message = $5, data = $6, last_seen_at = now()
       WHERE brand_id = $1 AND alert_key = $2`,
      [brandId, a.alert_key, a.severity, a.title, a.message, JSON.stringify(a.data ?? {})],
    );
  }
  for (const { alert_key: key, cooldown_until: until } of resolve) {
    await db.query(
      `UPDATE google_ads_alerts SET status = 'resolved', resolved_at = now(), cooldown_until = $3
       WHERE brand_id = $1 AND alert_key = $2`,
      [brandId, key, until],
    );
  }
}

export async function setAlertStatus(id, brandId, status, userId, cooldownUntil, db = pool) {
  const { rowCount } = await db.query(
    `UPDATE google_ads_alerts SET status = $3,
       acknowledged_by = CASE WHEN $3 = 'acknowledged' THEN $4 ELSE acknowledged_by END,
       acknowledged_at = CASE WHEN $3 = 'acknowledged' THEN now() ELSE acknowledged_at END,
       resolved_at = CASE WHEN $3 = 'resolved' THEN now() ELSE resolved_at END,
       cooldown_until = CASE WHEN $3 = 'resolved' THEN $5::timestamptz ELSE cooldown_until END
     WHERE google_ads_alert_id = $1 AND brand_id = $2`,
    [id, brandId, status, userId ?? null, cooldownUntil],
  );
  return rowCount;
}

export async function alertRows(brandId, db = pool) {
  const { rows } = await db.query(`SELECT alert_key, type, status, cooldown_until FROM google_ads_alerts WHERE brand_id = $1`, [brandId]);
  return rows;
}

export async function deleteCustomerOptimization(customerId, db = pool) {
  await db.query('DELETE FROM google_ads_alerts WHERE customer_id = $1', [customerId]);
}
