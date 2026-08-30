-- =====================================================================
-- ADS REPORTS SCHEMA — Fase 2 addendum.
-- Ported verbatim from the standalone report generator's migrations/
-- 002_report_runs_config.sql, renumbered to run after 004_ads_reports_
-- schema.sql in this folder.
--
-- report_runs (004) has no column for the platform-specific *input
-- parameters* a user picks in the UI that the client-side
-- buildMetaReport()/buildShopeeReport() functions need alongside the raw
-- ad rows to recompute the exact same report — Meta's industry pick / CPAS
-- toggle / custom Results column, Shopee's manually-entered Total Omzet.
-- Without persisting these, "Riwayat Laporan" could store the raw rows but
-- could not correctly reconstruct a reopened report.
--
-- Purely additive (ALTER ... ADD COLUMN IF NOT EXISTS) — does not touch any
-- public.* or shopee.* table, and does not alter any existing column.
-- =====================================================================
SET search_path TO ads_reports, public;

ALTER TABLE ads_reports.report_runs ADD COLUMN IF NOT EXISTS report_config JSONB;
