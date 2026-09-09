-- =====================================================================
-- ORDERS — pembeli boleh tidak diketahui
--
-- Shopee tidak selalu mengungkapkan username pembeli: sebagian pesanan
-- (terutama yang dibatalkan atau sudah lama selesai) datang dengan kolom
-- "Username (Pembeli)" kosong. Dengan customer_id NOT NULL, SATU pesanan
-- seperti itu menggagalkan impor seluruh file — satu baris membuang
-- sebulan data, dan pengguna hanya melihat pesan constraint mentah.
--
-- Pesanannya sendiri nyata: nilainya, produknya, dan tanggalnya ada.
-- Yang tidak diketahui hanya pembelinya, jadi NULL adalah jawaban yang
-- jujur. Metrik yang menghitung pelanggan sudah aman terhadap NULL —
-- COUNT(DISTINCT customer_id) mengabaikannya, dan query RFM memakai INNER
-- JOIN ke customers sehingga pesanan tanpa pembeli memang tidak ikut
-- dianalisis, yang justru benar: recency/frequency tidak bisa dihitung
-- untuk orang yang tidak dikenal.
-- =====================================================================

SET search_path TO shopee, public;

ALTER TABLE shopee.orders ALTER COLUMN customer_id DROP NOT NULL;
