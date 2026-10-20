-- =====================================================================
-- 054 — Google Reviews Analytics
--
-- A business found on Google Maps (keyed by its Place ID, so two branches
-- with the same name never mix), the reviews collected for it, one AI
-- reading per review, the collection/analysis runs, and the AI summary per
-- dataset version.
--
-- Retention: a data source may limit how long its content may be kept.
-- Each review carries expires_at (NULL = no limit), set from the source's
-- rule when it is collected; the service drops expired rows before reading.
--
-- Additive only (new tables in public); idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.gr_businesses (
  id                 BIGSERIAL PRIMARY KEY,
  place_id           TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  address            TEXT,
  category           TEXT,
  maps_url           TEXT,
  -- What Google reports, as of info_updated_at — not what was collected.
  google_rating      NUMERIC(2,1),
  google_total       INTEGER,
  info_source        TEXT,
  info_updated_at    TIMESTAMPTZ,
  last_collected_at  TIMESTAMPTZ,
  last_analyzed_at   TIMESTAMPTZ,
  -- Bumped whenever the set of reviews or their readings changes; the AI
  -- summary is cached against it.
  dataset_version    INTEGER NOT NULL DEFAULT 0,
  created_by         INTEGER REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gr_reviews (
  id                   BIGSERIAL PRIMARY KEY,
  business_id          BIGINT NOT NULL REFERENCES public.gr_businesses(id) ON DELETE CASCADE,
  source               TEXT NOT NULL,
  external_id          TEXT NOT NULL,
  reviewer_name        TEXT,
  rating               SMALLINT CHECK (rating BETWEEN 1 AND 5),
  review_date          TIMESTAMPTZ,
  text                 TEXT,
  language             TEXT,
  owner_response       TEXT,
  owner_response_date  TIMESTAMPTZ,
  -- Hash of rating + text: an edited review is read again, an unchanged
  -- one never is.
  content_hash         TEXT NOT NULL,
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ,
  UNIQUE (business_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS gr_reviews_business_date_idx ON public.gr_reviews (business_id, review_date DESC);
CREATE INDEX IF NOT EXISTS gr_reviews_expires_idx ON public.gr_reviews (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.gr_review_analysis (
  review_id     BIGINT PRIMARY KEY REFERENCES public.gr_reviews(id) ON DELETE CASCADE,
  content_hash  TEXT NOT NULL,
  -- rating_only: no text to read. failed: the model gave no usable answer.
  sentiment     TEXT NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative', 'rating_only', 'failed')),
  confidence    NUMERIC(3,2),
  -- Short aspect phrases the review praises / complains about, in the
  -- review's own terms; topics are grouped from these per business.
  praises       TEXT[] NOT NULL DEFAULT '{}',
  complaints    TEXT[] NOT NULL DEFAULT '{}',
  aspects       TEXT[] NOT NULL DEFAULT '{}',
  model         TEXT,
  analyzed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gr_runs (
  id             BIGSERIAL PRIMARY KEY,
  business_id    BIGINT NOT NULL REFERENCES public.gr_businesses(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
  stage          TEXT NOT NULL DEFAULT 'collect' CHECK (stage IN ('collect', 'analyze', 'summarize', 'done')),
  -- The source's pagination state between steps.
  cursor         JSONB,
  pages          INTEGER NOT NULL DEFAULT 0,
  collected      INTEGER NOT NULL DEFAULT 0,
  new_reviews    INTEGER NOT NULL DEFAULT 0,
  analyzed       INTEGER NOT NULL DEFAULT 0,
  to_analyze     INTEGER,
  attempts       INTEGER NOT NULL DEFAULT 0,
  -- One step at a time: a step claims the run until this moment.
  locked_until   TIMESTAMPTZ,
  error          TEXT,
  coverage_note  TEXT,
  started_by     INTEGER REFERENCES public.users(user_id) ON DELETE SET NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS gr_runs_business_idx ON public.gr_runs (business_id, started_at DESC);
-- At most one active run per business.
CREATE UNIQUE INDEX IF NOT EXISTS gr_runs_one_active ON public.gr_runs (business_id) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS public.gr_summaries (
  id               BIGSERIAL PRIMARY KEY,
  business_id      BIGINT NOT NULL REFERENCES public.gr_businesses(id) ON DELETE CASCADE,
  dataset_version  INTEGER NOT NULL,
  -- topics (with their member aspect phrases), highlights and the executive
  -- summary; counts are computed from the reviews, never taken from here.
  summary          JSONB NOT NULL,
  model            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, dataset_version)
);
