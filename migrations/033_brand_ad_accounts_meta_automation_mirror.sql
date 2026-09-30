-- =====================================================================
-- 033 — brand_ad_accounts becomes a mirror of Meta Ads Automation
--
-- User decision 2026-09-30: a brand's Meta ad accounts are entered ONLY in
-- Pengaturan Brand -> "Meta Ads Automation" (no separate Internal Dashboard
-- form). That registration lives in the Meta Automation Apps Script's
-- Script Properties (+ its hard-coded CONFIG.ACCOUNTS) — not in Postgres
-- and not in a spreadsheet. brand_ad_accounts holds a copy, refreshed by
-- ATLAS every time a brand is saved/deleted there
-- (services/internalDashboardSync/metaAccountsMirror.js), so the Internal
-- Dashboard never has to call Apps Script at read time.
--
--   account_type   'MAIN' | 'CPAS' (as registered)
--   boost_keyword  "Kata Kunci Boost Post" — a MAIN-account campaign whose
--                  lower-cased name contains it counts as Boost Post, same
--                  rule the Apps Script uses for Daily Tracking spend
--   synced_at      when this copy was last refreshed
--
-- Idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

ALTER TABLE brand_ad_accounts ADD COLUMN IF NOT EXISTS account_type  TEXT;
ALTER TABLE brand_ad_accounts ADD COLUMN IF NOT EXISTS boost_keyword TEXT;
ALTER TABLE brand_ad_accounts ADD COLUMN IF NOT EXISTS synced_at     TIMESTAMPTZ;

DO $$ BEGIN
    ALTER TABLE brand_ad_accounts ADD CONSTRAINT ck_baa_account_type
        CHECK (account_type IS NULL OR account_type IN ('MAIN', 'CPAS'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
