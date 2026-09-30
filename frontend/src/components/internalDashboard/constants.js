// Shared labels/enums for the Internal Dashboard tabs. Enum *values*
// mirror migration 009 (public.sales_channel / public.ad_platform); labels
// are the Indonesian UI text.

export const SALES_CHANNELS = [
  { value: 'shopee', label: 'Shopee' },
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'website', label: 'Website' },
  { value: 'offline', label: 'Offline' },
  { value: 'tokopedia', label: 'Tokopedia' },
  { value: 'blibli', label: 'Blibli' },
  { value: 'lazada', label: 'Lazada' },
];

export const AD_PLATFORMS = [
  { value: 'meta_nonboost', label: 'Meta — Non-boost (Main Account)' },
  { value: 'meta_boost', label: 'Meta — Boost Post' },
  { value: 'meta_cpas', label: 'Meta — CPAS Shopee' },
  { value: 'cpas_tokopedia', label: 'Meta — CPAS Tokopedia' },
  { value: 'iklanku_shopee', label: 'Shopee Iklanku' },
  { value: 'ttam_tiktok', label: 'TikTok Tokopedia Ads Manager (TTAM)' },
  { value: 'gmv_max_tiktok', label: 'TikTok GMV Max' },
  { value: 'google_ads', label: 'Google Ads' },
];
