// "Fitur baru" — a short guide that points at a feature the first time it is
// on an account's screen after it ships (FeatureSpotlight.jsx).
//
// EVERY NEW FEATURE GETS AN ENTRY HERE, on any page or tab. Who sees it:
//   • every account except superadmin (the people who ship the features);
//   • only accounts created BEFORE `released` — a newer account learns the
//     page from its page tour (tours.js) instead;
//   • only for SHOW_FOR_DAYS after `released`, so someone back from a long
//     leave is not met by a queue of old news;
//   • only once its `target` is actually on screen. A feature in a closed
//     tab, or one a role cannot open, waits — it is not marked seen until
//     it has been shown.
// Features on screen at the same moment are shown together, one step each.
//
// Fields:
//   id        unique and permanent (lowercase, digits, dashes) — it is what
//             each account's "seen" list stores, so never rename or reuse one
//   released  'YYYY-MM-DD', the day it ships
//   path      optional route prefix the guide is limited to
//   target    CSS selector of the element to point at — prefer a stable
//             data-* hook (PageBand tabs carry data-tab, Brand Tracking
//             views data-view) over a styling class
//   title, body   what changed and where to find it, in a sentence or two

export const SHOW_FOR_DAYS = 60;

export const WHATS_NEW = [
  {
    id: 'report-generator-tetap-tersimpan',
    released: '2026-10-27',
    target: '[data-nav^="/report-generator"]',
    title: 'Laporan tidak hilang saat pindah halaman',
    body: 'Laporan yang sudah di-generate di Report Generator kini tetap ada saat Anda membuka halaman lain dan kembali lagi — lengkap dengan file, periode, dan tab yang terakhir dibuka.',
  },
  {
    id: 'shopee-report-channel-tabs',
    released: '2026-10-26',
    path: '/report-generator/shopee',
    target: '[data-feature="shopee-roi-root"]',
    title: 'Report Shopee per channel',
    body: 'Report Shopee kini dibagi per tab Overall, Product Ads, Shop+ Ads, Live Ads, dan Banner Ads, masing-masing dengan Traffic, Conversion, Pareto, dan Potential. Overall dibuka dengan ROI yang dipecah ke Revenue dan Spend per channel, Shop+ Ads membandingkan tiap grup iklan, dan Potential Product kini hanya menampilkan produk laku yang belum diiklankan.',
  },
  {
    id: 'meta-boost-instagram-follows',
    released: '2026-10-21',
    path: '/data-brand',
    target: '[data-feature="meta-kolom-ditarik"]',
    title: 'Instagram follows di Boost Post',
    body: 'Tarikan Meta Ads untuk Boost Post kini memuat Instagram follows dan Cost per Instagram follow (Amount spent ÷ follows). Keduanya juga bisa dipilih di alert mingguan dan muncul di Report Generator.',
  },
  {
    id: 'hapus-channel-revenue',
    released: '2026-10-21',
    path: '/brand-tracking',
    target: '[data-feature="hapus-channel"]',
    title: 'Hapus channel yang tidak dipakai',
    body: 'Channel di Revenue Stream, termasuk channel bawaan seperti Shopee atau Tokopedia, kini bisa dihapus bila brand tidak memakainya. Semua datanya ikut terhapus; tambahkan lagi lewat Tambah channel kapan saja.',
  },
  {
    id: 'sidebar-brand-overview-business-insight',
    released: '2026-10-20',
    target: '[data-nav="/dashboard"]',
    title: 'Nama dan urutan menu baru',
    body: 'Business Overview kini bernama Brand Overview, dan Internal Dashboard kini Business Insight. Keduanya bersama Beranda ada paling atas sidebar; grup Operasional menjadi Integration.',
  },
  {
    id: 'pintasan-executive-snapshot',
    released: '2026-10-20',
    path: '/dashboard',
    target: '[data-feature="snapshot-shortcuts"]',
    title: 'Pintasan di Executive Snapshot',
    body: 'Langsung lompat ke Minutes of Meeting di bawah, atau buka Target & Budget brand ini di Brand Tracking.',
  },
  {
    id: 'halaman-extensions',
    released: '2026-10-20',
    target: '[data-nav="/extensions"]',
    title: 'Halaman Extensions',
    body: 'Unduh Chrome extension ATLAS Google Reviews Exporter di sini, lengkap dengan cara memasang dan memakainya.',
  },
  {
    id: 'google-reviews-import-csv',
    released: '2026-10-20',
    path: '/google-reviews',
    target: '[data-feature="gr-csv-import"]',
    title: 'Import CSV Google Reviews',
    body: 'Kumpulkan ulasan dari Google Maps dengan Chrome extension ATLAS Google Reviews Exporter, lalu unggah CSV-nya di sini. ATLAS menampilkan preview dulu, baru menyimpan dan menganalisisnya.',
  },
  {
    id: 'google-reviews-analytics',
    released: '2026-10-19',
    target: '[data-nav="/google-reviews"]',
    title: 'Google Reviews Analytics',
    body: 'Cari bisnis di Google Maps, kumpulkan ulasannya, lalu lihat sentimen, kata yang paling sering dipakai pelanggan, tren, dan ringkasan AI dalam satu halaman.',
  },
  {
    id: 'panduan-google-ads-script',
    released: '2026-10-15',
    path: '/data-brand',
    target: '[data-feature="google-ads-script-guide"]',
    title: 'Panduan setup Google Ads Script',
    body: 'Langkah memasang script di akun Google Ads klien kini ada di sini, lengkap dengan kode yang tinggal disalin. INGEST_KEY tetap diminta ke superadmin via Slack.',
  },
  {
    id: 'mom-di-brand-tracking',
    released: '2026-10-14',
    path: '/brand-tracking',
    target: '.bt-views [data-view="mom"]',
    title: 'Minutes of Meeting sekarang di Brand Tracking',
    body: 'Recap meeting dan to do list tiap brand kini ada di tab ini, berdampingan dengan angka harian brand. Sebelumnya ada di Data Collection Hub.',
  },
  {
    id: 'mom-pindah-dari-data-hub',
    released: '2026-10-14',
    path: '/data-brand',
    target: '[data-nav="/brand-tracking"]',
    title: 'Minutes of Meeting sudah pindah',
    body: 'Minutes of Meeting tidak lagi ada di Data Collection Hub. Buka Brand Tracking di sidebar, lalu pilih tab Minutes of Meeting.',
  },
  {
    id: 'brand-tracking-di-sidebar',
    released: '2026-10-15',
    target: '[data-nav="/brand-tracking"]',
    title: 'Brand Tracking sekarang menu sendiri',
    body: 'Brand Tracking keluar dari Brand Setting dan kini punya menu sendiri di sidebar: angka harian, target, dan Minutes of Meeting tiap brand.',
  },
  {
    id: 'target-tahunan',
    released: '2026-10-15',
    path: '/pengaturan-brand',
    target: '[data-feature="target-tahunan"]',
    title: 'Target tahunan brand',
    body: 'Isi target sales dan budget iklan setahun di sini. Brand Tracking membaginya otomatis ke 12 bulan, setiap update tersimpan tanpa menghapus target awal, dan target awal yang salah input bisa dikoreksi.',
  },
  {
    id: 'rencana-tahunan',
    released: '2026-10-15',
    path: '/brand-tracking',
    target: '[data-feature="rencana-tahunan"]',
    title: 'Rencana tahunan per bulan',
    body: 'Target tahunan dari Brand Setting dibagi ke 12 bulan di sini. Atur pembagiannya sendiri bila perlu — totalnya harus tetap 100%.',
  },
  {
    id: 'akses-beberapa-brand',
    released: '2026-10-14',
    path: '/pengaturan-akses',
    target: '[data-feature="akses-brand"]',
    title: 'Satu akun, beberapa brand',
    body: 'Akun User (Internal) kini bisa diberi lebih dari satu brand: centang semua brand yang ditanganinya. Akun client tetap dibatasi ke satu brand.',
  },
];
