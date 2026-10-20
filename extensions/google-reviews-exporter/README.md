# ATLAS Google Reviews Exporter

Chrome extension (Manifest V3) untuk Google Reviews Analytics di ATLAS. Extension ini membaca ulasan yang tampil di halaman bisnis Google Maps, lalu mengekspornya ke file CSV yang diunggah ke ATLAS.

Alur V1: **Google Maps → extension → CSV → ATLAS › Google Reviews › Import CSV → analisis AI → dashboard.** Extension tidak mengirim apa pun ke ATLAS atau server lain; file CSV diunggah sendiri oleh pengguna.

## Memasang (unpacked, untuk tim internal)

1. Buka `chrome://extensions` di Google Chrome.
2. Aktifkan **Developer mode** (pojok kanan atas).
3. Klik **Load unpacked**, lalu pilih folder `extensions/google-reviews-exporter` dari repo ATLAS.
4. Sematkan ikon ATLAS di toolbar (ikon puzzle → pin).
5. Jika tab Google Maps sudah terbuka sebelum extension dipasang, muat ulang tab itu sekali.

Pembaruan: tarik versi terbaru repo, lalu klik ikon ↻ pada kartu extension di `chrome://extensions`.

## Memakai

1. Di Chrome, buka [Google Maps](https://www.google.com/maps), cari bisnisnya (mis. "Alluderma"), dan buka halaman bisnis tersebut, bukan daftar hasil pencarian.
   - **Login ke akun Google di Chrome.** Tanpa login, Google hanya menampilkan "tampilan terbatas" berisi beberapa ulasan saja.
   - Bahasa Google Maps sebaiknya **Indonesia** (atau Inggris). Google hanya memberi tombol "Lainnya/More" untuk ulasan yang berbahasa sama dengan antarmukanya.
2. Klik ikon extension. Popup menampilkan nama, alamat, rating, jumlah ulasan, dan Business ID bisnis tersebut.
3. Atur **Maksimum ulasan** bila perlu, lalu tekan **Start Collection**. Extension membuka tab Ulasan dan menggulir daftar ulasan. Biarkan tab Google Maps tetap terbuka; popup boleh ditutup lalu dibuka lagi untuk melihat progres.
4. Tunggu status **Completed**, atau tekan **Stop** kapan saja. Ulasan yang sudah terkumpul tetap bisa diekspor.
5. Tekan **Export CSV**. File `ATLAS_GoogleReviews_<Bisnis>_<tanggal>.csv` tersimpan di folder Downloads.
6. Buka ATLAS → **Google Reviews** → **Upload Google Reviews CSV**. Tarik file ke sana, periksa preview, lalu tekan **Import**.

Satu file berisi satu bisnis. Jika halaman berpindah ke bisnis lain di tengah pengumpulan, extension berhenti dan tidak mencampur datanya; tekan **Reset** untuk memulai bisnis baru.

## Data yang dibaca

- **Bisnis:** nama, alamat, rating, jumlah ulasan yang dilaporkan Google, dan CID dari URL Google Maps.
- **Tiap ulasan yang tampil:** ID ulasan, nama penulis, bintang, teks tanggal, teks ulasan asli, bahasa, dan balasan pemilik.

Yang **tidak** dibaca dan tidak disimpan: password, cookie, token, data akun Google, serta halaman di luar Google Maps.

## Privasi dan izin

- Izin: `storage` (hanya untuk dua preferensi: persetujuan sekali di awal dan nilai maksimum ulasan) dan akses host terbatas ke `google.com/maps`, `google.co.id/maps`, dan `maps.google.com`.
- Ulasan yang terkumpul hanya ada di memori tab Google Maps. Data hilang saat tab ditutup atau dimuat ulang, dan dihapus setelah export (opsi bawaan) atau saat **Reset**.
- Tidak ada request jaringan dari extension, tidak ada kode dari luar (`script-src 'self'`), dan tidak ada pengiriman otomatis ke ATLAS.
- Extension tidak melewati login, CAPTCHA, atau pembatasan Google. Jika Google meminta verifikasi, pengumpulan berhenti.

## Ketentuan Google

Ketentuan Layanan Google Maps membatasi ekstraksi dan ekspor konten Maps untuk dipakai di luar layanan Google. Extension ini meminta persetujuan pengguna sebelum dipakai pertama kali. Gunakan hanya untuk analisis internal, dalam jumlah wajar, dan dengan kesadaran bahwa tanggung jawabnya ada pada akun Google yang menjalankannya. ATLAS menyimpan ulasan hasil import selama 30 hari (`GR_CSV_RETENTION_DAYS`), lalu menghapusnya otomatis.

## Pengembangan

- `manifest.json`: MV3, izin minimal.
- `lib/core.js`: label, tanggal, deduplikasi, dan pembuatan CSV (tanpa DOM; diuji di `backend/test/googleReviewsExtension.test.js`).
- `content.js`: membaca halaman Google Maps (berjalan di tab).
- `popup.html`, `popup.css`, `popup.js`: antarmuka popup.
- Kontrak CSV: `docs/google-reviews-csv-v1.md`.

Selector halaman Google Maps (mis. `div[data-review-id]`, label tombol "Lainnya"/"More") bisa berubah jika Google mengubah tata letaknya. Jika jumlah ulasan yang terbaca tiba-tiba nol, periksa selector di `content.js`.
