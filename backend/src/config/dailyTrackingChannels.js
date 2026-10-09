// Fixed Daily Tracking channels. These are app-level constants, not DB rows
// — only a brand's own "+ Tambah Channel Baru" additions live in
// daily_tracking_channels (migration 024). Keys must match exactly what
// frontend/src/dailyTracking/lib/constants.js sends, and — for the two meta_*
// keys — what the Apps Script ingest payload sends (see
// apps-script/DailyTrackingBoostPost.gs's postToAtlas_ helper).
export const FIXED_SALES_CHANNELS = [
  { key: 'website', label: 'Website' },
  { key: 'chat', label: 'Chat' },
  { key: 'shopee', label: 'Shopee' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'tokopedia', label: 'Tokopedia' },
  { key: 'offline_store', label: 'Offline Store' },
];

export const FIXED_SPEND_CHANNELS = [
  { key: 'meta_boost_post', label: 'Meta Boost Post' },
  { key: 'meta_nonboost_post', label: 'Meta Non-Boost Post' },
  { key: 'cpas_shopee', label: 'CPAS Shopee' },
  { key: 'cpas_tokopedia', label: 'CPAS Tokopedia' },
  { key: 'shopee_iklanku', label: 'Shopee Iklanku' },
  { key: 'gmv_max', label: 'GMV Max' },
  { key: 'ttam', label: 'TTAM' },
  // Filled from the Google Ads Script runs (googleAdsService.finishRun ->
  // dailyTrackingService.applyGoogleAdsSpend), migration 037.
  { key: 'google_ads', label: 'Google Ads' },
];

// Other names the same fixed channel goes by in client sheets / typed
// labels. A file column or a "+ Tambah Channel Baru" label whose slug is
// listed here IS that fixed channel — never a second pill for one metric.
// (Existing rows under these keys were moved by migration 034.)
export const CHANNEL_ALIASES = {
  sales: {},
  spend: {
    cpas_tokped: 'cpas_tokopedia',
    tiktok_gmv: 'gmv_max',
    google: 'google_ads',
    gads: 'google_ads',
    adwords: 'google_ads',
    google_ad: 'google_ads',
  },
};

export function resolveChannelKey(kind, key) {
  return CHANNEL_ALIASES[kind]?.[key] ?? key;
}

export const FIXED_SALES_KEYS = new Set(FIXED_SALES_CHANNELS.map((c) => c.key));
export const FIXED_SPEND_KEYS = new Set(FIXED_SPEND_CHANNELS.map((c) => c.key));

// Meta channels this feature can auto-sync from the Meta Ads Automation
// pipeline (see dailyTrackingService.runMetaSyncNow / ingestFromAppsScript).
// CPAS Shopee is a Meta channel too (a Meta ad account dedicated to
// Collaborative Ads/Shopee catalog) — same pull mechanism as Boost/Non-Boost
// (campaign-level Meta Graph API insights, H-1), just no name-based split.
export const META_SYNC_CHANNEL_KEYS = ['meta_boost_post', 'meta_nonboost_post', 'cpas_shopee'];

export const FIXED_SALES_LABELS = Object.fromEntries(FIXED_SALES_CHANNELS.map((c) => [c.key, c.label]));
export const FIXED_SPEND_LABELS = Object.fromEntries(FIXED_SPEND_CHANNELS.map((c) => [c.key, c.label]));

// Shared by dailyTrackingService (manual "+ Tambah Channel Baru") and
// dailyTrackingImportParser (a bulk file upload inventing a channel key from
// a spreadsheet column header it doesn't recognize as a fixed channel).
export function slugifyChannelLabel(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Which ad spend buys which sales — the pairing every per-channel ROAS in
// ATLAS uses (Business Overview, Brand Tracking's targets). Meta Non-Boost
// and Google Ads send traffic to the website and chat; Boost Post is
// awareness and has no sales channel of its own, so it only counts in the
// blended ROAS. A brand's custom channels also count only in the blend.
export const ROAS_GROUPS = [
  { key: 'shopee', label: 'Shopee', sales: ['shopee'], spend: ['shopee_iklanku', 'cpas_shopee'] },
  { key: 'tiktok', label: 'TikTok', sales: ['tiktok'], spend: ['gmv_max', 'ttam'] },
  { key: 'tokopedia', label: 'Tokopedia', sales: ['tokopedia'], spend: ['cpas_tokopedia'] },
  { key: 'web', label: 'Website & Chat', sales: ['website', 'chat'], spend: ['meta_nonboost_post', 'google_ads'] },
];
