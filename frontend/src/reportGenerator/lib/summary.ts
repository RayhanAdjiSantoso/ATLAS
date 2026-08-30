import type { DeltaClassName } from './types';

// ══════════════════════════════════════════════════════
// SUMMARY OVERVIEW — platform result registry + insight engine, ported 1:1.
// Modular by design: adding a new platform only requires pushing its config
// here and having its tab report a PlatformResultData on successful generate.
// ══════════════════════════════════════════════════════

export const PLATFORM_CONFIG = [
  { key: 'meta', label: 'Meta Ads', color: '#1e3eb8' },
  { key: 'shopee', label: 'Shopee Ads', color: '#ee4d2d' },
  { key: 'tiktok', label: 'TikTok GMV Max', color: '#010101' },
] as const;

export type PlatformKey = (typeof PLATFORM_CONFIG)[number]['key'];

// Curated subset of metric keys shown in the per-platform headline card;
// platforms not listed here fall back to their first N kpis.
export const SUMMARY_HEADLINE_KEYS: Partial<Record<PlatformKey, string[]>> = {
  shopee: ['omzetTotal', 'kontribusi', 'biaya', 'pesanan', 'roas'],
  tiktok: ['cost', 'orders', 'revenue', 'roi'],
};

export interface SummaryKpi {
  key?: string;
  label: string;
  old: string;
  cur: string;
  delta: string;
  deltaNum: number | null;
  cls: DeltaClassName;
}

export interface SpendEntry {
  old: number | null;
  cur: number | null;
}

export interface PlatformResultData {
  period: { old: string; cur: string };
  kpis: SummaryKpi[];
  cpasKpis?: SummaryKpi[];
  spend: Record<string, SpendEntry | undefined>;
}

export interface PlatformState {
  done: boolean;
  error: string | null;
  data: PlatformResultData | null;
}

export type PlatformStateMap = Record<PlatformKey, PlatformState>;

export function emptyPlatformState(): PlatformState {
  return { done: false, error: null, data: null };
}

export function emptyPlatformStateMap(): PlatformStateMap {
  return { meta: emptyPlatformState(), shopee: emptyPlatformState(), tiktok: emptyPlatformState() };
}

// Normalizes the various row shapes produced by buildKPI / buildShopeeKPIRows
// / buildTiktokKPIRows / buildCprRow into one common summary-kpi shape. `cur`
// covers rows shaped {cur}, `val` covers Meta's buildKPI rows shaped {val}.
export function toSummaryKpi(row: { key?: string; col?: string; label?: string; old: string; cur?: string; val?: string; delta: string; deltaNum?: number | null; cls: DeltaClassName }): SummaryKpi {
  return {
    key: row.key ?? row.col,
    label: row.label ?? row.col ?? '',
    old: row.old,
    cur: row.cur !== undefined ? row.cur : (row.val ?? ''),
    delta: row.delta,
    deltaNum: row.deltaNum === undefined ? null : row.deltaNum,
    cls: row.cls,
  };
}

export interface SpendItem {
  label: string;
  old: number | null;
  cur: number | null;
}

// Pulls the raw (unformatted) Amount Spent figures each platform's generate()
// step stashed in platformState[key].data.spend — kept as plain numbers
// specifically so they can be summed without re-parsing formatted
// "Rp1.234.567" strings back out of the display KPIs.
//
// Meta's CPAS "Overall" spend is deliberately excluded here — Overall already
// aggregates NV + RM (+ any unmatched campaigns), so summing it alongside NV
// and RM would double-count those campaigns' spend.
export function computeTotalAmountSpentItems(platformState: PlatformStateMap): SpendItem[] {
  const items: SpendItem[] = [];
  const push = (label: string, entry: SpendEntry | undefined) => {
    if (entry && entry.cur != null && !isNaN(entry.cur)) items.push({ label, old: entry.old, cur: entry.cur });
  };
  const m = platformState.meta.done && platformState.meta.data ? platformState.meta.data.spend : null;
  if (m) {
    push('Boost Post · Amount Spent (IDR)', m.boost);
    push('Non-Boost Post · Amount Spent (IDR)', m.nonboost);
    push('CPAS Marketplace · NV · Amount Spent (IDR)', m.cpasNV);
    push('CPAS Marketplace · RM · Amount Spent (IDR)', m.cpasRM);
  }
  const s = platformState.shopee.done && platformState.shopee.data ? platformState.shopee.data.spend : null;
  if (s) push('Shopee Ads · Biaya', s.ads);
  const t = platformState.tiktok.done && platformState.tiktok.data ? platformState.tiktok.data.spend : null;
  if (t) push('TikTok GMV Max · Cost', t.overall);
  return items;
}

export interface SummaryInsightKpi extends SummaryKpi {
  platform: string;
  platformKey: PlatformKey;
}

export interface SummaryInsights {
  all: SummaryInsightKpi[];
  significant: SummaryInsightKpi[];
  best: SummaryInsightKpi | null;
  worst: SummaryInsightKpi | null;
  topInsights: SummaryInsightKpi[];
  opportunities: SummaryInsightKpi[];
  recommendations: { platform: string; priority: 'Tinggi' | 'Sedang' | 'Rendah'; text: string }[];
}

// Purely synthesizes the KPI deltas already computed by each platform's
// generate() step (platformState) — no raw data is re-aggregated here.
export function computeSummaryInsights(platformState: PlatformStateMap): SummaryInsights {
  const all: SummaryInsightKpi[] = [];
  PLATFORM_CONFIG.forEach((p) => {
    const st = platformState[p.key];
    if (!st || !st.done || !st.data) return;
    (st.data.kpis || []).forEach((k) => {
      if (k.deltaNum === null || k.deltaNum === undefined || isNaN(k.deltaNum)) return;
      all.push({ ...k, platform: p.label, platformKey: p.key });
    });
  });
  const bySize = [...all].sort((a, b) => Math.abs(b.deltaNum as number) - Math.abs(a.deltaNum as number));
  const platformOrder = Object.fromEntries(PLATFORM_CONFIG.map((p, i) => [p.key, i]));
  // Selection (which items make the cut) stays magnitude-based; only the
  // final display order is regrouped by channel (Meta → Shopee → TikTok),
  // stable-sorted so magnitude order is preserved within each channel.
  const byChannel = (arr: SummaryInsightKpi[]) => [...arr].sort((a, b) => (platformOrder[a.platformKey] ?? 99) - (platformOrder[b.platformKey] ?? 99));
  const significant = byChannel(bySize.filter((k) => Math.abs(k.deltaNum as number) >= 15));
  const good = bySize.filter((k) => k.cls === 'delta-good');
  const bad = bySize.filter((k) => k.cls === 'delta-bad');
  const best = good[0] || null;
  const worst = bad[0] || null;
  const topInsights = byChannel(bySize.slice(0, 5));
  const opportunities = byChannel(bad.slice(0, 5));
  const recommendations = opportunities.map((o) => {
    const mag = Math.abs(o.deltaNum as number);
    const priority: 'Tinggi' | 'Sedang' | 'Rendah' = mag >= 25 ? 'Tinggi' : mag >= 10 ? 'Sedang' : 'Rendah';
    const dir = (o.deltaNum as number) >= 0 ? 'naik' : 'turun';
    return {
      platform: o.platform,
      priority,
      text: `${o.platform} — ${o.label} ${dir} ${mag.toFixed(1)}% dibanding periode lalu. Tinjau alokasi budget/strategi untuk metrik ini.`,
    };
  });
  return { all, significant, best, worst, topInsights, opportunities, recommendations };
}
