-- =====================================================================
-- BRAND LIBRARY — more than one file per month slot
--
-- Shopee splits a large month's Order export into parts
-- ("Order.all.20260801_20260831_part_1_of_2.xlsx"), and a slot that holds
-- exactly one file forces the user to choose which half of their month to
-- keep. Parts are now first-class: one row per part, and the month's
-- coverage is the union of its parts.
--
-- Merging is safe at the fact-table level without any extra work here:
-- every importer already de-duplicates on a natural key
-- (orders ON CONFLICT (brand_id, order_id), daily_order_performance on
-- (brand_id, report_date, stage_id), and so on, all DO NOTHING), so parts
-- that overlap mid-month contribute each row once.
-- =====================================================================

SET search_path TO public, ads_reports;

ALTER TABLE ads_reports.brand_library_files ADD COLUMN IF NOT EXISTS part_index INTEGER NOT NULL DEFAULT 1;

-- The monthly slot is now unique per part, not per month. The reference-file
-- index (period_month IS NULL) is deliberately untouched: a product master
-- has no parts.
DROP INDEX IF EXISTS ads_reports.ux_brand_library_month;
CREATE UNIQUE INDEX IF NOT EXISTS ux_brand_library_month_part
    ON ads_reports.brand_library_files (brand_id, platform, channel, period_month, part_index)
    WHERE period_month IS NOT NULL;
