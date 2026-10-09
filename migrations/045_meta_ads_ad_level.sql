-- =====================================================================
-- 045 — Meta Ads auto-fetch at ad level
--
-- The auto-fetch now asks Meta for level=ad, so a stored row is one
-- brand × account type × day × campaign × ad set × ad × age × gender.
-- Ad set and ad are added to the grain; rows fetched before this migration
-- (campaign level) keep '' in both and stay where they are. A later fetch
-- of the same days replaces them: a successful run deletes every row in its
-- range it did not write (fetch_run_id <> current), old grain included, so
-- a day never holds both grains at once.
--
-- The per-brand optional metric picker is gone (every account type now
-- fetches one fixed metric set — backend/src/config/metaAdsMetrics.js);
-- meta_ads_fetch_config is left in place, unread, rather than dropped.
--
-- Idempotent / re-runnable, same as the other migrations.
-- =====================================================================

SET search_path TO public;

ALTER TABLE meta_ads_insights_daily ADD COLUMN IF NOT EXISTS adset_id   TEXT NOT NULL DEFAULT '';
ALTER TABLE meta_ads_insights_daily ADD COLUMN IF NOT EXISTS adset_name TEXT NOT NULL DEFAULT '';
ALTER TABLE meta_ads_insights_daily ADD COLUMN IF NOT EXISTS ad_id      TEXT NOT NULL DEFAULT '';
ALTER TABLE meta_ads_insights_daily ADD COLUMN IF NOT EXISTS ad_name    TEXT NOT NULL DEFAULT '';

ALTER TABLE meta_ads_insights_daily DROP CONSTRAINT IF EXISTS ux_maid_grain;
ALTER TABLE meta_ads_insights_daily DROP CONSTRAINT IF EXISTS ux_maid_grain_ad;
ALTER TABLE meta_ads_insights_daily
  ADD CONSTRAINT ux_maid_grain_ad UNIQUE (brand_id, account_type, entry_date, campaign_id, adset_id, ad_id, age, gender);
