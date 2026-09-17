-- =====================================================================
-- 024 — Daily Tracking: daily-grain sales + ad spend entry, per brand
--
-- Digitizes the "2026 Daily Tracking" Google Sheet the team fills in by
-- hand today: one row per day, per-channel revenue/qty/transaksi for
-- sales, per-channel amount_spent for ads. Unlike client_monthly_metrics
-- (009), this is daily-grain (entry_date, not a month-truncated period),
-- and both internal staff AND client accounts write to it (Daily
-- Tracking is a deliberate exception to view-only accounts being
-- read-only elsewhere in the app).
--
-- Channel identity is deliberately TEXT, not an enum: the page lets
-- anyone add a custom channel ("+ Tambah Channel Baru") from the UI, and
-- an enum would need a migration for every new one. Fixed channels
-- (website/chat/shopee/tiktok/tokopedia/offline_store and
-- meta_boost_post/meta_nonboost_post/cpas_shopee/shopee_iklanku/
-- gmv_max/ttam) are app-level constants shared by the frontend and
-- backend and never get a daily_tracking_channels row; only channels
-- added via "+ Tambah Channel Baru" do (mirrors the
-- client_channel_sales_other / client_sales_channels free-text pattern
-- from 010/011, collapsed into one table since we don't need a separate
-- "which fixed channels apply" table here).
--
-- Idempotent / re-runnable, same as the other migrations.
-- =====================================================================

SET search_path TO public;

-- ---------------------------------------------------------------------
-- daily_tracking_channels — custom (user-added) channels only.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_tracking_channels (
    daily_tracking_channel_id  SERIAL PRIMARY KEY,
    brand_id     INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL,           -- 'sales' | 'spend'
    channel_key  TEXT    NOT NULL,           -- slug, e.g. 'blibli'
    label        TEXT    NOT NULL,           -- display name as typed, e.g. "Blibli"
    created_by   INTEGER REFERENCES users(user_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_dtc_brand_kind_key UNIQUE (brand_id, kind, channel_key),
    CONSTRAINT ck_dtc_kind CHECK (kind IN ('sales', 'spend'))
);
CREATE INDEX IF NOT EXISTS ix_dtc_brand_kind ON daily_tracking_channels (brand_id, kind);

-- ---------------------------------------------------------------------
-- daily_channel_sales — one row per (brand, day, channel).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_channel_sales (
    daily_channel_sale_id  SERIAL PRIMARY KEY,
    brand_id    INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    entry_date  DATE    NOT NULL,
    channel_key TEXT    NOT NULL,
    revenue     NUMERIC(16,2),
    qty_sold    INTEGER,
    transaksi   INTEGER,
    created_by  INTEGER REFERENCES users(user_id),
    updated_by  INTEGER REFERENCES users(user_id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_dcs_brand_date_channel UNIQUE (brand_id, entry_date, channel_key),
    CONSTRAINT ck_dcs_nonneg CHECK (
        (revenue   IS NULL OR revenue   >= 0) AND
        (qty_sold  IS NULL OR qty_sold  >= 0) AND
        (transaksi IS NULL OR transaksi >= 0)
    )
);
CREATE INDEX IF NOT EXISTS ix_dcs_brand_date ON daily_channel_sales (brand_id, entry_date);

-- trg_touch_updated_at() is defined in migration 009 (runs first).
DROP TRIGGER IF EXISTS trg_dcs_updated_at ON daily_channel_sales;
CREATE TRIGGER trg_dcs_updated_at BEFORE UPDATE ON daily_channel_sales
    FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- ---------------------------------------------------------------------
-- daily_channel_spend — one row per (brand, day, channel).
--
-- source/locked_manual/synced_at implement the "Meta auto-sync must
-- never clobber a staff correction" rule: a manual save (PUT
-- /api/daily-tracking/entries) always sets source='manual',
-- locked_manual=TRUE. The Meta-sync path (scheduled ingest + the manual
-- "Sync Meta Sekarang" button) upserts with
-- `... ON CONFLICT (...) DO UPDATE SET ... WHERE daily_channel_spend.locked_manual = FALSE`,
-- so Postgres itself skips any row a human has already touched.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_channel_spend (
    daily_channel_spend_id  SERIAL PRIMARY KEY,
    brand_id      INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    entry_date    DATE    NOT NULL,
    channel_key   TEXT    NOT NULL,
    amount_spent  NUMERIC(16,2),
    source        TEXT    NOT NULL DEFAULT 'manual',
    locked_manual BOOLEAN NOT NULL DEFAULT FALSE,
    synced_at     TIMESTAMPTZ,
    created_by    INTEGER REFERENCES users(user_id),
    updated_by    INTEGER REFERENCES users(user_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_dcp_brand_date_channel UNIQUE (brand_id, entry_date, channel_key),
    CONSTRAINT ck_dcp_source CHECK (source IN ('manual', 'meta_api')),
    CONSTRAINT ck_dcp_nonneg CHECK (amount_spent IS NULL OR amount_spent >= 0)
);
CREATE INDEX IF NOT EXISTS ix_dcp_brand_date ON daily_channel_spend (brand_id, entry_date);

DROP TRIGGER IF EXISTS trg_dcp_updated_at ON daily_channel_spend;
CREATE TRIGGER trg_dcp_updated_at BEFORE UPDATE ON daily_channel_spend
    FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

-- ---------------------------------------------------------------------
-- daily_tracking_ingestion_log — audit trail, daily-grain sibling of
-- data_ingestion_log (009 §2.7). target_table kept as TEXT + CHECK, not
-- an FK to a catalog, same reasoning as data_ingestion_log.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_tracking_ingestion_log (
    daily_tracking_ingestion_log_id  SERIAL PRIMARY KEY,
    brand_id      INTEGER REFERENCES brands(brand_id) ON DELETE SET NULL,
    target_table  TEXT NOT NULL,
    entry_date    DATE,
    source        TEXT NOT NULL,
    row_count     INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL,
    note          TEXT,
    pic           TEXT,
    performed_by  INTEGER REFERENCES users(user_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_dtil_target_table CHECK (target_table IN (
        'daily_channel_sales',
        'daily_channel_spend'
    )),
    CONSTRAINT ck_dtil_source CHECK (source IN ('manual', 'meta_api')),
    CONSTRAINT ck_dtil_status CHECK (status IN ('success', 'failed', 'partial'))
);
CREATE INDEX IF NOT EXISTS ix_dtil_brand_date ON daily_tracking_ingestion_log (brand_id, entry_date);
CREATE INDEX IF NOT EXISTS ix_dtil_created_at ON daily_tracking_ingestion_log (created_at DESC);
