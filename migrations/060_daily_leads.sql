-- =====================================================================
-- 060 — Daily leads (Brand Tracking › Input Daily Tracking › Leads Data)
--
-- A non-retail brand sells through chats, not a checkout: the day's
-- results are leads, not orders. One row per brand per day:
--   cold_leads  chats started that day (the sheets' "Cold Leads", every
--               region added up) — read as "Message Started"
--   deals       leads that closed that day ("Deal Leads")
--   deal_value  what those deals were worth (Rp) — entered by hand; the
--               sheets do not carry it
-- Report Generator › Meta › Non-Boost Post (Non Retail) roots its Root
-- Cause Analysis in these: Orders = deals, Message Started = cold_leads,
-- GMV = deal_value.
--
-- Additive only; idempotent.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS daily_leads (
    brand_id    INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    entry_date  DATE    NOT NULL,
    cold_leads  INTEGER,
    deals       INTEGER,
    deal_value  NUMERIC(16,2),
    created_by  INTEGER REFERENCES users(user_id),
    updated_by  INTEGER REFERENCES users(user_id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (brand_id, entry_date),
    CONSTRAINT ck_dl_nonneg CHECK (
        (cold_leads IS NULL OR cold_leads >= 0) AND
        (deals      IS NULL OR deals      >= 0) AND
        (deal_value IS NULL OR deal_value >= 0)
    )
);

DO $$ BEGIN
  ALTER TABLE public.daily_tracking_ingestion_log DROP CONSTRAINT IF EXISTS ck_dtil_target_table;
  ALTER TABLE public.daily_tracking_ingestion_log ADD CONSTRAINT ck_dtil_target_table
    CHECK (target_table IN ('daily_channel_sales', 'daily_channel_spend', 'daily_tracking_channels', 'daily_leads'));
  -- A leads column left out of a file import is remembered like a channel's.
  ALTER TABLE public.daily_tracking_import_ignored DROP CONSTRAINT IF EXISTS ck_dtii_kind;
  ALTER TABLE public.daily_tracking_import_ignored ADD CONSTRAINT ck_dtii_kind
    CHECK (kind IN ('sales', 'spend', 'leads'));
END $$;
