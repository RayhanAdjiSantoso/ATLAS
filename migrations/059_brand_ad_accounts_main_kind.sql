-- =====================================================================
-- 059 — Which campaigns a MAIN Meta ad account holds
--
-- Brand Setting › Data Collection Hub › Meta Ads › Akun. A MAIN account is
-- one of:
--   MIXED     Boost Post and Non Boost Post campaigns together; the
--             account's Kata Kunci Boost Post splits them (as before)
--   BOOST     only Boost Post campaigns — every row is Boost Post
--   NONBOOST  only Non Boost Post campaigns — every row is Non Boost Post
-- A BOOST or NONBOOST account needs no keyword. CPAS accounts leave it
-- NULL. Mirrored from Meta Ads Automation like the other columns
-- (services/internalDashboardSync/metaAccountsMirror.js); a row from before
-- this column reads as MIXED.
--
-- Additive only; idempotent.
-- =====================================================================

SET search_path TO public;

ALTER TABLE brand_ad_accounts ADD COLUMN IF NOT EXISTS main_kind TEXT;

DO $$ BEGIN
    ALTER TABLE brand_ad_accounts ADD CONSTRAINT ck_baa_main_kind
        CHECK (main_kind IS NULL OR main_kind IN ('MIXED', 'BOOST', 'NONBOOST'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
