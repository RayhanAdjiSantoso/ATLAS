-- =====================================================================
-- 022 — INTERNAL DASHBOARD: Google Sheets live-data source per brand
--
-- Maps each brand to the Google Sheet its team maintains ("Brand
-- Tracking" spreadsheet — one file per active client, each with a
-- "[NEW] Monthly Performance Analysis" tab). The Internal Dashboard
-- reads live from these sheets instead of the manual input forms.
--
-- Rows are bootstrapped by backend/scripts/mapBrandSheets.js (matches
-- brand names against Google Drive file titles) with is_verified=false,
-- then reviewed/corrected by hand before the dashboard trusts them.
--
-- Idempotent / re-runnable: scripts/migrate.js has no per-file tracking
-- and blindly re-applies every file in migrations/ on every run.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS brand_sheet_sources (
    brand_sheet_source_id  SERIAL PRIMARY KEY,
    brand_id                INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    spreadsheet_id          TEXT NOT NULL,
    spreadsheet_title        TEXT,           -- Drive file title, for humans reviewing the mapping
    tab_name                TEXT NOT NULL DEFAULT '[NEW] Monthly Performance Analysis',
    is_verified             BOOLEAN NOT NULL DEFAULT FALSE,  -- true once a human confirmed the match
    is_active                BOOLEAN NOT NULL DEFAULT TRUE,   -- false = temporarily stop pulling (sheet broken/moved)
    match_method             TEXT,            -- 'auto_name_match' | 'manual' — how this row was created
    note                     TEXT,
    last_synced_at           TIMESTAMPTZ,
    last_sync_error          TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_brand_sheet_sources_brand UNIQUE (brand_id)
);

CREATE INDEX IF NOT EXISTS ix_brand_sheet_sources_verified ON brand_sheet_sources (is_verified);

CREATE OR REPLACE FUNCTION trg_set_brand_sheet_sources_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_brand_sheet_sources_updated_at ON brand_sheet_sources;
CREATE TRIGGER trg_brand_sheet_sources_updated_at
    BEFORE UPDATE ON brand_sheet_sources
    FOR EACH ROW
    EXECUTE FUNCTION trg_set_brand_sheet_sources_updated_at();
