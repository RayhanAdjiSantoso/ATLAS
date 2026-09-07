-- =====================================================================
-- ATLAS APP LAYER — store dashboard upload bytes in Postgres
-- Reason: serverless (Vercel) has no persistent disk. Dashboard Excel
-- uploads previously lived on disk (multer diskStorage) and were read
-- back from disk by the Download endpoint. Keep the raw bytes in a BYTEA
-- column instead — same pattern as ads_reports.raw_uploads for Report
-- Generator files. stored_path stays (nullable) for pre-existing rows.
-- =====================================================================

SET search_path TO public, shopee;

ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS raw_file BYTEA;
