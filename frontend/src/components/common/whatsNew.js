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
    target: '.band-tabs [data-tab="/brand-tracking"]',
    title: 'Minutes of Meeting sudah pindah',
    body: 'Minutes of Meeting tidak lagi ada di Data Collection Hub. Buka Brand Tracking, lalu pilih tab Minutes of Meeting.',
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
