-- =====================================================================
-- 028 — daily_channel_performance: kolom biaya iklan & ROAS
--
-- Bagian "Iklan Shopee" di sheet Asal Penjualan punya kolom sendiri
-- (Ads Impression, Total Pesanan, Konversi, Pengeluaran Iklan, ROAS Iklan),
-- berbeda dari Halaman Produk / Live / Video / Affiliate. Importer lama
-- membaca bagian ini dengan urutan kolom Halaman Produk, sehingga "Total
-- Pesanan" iklan tersimpan sebagai klik dan biaya iklan tersimpan sebagai
-- produk dipesan.
--
-- Importer sekarang membaca per nama kolom. Biaya iklan dan ROAS tidak punya
-- tempat di tabel ini, jadi ditambahkan di sini. NULL untuk channel non-iklan:
-- channel itu memang tidak punya biaya, bukan biayanya nol.
-- =====================================================================

SET search_path TO shopee, public;

ALTER TABLE daily_channel_performance
  ADD COLUMN IF NOT EXISTS ad_spend_idr NUMERIC(16,2),
  ADD COLUMN IF NOT EXISTS roas NUMERIC(10,4);

COMMENT ON COLUMN daily_channel_performance.ad_spend_idr IS 'Pengeluaran Iklan (IDR). Hanya untuk channel Iklan Shopee; NULL untuk channel lain.';
COMMENT ON COLUMN daily_channel_performance.roas IS 'ROAS Iklan seperti dilaporkan Shopee. Hanya untuk channel Iklan Shopee.';
