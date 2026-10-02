-- =====================================================================
-- 036 — Google Ads in Pengaturan Brand › Data & file, change history,
--       and the AI Consultant Brief
--
-- 1. 'google' joins ads_reports.platform_enum. Two tables key on it:
--    brand_library_files (Data & file gets a Google Ads tab with three
--    monthly datasets: auction_insights, search_terms, change_history) and
--    ai_summaries (Report Generator › Google Ads gets the AI Consultant
--    Brief the other platforms have).
--
-- 2. google_ads_change_events: Google Ads' change history (who changed
--    what, when), pulled by the Google Ads Script next to the daily report
--    rows (035). Google only serves the last 30 days of it, so older months
--    come from a manual export filed in Data & file instead.
--    One row per change event; event_key is Google's change_event
--    resource name, unique per account.
--
-- ADD VALUE runs inside migrate.js's transaction; Postgres 12+ allows that
-- as long as the new value is not used in the same transaction (it isn't).
-- Idempotent / re-runnable.
-- =====================================================================

ALTER TYPE ads_reports.platform_enum ADD VALUE IF NOT EXISTS 'google';

SET search_path TO public;

CREATE TABLE IF NOT EXISTS google_ads_change_events (
    google_ads_change_event_id  BIGSERIAL PRIMARY KEY,
    brand_id        INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id     TEXT    NOT NULL,
    event_key       TEXT    NOT NULL,
    changed_at      TIMESTAMP NOT NULL,        -- account-local time, as Google reports it (no offset)
    change_date     DATE    NOT NULL,
    user_email      TEXT,
    client_type     TEXT,                      -- GOOGLE_ADS_WEB_CLIENT, GOOGLE_ADS_SCRIPTS, ...
    resource_type   TEXT,                      -- CAMPAIGN, AD_GROUP, AD_GROUP_CRITERION, ...
    operation       TEXT,                      -- CREATE, UPDATE, REMOVE
    campaign_name   TEXT,
    ad_group_name   TEXT,
    changes         TEXT,                      -- "status: PAUSED → ENABLED; ..."
    fetch_run_id    TEXT    NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_gace_event UNIQUE (customer_id, event_key)
);
CREATE INDEX IF NOT EXISTS ix_gace_brand_date ON google_ads_change_events (brand_id, change_date);
