// Fixed Daily Tracking channels — mirrors backend/src/config/dailyTrackingChannels.js
// exactly (keys are the join key across Postgres, Node and the Apps Script
// ingest payload, so don't rename one side without the other).
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

export const META_SYNC_CHANNEL_KEYS = ['meta_boost_post', 'meta_nonboost_post'];
