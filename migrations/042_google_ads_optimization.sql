-- =====================================================================
-- 042 — Google Ads optimisation: recommendations, experiments, alerts
--
-- google_ads_recommendations  What the AI Optimization Center proposes,
--   validated by the backend before it is stored. One open recommendation
--   per fingerprint (entity + category): a repeat updates it instead of
--   adding a duplicate, and a dismissed one stays quiet for 30 days. "Make
--   it a task" appends a line to the brand's latest MOM to-do (MIL side) —
--   the task lives in brand_minutes like every other MOM task; the row keeps
--   which minute and which task key, so ticking it in MOM shows here.
--
-- google_ads_experiments / _results  A change the team makes on purpose,
--   with its hypothesis, a baseline captured when it is recorded, and each
--   evaluation of baseline vs evaluation period. Results are observations
--   with their attribution limits, not proof of cause.
--
-- google_ads_alerts  Rule-based alerts, one row per alert key (type +
--   entity). Re-evaluated after every sync and when the alert list is read:
--   a key still firing updates its row, one that stops is resolved and stays
--   resolved through a cooldown so the same alert does not flap.
--
-- Additive only. Idempotent.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS google_ads_recommendations (
    google_ads_recommendation_id  SERIAL PRIMARY KEY,
    brand_id            INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id         TEXT,
    fingerprint         TEXT    NOT NULL,
    entity_type         TEXT    NOT NULL,
    entity_id           TEXT,
    entity_name         TEXT,
    category            TEXT    NOT NULL,
    title               TEXT    NOT NULL,
    finding             TEXT    NOT NULL,
    evidence            JSONB   NOT NULL DEFAULT '[]'::jsonb,
    possible_cause      TEXT,
    recommended_action  TEXT    NOT NULL,
    expected_direction  TEXT,
    priority            TEXT    NOT NULL,
    confidence          TEXT    NOT NULL,
    risk                TEXT,
    success_metric      TEXT,
    monitoring_period   TEXT,
    status              TEXT    NOT NULL DEFAULT 'new',
    notes               TEXT,
    source              TEXT    NOT NULL DEFAULT 'ai',
    model               TEXT,
    period_start        DATE,
    period_end          DATE,
    times_seen          INTEGER NOT NULL DEFAULT 1,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_updated_at   TIMESTAMPTZ,
    status_updated_by   INTEGER REFERENCES users(user_id),
    task_minute_id      INTEGER REFERENCES brand_minutes(id) ON DELETE SET NULL,
    task_key            TEXT,
    created_by          INTEGER REFERENCES users(user_id),
    CONSTRAINT ck_gar_priority CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    CONSTRAINT ck_gar_confidence CHECK (confidence IN ('high', 'medium', 'low')),
    CONSTRAINT ck_gar_status CHECK (status IN ('new', 'reviewed', 'planned', 'in_progress', 'monitoring', 'completed', 'dismissed')),
    CONSTRAINT ck_gar_entity CHECK (entity_type IN ('account', 'campaign', 'ad_group', 'keyword', 'search_term', 'ad', 'landing_page'))
);
CREATE INDEX IF NOT EXISTS ix_gar_brand ON google_ads_recommendations (brand_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS ix_gar_fingerprint ON google_ads_recommendations (brand_id, fingerprint);

CREATE TABLE IF NOT EXISTS google_ads_experiments (
    google_ads_experiment_id  SERIAL PRIMARY KEY,
    brand_id           INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id        TEXT,
    campaign_id        TEXT,                    -- NULL = the whole account
    campaign_name      TEXT,
    recommendation_id  INTEGER REFERENCES google_ads_recommendations(google_ads_recommendation_id) ON DELETE SET NULL,
    hypothesis         TEXT    NOT NULL,
    planned_action     TEXT,
    actual_change      TEXT,
    pic                TEXT,
    start_date         DATE    NOT NULL,        -- the day the change went live
    evaluation_date    DATE,
    baseline_start     DATE    NOT NULL,
    baseline_end       DATE    NOT NULL,
    eval_start         DATE    NOT NULL,
    eval_end           DATE    NOT NULL,
    success_metric     TEXT    NOT NULL,
    expected_direction TEXT    NOT NULL,
    baseline_snapshot  JSONB,                   -- metrics of the baseline period when the experiment was recorded
    status             TEXT    NOT NULL DEFAULT 'planned',
    result             TEXT,
    notes              TEXT,
    created_by         INTEGER REFERENCES users(user_id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gae_metric CHECK (success_metric IN ('cpa', 'conversions', 'cvr', 'ctr', 'cpc', 'roas', 'cost', 'conversions_value', 'impressions', 'clicks')),
    CONSTRAINT ck_gae_direction CHECK (expected_direction IN ('increase', 'decrease')),
    CONSTRAINT ck_gae_status CHECK (status IN ('planned', 'running', 'evaluating', 'completed', 'cancelled')),
    CONSTRAINT ck_gae_result CHECK (result IS NULL OR result IN ('improved', 'declined', 'inconclusive')),
    CONSTRAINT ck_gae_ranges CHECK (baseline_start <= baseline_end AND eval_start <= eval_end)
);
CREATE INDEX IF NOT EXISTS ix_gae_brand ON google_ads_experiments (brand_id, start_date DESC);

CREATE TABLE IF NOT EXISTS google_ads_experiment_results (
    google_ads_experiment_result_id  SERIAL PRIMARY KEY,
    experiment_id   INTEGER NOT NULL REFERENCES google_ads_experiments(google_ads_experiment_id) ON DELETE CASCADE,
    evaluated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    evaluated_by    INTEGER REFERENCES users(user_id),
    metric          TEXT    NOT NULL,
    baseline        JSONB   NOT NULL,
    evaluation      JSONB   NOT NULL,
    change          NUMERIC,
    verdict         TEXT    NOT NULL,
    limitations     JSONB   NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT ck_gaer_verdict CHECK (verdict IN ('improved', 'declined', 'inconclusive'))
);
CREATE INDEX IF NOT EXISTS ix_gaer_experiment ON google_ads_experiment_results (experiment_id, evaluated_at DESC);

CREATE TABLE IF NOT EXISTS google_ads_alerts (
    google_ads_alert_id  SERIAL PRIMARY KEY,
    brand_id         INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id      TEXT,
    alert_key        TEXT    NOT NULL,
    type             TEXT    NOT NULL,
    severity         TEXT    NOT NULL,
    title            TEXT    NOT NULL,
    message          TEXT    NOT NULL,
    data             JSONB   NOT NULL DEFAULT '{}'::jsonb,
    status           TEXT    NOT NULL DEFAULT 'open',
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at      TIMESTAMPTZ,
    cooldown_until   TIMESTAMPTZ,
    acknowledged_by  INTEGER REFERENCES users(user_id),
    acknowledged_at  TIMESTAMPTZ,
    CONSTRAINT ck_gaal_severity CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    CONSTRAINT ck_gaal_status CHECK (status IN ('open', 'acknowledged', 'resolved')),
    CONSTRAINT ux_gaal_key UNIQUE (brand_id, alert_key)
);
CREATE INDEX IF NOT EXISTS ix_gaal_brand ON google_ads_alerts (brand_id, status, last_seen_at DESC);
