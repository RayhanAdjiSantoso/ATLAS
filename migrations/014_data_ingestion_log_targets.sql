-- =====================================================================
-- 014 — data_ingestion_log.target_table: allow the two brand-level config
-- tables that now have a manual input form (Internal Dashboard "Input
-- Data" tab):
--   client_sales_channels (§2.2) — per-channel used/not-used toggle
--   brand_ad_accounts             — Meta ad-account list per client
--
-- Both were previously fillable only by one-shot migration scripts, so
-- their writes never logged. The form logs like the other three sub-tabs.
--
-- Idempotent / re-runnable — drops the CHECK if present and re-adds it.
-- =====================================================================

SET search_path TO public;

DO $$
BEGIN
  ALTER TABLE public.data_ingestion_log DROP CONSTRAINT IF EXISTS ck_dil_target_table;
  ALTER TABLE public.data_ingestion_log ADD CONSTRAINT ck_dil_target_table
    CHECK (target_table = ANY (ARRAY[
      'client_monthly_metrics'::text,
      'client_channel_sales_monthly'::text,
      'client_platform_spend_monthly'::text,
      'client_sales_channels'::text,
      'brand_ad_accounts'::text
    ]));
END $$;
