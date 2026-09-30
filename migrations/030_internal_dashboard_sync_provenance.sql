-- =====================================================================
-- 030 — INTERNAL DASHBOARD: Daily Tracking sync — provenance, source
-- capability, and run-level ingestion logging
--
-- The Sheets sync now reads two tabs per brand ("[NEW] Monthly Performance
-- Analysis" + "2026 Daily Tracking") and writes into the same fact tables
-- the manual forms use. To keep every stored number traceable:
--
--   1. sales_channel gains tokopedia / blibli / lazada — they are fixed
--      columns of the standard Daily Tracking template, not free text.
--      Chat stays in client_channel_sales_other (migration 010) on purpose.
--      Existing "other" rows for these three are moved by migration 031
--      (a new enum value cannot be used in the transaction that adds it).
--   2. Every fact row records where it came from (`source`, `source_ref`).
--      Policy (user decision 2026-09-30): the sync overwrites a manual row
--      for the same key, and the overwritten values are kept in
--      data_ingestion_log.details — `source` is what makes that visible.
--   3. `partial_month_reason` separates the sync's automatic
--      "current calendar month" flag from a hand-set partial flag, so the
--      automatic one can be cleared once the month is over without ever
--      clearing a manual one.
--   4. brand_sheet_sources records what each client sheet can actually
--      feed (capability), written by scripts/auditInternalDashboardSources.js.
--   5. data_ingestion_log gets run-level fields so one sync run is one
--      traceable event (started/finished, rows read/written/skipped,
--      warnings, details).
--
-- Idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

-- ---------------------------------------------------------------------
-- 1. Enum values
-- ---------------------------------------------------------------------
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'tokopedia';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'blibli';
ALTER TYPE sales_channel ADD VALUE IF NOT EXISTS 'lazada';

-- A run that wrote data but also skipped something (e.g. one month
-- rejected for duplicate dates) is neither 'success' nor 'failed'.
ALTER TYPE ingestion_status ADD VALUE IF NOT EXISTS 'partial';

-- ---------------------------------------------------------------------
-- 2. Provenance on every fact table
--   source      — which path wrote the row last (manual form / sheets)
--   source_ref  — human-readable pointer, e.g. "sheet:<id>#2026 Daily Tracking"
-- ---------------------------------------------------------------------
ALTER TABLE client_monthly_metrics        ADD COLUMN IF NOT EXISTS source ingestion_source NOT NULL DEFAULT 'manual_form';
ALTER TABLE client_monthly_metrics        ADD COLUMN IF NOT EXISTS source_ref TEXT;
ALTER TABLE client_channel_sales_monthly  ADD COLUMN IF NOT EXISTS source ingestion_source NOT NULL DEFAULT 'manual_form';
ALTER TABLE client_channel_sales_monthly  ADD COLUMN IF NOT EXISTS source_ref TEXT;
ALTER TABLE client_channel_sales_other    ADD COLUMN IF NOT EXISTS source ingestion_source NOT NULL DEFAULT 'manual_form';
ALTER TABLE client_channel_sales_other    ADD COLUMN IF NOT EXISTS source_ref TEXT;
ALTER TABLE client_platform_spend_monthly ADD COLUMN IF NOT EXISTS source ingestion_source NOT NULL DEFAULT 'manual_form';
ALTER TABLE client_platform_spend_monthly ADD COLUMN IF NOT EXISTS source_ref TEXT;

-- Backfill: rows whose most recent write in data_ingestion_log came from
-- the Sheets sync are marked google_sheets. Everything else keeps the
-- 'manual_form' default (manual form + one-shot bulk loads).
UPDATE client_monthly_metrics c SET source = 'google_sheets'
WHERE c.source = 'manual_form'
  AND (SELECT d.source FROM data_ingestion_log d
        WHERE d.brand_id = c.brand_id AND d.period = c.period
          AND d.target_table = 'client_monthly_metrics'
          AND d.method NOT LIKE 'delete%'
        ORDER BY d.created_at DESC LIMIT 1) = 'google_sheets';

UPDATE client_platform_spend_monthly c SET source = 'google_sheets'
WHERE c.source = 'manual_form'
  AND (SELECT d.source FROM data_ingestion_log d
        WHERE d.brand_id = c.brand_id AND d.period = c.period
          AND d.target_table = 'client_platform_spend_monthly'
          AND d.method LIKE '%(' || c.platform::text || ')'
          AND d.method NOT LIKE 'delete%'
        ORDER BY d.created_at DESC LIMIT 1) = 'google_sheets';

-- ---------------------------------------------------------------------
-- 3. Why a row is partial
--   'current_month' — set by the sync for the running calendar month;
--                     cleared by the sync once the month is over.
--   'manual'        — set by hand (Input Data "Bulan Parsial"); the sync
--                     never clears it.
--   NULL on a partial row = legacy hand-set flag (treated as manual).
-- ---------------------------------------------------------------------
ALTER TABLE client_monthly_metrics        ADD COLUMN IF NOT EXISTS partial_month_reason TEXT;
ALTER TABLE client_platform_spend_monthly ADD COLUMN IF NOT EXISTS partial_month_reason TEXT;

DO $$ BEGIN
    ALTER TABLE client_monthly_metrics ADD CONSTRAINT ck_cmm_partial_reason CHECK (
        partial_month_reason IS NULL
        OR (is_partial_month AND partial_month_reason IN ('current_month', 'manual'))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE client_platform_spend_monthly ADD CONSTRAINT ck_cps_partial_reason CHECK (
        partial_month_reason IS NULL
        OR (is_partial_month AND partial_month_reason IN ('current_month', 'manual'))
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 4. brand_sheet_sources — what the client sheet can feed
--   tab_name        (existing) = the "[NEW] Monthly Performance Analysis" tab
--   daily_tab_name  = the standard "2026 Daily Tracking" tab, NULL = none
--   capability      = result of the last schema check (audit script)
--   schema_version  = short signature of the daily header layout that was
--                     validated, so a changed template is detectable
-- ---------------------------------------------------------------------
ALTER TABLE brand_sheet_sources ADD COLUMN IF NOT EXISTS daily_tab_name       TEXT;
ALTER TABLE brand_sheet_sources ADD COLUMN IF NOT EXISTS capability           TEXT;
ALTER TABLE brand_sheet_sources ADD COLUMN IF NOT EXISTS schema_version       TEXT;
ALTER TABLE brand_sheet_sources ADD COLUMN IF NOT EXISTS last_schema_check_at TIMESTAMPTZ;
ALTER TABLE brand_sheet_sources ADD COLUMN IF NOT EXISTS last_schema_error    TEXT;

DO $$ BEGIN
    ALTER TABLE brand_sheet_sources ADD CONSTRAINT ck_bss_capability CHECK (capability IS NULL OR capability IN (
        'STANDARD_FULL', 'STANDARD_MONTHLY_ONLY', 'STANDARD_DAILY_ONLY',
        'CUSTOM', 'ACCESS_DENIED', 'MISSING_FILE', 'MISSING_REQUIRED_TAB', 'SCHEMA_MISMATCH'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 5. data_ingestion_log — run-level fields
--   One 'sheet_sync_run' row summarises a whole sync run for a brand; the
--   per-table rows it wrote carry the same run_id.
-- ---------------------------------------------------------------------
ALTER TABLE data_ingestion_log ADD COLUMN IF NOT EXISTS run_id        UUID;
ALTER TABLE data_ingestion_log ADD COLUMN IF NOT EXISTS started_at    TIMESTAMPTZ;
ALTER TABLE data_ingestion_log ADD COLUMN IF NOT EXISTS finished_at   TIMESTAMPTZ;
ALTER TABLE data_ingestion_log ADD COLUMN IF NOT EXISTS rows_read     INTEGER;
ALTER TABLE data_ingestion_log ADD COLUMN IF NOT EXISTS rows_written  INTEGER;
ALTER TABLE data_ingestion_log ADD COLUMN IF NOT EXISTS rows_skipped  INTEGER;
ALTER TABLE data_ingestion_log ADD COLUMN IF NOT EXISTS warning_count INTEGER;
ALTER TABLE data_ingestion_log ADD COLUMN IF NOT EXISTS details       JSONB;

CREATE INDEX IF NOT EXISTS ix_dil_run_id ON data_ingestion_log (run_id);

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
      'sheet_sync_run'::text
    ]));
END $$;
