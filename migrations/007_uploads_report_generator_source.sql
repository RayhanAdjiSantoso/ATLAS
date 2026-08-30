-- =====================================================================
-- HISTORY UPLOAD — distinguish Dashboard vs Report Generator uploads
--
-- public.uploads was Dashboard-only until now (Shopee order/performance_
-- overview/product_performance imports, via multer diskStorage +
-- stored_path). Report Generator's raw files were archived separately in
-- ads_reports.raw_uploads (BYTEA in the DB, not on disk) and never showed
-- up in History Upload at all.
--
-- This migration lets Report Generator uploads appear as ordinary rows in
-- the same table/page, distinguished by the new `source` column:
--   - file_type is Dashboard-specific (order/performance_overview/
--     product_performance) with no equivalent values for Report
--     Generator's channels (meta boost/nonboost/cpas.../shopee produk/
--     toko/live/toko_keyword/overview/tiktok) -- rather than force those
--     into the same enum, file_type is now nullable (Dashboard rows keep
--     populating it; Report Generator rows leave it NULL) and a separate
--     free-text report_channel column carries a human label instead.
--   - raw_upload_id links a Report Generator row to the exact
--     ads_reports.raw_uploads row holding its BYTEA file, so Download can
--     stream it back and Delete can remove just that one file's archive.
--     ON DELETE CASCADE: deleting a whole saved report from "Riwayat
--     Laporan" (which already cascades report_runs -> raw_uploads) also
--     cleans up its History Upload rows automatically, with no extra code.
-- =====================================================================

-- Schema-qualified on purpose (both the type and every reference to it
-- below) -- this file runs in the same migrate.js session as 004-006,
-- which leave `search_path` set to `ads_reports, public`; an unqualified
-- CREATE TYPE here would land in ads_reports instead of public (where
-- every other ATLAS enum -- user_role, file_type, upload_status -- lives).
DO $$ BEGIN
    CREATE TYPE public.upload_source_enum AS ENUM ('dashboard', 'report_generator');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS source public.upload_source_enum NOT NULL DEFAULT 'dashboard';
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS report_channel TEXT;
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS raw_upload_id INTEGER REFERENCES ads_reports.raw_uploads(id) ON DELETE CASCADE;
ALTER TABLE public.uploads ALTER COLUMN file_type DROP NOT NULL;

CREATE INDEX IF NOT EXISTS ix_uploads_source ON public.uploads (source);
CREATE INDEX IF NOT EXISTS ix_uploads_raw_upload ON public.uploads (raw_upload_id);
