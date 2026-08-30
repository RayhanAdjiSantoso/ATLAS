-- =====================================================================
-- product_variant_performance: add units-sold column
--
-- Problem: shopee.product_variant_performance (and shopee.product_variants)
-- exist in the schema but were never populated by any loader -- variant-
-- level rows from the "Produk dengan Performa Terbaik" sheet were silently
-- skipped on import (only product/category-level rows, Kode Variasi blank,
-- were loaded into product_performance_summary). The Product Performance
-- tab's variant-level view was therefore reconstructed from raw
-- orders/order_items instead of Shopee's own "Pesanan Siap Dikirim" export
-- figures, causing a numeric mismatch against the source Excel file.
--
-- Fix: add products_ordered_ready_to_ship (units sold), matching the
-- notebook's "Produk (Pesanan Siap Dikirim)" column for variant rows, so
-- the new variant loader (services/import/loaders/productPerformance.js)
-- can populate it. Safe to re-run.
-- =====================================================================

SET search_path TO shopee, public;

ALTER TABLE shopee.product_variant_performance
  ADD COLUMN IF NOT EXISTS products_ordered_ready_to_ship INTEGER NOT NULL DEFAULT 0;
