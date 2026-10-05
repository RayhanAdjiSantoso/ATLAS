-- =====================================================================
-- 043 — Google Ads production hardening
--
-- google_ads_data_quality   Result of each reconciliation / coverage /
--   freshness check after a sync: expected vs observed, the difference and
--   a status (VALID, PARTIAL, STALE, INCONSISTENT, MISSING, UNVERIFIED).
--   One row per check per sync; the report computes the same checks live
--   for its own period.
--
-- google_ads_finding_log    Each distinct diagnosis a report produced (per
--   period, finding and ruleset version) — the trigger counts of the
--   rule-performance review.
--
-- google_ads_feedback       Internal verdicts on findings, recommendations
--   and alerts (useful / not useful / false positive / needs more data),
--   stored with the ruleset version. Evidence for calibrating the rules by
--   hand; nothing learns from it automatically.
--
-- Plus: ruleset version and action type on recommendations, a
-- 'resolved_by_data' status (the issue disappeared from the data — not
-- the same as the team completing it), occurrence counts on alerts, a
-- quality label on experiment results, and an index the planner's
-- successful-run lookup uses.
--
-- Additive only. Idempotent.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS google_ads_data_quality (
    google_ads_data_quality_id  BIGSERIAL PRIMARY KEY,
    brand_id        INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id     TEXT,
    fetch_run_id    TEXT,
    check_key       TEXT    NOT NULL,        -- e.g. cost:devices, conversions:actions, coverage:hourly
    dataset         TEXT    NOT NULL,
    period_start    DATE    NOT NULL,
    period_end      DATE    NOT NULL,
    expected        NUMERIC,
    observed        NUMERIC,
    abs_diff        NUMERIC,
    rel_diff        NUMERIC,
    status          TEXT    NOT NULL,
    note            TEXT,
    ruleset_version TEXT    NOT NULL,
    checked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gadq_status CHECK (status IN ('VALID', 'PARTIAL', 'STALE', 'INCONSISTENT', 'MISSING', 'UNVERIFIED'))
);
CREATE INDEX IF NOT EXISTS ix_gadq_brand_checked ON google_ads_data_quality (brand_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS google_ads_finding_log (
    google_ads_finding_log_id  BIGSERIAL PRIMARY KEY,
    brand_id        INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    finding_id      TEXT    NOT NULL,        -- type:entity key
    type            TEXT    NOT NULL,
    entity_type     TEXT    NOT NULL,
    entity_name     TEXT,
    severity        TEXT    NOT NULL,
    status          TEXT    NOT NULL,        -- diagnosis | monitoring
    confidence      TEXT,
    confidence_score INTEGER,
    period_start    DATE    NOT NULL,
    period_end      DATE    NOT NULL,
    ruleset_version TEXT    NOT NULL,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    times_seen      INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT ux_gafl_finding UNIQUE (brand_id, finding_id, period_start, period_end, ruleset_version)
);
CREATE INDEX IF NOT EXISTS ix_gafl_brand_type ON google_ads_finding_log (brand_id, type, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS google_ads_feedback (
    google_ads_feedback_id  BIGSERIAL PRIMARY KEY,
    brand_id        INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    target_type     TEXT    NOT NULL,        -- finding | recommendation | alert
    target_key      TEXT    NOT NULL,        -- finding id, recommendation id, alert key
    rule_type       TEXT    NOT NULL,        -- finding / alert type, recommendation category:action
    verdict         TEXT    NOT NULL,
    note            TEXT,
    ruleset_version TEXT    NOT NULL,
    period_start    DATE,
    period_end      DATE,
    created_by      INTEGER REFERENCES users(user_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gafb_target CHECK (target_type IN ('finding', 'recommendation', 'alert')),
    CONSTRAINT ck_gafb_verdict CHECK (verdict IN ('useful', 'not_useful', 'false_positive', 'needs_more_data'))
);
CREATE INDEX IF NOT EXISTS ix_gafb_brand ON google_ads_feedback (brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_gafb_rule ON google_ads_feedback (rule_type, ruleset_version);

ALTER TABLE google_ads_recommendations ADD COLUMN IF NOT EXISTS ruleset_version TEXT;
ALTER TABLE google_ads_recommendations ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE google_ads_recommendations ADD COLUMN IF NOT EXISTS missed_generations INTEGER NOT NULL DEFAULT 0;
ALTER TABLE google_ads_recommendations ADD COLUMN IF NOT EXISTS validation_notes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE google_ads_recommendations DROP CONSTRAINT IF EXISTS ck_gar_status;
ALTER TABLE google_ads_recommendations ADD CONSTRAINT ck_gar_status
    CHECK (status IN ('new', 'reviewed', 'planned', 'in_progress', 'monitoring', 'completed', 'dismissed', 'resolved_by_data'));

ALTER TABLE google_ads_alerts ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE google_ads_alerts ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ;
ALTER TABLE google_ads_alerts ADD COLUMN IF NOT EXISTS ruleset_version TEXT;

ALTER TABLE google_ads_experiment_results ADD COLUMN IF NOT EXISTS quality TEXT;
ALTER TABLE google_ads_experiment_results ADD COLUMN IF NOT EXISTS ruleset_version TEXT;

CREATE INDEX IF NOT EXISTS ix_gafl_customer_status ON google_ads_fetch_log (customer_id, status);
