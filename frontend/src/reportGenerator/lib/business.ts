// ══════════════════════════════════════════════════════
// BUSINESS OVERVIEW METRICS — ported 1:1 from the original vanilla-JS logic.
// The original kept this state as mutable globals + direct DOM reads (e.g.
// reading Shopee's omzet <input> straight out of the page); here it's all
// parameterized through an explicit BizState so the calculations are pure
// and testable, with the actual state living in the Business Overview React
// component (and the Shopee omzet value passed in from the Shopee tab).
// ══════════════════════════════════════════════════════

export type BizMetricKey = 'revenue' | 'transactions' | 'qty';
export type BizPeriod = 'old' | 'cur';

export interface BizMetricPair {
  old: number | null;
  cur: number | null;
}

export interface BizChannelMetrics {
  revenue: BizMetricPair;
  transactions: BizMetricPair;
  qty: BizMetricPair;
}

export interface BizRow extends BizChannelMetrics {
  id: number;
  name: string;
}

export function emptyBizMetric(): BizMetricPair {
  return { old: null, cur: null };
}

export function emptyBizChannel(): BizChannelMetrics {
  return { revenue: emptyBizMetric(), transactions: emptyBizMetric(), qty: emptyBizMetric() };
}

export const BIZ_INPUT_CHANNELS = [
  { key: 'shopee', label: 'Shopee' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'tokopedia', label: 'Tokopedia' },
  { key: 'website', label: 'Website' },
  { key: 'chat', label: 'Chat' },
] as const;

export const BIZ_ALL_CHANNELS = [...BIZ_INPUT_CHANNELS, { key: 'offline_sales', label: 'Offline Sales' }, { key: 'other_channel', label: 'Other Channel' }] as const;

export interface BizState {
  channelData: Record<string, BizChannelMetrics>;
  offlineStores: BizRow[];
  otherChannels: BizRow[];
  // Shopee's "Total Omzet Toko" (Pesanan Dibuat status, entered on the Shopee
  // Ads tab) is the only place the app already holds genuine total-channel
  // revenue — reused here instead of asking for the same number twice.
  shopeeOmzet: BizMetricPair;
}

export function sumMaybe(vals: (number | null | undefined)[]): number | null {
  const present = vals.filter((v): v is number => v != null && !isNaN(v));
  if (!present.length) return null;
  return present.reduce((a, b) => a + b, 0);
}

export function bizChannelValue(state: BizState, chKey: string, metric: BizMetricKey, period: BizPeriod): number | null {
  if (chKey === 'offline_sales') return sumMaybe(state.offlineStores.map((r) => r[metric][period]));
  if (chKey === 'other_channel') return sumMaybe(state.otherChannels.map((r) => r[metric][period]));
  let v = state.channelData[chKey] ? state.channelData[chKey][metric][period] : null;
  if (v == null && chKey === 'shopee' && metric === 'revenue') v = state.shopeeOmzet[period];
  return v;
}

export function bizTotalMetric(state: BizState, metric: BizMetricKey, period: BizPeriod): number | null {
  return sumMaybe(BIZ_ALL_CHANNELS.map((ch) => bizChannelValue(state, ch.key, metric, period)));
}

export function safeDiv(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num == null || den == null || isNaN(num) || isNaN(den) || den === 0) return null;
  const r = num / den;
  return isFinite(r) ? r : null;
}

// chKey === '__total__' computes the metric across all channels combined.
export function bizAOV(state: BizState, period: BizPeriod, chKey: string): number | null {
  const rev = chKey === '__total__' ? bizTotalMetric(state, 'revenue', period) : bizChannelValue(state, chKey, 'revenue', period);
  const tx = chKey === '__total__' ? bizTotalMetric(state, 'transactions', period) : bizChannelValue(state, chKey, 'transactions', period);
  return safeDiv(rev, tx);
}

export function bizAUR(state: BizState, period: BizPeriod, chKey: string): number | null {
  const rev = chKey === '__total__' ? bizTotalMetric(state, 'revenue', period) : bizChannelValue(state, chKey, 'revenue', period);
  const qty = chKey === '__total__' ? bizTotalMetric(state, 'qty', period) : bizChannelValue(state, chKey, 'qty', period);
  return safeDiv(rev, qty);
}

export function bizBasket(state: BizState, period: BizPeriod, chKey: string): number | null {
  const qty = chKey === '__total__' ? bizTotalMetric(state, 'qty', period) : bizChannelValue(state, chKey, 'qty', period);
  const tx = chKey === '__total__' ? bizTotalMetric(state, 'transactions', period) : bizChannelValue(state, chKey, 'transactions', period);
  return safeDiv(qty, tx);
}

// Total Amount Spent is intentionally not reduced to 0 when no platform
// report exists yet — that's "unknown", not "zero spend" — so Cost per
// Revenue shows "—" instead of a misleading Rp0.
export function bizTotalAmountSpent(spendItems: { old: number | null; cur: number | null }[], period: BizPeriod): number | null {
  if (!spendItems.length) return null;
  return sumMaybe(spendItems.map((i) => i[period]));
}

export function bizCostPerRevenue(state: BizState, spendItems: { old: number | null; cur: number | null }[], period: BizPeriod): number | null {
  return safeDiv(bizTotalAmountSpent(spendItems, period), bizTotalMetric(state, 'revenue', period));
}

export function bizBadgeLabel(state: BizState): string {
  const filled = BIZ_ALL_CHANNELS.filter((ch) => (['revenue', 'transactions', 'qty'] as BizMetricKey[]).some((m) => bizChannelValue(state, ch.key, m, 'old') != null || bizChannelValue(state, ch.key, m, 'cur') != null));
  return filled.length ? `${filled.length}/${BIZ_ALL_CHANNELS.length}` : '—';
}

export function parseBizInputValue(str: string | null | undefined): number | null {
  const raw = String(str == null ? '' : str).replace(/[^\d]/g, '');
  return raw === '' ? null : parseInt(raw, 10);
}

export function formatBizInputValue(v: number | null): string {
  return v == null ? '' : v.toLocaleString('id-ID');
}

export function fmtBizNum(v: number | null | undefined): string {
  return v == null || isNaN(v) ? '—' : Math.round(v).toLocaleString('id-ID');
}
export function fmtBizRp(v: number | null | undefined): string {
  return v == null || isNaN(v) ? '—' : 'Rp' + Math.round(v).toLocaleString('id-ID');
}
export function fmtBizDec(v: number | null | undefined): string {
  return v == null || isNaN(v) ? '—' : v.toFixed(2);
}
export function fmtBizPct(v: number | null | undefined): string {
  return v == null || isNaN(v) ? '—' : (v * 100).toFixed(2) + '%';
}
