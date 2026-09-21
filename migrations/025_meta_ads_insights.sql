-- =====================================================================
-- 025 — Meta Ads insights (auto-fetch, monthly): campaign × age × gender × day
--
-- Replaces the manual "export from Ads Manager, upload to Data & file" step
-- for the Meta Ads (MAIN) and CPAS accounts registered under Meta Ads
-- Automation › Brand & Langganan. An Apps Script monthly trigger (day 1)
-- pulls the previous month from the Marketing API and pushes it here (see
-- apps-script/MetaAdsMonthly.gs and routes/metaAdsInsightsIngestRoutes.js).
--
-- Fact grain: one row per brand × account type × day × campaign × age ×
-- gender — the leaf rows of Ads Manager's nested breakdown (no "All"
-- subtotal rows; those are derivable and would double count).
--
-- Six additive core metrics are typed columns (what a dashboard would
-- SUM/JOIN on); everything else — the remaining default metrics and any
-- optional metric the user ticked in Data & file — lives in `metrics` JSONB
-- keyed by the catalog key in backend/src/config/metaAdsMetrics.js, so
-- adding a metric never needs a migration.
--
-- Re-fetching a month is an upsert per row plus, at the end of a
-- successful run, a delete of that month's rows that the run did NOT touch
-- (fetch_run_id <> current) — so a corrected re-fetch replaces the month
-- without ever leaving it half-empty if the run dies midway.
--
-- Idempotent / re-runnable, same as the other migrations.
-- =====================================================================

SET search_path TO public;

-- Which optional metrics a brand wants, per account type. Default metrics
-- are always fetched and are not stored here.
CREATE TABLE IF NOT EXISTS meta_ads_fetch_config (
    brand_id       INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    account_type   TEXT    NOT NULL,                 -- 'MAIN' | 'CPAS'
    extra_metrics  TEXT[]  NOT NULL DEFAULT '{}',
    updated_by     INTEGER REFERENCES users(user_id),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (brand_id, account_type),
    CONSTRAINT ck_mafc_account_type CHECK (account_type IN ('MAIN', 'CPAS'))
);

CREATE TABLE IF NOT EXISTS meta_ads_insights_daily (
    meta_ads_insight_id  BIGSERIAL PRIMARY KEY,
    brand_id        INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    account_type    TEXT    NOT NULL,                -- 'MAIN' | 'CPAS'
    ad_account_id   TEXT    NOT NULL,                -- act_... the row came from
    entry_date      DATE    NOT NULL,
    campaign_id     TEXT    NOT NULL,
    campaign_name   TEXT    NOT NULL,
    age             TEXT    NOT NULL,                -- '25-34', 'Unknown', ...
    gender          TEXT    NOT NULL,                -- 'female' | 'male' | 'unknown'
    objective       TEXT,
    amount_spent    NUMERIC,
    impressions     NUMERIC,
    reach           NUMERIC,
    link_clicks     NUMERIC,
    purchases       NUMERIC,
    purchase_value  NUMERIC,
    metrics         JSONB   NOT NULL DEFAULT '{}',
    fetch_run_id    TEXT    NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_maid_account_type CHECK (account_type IN ('MAIN', 'CPAS')),
    CONSTRAINT ux_maid_grain UNIQUE (brand_id, account_type, entry_date, campaign_id, age, gender)
);
CREATE INDEX IF NOT EXISTS ix_maid_brand_type_date ON meta_ads_insights_daily (brand_id, account_type, entry_date);

-- One row per fetch run (scheduled or manual) — drives the status list in
-- Data & file. status 'running' is written when the run starts so the UI can
-- show it in progress; a run that dies without reporting stays 'running'
-- and the UI treats an old one as failed.
CREATE TABLE IF NOT EXISTS meta_ads_fetch_log (
    meta_ads_fetch_log_id  SERIAL PRIMARY KEY,
    brand_id       INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    account_type   TEXT    NOT NULL,
    ad_account_id  TEXT,
    month          DATE    NOT NULL,                 -- first day of the fetched month
    trigger        TEXT    NOT NULL,                 -- 'scheduled' | 'manual'
    fetch_run_id   TEXT    NOT NULL UNIQUE,
    status         TEXT    NOT NULL DEFAULT 'running',
    row_count      INTEGER NOT NULL DEFAULT 0,
    note           TEXT,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ,
    CONSTRAINT ck_mafl_account_type CHECK (account_type IN ('MAIN', 'CPAS')),
    CONSTRAINT ck_mafl_trigger CHECK (trigger IN ('scheduled', 'manual')),
    CONSTRAINT ck_mafl_status CHECK (status IN ('running', 'success', 'failed'))
);
CREATE INDEX IF NOT EXISTS ix_mafl_brand_started ON meta_ads_fetch_log (brand_id, started_at DESC);
