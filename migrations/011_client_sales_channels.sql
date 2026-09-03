-- =====================================================================
-- 011 — client_sales_channels (§2.2): which of the 4 canonical channels
-- a client actually uses. Feeds S8's "Matriks Kelengkapan Data" so an
-- empty cell can mean "channel not used" rather than "data missing", and
-- S6's channel coverage.
--
-- One row per (brand, channel). is_used is 3-valued in effect: TRUE /
-- FALSE / row-absent (= not yet assessed). `source` records where the
-- value came from so S8 can weigh confidence:
--   'enabled_website_col' — the clean "Enabled Website" boolean (website)
--   'display_ads_parse'   — derived from the free-text Display/Marketplace
--                           Ads columns (positive = token present;
--                           negative = client listed its channels and this
--                           one was not among them)
--   'manual'              — hand-entered later
--
-- Populated by backend/scripts/migrateClientInfo.js --channels (reviewed
-- before commit, same as the other one-shot loads).
--
-- Idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS client_sales_channels (
    client_sales_channel_id  SERIAL PRIMARY KEY,
    brand_id     INTEGER       NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    channel      sales_channel NOT NULL,          -- enum from migration 009
    is_used      BOOLEAN       NOT NULL,
    source       TEXT,
    note         TEXT,
    created_by   INTEGER REFERENCES users(user_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_client_sales_channels UNIQUE (brand_id, channel)
);

CREATE INDEX IF NOT EXISTS ix_csc_brand   ON client_sales_channels (brand_id);
CREATE INDEX IF NOT EXISTS ix_csc_channel ON client_sales_channels (channel);

-- trg_touch_updated_at() is defined in migration 009 (runs first).
DROP TRIGGER IF EXISTS trg_csc_updated_at ON client_sales_channels;
CREATE TRIGGER trg_csc_updated_at BEFORE UPDATE ON client_sales_channels
    FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
