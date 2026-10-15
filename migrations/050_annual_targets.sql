-- =====================================================================
-- 050 — Annual sales & ad budget targets, with revision history
--
-- A brand's year: the sales target and ad budget set in Brand Setting.
-- Brand Tracking splits them across the 12 months; the monthly amounts live
-- in brand_tracking_targets (migration 046), so every month keeps its own
-- achievement, projection and channel allocation as before. The 12 months
-- always add up to the year's current totals.
--
-- brand_annual_targets          — the year's CURRENT totals (one row).
-- brand_annual_target_revisions — every version ever set, never edited:
--   version 1 is the original target, each "update target" adds the next
--   one with the month it takes effect from and why. The original is kept
--   so the final target can be read against it (e.g. +12,5% from target awal).
--   kind: 'original' (v1), 'revision' (a mid-year update: earlier months
--   keep their targets) or 'correction' (the target awal was entered wrong:
--   the corrected figures replace it as the baseline, over all 12 months).
--
-- Additive only (new tables); idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS brand_annual_targets (
    brand_id      INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    year          INTEGER NOT NULL,
    target_sales  NUMERIC(18, 2) NOT NULL,
    target_spend  NUMERIC(18, 2),
    created_by    INTEGER REFERENCES users(user_id),
    updated_by    INTEGER REFERENCES users(user_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_brand_annual_targets PRIMARY KEY (brand_id, year),
    CONSTRAINT ck_bat_year CHECK (year BETWEEN 2000 AND 2100),
    CONSTRAINT ck_bat_nonneg CHECK (target_sales >= 0 AND COALESCE(target_spend, 0) >= 0)
);

CREATE TABLE IF NOT EXISTS brand_annual_target_revisions (
    id               BIGSERIAL PRIMARY KEY,
    brand_id         INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    year             INTEGER NOT NULL,
    version          INTEGER NOT NULL,
    target_sales     NUMERIC(18, 2) NOT NULL,
    target_spend     NUMERIC(18, 2),
    effective_month  DATE    NOT NULL,
    note             TEXT,
    created_by       INTEGER REFERENCES users(user_id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_batr_version UNIQUE (brand_id, year, version),
    CONSTRAINT ck_batr_month_first CHECK (EXTRACT(DAY FROM effective_month) = 1),
    CONSTRAINT ck_batr_nonneg CHECK (target_sales >= 0 AND COALESCE(target_spend, 0) >= 0)
);

-- Added after the tables first went out; idempotent for databases that
-- already have them.
ALTER TABLE brand_annual_target_revisions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'revision';
UPDATE brand_annual_target_revisions SET kind = 'original' WHERE version = 1 AND kind <> 'original';
DO $$ BEGIN
    ALTER TABLE brand_annual_target_revisions
        ADD CONSTRAINT ck_batr_kind CHECK (kind IN ('original', 'revision', 'correction'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS ix_batr_brand_year ON brand_annual_target_revisions (brand_id, year, version);
