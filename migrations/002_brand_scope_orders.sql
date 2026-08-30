-- =====================================================================
-- BRAND-SCOPE orders & order_items
-- Run AFTER 001_app_tables.sql on database atlas_FIN
--
-- Problem: shopee.orders.order_id was the sole PRIMARY KEY (global,
-- not scoped by brand), and shopee.order_items was uniquely keyed on
-- (order_id, sku_reference), also global. When two different brands'
-- Order exports contain the same "No. Pesanan" (observed in practice
-- when the same sample/export file was uploaded under multiple brand
-- accounts), ON CONFLICT (order_id) DO NOTHING in the importer silently
-- skipped almost every row for the second/third brand while still
-- reporting the upload as "success" -- leaving shopee.orders with ZERO
-- rows for that brand and breaking every dashboard tab that reads from
-- orders/order_items (RFM, Transaction Behavior, Basket Analysis).
--
-- Fix: make brand_id part of the identity of orders/order_items so
-- the same order_id can legitimately exist once per brand.
--
-- This file is written to be safely re-runnable (same convention as
-- 001_app_tables.sql), since scripts/migrate.js re-applies every file
-- in the migrations/ directory on each run.
-- =====================================================================

SET search_path TO shopee, public;

-- ---------------------------------------------------------------------
-- 1. orders.brand_id becomes mandatory (all rows already populated).
--    SET NOT NULL is a no-op if already NOT NULL -- safe to re-run.
-- ---------------------------------------------------------------------
ALTER TABLE shopee.orders ALTER COLUMN brand_id SET NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Give order_items its own brand_id (denormalized from the parent
--    order), backfilled while order_id is still guaranteed unique.
-- ---------------------------------------------------------------------
ALTER TABLE shopee.order_items ADD COLUMN IF NOT EXISTS brand_id INTEGER;

UPDATE shopee.order_items oi
SET brand_id = o.brand_id
FROM shopee.orders o
WHERE o.order_id = oi.order_id
  AND oi.brand_id IS NULL;

ALTER TABLE shopee.order_items ALTER COLUMN brand_id SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE shopee.order_items
    ADD CONSTRAINT order_items_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES brands(brand_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS ix_order_items_brand ON shopee.order_items (brand_id);

-- ---------------------------------------------------------------------
-- 3. Re-key orders: order_id is only unique WITHIN a brand. Drop the
--    dependent order_items FK first (if present) to avoid a dependency
--    error, and only touch the PK if it hasn't already been migrated.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  pk_cols text;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY k.ord)
  INTO pk_cols
  FROM pg_constraint c
  JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conname = 'orders_pkey' AND c.conrelid = 'shopee.orders'::regclass;

  IF pk_cols = 'order_id' THEN
    ALTER TABLE shopee.order_items DROP CONSTRAINT IF EXISTS order_items_order_id_fkey;
    ALTER TABLE shopee.orders DROP CONSTRAINT orders_pkey;
    ALTER TABLE shopee.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (brand_id, order_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 4. Re-point order_items -> orders FK at the composite key, and make
--    the per-order-per-SKU uniqueness brand-scoped too.
-- ---------------------------------------------------------------------
ALTER TABLE shopee.order_items DROP CONSTRAINT IF EXISTS ux_order_item_sku;

DO $$ BEGIN
  ALTER TABLE shopee.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (brand_id, order_id)
      REFERENCES shopee.orders (brand_id, order_id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE shopee.order_items
    ADD CONSTRAINT ux_order_item_sku UNIQUE (brand_id, order_id, sku_reference);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
