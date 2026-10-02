-- =====================================================================
-- 035 — Google Ads: per-brand account connection + daily report rows
--
-- Feeds Report Generator › Google Ads (the Looker Studio monthly report
-- rebuilt in ATLAS). A brand's Google Ads customer IDs are entered in
-- Pengaturan Brand › Google Ads; something outside ATLAS then pulls the
-- numbers and pushes them in through /api/google-ads/ingest.
--
-- That "something" is, for now, one Google Ads Script running in MIL's
-- manager account (apps-script/GoogleAdsReport.js — it needs no developer
-- token). It is meant to be replaced by a Google Ads API fetcher inside
-- ATLAS later, so nothing here is specific to Ads Scripts: the fetcher
-- writes the same rows through the same service functions, and
-- google_ads_fetch_log.source records which one did.
--
-- Fact grain (google_ads_daily): one row per account × day × level × item.
--   level 'campaign'    item = the campaign            (budget, channel type)
--         'ad_group'    item = the ad group
--         'keyword'     item = keyword text, match_type = its match type
--         'search_term' item = the search term, match_type = how it matched
--         'city'        item = geo target city name
-- Dimensions a level lacks are '' (not NULL) so the unique key holds.
-- Every metric column is additive across days except the two impression-
-- share ratios; the report weights those by impressions when it sums days.
--
-- Re-fetching a range is an upsert per row plus, after a successful run,
-- a delete of that range's rows the run did not touch (fetch_run_id <>
-- current) — same scheme as meta_ads_insights_daily (025).
--
-- Idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS google_ads_accounts (
    google_ads_account_id  SERIAL PRIMARY KEY,
    brand_id         INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id      TEXT    NOT NULL,          -- 10 digits, no dashes
    label            TEXT,                      -- what the team calls it ("KL", "JKT")
    account_name     TEXT,                      -- as Google reports it, filled by the first sync
    currency_code    TEXT,                      -- 'MYR', 'IDR', ... filled by the first sync
    time_zone        TEXT,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    backfill_from    DATE    NOT NULL,          -- earliest day the fetcher should hold
    -- A "Tarik ulang" from Pengaturan Brand: the fetcher picks it up on its
    -- next run and clears it when that range has been re-fetched.
    resync_from      DATE,
    resync_to        DATE,
    resync_requested_at TIMESTAMPTZ,
    last_synced_at   TIMESTAMPTZ,
    last_sync_status TEXT,
    last_sync_error  TEXT,
    created_by       INTEGER REFERENCES users(user_id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gaa_customer_id CHECK (customer_id ~ '^[0-9]{10}$'),
    -- One account feeds one brand; two brands sharing it would report its spend twice.
    CONSTRAINT ux_gaa_customer UNIQUE (customer_id)
);
CREATE INDEX IF NOT EXISTS ix_gaa_brand ON google_ads_accounts (brand_id);

CREATE TABLE IF NOT EXISTS google_ads_daily (
    google_ads_daily_id  BIGSERIAL PRIMARY KEY,
    brand_id         INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id      TEXT    NOT NULL,
    entry_date       DATE    NOT NULL,
    level            TEXT    NOT NULL,
    campaign_id      TEXT    NOT NULL DEFAULT '',
    campaign_name    TEXT    NOT NULL DEFAULT '',
    channel_type     TEXT    NOT NULL DEFAULT '',  -- SEARCH, VIDEO, PERFORMANCE_MAX, ...
    ad_group_id      TEXT    NOT NULL DEFAULT '',
    ad_group_name    TEXT    NOT NULL DEFAULT '',
    item             TEXT    NOT NULL DEFAULT '',  -- keyword / search term / city
    match_type       TEXT    NOT NULL DEFAULT '',
    budget_amount    NUMERIC,                      -- campaign daily budget, campaign rows only
    cost             NUMERIC NOT NULL DEFAULT 0,
    impressions      NUMERIC NOT NULL DEFAULT 0,
    clicks           NUMERIC NOT NULL DEFAULT 0,
    conversions      NUMERIC NOT NULL DEFAULT 0,
    conversions_value NUMERIC NOT NULL DEFAULT 0,
    all_conversions  NUMERIC NOT NULL DEFAULT 0,
    abs_top_impression_pct   NUMERIC,              -- keyword rows, 0..1
    search_lost_top_is_rank  NUMERIC,              -- keyword rows, 0..1
    fetch_run_id     TEXT    NOT NULL,
    fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gad_level CHECK (level IN ('campaign', 'ad_group', 'keyword', 'search_term', 'city')),
    CONSTRAINT ux_gad_grain UNIQUE (customer_id, entry_date, level, campaign_id, ad_group_id, item, match_type)
);
CREATE INDEX IF NOT EXISTS ix_gad_brand_level_date ON google_ads_daily (brand_id, level, entry_date);

-- One row per fetch of one account over one date range — drives the sync
-- status shown in Pengaturan Brand. A run that dies without reporting stays
-- 'running'; the UI treats an old one as failed.
CREATE TABLE IF NOT EXISTS google_ads_fetch_log (
    google_ads_fetch_log_id  SERIAL PRIMARY KEY,
    brand_id       INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id    TEXT    NOT NULL,
    start_date     DATE    NOT NULL,
    end_date       DATE    NOT NULL,
    source         TEXT    NOT NULL DEFAULT 'ads_script',
    fetch_run_id   TEXT    NOT NULL UNIQUE,
    status         TEXT    NOT NULL DEFAULT 'running',
    row_count      INTEGER NOT NULL DEFAULT 0,
    note           TEXT,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at    TIMESTAMPTZ,
    CONSTRAINT ck_gafl_source CHECK (source IN ('ads_script', 'api')),
    CONSTRAINT ck_gafl_status CHECK (status IN ('running', 'success', 'failed'))
);
CREATE INDEX IF NOT EXISTS ix_gafl_brand_started ON google_ads_fetch_log (brand_id, started_at DESC);
