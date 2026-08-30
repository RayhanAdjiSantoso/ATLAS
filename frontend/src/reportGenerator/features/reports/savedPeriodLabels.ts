// Shared display helpers for the "Pilih dari data tersimpan" picker and the
// per-slot cards that show what was picked.

const CHANNEL_LABELS: Record<string, string> = {
  produk: 'Produk',
  produk_otomatis: 'Produk Otomatis',
  toko: 'Toko',
  toko_keyword: 'Keyword',
  live: 'Live',
  boost: 'Boost',
  nonboost: 'Non-Boost',
  cpas_overall: 'CPAS',
  tiktok: 'Campaign',
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel;
}

// "Produk 103 · Toko 6 · Keyword 38" — a one-line summary of which channels
// a saved period actually holds rows for, so the user can tell instances of
// the same month apart without opening each.
export function formatChannelCoverage(channels: Record<string, number>): string {
  const parts = Object.entries(channels)
    .filter(([, n]) => n > 0)
    .map(([ch, n]) => `${channelLabel(ch)} ${n}`);
  return parts.length ? parts.join(' · ') : '—';
}

export function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const PLATFORM_LABEL: Record<'meta' | 'shopee' | 'tiktok', string> = {
  meta: 'Meta Ads',
  shopee: 'Shopee Ads',
  tiktok: 'TikTok GMV Max',
};
