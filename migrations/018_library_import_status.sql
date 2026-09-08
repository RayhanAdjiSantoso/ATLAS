-- =====================================================================
-- BRAND LIBRARY — bedakan "file tersimpan" dari "data masuk Dashboard"
--
-- Baris library ditulis lebih dulu, importnya menyusul. Kalau importnya
-- gagal — dan di Vercel itu terjadi diam-diam saat function melewati 60
-- detik — filenya tetap tersimpan sementara tabel fakta kosong, dan UI
-- menampilkan "Lengkap" untuk periode yang sebenarnya tidak punya data
-- sama sekali. Status yang berbohong lebih berbahaya daripada error:
-- pengguna berhenti mencari masalah karena merasa sudah beres.
--
-- dashboard_upload_id saja tidak cukup untuk membedakan "gagal" dari
-- "memang bukan dataset Dashboard" — keduanya NULL. Tiga kolom ini
-- menyimpan hasilnya secara eksplisit, termasuk pesan errornya, supaya UI
-- bisa menampilkan alasannya dan menawarkan impor ulang tanpa meminta
-- pengguna mengunggah file yang sama untuk kedua kalinya (byte-nya sudah
-- ada di raw_file).
-- =====================================================================

SET search_path TO public, ads_reports;

-- 'not_applicable' = channel ini tidak dibaca Dashboard (hanya arsip)
-- 'success' | 'failed' = hasil impor terakhir ke tabel fakta shopee.*
ALTER TABLE ads_reports.brand_library_files ADD COLUMN IF NOT EXISTS import_status TEXT;
ALTER TABLE ads_reports.brand_library_files ADD COLUMN IF NOT EXISTS import_error  TEXT;
ALTER TABLE ads_reports.brand_library_files ADD COLUMN IF NOT EXISTS import_rows   INTEGER;

-- Baris yang sudah terlanjur ada sebelum kolom ini: yang punya tautan ke
-- public.uploads berarti importnya dulu berhasil.
UPDATE ads_reports.brand_library_files
SET import_status = 'success'
WHERE import_status IS NULL AND dashboard_upload_id IS NOT NULL;
