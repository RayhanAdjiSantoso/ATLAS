-- =====================================================================
-- 061 — Meta ad preview links
--
-- One row per ad of a brand: Meta's `preview_shareable_link` (an fb.me
-- link that opens the ad's preview, the same as Ads Manager's "Share a
-- link"). Written by the Meta Ads auto-fetch (apps-script/MetaAdsMonthly.gs,
-- POST /meta-ads-insights/ingest/ads) for the ads a run saw, and carried
-- into the generated workbook as an "Ad preview link" column, which the
-- Report Generator's per-materi-iklan tables link to.
--
-- Kept beside meta_ads_insights_daily rather than in it: the link belongs
-- to the ad, not to each day × age × gender row.
--
-- Additive only; idempotent.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS meta_ad_previews (
    brand_id      INTEGER     NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    ad_id         TEXT        NOT NULL,
    preview_link  TEXT        NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (brand_id, ad_id)
);
