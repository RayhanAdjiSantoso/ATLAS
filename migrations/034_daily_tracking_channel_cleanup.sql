-- =====================================================================
-- 034 — Daily Tracking: channel aliases + remembered import choices
--
-- 1. "CPAS Tokped" and "TikTok GMV" were imported as custom spend channels
--    although they are CPAS Tokopedia and GMV Max — two pills for one
--    metric. CPAS Tokopedia becomes a fixed spend channel (app config,
--    config/dailyTrackingChannels.js) and both aliases are read as the
--    standard channel from now on. Existing rows move to the standard key;
--    a row is only moved when the standard key has no row for that date
--    (never overwrites). The alias pill is removed once it holds no data.
--
-- 2. daily_tracking_import_ignored — columns a user chose NOT to import
--    from a Daily Tracking file, remembered per brand so the next upload
--    can say "sebelumnya diabaikan" and leave them unticked.
--
-- Idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

-- ---------------------------------------------------------------------
-- 1. Alias channel keys -> standard keys
-- ---------------------------------------------------------------------
DO $$
DECLARE
    pair RECORD;
BEGIN
    FOR pair IN SELECT * FROM (VALUES ('cpas_tokped', 'cpas_tokopedia'), ('tiktok_gmv', 'gmv_max')) AS t(alias, standard)
    LOOP
        UPDATE daily_channel_spend a
           SET channel_key = pair.standard
         WHERE a.channel_key = pair.alias
           AND NOT EXISTS (
               SELECT 1 FROM daily_channel_spend s
                WHERE s.brand_id = a.brand_id AND s.entry_date = a.entry_date AND s.channel_key = pair.standard
           );

        -- A custom pill with the standard key is redundant (the standard
        -- channel is fixed in app config); an alias pill goes once it holds
        -- no data (a row left behind by a date conflict keeps it visible).
        DELETE FROM daily_tracking_channels c
         WHERE c.kind = 'spend'
           AND (c.channel_key = pair.standard
                OR (c.channel_key = pair.alias
                    AND NOT EXISTS (SELECT 1 FROM daily_channel_spend s
                                     WHERE s.brand_id = c.brand_id AND s.channel_key = pair.alias)));
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Columns skipped on import, per brand
--   column_label  the header as it appears in the file (normalised:
--                 trimmed, single spaces) — what the user recognises
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_tracking_import_ignored (
    brand_id      INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    kind          TEXT    NOT NULL,
    column_label  TEXT    NOT NULL,
    ignored_by    INTEGER REFERENCES users(user_id),
    ignored_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (brand_id, kind, column_label),
    CONSTRAINT ck_dtii_kind CHECK (kind IN ('sales', 'spend'))
);

-- daily_tracking_ingestion_log notes channel deletes / moves too
DO $$
BEGIN
  ALTER TABLE public.daily_tracking_ingestion_log DROP CONSTRAINT IF EXISTS ck_dtil_target_table;
  ALTER TABLE public.daily_tracking_ingestion_log ADD CONSTRAINT ck_dtil_target_table
    CHECK (target_table IN ('daily_channel_sales', 'daily_channel_spend', 'daily_tracking_channels'));
END $$;
