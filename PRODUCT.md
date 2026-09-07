# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Tim MIL Digital (role `admin`)** — account manager dan analyst agensi. Situasi: mengolah data performa ~33 klien aktif, menyusun laporan bulanan per brand, dan memantau portofolio lintas klien. Mereka satu-satunya yang boleh membuka Internal Dashboard dan Meta Ads Automation.

**Orang dari brand klien (role `user`)** — login untuk membaca Business Overview brand-nya sendiri dan menarik laporannya sendiri lewat Report Generator. Tidak pernah melihat data klien lain.

Konsekuensi desain: setiap permukaan harus jelas berada di sisi *client-facing* atau *internal*. Report Generator dan Business Overview dibaca orang luar; Internal Dashboard tidak pernah.

## Product Purpose

ATLAS adalah **platform payung** — satu shell aplikasi, satu sidebar, satu wordmark — yang menaungi modul-modul yang tadinya berdiri sendiri. Tujuannya: dari file ekspor mentah sampai laporan siap kirim ke klien tanpa spreadsheet manual di tengah, dan tanpa tiap modul memelihara daftar kliennya sendiri.

Sukses berarti: satu brand di-update sekali, konsisten terlihat di semua modul; laporan bulanan tersusun dari data yang sudah masuk, bukan dari salin-tempel.

## Positioning

