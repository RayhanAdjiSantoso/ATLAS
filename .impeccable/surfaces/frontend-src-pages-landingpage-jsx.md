---
version: 1
slug: "frontend-src-pages-landingpage-jsx"
primary_target: "frontend/src/pages/LandingPage.jsx"
related_targets: []
---

# Homepage publik ATLAS (sebelum login)

Scope: route `/` untuk pengunjung belum login (dan `/selamat-datang` untuk semua). Mode: Persuade — klien MIL dan tim internal yang membuka link ATLAS; aksi utama: Masuk.
Konten wajib: logo MIL sebagai identitas, portofolio singkat MIL Digital, running logo klien (infinite loop), carousel foto yang diatur admin (modul akses `homepage_content`).
Batas: tidak ada klaim komersial yang dikarang; angka hanya dari data nyata (jumlah klien aktif dari `public.brands`). Foto dikompres di browser (storage Neon kecil).

## Direction contract
THESIS: Logo MIL adalah panggungnya — huruf m, i, l raksasa jadi jendela foto; menolak hero teks + gambar stok yang biasa.
OWN-WORLD: dasar #fbfcfe, gradien mil #0A8BF5→#0047E8, tinta #0f1a3a, hairline #dde2ee, Inter berat; foto hanya tampil di dalam huruf.
STORY: pengunjung mengenali MIL, melihat kerja dan klien nyata, lalu Masuk ke ATLAS.
FIRST VIEWPORT: kiri 8 kolom wordmark mil berisi carousel foto + kontrol; kanan kartu Masuk; garis dasar huruf = running logo klien selebar layar.
FORM: Jendela MIL, kandidat #7 dari daftar, seed 82dd4e08.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
