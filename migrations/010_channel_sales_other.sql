-- =====================================================================
-- 010 — client_channel_sales_other: free-text sales channels
--
-- client_channel_sales_monthly (§2.4) only models the four canonical
-- channels (shopee / tiktok_shop / website / offline). Real client data
-- carries more — e.g. Petite Fleur's Jan 2026 breakdown has "chat"
-- (WhatsApp/DM orders — 63% of its channel sales) and "tokopedia". Those
-- are kept here verbatim rather than forced into a canonical bucket or
-- dropped. S6 rolls this table into total_channel_sales and lists each
-- label alongside the four canonical channels, sorted by value.
--
-- Idempotent / re-runnable, same as the other migrations.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS client_channel_sales_other (
    client_channel_sales_other_id  SERIAL PRIMARY KEY,
    brand_id       INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    period         DATE    NOT NULL,
    channel_label  TEXT    NOT NULL,          -- original wording, e.g. "chat", "tokopedia"
    sales_amount   NUMERIC(16,2) NOT NULL,
    created_by     INTEGER REFERENCES users(user_id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_client_channel_sales_other UNIQUE (brand_id, period, channel_label),
    CONSTRAINT ck_ccso_period_month CHECK (period = date_trunc('month', period)::date),
    CONSTRAINT ck_ccso_nonneg CHECK (sales_amount >= 0)
);

CREATE INDEX IF NOT EXISTS ix_ccso_brand_period ON client_channel_sales_other (brand_id, period);
CREATE INDEX IF NOT EXISTS ix_ccso_period       ON client_channel_sales_other (period);

-- trg_touch_updated_at() is defined in migration 009 (runs first).
DROP TRIGGER IF EXISTS trg_ccso_updated_at ON client_channel_sales_other;
CREATE TRIGGER trg_ccso_updated_at BEFORE UPDATE ON client_channel_sales_other
    FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();
