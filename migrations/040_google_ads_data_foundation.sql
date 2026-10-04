-- =====================================================================
-- 040 — Google Ads data foundation: datasets beyond the five daily reports
--
-- The Google Ads Script (apps-script/GoogleAdsReport.js) keeps sending the
-- five daily reports of 035 ('core'). A script that declares more datasets
-- on GET /ingest/jobs?datasets=... is planned and sends, per job:
--
--   daily (one month of rows, replaced per run like google_ads_daily)
--     ads           google_ads_ads_daily          per ad × day
--     conversions   google_ads_conversion_daily   per campaign × conversion action × day
--     competitive   google_ads_competitive_metrics impression share, see below
--   snapshot (current configuration, sent once per account per execution)
--     campaign_settings   google_ads_campaign_settings  history: a row per distinct setting
--     conversion_actions  google_ads_conversion_actions current metadata
--     ad_assets           google_ads_ad_assets          current ad copy
--
-- Every table is a different view of the same spend: never add cost across
-- them. Account and campaign totals stay on google_ads_daily level 'campaign'.
--
-- Impression share is a ratio over an eligible-impression count Google does
-- not return, so a day's share cannot be summed into a month's. The script
-- stores both what Google reports for the job's whole range (granularity
-- 'range', exact) and per day (granularity 'day', campaign level only); the
-- report uses the range row when its period matches and otherwise labels a
-- daily-weighted value as an estimate.
--
-- google_ads_fetch_log records which datasets a run carried and how each
-- ended, so the planner re-plans a dataset that failed without re-fetching
-- the ones that worked. Runs from before this migration have datasets NULL,
-- read as 'core' only.
--
-- google_ads_conversion_goal_map is the brand's own reading of its
-- conversion actions (purchase / lead / micro / other / ignore). Without a
-- row the report derives one from Google's category and flags it as
-- needing verification.
--
-- Additive only: no existing column, key or row changes. Idempotent.
-- =====================================================================

SET search_path TO public;

ALTER TABLE google_ads_fetch_log ADD COLUMN IF NOT EXISTS datasets TEXT[];
ALTER TABLE google_ads_fetch_log ADD COLUMN IF NOT EXISTS dataset_results JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── daily: per ad ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_ads_daily (
    google_ads_ads_daily_id  BIGSERIAL PRIMARY KEY,
    brand_id          INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id       TEXT    NOT NULL,
    entry_date        DATE    NOT NULL,
    campaign_id       TEXT    NOT NULL,
    campaign_name     TEXT    NOT NULL DEFAULT '',
    channel_type      TEXT    NOT NULL DEFAULT '',
    ad_group_id       TEXT    NOT NULL,
    ad_group_name     TEXT    NOT NULL DEFAULT '',
    ad_id             TEXT    NOT NULL,
    ad_type           TEXT    NOT NULL DEFAULT '',
    ad_status         TEXT    NOT NULL DEFAULT '',
    cost              NUMERIC NOT NULL DEFAULT 0,
    impressions       NUMERIC NOT NULL DEFAULT 0,
    clicks            NUMERIC NOT NULL DEFAULT 0,
    conversions       NUMERIC NOT NULL DEFAULT 0,
    conversions_value NUMERIC NOT NULL DEFAULT 0,
    all_conversions   NUMERIC NOT NULL DEFAULT 0,
    source            TEXT    NOT NULL DEFAULT 'ads_script',
    fetch_run_id      TEXT    NOT NULL,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_gaad_grain UNIQUE (customer_id, entry_date, ad_group_id, ad_id)
);
CREATE INDEX IF NOT EXISTS ix_gaad_brand_date ON google_ads_ads_daily (brand_id, entry_date);
CREATE INDEX IF NOT EXISTS ix_gaad_customer_ad ON google_ads_ads_daily (customer_id, ad_group_id, ad_id);

