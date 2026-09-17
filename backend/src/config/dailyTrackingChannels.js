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
  { key: 'shopee_iklanku', label: 'Shopee Iklanku' },
  { key: 'gmv_max', label: 'GMV Max' },
  { key: 'ttam', label: 'TTAM' },
];

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
