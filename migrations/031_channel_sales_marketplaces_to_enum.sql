-- =====================================================================
-- 031 — move Tokopedia / Blibli / Lazada out of client_channel_sales_other
--
-- Migration 030 added these three to the sales_channel enum (they are
-- fixed columns of the standard Daily Tracking template). Rows that were
-- entered earlier as free-text labels are moved to the canonical table so
-- S6 does not list the same marketplace twice.
--
-- A row is only deleted from the "other" table once the canonical table
-- holds the SAME amount for that brand/period/channel. If the canonical
-- table already has a different amount, both rows stay and S8's
-- channel-vs-revenue reconciliation surfaces the double entry for review
-- instead of this migration picking one.
--
-- Separate file from 030 on purpose: a new enum value cannot be used in
-- the same transaction that adds it. Idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

INSERT INTO client_channel_sales_monthly (brand_id, period, channel, sales, created_by, source, source_ref)
SELECT o.brand_id, o.period, lower(trim(o.channel_label))::sales_channel, o.sales_amount,
       o.created_by, o.source, o.source_ref
FROM client_channel_sales_other o
WHERE lower(trim(o.channel_label)) IN ('tokopedia', 'blibli', 'lazada')
ON CONFLICT (brand_id, period, channel) DO NOTHING;

DELETE FROM client_channel_sales_other o
WHERE lower(trim(o.channel_label)) IN ('tokopedia', 'blibli', 'lazada')
  AND EXISTS (
      SELECT 1 FROM client_channel_sales_monthly c
      WHERE c.brand_id = o.brand_id
        AND c.period = o.period
        AND c.channel::text = lower(trim(o.channel_label))
        AND c.sales = o.sales_amount
  );
