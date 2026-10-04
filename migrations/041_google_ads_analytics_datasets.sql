-- =====================================================================
-- 041 — Google Ads: Quality Score, device, hour and landing page datasets
--
-- Same scheme as 040 (see googleAdsDatasets.js): daily datasets replace the
-- run's range when they finish well, snapshots are kept.
--
--   devices        google_ads_device_daily         campaign × day × device
--   hourly         google_ads_hourly               campaign × day × hour (account time zone)
--   landing_pages  google_ads_landing_pages_daily  landing page × day (× campaign when Google allows)
--   keyword_quality google_ads_keyword_quality     snapshot per keyword per day
--
-- Like every other table here these are views of the same spend: never add
-- their cost to google_ads_daily's.
--
-- Quality Score and its components are diagnostics, not metrics: they are
-- never summed, NULL means Google has no score (shown as N/A, not 0), and a
-- row per day keeps their history.
--
-- Landing page metrics depend on what Google lets the fetcher select; a
-- metric it refused is NULL in every row and named in `unavailable`, never
-- estimated.
--
-- Additive only. Idempotent.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS google_ads_device_daily (
    google_ads_device_daily_id  BIGSERIAL PRIMARY KEY,
    brand_id          INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id       TEXT    NOT NULL,
    entry_date        DATE    NOT NULL,
    campaign_id       TEXT    NOT NULL,
    campaign_name     TEXT    NOT NULL DEFAULT '',
    channel_type      TEXT    NOT NULL DEFAULT '',
    device            TEXT    NOT NULL,          -- MOBILE, DESKTOP, TABLET, CONNECTED_TV, OTHER
    cost              NUMERIC NOT NULL DEFAULT 0,
    impressions       NUMERIC NOT NULL DEFAULT 0,
    clicks            NUMERIC NOT NULL DEFAULT 0,
    conversions       NUMERIC NOT NULL DEFAULT 0,
    conversions_value NUMERIC NOT NULL DEFAULT 0,
    all_conversions   NUMERIC NOT NULL DEFAULT 0,
    source            TEXT    NOT NULL DEFAULT 'ads_script',
    fetch_run_id      TEXT    NOT NULL,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_gadd_grain UNIQUE (customer_id, entry_date, campaign_id, device)
);
CREATE INDEX IF NOT EXISTS ix_gadd_brand_date ON google_ads_device_daily (brand_id, entry_date);

-- entry_date and hour are the account's own time zone, as Google reports them.
CREATE TABLE IF NOT EXISTS google_ads_hourly (
    google_ads_hourly_id  BIGSERIAL PRIMARY KEY,
    brand_id          INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id       TEXT    NOT NULL,
    entry_date        DATE    NOT NULL,
    hour              SMALLINT NOT NULL,
    campaign_id       TEXT    NOT NULL,
    campaign_name     TEXT    NOT NULL DEFAULT '',
    cost              NUMERIC NOT NULL DEFAULT 0,
    impressions       NUMERIC NOT NULL DEFAULT 0,
    clicks            NUMERIC NOT NULL DEFAULT 0,
    conversions       NUMERIC NOT NULL DEFAULT 0,
    conversions_value NUMERIC NOT NULL DEFAULT 0,
    source            TEXT    NOT NULL DEFAULT 'ads_script',
    fetch_run_id      TEXT    NOT NULL,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gah_hour CHECK (hour BETWEEN 0 AND 23),
    CONSTRAINT ux_gah_grain UNIQUE (customer_id, entry_date, campaign_id, hour)
);
CREATE INDEX IF NOT EXISTS ix_gah_brand_date ON google_ads_hourly (brand_id, entry_date);

-- campaign_id '' when Google would not segment landing pages by campaign.
CREATE TABLE IF NOT EXISTS google_ads_landing_pages_daily (
    google_ads_landing_page_daily_id  BIGSERIAL PRIMARY KEY,
    brand_id          INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id       TEXT    NOT NULL,
    entry_date        DATE    NOT NULL,
    campaign_id       TEXT    NOT NULL DEFAULT '',
    campaign_name     TEXT    NOT NULL DEFAULT '',
    url               TEXT    NOT NULL,
    clicks            NUMERIC,
    impressions       NUMERIC,
    cost              NUMERIC,
    conversions       NUMERIC,
    conversions_value NUMERIC,
    speed_score       NUMERIC,                   -- 1..10, Google's mobile speed score
    mobile_friendly_clicks_pct NUMERIC,          -- 0..1
    unavailable       JSONB   NOT NULL DEFAULT '[]'::jsonb,
    source            TEXT    NOT NULL DEFAULT 'ads_script',
    fetch_run_id      TEXT    NOT NULL,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_galp_grain UNIQUE (customer_id, entry_date, campaign_id, url)
);
CREATE INDEX IF NOT EXISTS ix_galp_brand_date ON google_ads_landing_pages_daily (brand_id, entry_date);

-- Components as Google rates them: BELOW_AVERAGE, AVERAGE, ABOVE_AVERAGE.
CREATE TABLE IF NOT EXISTS google_ads_keyword_quality (
    google_ads_keyword_quality_id  BIGSERIAL PRIMARY KEY,
    brand_id          INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    customer_id       TEXT    NOT NULL,
    snapshot_date     DATE    NOT NULL,
    campaign_id       TEXT    NOT NULL DEFAULT '',
    campaign_name     TEXT    NOT NULL DEFAULT '',
    ad_group_id       TEXT    NOT NULL,
    ad_group_name     TEXT    NOT NULL DEFAULT '',
    criterion_id      TEXT    NOT NULL,
    keyword           TEXT    NOT NULL DEFAULT '',
    match_type        TEXT    NOT NULL DEFAULT '',
    status            TEXT,
    quality_score     SMALLINT,
    expected_ctr      TEXT,
    ad_relevance      TEXT,
    landing_page_experience TEXT,
    source            TEXT    NOT NULL DEFAULT 'ads_script',
    fetch_run_id      TEXT    NOT NULL,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_gakq_score CHECK (quality_score IS NULL OR quality_score BETWEEN 1 AND 10),
    CONSTRAINT ux_gakq_grain UNIQUE (customer_id, snapshot_date, ad_group_id, criterion_id)
);
CREATE INDEX IF NOT EXISTS ix_gakq_brand_date ON google_ads_keyword_quality (brand_id, snapshot_date);
CREATE INDEX IF NOT EXISTS ix_gakq_keyword ON google_ads_keyword_quality (customer_id, ad_group_id, criterion_id, snapshot_date DESC);
