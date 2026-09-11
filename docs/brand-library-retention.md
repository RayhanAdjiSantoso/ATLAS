# Brand, sumber laporan, dan retention

Perubahan September 2026. Tidak memerlukan migrasi baru: status memakai
`public.brands.status` yang sudah ada sejak migration 008.

- Pengaturan Brand → Daftar brand mengelola `active`, `off`, `freeze`.
  Status kosong tetap ditampilkan sebagai “Belum diatur”, bukan otomatis aktif.
  Brand baru dibuat aktif; nama kosong, terlalu panjang, dan duplikat ditolak.
- Konteks navigasi disimpan per akun, per tab browser di sessionStorage.
- Report Generator membaca katalog dan unduhan terautentikasi dari endpoint
  `/api/brands/:brandId/library`, sama dengan Pengaturan Brand. Tidak bergantung
  pada riwayat `report_runs`. File asli tetap berada di perpustakaan; hasil
  laporan menyimpan baris terolah seperti sebelumnya.
- Pilih seluruh bagian ekspor untuk bulan yang sama. Meta dapat mengambil
  beberapa file untuk dua periode. File yang ditandai salah periode harus
  diperbaiki di perpustakaan. Mengganti brand membuang state laporan klien lama.
- Sumber dibedakan menurut platform/channel. Order dan Performance Overview
  adalah sumber dashboard; keduanya bukan pengganti Iklan Produk untuk laporan
  iklan Shopee. Product Performance tersedia pada sumber tambahan laporan.

## Definisi retention

Semua metrik memakai pesanan berstatus Selesai, tanggal selesai, identitas
pelanggan yang tersedia, dan brand yang sama. Riwayat berarti data yang telah
masuk ke ATLAS, bukan semua transaksi yang pernah terjadi di Shopee.

1. Pelanggan kembali: pembeli pada periode utama yang juga menyelesaikan
   pesanan sebelum tanggal awal periode utama.
2. Porsi pelanggan kembali: pelanggan kembali / pembeli unik periode utama.
3. Retention seluruh riwayat: pelanggan kembali / pembeli unik sebelum periode
   utama. Transaksi sesudah periode utama tidak ikut menentukan riwayat.
4. Retention kohort pembanding: pembeli periode pembanding yang bertransaksi
   lagi pada periode utama / pembeli periode pembanding. Periode pembanding
   harus berakhir sebelum periode utama. Tanpa kohort, nilai tidak tersedia.
5. Repeat customer rate tetap terpisah: pelanggan dengan >1 transaksi di dalam
   periode / seluruh pelanggan pada periode tersebut.

## Validasi

- `cd backend && node tests/brand-retention.integration.mjs`: temporary tables,
  rollback, tidak menulis data klien. Memeriksa cutoff, isolasi brand, buyer NULL,
  beda repeat/returning, create brand, duplikat, perubahan status, validasi API.
- `npm run build --prefix frontend`.
- Browser fixture terpisah: filter status, desktop/mobile date picker, pilihan
  dua file perpustakaan Shopee → generate → penyimpanan laporan. Fixture tidak
  dikirim ke production dan tidak memakai atau mengubah data klien.

Hak akses akun bertingkat tidak diubah dalam pekerjaan ini.
