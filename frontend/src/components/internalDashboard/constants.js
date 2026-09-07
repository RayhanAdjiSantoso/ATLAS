// Shared labels/enums for the Internal Dashboard input forms. Enum *values*
// mirror migration 009 (public.sales_channel / public.ad_platform); labels
// are the Indonesian UI text.

export const SALES_CHANNELS = [
  { value: 'shopee', label: 'Shopee' },
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'website', label: 'Website' },
  { value: 'offline', label: 'Offline' },
];

export const AD_PLATFORMS = [
  { value: 'meta_nonboost', label: 'Meta — Non-boost (Main Account)' },
  { value: 'meta_boost', label: 'Meta — Boost Post' },
  { value: 'meta_cpas', label: 'Meta — CPAS' },
  { value: 'iklanku_shopee', label: 'Shopee Iklanku' },
  { value: 'gmv_max_tiktok', label: 'TikTok GMV Max' },
  { value: 'google_ads', label: 'Google Ads' },
];

// client_platform_spend_monthly columns, grouped for the form layout.
export const PLATFORM_SPEND_FIELDS = {
  required: [
    { key: 'amount_spent', label: 'Amount Spent (Rp)', kind: 'money' },
    { key: 'impressions', label: 'Impressions', kind: 'int' },
    { key: 'link_clicks', label: 'Link Clicks', kind: 'int' },
    { key: 'purchase', label: 'Purchase (jumlah)', kind: 'int' },
    { key: 'purchase_value', label: 'Purchase Value (Rp)', kind: 'money' },
  ],
  optionalRaw: [
    { key: 'reach', label: 'Reach', kind: 'int' },
    { key: 'frequency', label: 'Frequency', kind: 'decimal' },
    { key: 'view_content', label: 'View Content', kind: 'int' },
    { key: 'atc', label: 'Add to Cart', kind: 'int' },
    { key: 'lpv', label: 'Landing Page Views', kind: 'int' },
    { key: 'ig_profile_visit', label: 'IG Profile Visit', kind: 'int', proxy: true },
  ],
  ratios: [
    { key: 'cpm', label: 'CPM (Rp)', kind: 'money' },
    { key: 'cpc', label: 'CPC (Rp)', kind: 'money' },
    { key: 'ctr', label: 'CTR (%)', kind: 'decimal' },
    { key: 'cost_per_vc', label: 'Cost / View Content (Rp)', kind: 'money' },
    { key: 'cost_per_atc', label: 'Cost / ATC (Rp)', kind: 'money' },
    { key: 'cost_per_purchase', label: 'Cost / Purchase (Rp)', kind: 'money' },
    { key: 'roas', label: 'ROAS', kind: 'decimal' },
  ],
};

export const TARGET_LABELS = {
  client_monthly_metrics: 'Metrik Bulanan',
  client_channel_sales_monthly: 'Sales per Channel',
  client_platform_spend_monthly: 'Spend per Platform',
  client_sales_channels: 'Channel Dipakai',
  brand_ad_accounts: 'Ad Account Meta',
};

// client_sales_channels.source — where the used/not-used value came from.
export const CSC_SOURCE_LABELS = {
  manual: 'input manual',
  sales_data: 'dari data sales riil',
  ads_text_positive: 'dari teks Display/Marketplace Ads',
  enabled_website_col: 'dari kolom "Enabled Website"',
  display_ads_parse: 'dari parsing Display Ads',
};
