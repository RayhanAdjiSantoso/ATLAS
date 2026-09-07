-- =====================================================================
-- PENGATURAN BRAND — brand profile + one file library per brand
--
-- Why this exists: every ATLAS module (Report Generator, Dashboard
-- Business Overview, Meta Automation) used to ask for its own upload, so
-- the same Shopee/Meta/TikTok export was re-uploaded once per feature and
-- nothing knew which periods a brand actually had. Pengaturan Brand is
-- now the single intake point: a file is uploaded once, against a brand +
-- platform + channel + month, and the other pages read from here.
--
-- Two tables:
--   1. public.brand_profiles — the narrative context the Report Generator
--      prompts already assume exists (brands is (brand_id, brand_name)
--      only, which is exactly why reportGenerator/app/reports.ts says
--      porting "Pengaturan Brand" was blocked on backend work).
--   2. ads_reports.brand_library_files — the library itself. It lives in
--      ads_reports, next to raw_uploads, and deliberately reuses that
--      table's vocabulary (platform_enum + the same free-text `channel`
--      values: 'meta','cpas','produk','produk_otomatis','toko',
--      'toko_keyword','live','overview','tiktok') so a stored library
--      file can be handed to the report pipeline later without any
--      translation layer. It is NOT raw_uploads itself because that table
--      is keyed to a report_run — a library file exists before (and
--      without) any report ever being generated.
-- =====================================================================

SET search_path TO public, ads_reports;

-- ---------------------------------------------------------------------
-- 1. Brand profile (Brand context + Current direction)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brand_profiles (
    brand_id                    INTEGER PRIMARY KEY REFERENCES public.brands(brand_id) ON DELETE CASCADE,
    sector                      TEXT,
    -- Brand context
    brand_products_customer     TEXT,
    positioning_driver          TEXT,
    key_products_channels       TEXT,
    business_characteristics    TEXT,
    historical_learning         TEXT,
    -- Current direction
    objective_target            TEXT,
    strategic_priorities        TEXT,
    constraints_concerns        TEXT,
    updated_by                  INTEGER REFERENCES public.users(user_id),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. File library
--
-- One row = one file for one brand + platform + channel + month. Re-
-- uploading the same slot replaces the row (see the unique indexes), so
-- the library never accumulates duplicates of the same month.
--
-- day_bitmap is what makes the month/day indicator in the UI cheap: a
-- string of '0'/'1', one character per day of `period_month` (index 0 =
-- day 1). Reading coverage never has to open the file or scan a fact
-- table, and a partially-covered month is honest about WHICH days it has
-- rather than just how many.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ads_reports.brand_library_files (
    id                  SERIAL PRIMARY KEY,
    brand_id            INTEGER NOT NULL REFERENCES public.brands(brand_id) ON DELETE CASCADE,
    platform            ads_reports.platform_enum NOT NULL,
    channel             TEXT NOT NULL,
    -- First day of the month this file belongs to. NULL = a reference file
    -- with no period at all (e.g. the product name -> Category/Series map).
    period_month        DATE,
    period_start        DATE,
    period_end          DATE,
    covered_days        INTEGER NOT NULL DEFAULT 0,
    day_bitmap          TEXT,
    row_count           INTEGER,
    original_filename   TEXT NOT NULL,
    byte_size           INTEGER,
    raw_file            BYTEA,
    uploaded_by         INTEGER REFERENCES public.users(user_id),
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two partial indexes rather than one constraint: NULLs never collide in a
-- UNIQUE constraint, so reference files (period_month IS NULL) would be
-- free to duplicate without the second one.
CREATE UNIQUE INDEX IF NOT EXISTS ux_brand_library_month
    ON ads_reports.brand_library_files (brand_id, platform, channel, period_month)
    WHERE period_month IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_brand_library_reference
    ON ads_reports.brand_library_files (brand_id, platform, channel)
    WHERE period_month IS NULL;

CREATE INDEX IF NOT EXISTS ix_brand_library_brand ON ads_reports.brand_library_files (brand_id);
CREATE INDEX IF NOT EXISTS ix_brand_library_scope ON ads_reports.brand_library_files (brand_id, platform, period_month);

-- How the period was determined: 'declared' (a "Periode" line inside the
-- file), 'filename' (the range Shopee/TikTok stamp into the download name),
-- 'rows' (dates read from the data itself) or 'none'. Kept because the three
-- are not equally trustworthy — a campaign export's row dates are creation
-- dates, not the reporting period — and showing which rule won is what makes
-- a surprising coverage bar explainable instead of suspicious.
ALTER TABLE ads_reports.brand_library_files ADD COLUMN IF NOT EXISTS period_source TEXT;
