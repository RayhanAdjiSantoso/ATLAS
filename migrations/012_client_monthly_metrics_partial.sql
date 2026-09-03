-- =====================================================================
-- 012 — client_monthly_metrics.is_partial_month
--
-- Marks a business-data row that covers less than a full calendar month
-- (client started/paused mid-month, or the source export was cut short).
-- Set from the Input Data form ("Bulan Parsial" toggle on the Metrik
-- Bulanan sub-tab).
--
-- S5 Benchmarking fully EXCLUDES a client-month flagged partial (or whose
-- platform-spend row for that month is partial — migration 009): it never
-- enters a peer average/median, and the client's own scorecard for that
-- month is not compared. Raw values still show normally in S7 Client
-- Detail. Portfolio aggregates (S1/S2/S3) count partial revenue normally
-- — it is real money.
--
-- Idempotent / re-runnable. No backfill: confirmed no partial months in
-- the data entered so far.
-- =====================================================================

SET search_path TO public;

ALTER TABLE client_monthly_metrics
  ADD COLUMN IF NOT EXISTS is_partial_month BOOLEAN NOT NULL DEFAULT FALSE;
