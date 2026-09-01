-- =====================================================================
-- 009 — INTERNAL DASHBOARD: monthly manual-input fact tables + ingestion log
--   (see technical breakdown §2.3–§2.7)
--
-- Backs the 3 independent manual-input sub-tabs of the Internal Dashboard
-- (technical breakdown §2.3 / §2.4 / §2.5) plus the ingestion audit log
-- (§2.7). Each sub-tab submits on its own to its own table and writes its
-- own data_ingestion_log row — ingestion is staggered (different sources,
-- different times), never one atomic 3-in-1 submit.
--
-- NOT in this migration (deliberately, built later with S6/S8):
--   - client_sales_channels (§2.2) — which channels a client actually runs
--   - anything meta_api / upload_export ingestion related
--
-- Idempotent / re-runnable: scripts/migrate.js re-applies every file on
-- every run, with no per-file tracking.
-- =====================================================================

SET search_path TO public;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE sales_channel AS ENUM ('shopee', 'tiktok_shop', 'website', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    -- §2.5 platform set. Same 6 values the migrateClientInfo.js Display Ads
    -- parser targets.
    CREATE TYPE ad_platform AS ENUM (
        'meta_nonboost', 'meta_boost', 'meta_cpas',
        'iklanku_shopee', 'gmv_max_tiktok', 'google_ads'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE ingestion_source AS ENUM ('manual_form', 'meta_api', 'google_sheets', 'upload_export');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE ingestion_status AS ENUM ('success', 'failed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- Shared updated_at trigger fn (generic — attached to every table below)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- §2.3  client_monthly_metrics — DS#1, the top-line fact table
--   `period` is the first day of the month (YYYY-MM-01); the CHECK keeps
--   it month-aligned so range queries (S2/S7 13-month trends) are clean.
--   Column named brand_id (not client_id) — ATLAS keys everything off
--   public.brands (breakdown §5: extend brands, no parallel `clients`).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_monthly_metrics (
    client_monthly_metric_id  SERIAL PRIMARY KEY,
    brand_id      INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    period        DATE    NOT NULL,
    revenue       NUMERIC(16,2) NOT NULL,
    transaksi     INTEGER,            -- nullable: not every client reports order count
    qty_sold      INTEGER,            -- nullable
    target_sales  NUMERIC(16,2),      -- nullable (§2.3)
    created_by    INTEGER REFERENCES users(user_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_client_monthly_metrics UNIQUE (brand_id, period),
    CONSTRAINT ck_cmm_period_month CHECK (period = date_trunc('month', period)::date),
    CONSTRAINT ck_cmm_nonneg CHECK (
        revenue >= 0
        AND (transaksi    IS NULL OR transaksi    >= 0)
        AND (qty_sold     IS NULL OR qty_sold     >= 0)
        AND (target_sales IS NULL OR target_sales >= 0)
    )
);
CREATE INDEX IF NOT EXISTS ix_cmm_brand_period ON client_monthly_metrics (brand_id, period);
CREATE INDEX IF NOT EXISTS ix_cmm_period       ON client_monthly_metrics (period);

DROP TRIGGER IF EXISTS trg_cmm_updated_at ON client_monthly_metrics;
CREATE TRIGGER trg_cmm_updated_at BEFORE UPDATE ON client_monthly_metrics
    FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- ---------------------------------------------------------------------
-- §2.4  client_channel_sales_monthly — sales split by channel
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_channel_sales_monthly (
    client_channel_sales_id  SERIAL PRIMARY KEY,
    brand_id    INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    period      DATE          NOT NULL,
    channel     sales_channel NOT NULL,
    sales       NUMERIC(16,2) NOT NULL,
    created_by  INTEGER REFERENCES users(user_id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_client_channel_sales UNIQUE (brand_id, period, channel),
    CONSTRAINT ck_ccs_period_month CHECK (period = date_trunc('month', period)::date),
    CONSTRAINT ck_ccs_nonneg CHECK (sales >= 0)
);
CREATE INDEX IF NOT EXISTS ix_ccs_brand_period ON client_channel_sales_monthly (brand_id, period);
CREATE INDEX IF NOT EXISTS ix_ccs_period       ON client_channel_sales_monthly (period);

DROP TRIGGER IF EXISTS trg_ccs_updated_at ON client_channel_sales_monthly;
CREATE TRIGGER trg_ccs_updated_at BEFORE UPDATE ON client_channel_sales_monthly
    FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- ---------------------------------------------------------------------
-- §2.5  client_platform_spend_monthly — ad spend + funnel per platform
--
--   REQUIRED (NOT NULL): raw, summable counters only —
--     amount_spent, impressions, link_clicks, purchase, purchase_value
--   OPTIONAL raw:
--     reach, frequency, view_content, atc, lpv, ig_profile_visit
--       (ig_profile_visit is shown with a "PROXY" label in the UI, and
--        link_clicks is used as its proxy in rollups — breakdown §4)
--   OPTIONAL stored ratios (cpm, cpc, ctr, cost_per_vc, cost_per_atc,
--     cost_per_purchase, roas):
--       *** DISPLAY-ONLY, single-month cross-check against Ads Manager. ***
--       Every multi-period rollup (S1/S2/S3/S7) MUST recompute ratios from
--       the raw NOT NULL columns above (sum components first, then divide)
--       and MUST NEVER SUM/AVG these stored ratio columns. This is the
--       explicit guard against the old BI dashboard's "ROAS 118x" bug
--       (ratios averaged across months where spend input had stopped).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_platform_spend_monthly (
    client_platform_spend_id  SERIAL PRIMARY KEY,
    brand_id      INTEGER     NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    period        DATE        NOT NULL,
    platform      ad_platform NOT NULL,

    -- required (raw / summable)
    amount_spent   NUMERIC(16,2) NOT NULL,
    impressions    BIGINT        NOT NULL,
    link_clicks    BIGINT        NOT NULL,
    purchase       INTEGER       NOT NULL,
    purchase_value NUMERIC(16,2) NOT NULL,

    -- optional (raw / summable)
    reach             BIGINT,
    frequency         NUMERIC(10,4),
    view_content      INTEGER,
    atc               INTEGER,
    lpv               INTEGER,
    ig_profile_visit  INTEGER,

    -- optional (stored ratios — DISPLAY-ONLY, never aggregated; see block above)
    cpm               NUMERIC(14,4),
    cpc               NUMERIC(14,4),
    ctr               NUMERIC(9,6),
    cost_per_vc       NUMERIC(14,4),
    cost_per_atc      NUMERIC(14,4),
    cost_per_purchase NUMERIC(14,4),
    roas              NUMERIC(12,4),

    created_by  INTEGER REFERENCES users(user_id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ux_client_platform_spend UNIQUE (brand_id, period, platform),
    CONSTRAINT ck_cps_period_month CHECK (period = date_trunc('month', period)::date),
    CONSTRAINT ck_cps_required_nonneg CHECK (
        amount_spent >= 0 AND impressions >= 0 AND link_clicks >= 0
        AND purchase >= 0 AND purchase_value >= 0
    ),
    CONSTRAINT ck_cps_optional_nonneg CHECK (
        (reach            IS NULL OR reach            >= 0) AND
        (frequency        IS NULL OR frequency        >= 0) AND
        (view_content     IS NULL OR view_content     >= 0) AND
        (atc              IS NULL OR atc              >= 0) AND
        (lpv              IS NULL OR lpv              >= 0) AND
        (ig_profile_visit IS NULL OR ig_profile_visit >= 0)
    )
);
CREATE INDEX IF NOT EXISTS ix_cps_brand_period ON client_platform_spend_monthly (brand_id, period);
CREATE INDEX IF NOT EXISTS ix_cps_period       ON client_platform_spend_monthly (period);
CREATE INDEX IF NOT EXISTS ix_cps_platform     ON client_platform_spend_monthly (platform);

DROP TRIGGER IF EXISTS trg_cps_updated_at ON client_platform_spend_monthly;
CREATE TRIGGER trg_cps_updated_at BEFORE UPDATE ON client_platform_spend_monthly
    FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- ---------------------------------------------------------------------
-- §2.7  data_ingestion_log — one row per ingestion event (per sub-tab
--   submit, per edit). Survives brand deletion for audit (brand_id
--   ON DELETE SET NULL).
--   target_table: kept as TEXT + CHECK (not an enum) so migrate.js can
--   re-run safely and a future target can be added by editing the CHECK.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_ingestion_log (
    data_ingestion_log_id  SERIAL PRIMARY KEY,
    brand_id      INTEGER REFERENCES brands(brand_id) ON DELETE SET NULL,
    target_table  TEXT NOT NULL,
    period        DATE,
    source        ingestion_source NOT NULL DEFAULT 'manual_form',
    method        TEXT,
    row_count     INTEGER NOT NULL DEFAULT 0,
    status        ingestion_status NOT NULL,
    note          TEXT,
    pic           TEXT,                               -- §2.7; may differ from the logged-in user
    performed_by  INTEGER REFERENCES users(user_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(), -- = §2.7 "timestamp"
    CONSTRAINT ck_dil_target_table CHECK (target_table IN (
        'client_monthly_metrics',
        'client_channel_sales_monthly',
        'client_platform_spend_monthly'
    )),
    CONSTRAINT ck_dil_period_month CHECK (period IS NULL OR period = date_trunc('month', period)::date)
);
CREATE INDEX IF NOT EXISTS ix_dil_brand_period ON data_ingestion_log (brand_id, period);
CREATE INDEX IF NOT EXISTS ix_dil_created_at   ON data_ingestion_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_dil_status       ON data_ingestion_log (status);
