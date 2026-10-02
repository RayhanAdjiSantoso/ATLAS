-- =====================================================================
-- 038 — Meta Ads auto-fetch: daily runs over a date range
--
-- The auto-fetch used to pull one whole month on the 1st. It now runs every
-- day over a window inside one month (the last 7 days up to yesterday, or the
-- whole previous month on the 1st), so a run's stale-row cleanup must be
-- limited to the days that run actually fetched — not the whole month.
--
-- `month` stays the first day of the run's month (the UI lists runs per
-- month); range_start/range_end are the exact days fetched. NULL on runs
-- logged before this migration, which always covered the whole month.
--
-- Idempotent / re-runnable, same as the other migrations.
-- =====================================================================

SET search_path TO public;

ALTER TABLE meta_ads_fetch_log ADD COLUMN IF NOT EXISTS range_start DATE;
ALTER TABLE meta_ads_fetch_log ADD COLUMN IF NOT EXISTS range_end   DATE;
