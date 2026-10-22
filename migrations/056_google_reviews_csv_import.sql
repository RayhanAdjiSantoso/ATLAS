-- =====================================================================
-- 056 — Google Reviews: CSV import (V1) and access by brand
--
-- gr_businesses.brand_id: the ATLAS brand a business is analysed for.
-- An account limited to some brands (Pengaturan Akses) sees a business
-- when it belongs to one of them, or when the account itself added it; an
-- unrestricted account sees all. NULL = no brand.
--
-- gr_imports: one row per uploaded CSV — the preview (with the parsed rows
-- held until the import is confirmed or cancelled, then dropped), the
-- outcome and who did it. The import history and the audit trail.
--
-- Additive only; idempotent.
-- =====================================================================

ALTER TABLE public.gr_businesses
  ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES public.brands(brand_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS gr_businesses_brand_idx ON public.gr_businesses (brand_id);

CREATE TABLE IF NOT EXISTS public.gr_imports (
  id                BIGSERIAL PRIMARY KEY,
  business_id       BIGINT REFERENCES public.gr_businesses(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'previewed'
                    CHECK (status IN ('previewed', 'importing', 'imported', 'failed', 'cancelled', 'expired')),
  filename          TEXT NOT NULL,
  file_sha          TEXT NOT NULL,
  file_bytes        INTEGER NOT NULL,
  schema_version    TEXT,
  -- What the file says about the business (name, key, address, url, rating,
  -- total) — used to match or create the business on confirm.
  business_meta     JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_rows        INTEGER NOT NULL DEFAULT 0,
  valid_rows        INTEGER NOT NULL DEFAULT 0,
  invalid_rows      INTEGER NOT NULL DEFAULT 0,
  duplicate_rows    INTEGER NOT NULL DEFAULT 0,
  rating_only_rows  INTEGER NOT NULL DEFAULT 0,
  new_reviews       INTEGER,
  updated_reviews   INTEGER,
  unchanged_reviews INTEGER,
  date_from         TIMESTAMPTZ,
  date_to           TIMESTAMPTZ,
  -- First problems found, row and column named: [{row, column, message}].
  issues            JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Parsed rows between preview and confirm; NULL once settled.
  payload           JSONB,
  error             TEXT,
  run_id            BIGINT REFERENCES public.gr_runs(id) ON DELETE SET NULL,
  created_by        INTEGER REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by      INTEGER REFERENCES public.users(user_id) ON DELETE SET NULL,
  confirmed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS gr_imports_business_idx ON public.gr_imports (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gr_imports_creator_idx ON public.gr_imports (created_by, created_at DESC);
