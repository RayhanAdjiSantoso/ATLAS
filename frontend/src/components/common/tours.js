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
  title: 'Dua bagian dalam satu tempat',
  body: 'Setup Context & Brand Direction untuk profil, arah, dan target tahunan brand; Data Collection Hub untuk semua file data dan akun iklan. Brand Tracking (angka harian, target, dan meeting) ada di menu tersendiri di sidebar.',
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
      body: 'Semua file di halaman ini milik brand yang dipilih di sini. Di sampingnya: rentang bulan yang sudah punya data.',
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
    {
      target: '.bt-command',
      title: 'Brand dan bulan',
      body: 'Pilih brand dan bulan yang ingin dilihat atau diisi. Semua angka di bawah mengikuti pilihan ini.',
    },
    {
      target: '.bt-views',
      title: 'Tampilan Brand Tracking',
      body: 'Target & Budget untuk rencana tahunan, target bulanan, dan alokasi channel, Input Daily Tracking untuk mengisi penjualan serta belanja iklan harian, dan (khusus tim internal) Minutes of Meeting untuk recap serta to do list tiap meeting. Pembacaan hasil ada di Brand Overview › Executive Snapshot.',
    },
    {
      target: '.bt-coverage',
      title: 'Kelengkapan data',
      body: 'Peta hari yang sudah dan belum terisi per channel. Klik satu hari untuk langsung membuka isiannya.',
    },
    {
      target: '.bt-work',
      title: 'Isi harian',
      body: 'Pilih Revenue, Spending, atau Leads, lalu channel-nya, dan isi angka per hari. Tersimpan otomatis.',
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
      target: '.panel.active .ai-sum',
      title: 'AI Consultant Brief',
      body: 'Setelah laporan dibuat, AI membaca angka, target, Brand Tracking, dan catatan meeting, lalu menyusun verdict, bukti, dan action plan.',
    },
    LAUNCH,
  ],

  'business-overview': [
    {
      target: '.bo-shell .band-tabs',
      kicker: 'Brand Overview',
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
      target: '.bo-chip-range',
      title: 'Periode & pembanding',
      body: 'Klik untuk memilih rentang tanggal yang dianalisis. Centang "Bandingkan" di panelnya untuk menambah periode pembanding — periode sebelumnya, bulan lalu, tahun lalu, atau rentang sendiri — supaya setiap angka punya arah naik atau turun.',
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