-- ── daily: per conversion action ─────────────────────────────────────
-- Google only returns conversion metrics when segmenting by action: no cost,
-- clicks or impressions here. `conversions` counts the action only when it
-- is primary (included in the Conversions column); `all_conversions`
-- counts it either way — that is how primary and secondary stay apart.
CREATE TABLE IF NOT EXISTS google_ads_conversion_daily (
    google_ads_conversion_daily_id  BIGSERIAL PRIMARY KEY,
    brand_id              INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id           TEXT    NOT NULL,
    entry_date            DATE    NOT NULL,
    campaign_id           TEXT    NOT NULL,
    campaign_name         TEXT    NOT NULL DEFAULT '',
    conversion_action_id  TEXT    NOT NULL,
    conversion_action_name TEXT   NOT NULL DEFAULT '',
    conversion_category   TEXT    NOT NULL DEFAULT '',
    conversions           NUMERIC NOT NULL DEFAULT 0,
    conversions_value     NUMERIC NOT NULL DEFAULT 0,
    all_conversions       NUMERIC NOT NULL DEFAULT 0,
    all_conversions_value NUMERIC NOT NULL DEFAULT 0,
    source                TEXT    NOT NULL DEFAULT 'ads_script',
    fetch_run_id          TEXT    NOT NULL,
    fetched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_gacd_grain UNIQUE (customer_id, entry_date, campaign_id, conversion_action_id)
);
CREATE INDEX IF NOT EXISTS ix_gacd_brand_date ON google_ads_conversion_daily (brand_id, entry_date);

-- ── impression share ─────────────────────────────────────────────────
-- Shares are 0..1 as Google returns them; Google reports "< 10%" as 0.0999
-- and "> 90%" as 0.9001. NULL = Google gave no value (not 0). Budget-lost
-- shares exist at campaign level only. `impressions` is the row's own
-- impressions, used to weight daily values into an estimate.
CREATE TABLE IF NOT EXISTS google_ads_competitive_metrics (
    google_ads_competitive_metric_id  BIGSERIAL PRIMARY KEY,
    brand_id        INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id     TEXT    NOT NULL,
    level           TEXT    NOT NULL,
    granularity     TEXT    NOT NULL,
    start_date      DATE    NOT NULL,
    end_date        DATE    NOT NULL,
    campaign_id     TEXT    NOT NULL DEFAULT '',
    campaign_name   TEXT    NOT NULL DEFAULT '',
    ad_group_id     TEXT    NOT NULL DEFAULT '',
    ad_group_name   TEXT    NOT NULL DEFAULT '',
    criterion_id    TEXT    NOT NULL DEFAULT '',
    keyword         TEXT    NOT NULL DEFAULT '',
    match_type      TEXT    NOT NULL DEFAULT '',
    impressions     NUMERIC,
    search_impression_share        NUMERIC,
    search_budget_lost_is          NUMERIC,
    search_rank_lost_is            NUMERIC,
    search_top_is                  NUMERIC,
    search_abs_top_is              NUMERIC,
    search_budget_lost_top_is      NUMERIC,
    search_rank_lost_top_is        NUMERIC,
    search_budget_lost_abs_top_is  NUMERIC,
    search_rank_lost_abs_top_is    NUMERIC,
    source          TEXT    NOT NULL DEFAULT 'ads_script',
    fetch_run_id    TEXT    NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gacm_level CHECK (level IN ('campaign', 'ad_group', 'keyword')),
    CONSTRAINT ck_gacm_granularity CHECK (granularity IN ('day', 'range')),
    CONSTRAINT ux_gacm_grain UNIQUE (customer_id, level, granularity, start_date, end_date, campaign_id, ad_group_id, criterion_id)
);
CREATE INDEX IF NOT EXISTS ix_gacm_brand ON google_ads_competitive_metrics (brand_id, level, granularity, start_date);

