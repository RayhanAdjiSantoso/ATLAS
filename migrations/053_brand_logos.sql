-- =====================================================================
-- 053 — A logo per brand
--
-- Uploaded in Setup Context & Brand Direction; the image lives in R2
-- (backend/src/services/fileStore.js) and the brand row keeps its object key,
-- type and when it last changed (the change time versions the image URL, so
-- browsers cache it until it is replaced).
--
-- Additive only (nullable columns); idempotent.
-- =====================================================================

ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS logo_key TEXT;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS logo_mime TEXT;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ;
