-- =====================================================================
-- 032 — INTERNAL DASHBOARD: ATLAS Daily Tracking as the data source
--
-- User decision 2026-09-30: the Internal Dashboard's business + spend
-- numbers come from ATLAS's own Daily Tracking page (daily_channel_sales /
-- daily_channel_spend, migration 024), NOT from the client Google Sheets.
-- The monthly fact tables stay the single place S1–S8 read from; a sync
-- rolls the daily rows up into them.
--
--   - ingestion_source gains 'atlas_daily_tracking' (fact rows written by
--     that roll-up; `source` column from migration 030).
--   - data_ingestion_log.target_table gains 'daily_tracking_sync_run' — one
--     summary row per brand per sync run, like 'sheet_sync_run'.
--
-- Idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

ALTER TYPE ingestion_source ADD VALUE IF NOT EXISTS 'atlas_daily_tracking';

DO $$
BEGIN
  ALTER TABLE public.data_ingestion_log DROP CONSTRAINT IF EXISTS ck_dil_target_table;
  ALTER TABLE public.data_ingestion_log ADD CONSTRAINT ck_dil_target_table
    CHECK (target_table = ANY (ARRAY[
      'client_monthly_metrics'::text,
      'client_channel_sales_monthly'::text,
      'client_channel_sales_other'::text,
      'client_platform_spend_monthly'::text,
      'client_sales_channels'::text,
      'brand_ad_accounts'::text,
      'sheet_sync_run'::text,
      'daily_tracking_sync_run'::text
    ]));
END $$;
