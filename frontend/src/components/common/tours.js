// The guided tours (Coachmark.jsx), one per page. `target` is a selector on
// the live page; a step whose element is not on screen is skipped, so a
// tour fits every role and every state of its page.

const LAUNCH = {
  target: '[data-tour-launch]',
  title: 'Buka panduan lagi kapan saja',
  body: 'Tombol Panduan di pojok kanan atas memutar ulang penjelasan ini. Panduan tiap halaman berbeda, sesuai isi halamannya.',
  padding: 6,
};

const SECTIONS = {
  target: '.bs .band-tabs',
  kicker: 'Brand Setting',
  title: 'Tiga bagian dalam satu tempat',
  body: 'Brand Context untuk profil dan arah brand, Data Collection Hub untuk semua file data, dan Brand Tracking untuk penjualan serta belanja iklan harian. Pindah bagian kapan saja dari tab ini.',
};

export const TOURS = {
  'brand-context': [
    SECTIONS,
    {
      target: '.bp-portfolio',
      title: 'Ringkasan portofolio',
      body: 'Jumlah brand, status aktif, dan sebaran industri seluruh klien — gambaran cepat sebelum masuk ke satu brand.',
    },
    {
      target: '.bp-list-head',
      title: 'Cari dan saring brand',
      body: 'Ketik nama brand atau saring menurut status. Daftar di bawahnya langsung menyesuaikan.',
    },
    {
      target: '.bp-list-items',
      title: 'Pilih brand',
      body: 'Klik satu brand untuk membuka profilnya di panel kanan.',
    },
    {
      target: '.bp-setting',
      title: 'Konteks & arah brand',
      body: 'Objective & target, strategic priorities, dan constraints brand. Isian ini dibaca tim dan AI Consultant Brief saat menyusun laporan, jadi semakin lengkap semakin tajam analisisnya.',
    },
    LAUNCH,
  ],

  'data-hub': [
    SECTIONS,
    {
      target: '.bp-command',
      title: 'Brand yang sedang dikelola',
      body: 'Semua file di halaman ini milik brand yang dipilih di sini. Di sampingnya: rentang data, jumlah file, dan dataset yang sudah aktif.',
    },
    {
      target: '.bp-tabs',
      title: 'Performance Database & Minutes of Meeting',
      body: 'Performance Database menyimpan file performa per platform. Minutes of Meeting menyimpan catatan dan keputusan meeting brand.',
    },
    {
      target: '.bp-platforms',
      title: 'Pilih platform',
      body: 'Meta Ads, Shopee, TikTok, dan Google Ads. Persentase menunjukkan kelengkapan dataset inti untuk bulan yang tampil.',
    },
    {
      target: '.brand-month-rail',
      title: 'Geser bulan',
      body: 'Tampilkan bulan yang lebih lama atau lebih baru. Titik di tiap bulan menandai ada atau tidaknya data.',
    },
    {
      target: '.brand-ds-table',
      title: 'Matriks dataset × bulan',
      body: 'Satu baris satu dataset, satu kolom satu bulan. Klik sel kosong untuk upload, klik sel berisi untuk melihat detail dan part-nya. Status di kanan merangkum kelengkapannya.',
    },
    {
      target: '.bp-help',
      title: 'Cara upload & memperbarui file',
      body: 'Format, kolom export, dan cara mengganti file ada di sini bila ragu.',
    },
    LAUNCH,
  ],

  'brand-tracking': [
    SECTIONS,
    {
      target: '.bt-command',
      title: 'Brand dan bulan',
      body: 'Pilih brand dan bulan yang ingin dilihat atau diisi. Semua angka di bawah mengikuti pilihan ini.',
    },
    {
      target: '.bt-views',
      title: 'Tiga tampilan',
      body: 'Performance Overview untuk membaca hasil, Target & Budget untuk target bulanan dan alokasi channel, dan Input untuk mengisi penjualan serta belanja iklan harian.',
    },
    {
      target: '.bt-kpis',
      title: 'Angka utama bulan ini',
      body: 'Penjualan, belanja iklan, ROAS, dan transaksi — dengan perubahan dibanding periode sebelumnya.',
    },
    {
      target: '.bt-cmp',
      title: 'Bandingkan dua rentang',
      body: 'Pilih preset atau atur sendiri dua rentang tanggal untuk melihat apa yang berubah per channel.',
    },
    {
      target: '.bt-pulse',
      title: 'Ritme harian',
      body: 'Grafik harian penjualan dan belanja iklan — hari yang melonjak atau bolong langsung terlihat.',
    },
    LAUNCH,
  ],

  'report-generator': [
    {
      target: '.report-generator-app .band-tabs',
      kicker: 'Report Generator',
      title: 'Pilih jenis laporan',
      body: 'Meta Ads, Shopee, TikTok, Google Ads, dan ringkasan bisnis. Tiap tab adalah satu laporan dengan sumber datanya sendiri.',
    },
    {
      target: '.report-generator-app .band-action[href$="/reports"]',
      title: 'Riwayat laporan',
      body: 'Semua laporan yang pernah dibuat tersimpan otomatis dan bisa dibuka lagi dari sini.',
      padding: 6,
    },
    {
      target: '.rgx-command',
      title: 'Brand untuk laporan',
      body: 'Pilih brand dulu. Data dari Data Collection Hub, arsip, dan konteks brand semuanya mengikuti brand ini.',
    },
    {
      target: '.panel.active .stepper',
      title: 'Tiga langkah',
      body: 'Pilih sumber data, generate laporan, lalu lihat dan unduh PDF. Langkah yang sedang aktif ditandai.',
    },
    {
      target: '.panel.active .setup-board',
      title: 'Sumber data per periode',
      body: 'Untuk Periode Lalu dan Periode Ini, pilih Upload, Perpustakaan (Data Collection Hub), Arsip laporan, atau Rentang tanggal. Di Meta Ads, centang Meta Ads, CPAS, atau keduanya.',
    },
    {
      target: '.panel.active .howto',
      title: 'Cara penggunaan',
      body: 'Kolom export yang dibutuhkan dan alurnya lengkap ada di sini.',
    },
    {
      target: '.panel.active .ai-sum',
      title: 'AI Consultant Brief',
      body: 'Setelah laporan dibuat, AI membaca angka, target, Brand Tracking, dan catatan meeting, lalu menyusun verdict, bukti, dan action plan.',
    },
    LAUNCH,
  ],

  'business-overview': [
    {
      target: '.bo-shell .band-tabs',
      kicker: 'Business Overview',
      title: 'Executive Snapshot dan tiap channel',
      body: 'Executive Snapshot merangkum semua channel beserta catatan meeting. Meta Ads, Shopee, dan TikTok membuka analisis per channel.',
    },
    {
      target: '.bo-chip-brand',
      title: 'Brand',
      body: 'Semua angka di halaman ini mengikuti brand yang dipilih di sini.',
      padding: 6,
    },
    {
      target: '.bo-chip-period',
      title: 'Periode',
      body: 'Rentang tanggal yang dianalisis.',
      padding: 6,
    },
    {
      target: '.bo-chip-compare',
      title: 'Bandingkan',
      body: 'Pilih pembanding — periode sebelumnya, bulan lalu, tahun lalu, atau rentang sendiri — supaya setiap angka punya arah naik atau turun.',
      padding: 6,
    },
    {
      target: '.bo-views',
      title: 'Analisis per channel',
      body: 'Business Growth, Traffic & Funnel, dan analisis lain untuk channel yang terbuka. Tab yang lebih pudar belum punya data.',
    },
    {
      target: '.roas-strip',
      title: 'ROAS dari penjualan nyata',
      body: 'ROAS channel ini dihitung dari Brand Tracking — penjualan nyata dibagi belanja iklannya — di samping ROAS blended brand.',
    },
    {
      target: '.bo-shell .soft-content',
      title: 'Area analisis',
      body: 'Grafik dan tabel untuk tab yang dipilih. Di tab Meta Ads, tiap analisis dibuka dengan "Bacaan cepat".',
    },
    LAUNCH,
  ],
};
