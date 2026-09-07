// Single source of truth for the report types the app can generate. Drives
// the home-page rows, the generator's report-type rail, and the
// /report-generator/:platform route param validation. Keys match the old
// PlatformTabs `TabKey` union 1:1 so nothing downstream had to change.
//
// MRG's seventh entry, 'brands' (Pengaturan Brand), is deliberately absent:
// that page reads brand category / description / monthly win-con notes, and
// ATLAS's brands table is (brand_id, brand_name) only. Porting it is backend
// work — a migration plus routes — not a UI move, so it waits for its own
// change.
export type ReportKey = 'meta' | 'shopee' | 'tiktok' | 'business' | 'summary' | 'reports';

export interface ReportNavItem {
  key: ReportKey;
  label: string;
  short: string;
  tagline: string;
  desc: string;
  accent: string; // any CSS color / var()
  tint: string; // a very-light wash of the accent (token/hex, no color-mix) — sidebar pill etc.
  mark: string; // 1–2 char glyph for the icon tile
}

export const REPORT_NAV: ReportNavItem[] = [
  {
    key: 'meta',
    label: 'Meta Ads',
    short: 'Meta',
    tagline: 'Boost, Non-Boost & CPAS',
    desc: 'Perbandingan dua periode untuk Boost / Non-Boost Post, CPAS Shopee, plus breakdown umur & gender.',
    accent: 'var(--acc)',
    tint: 'var(--acc-100)',
    mark: 'M',
  },
  {
    key: 'shopee',
    label: 'Shopee Ads',
    short: 'Shopee',
    tagline: 'Iklan Produk & deep-dive',
    desc: 'Funnel iklan, analisis per produk, tren harian, dan Total Omzet toko yang diisi manual.',
    accent: 'var(--shopee)',
    tint: 'var(--shopee-100)',
    mark: 'S',
  },
  {
    key: 'tiktok',
    label: 'TikTok GMV Max',
    short: 'TikTok',
    tagline: 'Performa GMV Max',
    desc: 'Ringkasan performa kampanye GMV Max dari satu periode ke periode berikutnya.',
    accent: '#111827',
    tint: '#eef1f7',
    mark: 'T',
  },
  {
    key: 'business',
    label: 'Business Overview',
    short: 'Business',
    tagline: 'Online + offline jadi satu',
    desc: 'Menggabungkan seluruh channel penjualan — online, toko offline, channel lain — ke dalam satu ringkasan bisnis.',
    accent: 'var(--biz)',
    tint: 'var(--biz-100)',
    mark: 'B',
  },
  {
    key: 'summary',
    label: 'Summary Overview',
    short: 'Summary',
    tagline: 'Rangkuman semua platform',
    desc: 'Highlight terbaik & terburuk, cost per revenue, dan rekomendasi lintas Meta, Shopee, dan TikTok.',
    accent: 'var(--sum)',
    tint: 'var(--sum-100)',
    mark: 'Σ',
  },
  {
    key: 'reports',
    label: 'Riwayat Laporan',
    short: 'Riwayat',
    tagline: 'Buka laporan tersimpan',
    desc: 'Buka kembali laporan yang pernah dibuat dan disimpan, dikelompokkan per klien.',
    accent: 'var(--muted)',
    tint: 'var(--s2)',
    mark: 'H',
  },
];

export const REPORT_KEYS = REPORT_NAV.map((r) => r.key);

export function isReportKey(v: string | undefined): v is ReportKey {
  return v !== undefined && (REPORT_KEYS as string[]).includes(v);
}

export function reportByKey(key: ReportKey): ReportNavItem {
  return REPORT_NAV.find((r) => r.key === key) as ReportNavItem;
}
