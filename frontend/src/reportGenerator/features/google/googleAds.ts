import api from '../../../api/client.js';

// Shapes returned by GET /api/google-ads/report (backend/src/services/googleAdsService.js).
export interface GadsMetrics {
  cost: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversions_value: number;
  all_conversions: number;
  ctr: number | null;
  avg_cpc: number | null;
  avg_cpm: number | null;
  cost_per_conv: number | null;
  cvr: number | null;
  roas: number | null;
}

export type GadsCampaign = GadsMetrics & { campaign_id: string; campaign_name: string; channel_type: string; budget: number | null };
export type GadsAdGroup = GadsMetrics & { ad_group_id: string; ad_group_name: string; campaign_name: string; channel_type: string };
export type GadsKeyword = GadsMetrics & { keyword: string; abs_top_impression_pct: number | null; search_lost_top_is_rank: number | null };
export type GadsSearchTerm = GadsMetrics & { search_term: string; match_type: string };
export type GadsCity = GadsMetrics & { city: string };
export type GadsDay = GadsMetrics & { date: string };

export interface GadsPeriod {
  start: string;
  end: string;
  totals: GadsMetrics;
  daily: GadsDay[];
  campaigns: GadsCampaign[];
  adGroups: GadsAdGroup[];
  keywords: GadsKeyword[];
  searchTerms: GadsSearchTerm[];
  cities: GadsCity[];
}

export interface GadsReport {
  accounts: { customerId: string; label: string | null; name: string | null; currency: string | null }[];
  currency: string | null;
  mixedCurrency: boolean;
  coverage: { customer_id: string; first_date: string; last_date: string; days: number }[];
  old: GadsPeriod;
  cur: GadsPeriod;
}

export interface GadsOverview {
  accounts: { id: number; customer_id: string; label: string | null; account_name: string | null; is_active: boolean; coverage: { first_date: string; last_date: string } | null }[];
}

export async function fetchOverview(brandId: number): Promise<GadsOverview> {
  const res = await api.get('/google-ads/overview', { params: { brandId } });
  return res.data;
}

export async function fetchReport(brandId: number, p: { oldStart: string; oldEnd: string; curStart: string; curEnd: string }): Promise<GadsReport> {
  const res = await api.get('/google-ads/report', { params: { brandId, ...p } });
  return res.data;
}

// ── formatting ────────────────────────────────────────────────────────
const CURRENCY: Record<string, { prefix: string; locale: string; digits: number }> = {
  MYR: { prefix: 'RM', locale: 'en-MY', digits: 2 },
  IDR: { prefix: 'Rp', locale: 'id-ID', digits: 0 },
  SGD: { prefix: 'S$', locale: 'en-SG', digits: 2 },
  USD: { prefix: '$', locale: 'en-US', digits: 2 },
};

export interface Formatter {
  money: (v: number | null) => string;
  moneyShort: (v: number | null) => string;
  int: (v: number | null) => string;
  dec: (v: number | null) => string;
  pct: (v: number | null) => string;
}

export function formatter(currency: string | null): Formatter {
  const c = (currency && CURRENCY[currency]) || { prefix: currency ? `${currency} ` : '', locale: 'id-ID', digits: 2 };
  const n = (v: number, digits: number) => v.toLocaleString(c.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return {
    money: (v) => (v == null ? '—' : c.prefix + n(v, c.digits)),
    moneyShort: (v) => (v == null ? '—' : c.prefix + v.toLocaleString(c.locale, { notation: 'compact', maximumFractionDigits: 2 })),
    int: (v) => (v == null ? '—' : Math.round(v).toLocaleString(c.locale)),
    // Conversions are fractional under data-driven attribution (91.66).
    dec: (v) => (v == null ? '—' : v.toLocaleString(c.locale, { maximumFractionDigits: 2 })),
    pct: (v) => (v == null ? '—' : (v * 100).toLocaleString(c.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'),
  };
}

const MATCH_TYPES: Record<string, string> = {
  BROAD: 'Broad',
  EXACT: 'Exact',
  PHRASE: 'Phrase',
  NEAR_EXACT: 'Exact (close variant)',
  NEAR_PHRASE: 'Phrase (close variant)',
};
export const matchTypeLabel = (t: string) => MATCH_TYPES[t] ?? (t ? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ') : '—');

const CHANNELS: Record<string, string> = {
  SEARCH: 'Search', VIDEO: 'Video', DISPLAY: 'Display', PERFORMANCE_MAX: 'Performance Max',
  SHOPPING: 'Shopping', DEMAND_GEN: 'Demand Gen', MULTI_CHANNEL: 'App',
};
export const channelLabel = (t: string) => CHANNELS[t] ?? (t ? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ') : '—');

// ── periods ───────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

// "Sep 2026" for a whole month, "1–15 Sep 2026" / "25 Agu – 3 Sep 2026" otherwise.
export function rangeLabel(start: string, end: string): string {
  const a = parse(start);
  const b = parse(end);
  if (a.getDate() === 1 && b.getDate() === lastDay(b.getFullYear(), b.getMonth()) && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    return `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  }
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}–${b.getDate()} ${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]}${a.getFullYear() !== b.getFullYear() ? ` ${a.getFullYear()}` : ''} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
}

export interface PeriodPair { oldStart: string; oldEnd: string; curStart: string; curEnd: string }

export const PRESETS: { id: string; label: string; build: (today: Date) => PeriodPair }[] = [
  {
    id: 'last-month',
    label: 'Bulan lalu vs sebelumnya',
    build: (t) => {
      const cur = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const old = new Date(t.getFullYear(), t.getMonth() - 2, 1);
      return {
        curStart: iso(cur), curEnd: iso(new Date(cur.getFullYear(), cur.getMonth() + 1, 0)),
        oldStart: iso(old), oldEnd: iso(new Date(old.getFullYear(), old.getMonth() + 1, 0)),
      };
    },
  },
  {
    id: 'mtd',
    label: 'Bulan ini (s.d. kemarin) vs periode sama bulan lalu',
    build: (t) => {
      const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
      const curStart = new Date(y.getFullYear(), y.getMonth(), 1);
      const oldStart = new Date(y.getFullYear(), y.getMonth() - 1, 1);
      const oldEndDay = Math.min(y.getDate(), lastDay(oldStart.getFullYear(), oldStart.getMonth()));
      return {
        curStart: iso(curStart), curEnd: iso(y),
        oldStart: iso(oldStart), oldEnd: iso(new Date(oldStart.getFullYear(), oldStart.getMonth(), oldEndDay)),
      };
    },
  },
  {
    id: 'last-30',
    label: '30 hari terakhir vs 30 hari sebelumnya',
    build: (t) => {
      const day = (offset: number) => iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + offset));
      return { curStart: day(-30), curEnd: day(-1), oldStart: day(-60), oldEnd: day(-31) };
    },
  },
];
