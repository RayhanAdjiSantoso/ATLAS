-- =====================================================================
-- 052 — A saved report's parsed rows live in R2, one object per set
--
-- A Report Generator save used to write every parsed row of its uploaded
-- exports into meta_ad_rows / shopee_ad_rows / tiktok_ad_rows, each with the
-- full original row in `extra` (JSONB). Nothing reads those rows except to
-- hand `extra` back when a saved report is reopened, so the rows are in
-- effect files: Meta alone reached ~250 MB in two months, and reopening one
-- report pulled several MB out of the database.
--
-- Now each (report, period, channel) set is one gzipped JSON array in R2
-- (backend/src/services/reportRowsets.js); this table keeps what the app
-- needs to find and count it. The old row tables stay for reports saved
-- before the move (and as the fallback when R2 is unavailable); readers take
-- both. backend/scripts/moveReportRowsToR2.js moves the old rows over.
--
-- Additive only; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ads_reports.report_run_rowsets (
    report_run_id  INTEGER NOT NULL REFERENCES ads_reports.report_runs(id) ON DELETE CASCADE,
    period_role    ads_reports.period_role_enum NOT NULL,
    channel        TEXT NOT NULL,          -- 'tiktok' for TikTok, which has no channel split
    row_count      INTEGER NOT NULL,
    byte_size      INTEGER,                -- gzipped size of the object
    storage_key    TEXT NOT NULL,
    seq            INTEGER NOT NULL DEFAULT 0,  -- where the set's first row stood in the saved order
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_report_run_rowsets PRIMARY KEY (report_run_id, period_role, channel)
);
