-- =====================================================================
-- 023 — extend ad_platform with cpas_tokopedia + ttam_tiktok
--
-- The 6-value ad_platform enum (migration 009) mapped 1:1 onto the
-- Display Ads free-text categories known at the time. The live Google
-- Sheets integration's per-client "[NEW] Monthly Performance Analysis"
-- tab has 7 distinct platform blocks (Main Account Boost + Non-boost,
-- CPAS Shopee, Iklan Shopee, CPAS Tokopedia, TTAM, GMV Max) — "CPAS
-- Tokopedia" and "TTAM" (TikTok Tokopedia Ads Manager) had no matching
-- enum value; forcing CPAS Tokopedia onto the existing meta_cpas value
-- would collide with CPAS Shopee under the (brand_id, period, platform)
-- unique constraint on client_platform_spend_monthly.
--
-- Idempotent / re-runnable: scripts/migrate.js re-applies every file on
-- every run, with no per-file tracking. ADD VALUE IF NOT EXISTS handles
-- that directly; no DO $$ EXCEPTION wrapper needed for this statement.
-- =====================================================================

SET search_path TO public;

ALTER TYPE ad_platform ADD VALUE IF NOT EXISTS 'cpas_tokopedia';
ALTER TYPE ad_platform ADD VALUE IF NOT EXISTS 'ttam_tiktok';