Yang membedakan ATLAS dari "empat aplikasi yang ditempel jadi satu": **semua modul berbagi satu master data klien yang sama (`public.brands`, DS#4)**. Master itu tidak boleh di-fork per modul. Di atasnya, Internal Dashboard memberi pembacaan portfolio-level lintas seluruh klien — benchmarking yang secara struktural tidak bisa dilihat satu brand sendirian.

## Operating Context

Empat sumber data yang memberi makan seluruh platform:

- **DS#1 Business Data** — Revenue, Transaksi, Qty Sold; breakdown per channel, harian.
- **DS#2 Advertising Data** — Meta Ads, Iklanku Shopee, GMV Max TikTok, Google Ads.
- **DS#3 Sales Channel Data** — Shopee, TikTok Shop, Website.
- **DS#4 MIL Digital Internal Data** — master klien: nama brand, industry/sub-industry, main expectations, sales channel, ad account, BM ID.

Modul yang tampil di sidebar:

| Modul | Sifat | Isi |
|---|---|---|
| Beranda | — | Front door, indeks modul |
| Business Overview | client-facing | Executive Snapshot, Business Growth, Traffic & Funnel, Retention, Transaction Behavior, Basket Analysis, Product Performance — dari data Shopee per brand |
| Report Generator | client-facing | Laporan per brand (Meta Boost/Non-Boost/CPAS, Shopee Ads, TikTok GMV Max), pembandingan dua periode |
| Meta Ads Automation | internal, admin-only | Panel kontrol automasi Google Apps Script: Weekly Campaign Review, Daily Urgent Check, Daily Tracking Boost Post |
| Internal Dashboard MIL Digital | internal, admin-only | Executive Overview, Business Checkup, Kategori Besar, Industry, Benchmarking, Channel & Platform, Client Detail, Data Quality, Input Data |
| History Upload | utilitas | Jejak setiap file yang masuk |

Ritual kerja: unggah ekspor → ETL memetakan per brand + periode → dashboard terbentuk → laporan diunduh dan dikirim ke klien. Data entry Meta Ads tetap **manual untuk semua klien** demi konsistensi, walau sebagian klien (mis. Petite Fleur, Valentine) sudah punya token API.

## Capabilities and Constraints

Aturan perhitungan yang wajib bertahan melewati restyle UI apa pun — ini logika, bukan visual, dan merusaknya membuat angka salah tanpa terlihat salah:

1. **Master klien satu sumber.** `public.brands` (DS#4) tidak boleh di-fork per modul.
2. **Like-for-like vs total absolut adalah dua konsep berbeda.** Perbandingan periode (MoM, benchmarking) hanya mencakup klien yang punya data di *kedua* periode; total absolut mencakup semua klien yang ada datanya. Jangan pernah menggabung keduanya dalam satu angka atau satu label.
3. **Peer group dihitung per sub-industry** — tanpa ambang minimum jumlah klien, dan tanpa eskalasi ke level lebih luas kalau sub-industry-nya kecil.
4. **Agregasi metrik rasio lintas periode: jumlahkan komponen dulu, baru dibagi.** ROAS dan Cost per X tidak pernah dirata-ratakan dari rasio bulanan.
5. **NULL ≠ 0, dan bedanya harus terlihat.** Setiap card dan tabel wajib membedakan "data belum ada" dari "nilainya nol" secara eksplisit dan visual.
6. **Metrik proxy wajib berlabel `PROXY`.** Contoh: Cost per Profile Visit, karena data Instagram profile visits tidak konsisten dari Meta API.
7. **Klasifikasi campaign Meta (Boost Post / Non-Boost Post / CPAS) adalah standar global**, bukan setelan per klien.
8. **Internal Dashboard admin-only**, ditegakkan di route guard, bukan hanya disembunyikan dari nav.
9. **Impor idempotent** dan selalu ter-scope per brand + periode; upload ulang tidak menimpa data existing.

Stack (sudah ada di codebase): React 19 + Vite + React Router, Chart.js, framer-motion, lucide-react; Express + PostgreSQL (schema `shopee` untuk fakta, `public` untuk app layer); deploy Vercel.

## Brand Commitments

- ATLAS adalah produk internal MIL Digital. Wordmark **`ATLAS.`** (huruf A ditekankan + titik) dan `MilMark` adalah komitmen identitas yang dipertahankan.
- **Seluruh UI berbahasa Indonesia.** Label, tombol, state kosong, dan pesan error semuanya Bahasa Indonesia. Istilah metrik tetap Inggris (ROAS, CTR, GMV, CPM, Amount Spent, Add to Cart) — itu kosakata kerja pengguna, bukan jargon yang perlu diterjemahkan.
- Enum nilai di database berbahasa Inggris (`meta_boost`, `tiktok_shop`); labelnya di UI Indonesia. Jangan pernah menampilkan nilai enum mentah.

## Evidence on Hand

- Data produksi nyata: ~33 klien aktif di Internal Dashboard.
- File ekspor contoh di root repo: `Order 0626.xlsx`, `Performance Overview 0626.xlsx`, `Product Performance 0626.xlsx`.
- Bentuk file ekspor ditentukan platform (Shopee/Meta/TikTok) dan **tidak bisa diubah** — impor harus menyesuaikan diri padanya.
- Referensi ETL asal: `import_shopee_data.py`; schema di `schema.sql` + `migrations/`.
- Tidak ada testimonial, benchmark publik, harga, atau klaim pers. Jangan mengarangnya.

## Product Principles

1. **Satu shell, banyak modul — tapi satu kebenaran klien.** Setiap penambahan harus menarik dari master yang sama, bukan membuat salinannya.
2. **Angka harus jujur tentang dirinya sendiri.** Kosong, nol, proxy, dan like-for-like masing-masing terlihat berbeda; ambiguitas di sini lebih berbahaya daripada tampilan yang kurang rapi.
3. **Batas client-facing dan internal tidak pernah kabur.** Permukaan yang dibaca klien tidak boleh membocorkan pembacaan portofolio.
4. **Deliverable-nya adalah file, bukan layar.** Laporan harus tetap bisa diunduh sebagai PDF, PNG per section, dan Excel — itu yang sampai ke klien.
5. **Pengguna sudah tahu produknya.** Ini alat kerja harian, bukan halaman perkenalan: kepadatan dan ketepatan mengalahkan penjelasan.

## Accessibility & Inclusion

Belum ada standar yang ditetapkan secara eksplisit. Kebutuhan yang sudah tercermin di kode dan wajib dipertahankan: dukungan `prefers-reduced-motion`, label dan `aria-label` Bahasa Indonesia pada kontrol ikon-saja, serta pembedaan status yang tidak hanya bergantung pada warna (konsekuensi langsung dari aturan NULL ≠ 0).
