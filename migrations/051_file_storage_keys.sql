-- =====================================================================
-- 051 — Uploaded files' bytes move to object storage (Cloudflare R2)
--
-- Every table that held a file's bytes in a BYTEA column gets storage_key:
-- the object's key in the R2 bucket (backend/src/services/fileStore.js).
-- A row holds its bytes in exactly one place —
--   raw_file / data  (before the move, or while R2 is not configured), or
--   storage_key      (in R2; the BYTEA column is then NULL).
-- Readers try the column first and fall back to the object, so rows can be
-- moved one at a time (backend/scripts/moveFilesToR2.js) with no downtime.
--
-- Additive only (new nullable columns, one NOT NULL relaxed); idempotent.
-- =====================================================================

SET search_path TO public;

ALTER TABLE public.uploads                     ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE ads_reports.brand_library_files    ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE ads_reports.raw_uploads            ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE public.homepage_media              ADD COLUMN IF NOT EXISTS storage_key TEXT;

-- A photo moved to R2 keeps its row without the bytes.
ALTER TABLE public.homepage_media ALTER COLUMN data DROP NOT NULL;
