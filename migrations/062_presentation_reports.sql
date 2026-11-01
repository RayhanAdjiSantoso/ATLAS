-- Presentation Report Builder (Report Generator): a monthly client deck kept
-- as a draft — its slide order, layouts and narrative (`document`) plus the
-- analytic figures it was built from (`snapshot`), so a deck exported later
-- still shows what was reviewed even if the underlying report is re-saved.
--
-- The source reports stay in ads_reports.report_runs; nothing here changes
-- them. Purely additive. Brand deletion reads foreign keys from the catalog
-- (brandService.js), so this table blocks a plain delete and is cleared by the
-- purge like every other ads_reports table.
CREATE TABLE IF NOT EXISTS ads_reports.presentation_reports (
    id                SERIAL PRIMARY KEY,
    brand_id          INTEGER NOT NULL REFERENCES public.brands(brand_id),
    name              TEXT NOT NULL,
    period_old_start  DATE,
    period_old_end    DATE,
    period_cur_start  DATE,
    period_cur_end    DATE,
    channels          TEXT[] NOT NULL DEFAULT '{}',
    template_version  INTEGER NOT NULL DEFAULT 1,
    document          JSONB NOT NULL,
    snapshot          JSONB,
    -- Bumped on every save; a save naming an older revision is refused, so a
    -- second open tab cannot silently overwrite newer edits.
    revision          INTEGER NOT NULL DEFAULT 1,
    created_by        INTEGER REFERENCES public.users(user_id) ON DELETE SET NULL,
    updated_by        INTEGER REFERENCES public.users(user_id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS presentation_reports_brand_idx ON ads_reports.presentation_reports (brand_id, updated_at DESC);

-- Supporting images a user adds to a deck. Bytes follow the fileStore pattern:
-- R2 when configured (storage_key), otherwise in the row (raw_bytes).
CREATE TABLE IF NOT EXISTS ads_reports.presentation_assets (
    id          SERIAL PRIMARY KEY,
    report_id   INTEGER NOT NULL REFERENCES ads_reports.presentation_reports(id) ON DELETE CASCADE,
    mime        TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    storage_key TEXT,
    raw_bytes   BYTEA,
    created_by  INTEGER REFERENCES public.users(user_id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS presentation_assets_report_idx ON ads_reports.presentation_assets (report_id);
