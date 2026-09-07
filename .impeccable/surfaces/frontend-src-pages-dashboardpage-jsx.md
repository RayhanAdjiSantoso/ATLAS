---
version: 1
slug: "frontend-src-pages-dashboardpage-jsx"
primary_target: "frontend/src/pages/DashboardPage.jsx"
related_targets: ["frontend/src/components/dashboard/DashboardTab.jsx","frontend/src/components/dashboard/FilterPanel.jsx"]
---

Scope: rute `/dashboard` (Dashboard Business Overview) dan komponen di `frontend/src/components/dashboard/`. Visitor mode: **Operate**.

Audience: analyst MIL Digital melakukan root cause analysis per klien; berpotensi dibuka ke orang brand, ter-scope brand sendiri. Job: menemukan *sebab* naik/turunnya angka, bukan sekadar melihat angkanya.

Constraint: tidak boleh ada KPI, chart, atau tabel yang hilang dari layar. Tab "Upload Data" pindah ke halaman baru **Pengaturan Brand** di sidebar (detail menyusul dari user); fungsi simpan datanya wajib tetap hidup dan menyuplai seluruh aplikasi.

## Direction contract

THESIS: Konsol kerja tempat seluruh domain analitik hadir sekaligus dan satu bisa difokuskan — menolak delapan tombol pil sejajar yang menyembunyikan tujuh dari delapan isi halaman.

OWN-WORLD: Sistem `.mil-ui` yang sudah berjalan di Beranda dan Report Generator, tanpa dunia baru: Inter, `--acc` #1e3eb8, ground #fbfcfe, `--shopee` oranye untuk aksen platform, `--good`/`--bad` hanya untuk delta, angka tabular, kartu `.sec-block` bersudut 14px dengan `--shadow`, kurva `--ease-out` cubic-bezier(.22,1,.36,1).

STORY: Analyst memilih brand dan periode sekali di atas, membaca strip KPI, mengenali modul yang bergerak, lalu memfokuskannya untuk membaca seluruh bukti tanpa berpindah halaman atau kehilangan konteks periode.

FIRST VIEWPORT: Bar brand+periode+banding menempel di puncak kanvas. Rail domain vertikal di kiri kanvas — indeks tipografis dengan titik status, tanpa ikon, supaya tidak terbaca sebagai sidebar kedua di sebelah sidebar aplikasi. Kanan: strip KPI, lalu modul fokus selebar kanvas berisi chart dan tabel lengkap, dengan modul-modul lain menyusut jadi kartu ringkas di bawahnya. Aksi utama — mengganti fokus — ada di kartu modul itu sendiri dan di rail.

Dua adaptasi terhadap rencana awal, dicatat karena melenceng dari kata-katanya: (a) strip KPI **bukan satu baris** — ia memuat kedelapan KPI Executive Snapshot dalam 4×2, karena strip ini mengambil alih baris KPI dari panel Snapshot supaya angka yang sama tidak tampil dua kali dalam satu layar; (b) grid modul memakai `auto-fill minmax(268px)` sehingga menjadi **tiga kolom di 1440px**, bukan dua — dua kolom menyisakan lebar mati pada kartu yang isinya satu angka dan satu kalimat.

FORM: Konsol Modul; kandidat ke-5 pada daftar terurut saya; seed key 817ca91a, deal 4/5/3, dipilih user dari tiga kartu.

MOTION: Satu grammar. Pertukaran fokus modul memakai transisi tinggi+opasitas berbasis `--ease-out` yang diorkestrasi sekali, bukan hover-effect tersebar; chart tidak menganimasi ulang saat filter berubah; seluruhnya tunduk pada `prefers-reduced-motion`.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
