-- =====================================================================
-- 057 — Google Reviews: two separate sentiment methods
--
-- code — rules and lexicons in ATLAS's backend; no API, no cost.
-- ai   — Claude / Gemini (what 054 stored).
--
-- Each review keeps one reading per method, side by side, so running one
-- method never overwrites or mixes with the other. Every reading existing
-- before this migration came from the AI path and is kept as method 'ai'.
--
-- gr_review_analysis: key becomes (review_id, method); new columns for what
--   the code engine reports (score, evidence label, terms it matched, its
--   version, the language it detected).
-- gr_runs: which method a run used.
-- gr_summaries: one summary per method, cached against a signature of the
--   readings it was built from (not the shared dataset_version, which only
--   moves when reviews themselves change).
--
-- Non-destructive: no row is deleted or rewritten except the default
-- 'ai' label on existing rows. Idempotent.
-- =====================================================================

ALTER TABLE public.gr_review_analysis ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'ai';
ALTER TABLE public.gr_review_analysis ADD COLUMN IF NOT EXISTS engine_version TEXT;
ALTER TABLE public.gr_review_analysis ADD COLUMN IF NOT EXISTS score NUMERIC(5,3);
ALTER TABLE public.gr_review_analysis ADD COLUMN IF NOT EXISTS evidence TEXT;
ALTER TABLE public.gr_review_analysis ADD COLUMN IF NOT EXISTS terms TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.gr_review_analysis ADD COLUMN IF NOT EXISTS language TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gr_review_analysis_method_check') THEN
    ALTER TABLE public.gr_review_analysis ADD CONSTRAINT gr_review_analysis_method_check CHECK (method IN ('code', 'ai'));
  END IF;
  -- Primary key (review_id) -> (review_id, method).
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'gr_review_analysis_pkey' AND array_length(c.conkey, 1) = 1
  ) THEN
    ALTER TABLE public.gr_review_analysis DROP CONSTRAINT gr_review_analysis_pkey;
    ALTER TABLE public.gr_review_analysis ADD CONSTRAINT gr_review_analysis_pkey PRIMARY KEY (review_id, method);
  END IF;
END $$;

ALTER TABLE public.gr_runs ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'ai';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gr_runs_method_check') THEN
    ALTER TABLE public.gr_runs ADD CONSTRAINT gr_runs_method_check CHECK (method IN ('code', 'ai'));
  END IF;
END $$;

ALTER TABLE public.gr_summaries ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'ai';
ALTER TABLE public.gr_summaries ADD COLUMN IF NOT EXISTS signature TEXT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gr_summaries_business_id_dataset_version_key') THEN
    ALTER TABLE public.gr_summaries DROP CONSTRAINT gr_summaries_business_id_dataset_version_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS gr_summaries_method_signature ON public.gr_summaries (business_id, method, signature);
CREATE INDEX IF NOT EXISTS gr_summaries_latest ON public.gr_summaries (business_id, method, created_at DESC);
