-- =====================================================================
-- ADS REPORTS SCHEMA — "reuse a saved period" addendum.
-- Ported verbatim from the standalone report generator's migrations/
-- 003_report_runs_updated_at.sql, renumbered to run after 005_ads_reports_
-- config.sql in this folder.
--
-- report_runs.created_at is set once at first save and never moves — the
-- upsert in POST /api/report-generator/reports only rewrites label/config/
-- rows on conflict, not the timestamp. The "Pilih dari data tersimpan"
-- picker needs a "terakhir disimpan" value to sort saved periods
-- newest-first and to tell apart multiple saved instances of the same
-- calendar period, so add updated_at and touch it on every (re)save.
--
-- Purely additive. Existing rows get now() once via the column default;
-- from then on POST .../reports keeps it current.
-- =====================================================================
SET search_path TO ads_reports, public;

ALTER TABLE ads_reports.report_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
