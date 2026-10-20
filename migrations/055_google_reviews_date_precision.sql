-- =====================================================================
-- 055 — How precise a review's date is
--
-- Google Maps shows most review dates as "6 months ago" or "a year ago".
-- The collector turns that into a date counted back from when the review was
-- read (fetched_at), and records how precise that date really is, so the
-- trend never puts a "6 months ago" review into one particular week.
--
--   NULL   exact date from the source
--   day | week | month | year   approximate, to that unit
--
-- Additive only (nullable column); idempotent.
-- =====================================================================

ALTER TABLE public.gr_reviews ADD COLUMN IF NOT EXISTS date_precision TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gr_reviews_date_precision_check') THEN
    ALTER TABLE public.gr_reviews
      ADD CONSTRAINT gr_reviews_date_precision_check CHECK (date_precision IN ('day', 'week', 'month', 'year'));
  END IF;
END $$;
