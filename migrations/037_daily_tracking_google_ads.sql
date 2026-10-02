-- =====================================================================
-- 037 — Daily Tracking: Google Ads spend, filled from the Google Ads Script
--
-- "Google Ads" becomes a fixed spend channel (key google_ads — the key the
-- Internal Dashboard already maps to ad_platform 'google_ads'). After every
-- successful Google Ads Script run, ATLAS writes each day's total cost of
-- the brand's connected accounts into daily_channel_spend with
-- source 'google_ads_api', following the Meta rule: a row a person saved
-- (locked_manual) is never overwritten.
--
-- Brands that had added "Google Ads" themselves via "+ Tambah Channel
-- Baru" already store their rows under channel_key 'google_ads'; only the
-- custom-channel registration is dropped (a fixed channel has none), so
-- those rows simply show up under the fixed channel. They were entered by
-- hand, so they stay locked against the sync.
--
-- Idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

ALTER TABLE daily_channel_spend DROP CONSTRAINT IF EXISTS ck_dcp_source;
ALTER TABLE daily_channel_spend ADD CONSTRAINT ck_dcp_source
    CHECK (source IN ('manual', 'meta_api', 'google_ads_api'));

ALTER TABLE daily_tracking_ingestion_log DROP CONSTRAINT IF EXISTS ck_dtil_source;
ALTER TABLE daily_tracking_ingestion_log ADD CONSTRAINT ck_dtil_source
    CHECK (source IN ('manual', 'meta_api', 'google_ads_api'));

DELETE FROM daily_tracking_channels WHERE kind = 'spend' AND channel_key = 'google_ads';