-- ── snapshot: campaign settings (history) ────────────────────────────
-- A new row only when something in the setting changed (settings_hash);
-- otherwise the latest row's last_seen_at moves. NULL = not used by the
-- campaign (Maximize Conversions without a target has target_cpa NULL);
-- `unavailable` lists fields the fetcher could not read, so a NULL there is
-- "unknown", not "not set".
CREATE TABLE IF NOT EXISTS google_ads_campaign_settings (
    google_ads_campaign_setting_id  BIGSERIAL PRIMARY KEY,
    brand_id                 INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id              TEXT    NOT NULL,
    campaign_id              TEXT    NOT NULL,
    campaign_name            TEXT    NOT NULL DEFAULT '',
    status                   TEXT,
    channel_type             TEXT,
    channel_sub_type         TEXT,
    budget_id                TEXT,
    budget_name              TEXT,
    budget_amount            NUMERIC,
    budget_shared            BOOLEAN,
    budget_delivery_method   TEXT,
    bidding_strategy_type    TEXT,
    bidding_strategy_source  TEXT,          -- CAMPAIGN | PORTFOLIO
    bidding_strategy_name    TEXT,
    target_cpa               NUMERIC,       -- account currency
    target_roas              NUMERIC,       -- ratio, 3.5 = 350%
    target_impression_share  NUMERIC,       -- 0..1
    target_impression_share_location TEXT,
    target_is_cpc_ceiling    NUMERIC,
    conversion_goals         JSONB,         -- [{category, origin, biddable}]
    network_google_search    BOOLEAN,
    network_search_partners  BOOLEAN,
    network_display          BOOLEAN,
    locations_included       JSONB,         -- [name]
    locations_excluded       JSONB,
    positive_geo_target_type TEXT,          -- PRESENCE_OR_INTEREST | PRESENCE
    negative_geo_target_type TEXT,
    start_date               DATE,
    end_date                 DATE,
    unavailable              JSONB NOT NULL DEFAULT '[]'::jsonb,
    settings_hash            TEXT    NOT NULL,
    valid_from               TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    source                   TEXT    NOT NULL DEFAULT 'ads_script',
    fetch_run_id             TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_gacs_campaign ON google_ads_campaign_settings (customer_id, campaign_id, valid_from DESC);
CREATE INDEX IF NOT EXISTS ix_gacs_brand ON google_ads_campaign_settings (brand_id, valid_from);

-- ── snapshot: conversion actions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_conversion_actions (
    google_ads_conversion_action_pk  SERIAL PRIMARY KEY,
    brand_id                INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id             TEXT    NOT NULL,
    conversion_action_id    TEXT    NOT NULL,
    name                    TEXT    NOT NULL DEFAULT '',
    category                TEXT,
    status                  TEXT,
    type                    TEXT,
    origin                  TEXT,
    primary_for_goal        BOOLEAN,
    include_in_conversions  BOOLEAN,
    counting_type           TEXT,
    attribution_model       TEXT,
    click_through_window_days INTEGER,
    view_through_window_days  INTEGER,
    unavailable             JSONB NOT NULL DEFAULT '[]'::jsonb,
    source                  TEXT    NOT NULL DEFAULT 'ads_script',
    first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_gaca_action UNIQUE (customer_id, conversion_action_id)
);
CREATE INDEX IF NOT EXISTS ix_gaca_brand ON google_ads_conversion_actions (brand_id);

-- ── snapshot: ad copy ────────────────────────────────────────────────
-- Google gives an edited ad a new ad ID, so one row per ad is its history;
-- content_hash/content_changed_at catch the edits that keep the ID.
CREATE TABLE IF NOT EXISTS google_ads_ad_assets (
    google_ads_ad_asset_id  BIGSERIAL PRIMARY KEY,
    brand_id         INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id      TEXT    NOT NULL,
    campaign_id      TEXT    NOT NULL DEFAULT '',
    campaign_name    TEXT    NOT NULL DEFAULT '',
    ad_group_id      TEXT    NOT NULL,
    ad_group_name    TEXT    NOT NULL DEFAULT '',
    ad_id            TEXT    NOT NULL,
    ad_type          TEXT,
    ad_status        TEXT,
    ad_strength      TEXT,
    final_urls       JSONB   NOT NULL DEFAULT '[]'::jsonb,
    headlines        JSONB   NOT NULL DEFAULT '[]'::jsonb,   -- [{text, pinned, label}]
    descriptions     JSONB   NOT NULL DEFAULT '[]'::jsonb,
    path1            TEXT,
    path2            TEXT,
    unavailable      JSONB   NOT NULL DEFAULT '[]'::jsonb,
    content_hash     TEXT    NOT NULL,
    content_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source           TEXT    NOT NULL DEFAULT 'ads_script',
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_gaas_ad UNIQUE (customer_id, ad_group_id, ad_id)
);
CREATE INDEX IF NOT EXISTS ix_gaas_brand ON google_ads_ad_assets (brand_id);

-- ── brand's reading of its conversion actions ────────────────────────
CREATE TABLE IF NOT EXISTS google_ads_conversion_goal_map (
    google_ads_conversion_goal_map_id  SERIAL PRIMARY KEY,
    brand_id              INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id           TEXT    NOT NULL,
    conversion_action_id  TEXT    NOT NULL,
    goal                  TEXT    NOT NULL,
    updated_by            INTEGER REFERENCES users(user_id),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gacgm_goal CHECK (goal IN ('purchase', 'lead', 'micro', 'other', 'ignore')),
    CONSTRAINT ux_gacgm_action UNIQUE (customer_id, conversion_action_id)
);
CREATE INDEX IF NOT EXISTS ix_gacgm_brand ON google_ads_conversion_goal_map (brand_id);
