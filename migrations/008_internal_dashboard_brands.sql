-- =====================================================================
-- 008 — INTERNAL DASHBOARD: extend public.brands to master client data
--
-- Backs the new admin-only "Internal Dashboard MIL Digital" page
-- (all-clients performance). Source of truth for these attributes is the
-- "Client info" tab of "MIL DIGITAL CLIENTS [UPDATED 2025]", migrated
-- ONCE into ATLAS (not synced from Sheets) — technical breakdown §2.1 / §2.6.
--
-- STRUCTURE ONLY. Populating the columns — and parsing the free-text
-- "Display Ads"/"Marketplace Ads" into platform enums, and flagging rows
-- whose Industry/Sub Industry look swapped — is done by
-- backend/scripts/migrateClientInfo.js, whose output is reviewed by hand
-- before commit (breakdown §6 steps 1–2).
--
-- Idempotent / re-runnable: scripts/migrate.js has no per-file tracking
-- and blindly re-applies every file in migrations/ on every run.
-- =====================================================================

SET search_path TO public;

-- ---------------------------------------------------------------------
-- Client status — actual sheet values: ACTIVE / OFF / FREEZE.
-- Some rows (internal entities, e.g. "MIL Digital", "Opus One (as BC)")
-- have a blank status → column stays NULLable, no DEFAULT.
-- ---------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE brand_status AS ENUM ('active', 'off', 'freeze');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- industry_hierarchy — master data (breakdown §2.6)
--   kategori_besar  ← derived bucket ("Retail", "B2B/Service", "F&B", …)
--   industry        ← raw "Industry" string from the sheet
--   sub_industry    ← raw "Sub Industry" string from the sheet
-- Grain: one row per valid (industry, sub_industry) pair.
-- kategori_besar is a function of `industry` alone (breakdown §2.1) —
-- kept as a stored column so the mapping is explicit and editable, and
-- NOT duplicated onto brands. Rows are loaded by migrateClientInfo.js,
-- not here.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS industry_hierarchy (
    industry_hierarchy_id  SERIAL PRIMARY KEY,
    kategori_besar         TEXT NOT NULL,
    industry               TEXT NOT NULL,
    sub_industry           TEXT NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_industry_hierarchy_pair UNIQUE (industry, sub_industry)
);

CREATE INDEX IF NOT EXISTS ix_industry_hierarchy_industry ON industry_hierarchy (industry);
CREATE INDEX IF NOT EXISTS ix_industry_hierarchy_kategori ON industry_hierarchy (kategori_besar);

-- ---------------------------------------------------------------------
-- Extend brands with the in-scope master-client attributes.
--
-- Out of scope (breakdown decision #6, NOT added): package, consultant,
-- ao_1, ao_2, alamat, no_telp, kota, ongkir.
-- Not added: join_date — no source column exists in the sheet yet
-- (breakdown §2.1, open question).
--
-- Every column NULLable: ~9 ACTIVE clients currently have no industry /
-- sub-industry / BM ID at all; the migration still loads them (decision:
-- migrate with NULLs, S8 Data Quality flags them afterwards).
-- ---------------------------------------------------------------------
ALTER TABLE brands ADD COLUMN IF NOT EXISTS status        brand_status;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS industry      TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS sub_industry  TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS bm_id         TEXT;  -- "Business ID" = BM ID; TEXT to avoid 16-digit precision loss
ALTER TABLE brands ADD COLUMN IF NOT EXISTS pic           TEXT;
-- "Mulai kerja sama" — first month of engagement (day = 1). Not in the
-- "Client info" sheet; collected separately from AO/Consultant/PIC records
-- and loaded by migrateClientInfo.js (--join-dates). NULL where unknown —
-- never proxied from "first month with data" (S1/S2 "new client" logic).
ALTER TABLE brands ADD COLUMN IF NOT EXISTS join_date     DATE;

-- Generic hand-review flag (free text, not boolean): the migration
-- scripts set this to a specific reason for rows that need a human look
-- — first for swapped/empty Industry vs Sub Industry, and later for
-- ambiguous Display Ads / Marketplace Ads parsing. NULL = nothing to review.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS migration_review_note TEXT;

-- updated_at + trigger (mirrors users, migration 001) — the dashboard
-- will mutate brand rows via POST endpoints. Declared before the view
-- below so `brands.*` in the view stays stable across migrate re-runs.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- industry / sub_industry are a SOFT reference to industry_hierarchy,
-- NOT a FK: they can be NULL, and pre-cleanup they may not yet exist in
-- the hierarchy. Promote to FK in a later migration once the sheet and
-- the hierarchy are reconciled.
CREATE INDEX IF NOT EXISTS ix_brands_status       ON brands (status);
CREATE INDEX IF NOT EXISTS ix_brands_industry     ON brands (industry);
CREATE INDEX IF NOT EXISTS ix_brands_sub_industry ON brands (sub_industry);

-- ---------------------------------------------------------------------
-- brand_ad_accounts — 1 client : many Meta ad accounts
-- (breakdown §2.1, decision #3). Filled fresh: the sheet only has a
-- COUNT ("# Ad account") and a single "Business ID"/BM ID, never the
-- individual ad-account IDs.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brand_ad_accounts (
    brand_ad_account_id  SERIAL PRIMARY KEY,
    brand_id             INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    ad_account_id        TEXT NOT NULL,
    account_name         TEXT,
    is_primary           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_brand_ad_accounts UNIQUE (brand_id, ad_account_id)
);

CREATE INDEX IF NOT EXISTS ix_brand_ad_accounts_brand ON brand_ad_accounts (brand_id);
-- at most one primary ad account per brand
CREATE UNIQUE INDEX IF NOT EXISTS ux_brand_ad_accounts_primary
    ON brand_ad_accounts (brand_id) WHERE is_primary;

-- ---------------------------------------------------------------------
-- kategori_besar is derived, never stored on brands (breakdown §2.1).
-- Convenience view: each brand plus its big-category bucket.
-- Columns are listed explicitly (not `b.*`): migrate.js re-runs every
-- file on every run, and CREATE OR REPLACE VIEW cannot reorder columns,
-- so a `b.*` here would break the day a later migration adds a brands
-- column. A later migration that needs a new column in this view edits
-- this statement.
-- ---------------------------------------------------------------------
-- NOTE on column order: CREATE OR REPLACE VIEW may only APPEND columns, so
-- new brands columns are added at the very end here (after kategori_besar).
CREATE OR REPLACE VIEW brands_with_category AS
SELECT b.brand_id,
       b.brand_name,
       b.status,
       b.industry,
       b.sub_industry,
       b.bm_id,
       b.pic,
       b.migration_review_note,
       b.created_at,
       b.updated_at,
       (SELECT ih.kategori_besar
          FROM industry_hierarchy ih
         WHERE ih.industry = b.industry
         LIMIT 1) AS kategori_besar,
       b.join_date
FROM brands b;

-- ---------------------------------------------------------------------
-- updated_at trigger for brands
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_set_brands_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_brands_updated_at ON brands;
CREATE TRIGGER trg_brands_updated_at
    BEFORE UPDATE ON brands
    FOR EACH ROW
    EXECUTE FUNCTION trg_set_brands_updated_at();
