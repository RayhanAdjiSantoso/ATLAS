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

export type GadsCampaign = GadsMetrics & { customer_id: string; campaign_id: string; campaign_name: string; channel_type: string; budget: number | null; active_days?: number };
export type GadsAdGroup = GadsMetrics & { ad_group_id: string; ad_group_name: string; campaign_name: string; channel_type: string };
export type GadsKeyword = GadsMetrics & { keyword: string; abs_top_impression_pct: number | null; search_lost_top_is_rank: number | null };
export type GadsSearchTerm = GadsMetrics & { search_term: string; match_type: string };
export type GadsCity = GadsMetrics & { city: string };
export type GadsDay = GadsMetrics & { date: string };

// ── datasets of migrations 040/041 and the rule-based insights ─────────
// All optional: an account whose script predates them returns empty lists,
// and a backend before them returns none — every section copes with both.
export type GoalKey = 'purchase' | 'lead' | 'micro' | 'other' | 'ignore';

export interface GadsGoalTotal {
  goal: GoalKey;
  conversions: number;
  conversions_value: number;
  all_conversions: number;
  all_conversions_value: number;
  actions: number;
  unverified: number;
  results?: number;
  value?: number;
  blended_cost_per_result?: number | null;
  blended_roas?: number | null;
  focus_campaigns?: number;
  focus_cost?: number;
  focus_results?: number;
  focus_cost_per_result?: number | null;
  focus_roas?: number | null;
}

export interface GadsConversionAction {
  customer_id: string;
  conversion_action_id: string;
  name: string;
  category: string | null;
  status: string | null;
  primary: boolean | null;
  account_primary: boolean | null;
  goal: GoalKey;
  goal_source: 'manual' | 'default';
  conversions: number;
  conversions_value: number;
  all_conversions: number;
  all_conversions_value: number;
  campaigns: { campaign_id: string; campaign_name: string; conversions: number; all_conversions: number; conversions_value: number }[];
}

export interface GadsAssetText { text: string; pinned: string | null; label: string | null }
export type GadsAd = GadsMetrics & {
  customer_id: string; campaign_id: string; campaign_name: string; ad_group_id: string; ad_group_name: string; ad_id: string;
  ad_type: string; ad_status: string; ad_strength: string | null; final_urls: string[] | null;
  headlines: GadsAssetText[] | null; descriptions: GadsAssetText[] | null; path1: string | null; path2: string | null;
  flags?: string[]; cost_share_in_group?: number | null;
};

export interface GadsShares {
  granularity: 'range' | 'daily_estimate' | 'unavailable';
  search_impression_share: number | null;
  search_budget_lost_is: number | null;
  search_rank_lost_is: number | null;
  search_top_is: number | null;
  search_abs_top_is: number | null;
}
export type GadsCampaignShares = GadsShares & { customer_id: string; campaign_id: string; campaign_name: string };

export interface GadsCampaignSetting {
  customer_id: string; campaign_id: string; campaign_name: string; status: string | null; channel_type: string | null;
  budget_amount: number | null; budget_shared: boolean | null; bidding_strategy_type: string | null; bidding_strategy_source: string | null;
  bidding_strategy_name: string | null; target_cpa: number | null; target_roas: number | null; target_impression_share: number | null;
  conversion_goals: { category: string; origin: string; biddable: boolean }[] | null;
  locations_included: string[] | null; locations_excluded: string[] | null; unavailable: string[];
  start_date: string | null; end_date: string | null;
}
export type GadsSettingChange = GadsCampaignSetting & { valid_from: string; changed_fields: { field: string; from: unknown; to: unknown }[] };

export type KeywordClass = 'performing' | 'high_potential' | 'underperforming' | 'no_conversion' | 'insufficient_data';
export type GadsKeywordDetail = GadsMetrics & {
  customer_id: string; campaign_id: string; campaign_name: string; ad_group_id: string; ad_group_name: string;
  keyword: string; match_type: string; quality_score: number | null; expected_ctr: string | null; ad_relevance: string | null;
  landing_page_experience: string | null; quality_date: string | null; search_impression_share: number | null;
  search_lost_top_is_rank: number | null; classification: KeywordClass; reasons: string[]; quality_flags: string[]; suggested_action: string;
};

export type TermClass = 'high_intent' | 'new_keyword_opportunity' | 'potential_negative' | 'informational' | 'competitor' | 'location_mismatch' | 'requires_review' | 'monitoring';
export type GadsTermDetail = GadsMetrics & {
  search_term: string; match_type: string; campaign_name: string; ad_group_name: string;
  classification: TermClass; reasons: string[]; suggested_action: string;
};
export interface GadsTermSummary {
  observed_no_conversion_spend: number; potentially_irrelevant_spend: number; confirmed_irrelevant_spend: number | null;
  search_term_cost: number; search_campaign_cost: number; coverage: number | null; coverage_warning: string | null;
  by_class: Record<TermClass, { terms: number; cost: number; conversions: number }>;
  negative_candidates: { text: string; classification: TermClass; cost: number; campaign_name: string }[];
  listed?: number; total_terms?: number;
}

export type GadsDevice = GadsMetrics & { device: string; cost_share: number | null; conversion_share: number | null; flags: string[] };
export type GadsHourCell = GadsMetrics & { dow: number; hour: number; days: number };
export type GadsHour = GadsMetrics & { hour: number };
export interface GadsSchedule {
  grid: GadsHourCell[]; hours: GadsHour[]; top_by_clicks: number[]; top_by_conversions: number[];
  underperforming_hours: { hour: number; cost: number; clicks: number; conversions: number; cost_per_conv: number | null }[];
  data_sufficient: boolean; note: string | null; support: { conversions: number; clicks: number; days: number };
}
export interface GadsLandingPage {
  url: string; variants: number; clicks: number | null; impressions: number | null; cost: number | null; conversions: number | null;
  conversions_value: number | null; campaigns: string[]; ctr: number | null; avg_cpc: number | null; cvr: number | null;
  cost_per_conv: number | null; flags: string[];
}
export interface GadsPageTotals { pages: number; clicks: number | null; impressions: number | null; cost: number | null; conversions: number | null }
export interface GadsMessageMatch {
  ad_group_id: string; ad_group_name: string; campaign_name: string; cost: number; headline_match: number | null; url_match: number | null;
  missing_in_headlines: string[]; flag: string | null;
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export interface GadsFinding {
  id: string; entity_type: 'account' | 'campaign'; entity_id: string | null; entity_name: string; customer_id: string | null;
  type: string; severity: Severity; confidence: 'high' | 'medium' | 'low';
  metrics: Record<string, { old: number | null; cur: number | null; change: number | null }>;
  facts: string[]; possible_causes: string[]; next_steps: string[];
}
export interface GadsAnomaly { date: string; metric: 'cost' | 'clicks' | 'conversions' | 'cpa'; value: number; expected: number; z: number; direction: 'up' | 'down' }

export interface GadsPeriod {
  start: string;
  end: string;
  totals: GadsMetrics;
  daily: GadsDay[];
  campaigns: GadsCampaign[];
  adGroups: GadsAdGroup[];
  keywords: GadsKeyword[];
  searchTerms: GadsSearchTerm[];
  // 'upload' / 'mixed': an uploaded Search terms report in Data & file
  // replaced the script's numbers for (some of) the period's months.
  searchTermsSource?: 'atlas' | 'upload' | 'mixed';
  cities: GadsCity[];
  conversionActions?: GadsConversionAction[];
  goals?: Record<GoalKey, GadsGoalTotal>;
  campaignGoals?: Record<string, { goal: 'purchase' | 'lead' | 'mixed'; source: string }>;
  ads?: GadsAd[];
  competitive?: { campaigns: GadsCampaignShares[] };
  keywordDetail?: GadsKeywordDetail[];
  keywordSummary?: Record<KeywordClass, number>;
  searchTermDetail?: GadsTermDetail[];
  searchTermSummary?: GadsTermSummary;
  devices?: { devices: GadsDevice[]; bid_adjustment_note: string | null };
  schedule?: GadsSchedule;
  landingPages?: { conversions_available: boolean; speed_available: boolean; note: string | null; totals: GadsPageTotals; others: GadsPageTotals | null; pages: GadsLandingPage[] };
  messageMatch?: GadsMessageMatch[];
}

// Auction insights shares, 0..1. `text` is set when the export gave words
// instead of a number ("< 10%").
export interface GadsShare { value: number | null; text: string | null }
export interface GadsAuctionRow {
  domain: string;
  isYou: boolean;
  impression_share: GadsShare;
  overlap_rate: GadsShare;
  position_above_rate: GadsShare;
  top_of_page_rate: GadsShare;
  abs_top_of_page_rate: GadsShare;
  outranking_share: GadsShare;
}
export interface GadsAuctionPeriod { months: string[]; files: string[]; rows: GadsAuctionRow[] }

export interface GadsChange {
  changed_at: string;
  user_email: string | null;
  client_type: string | null;
  resource_type: string | null;
  operation: string | null;
  campaign_name: string | null;
  ad_group_name: string | null;
  changes: string | null;
  source: 'atlas' | 'upload';
}

export interface GadsReport {
  accounts: { customerId: string; label: string | null; name: string | null; currency: string | null }[];
  currency: string | null;
  mixedCurrency: boolean;
  coverage: { customer_id: string; first_date: string; last_date: string; days: number }[];
  old: GadsPeriod;
  cur: GadsPeriod;
  auctionInsights: { old: GadsAuctionPeriod; cur: GadsAuctionPeriod };
  changeHistory: { rows: GadsChange[]; uploadedFiles: string[] };
  campaignSettings?: GadsCampaignSetting[];
  campaignSettingChanges?: GadsSettingChange[];
  dataAvailability?: Record<string, { dataset: string; first_date: string | null; last_date: string | null; fetched_at: string | null }>;
  diagnostics?: GadsFinding[];
  anomalies?: { anomalies: GadsAnomaly[]; status: 'normal' | 'monitoring' | 'anomaly' };
}

export interface GadsGoalActions {
  actions: (Omit<GadsConversionAction, 'primary' | 'account_primary' | 'conversions' | 'conversions_value' | 'all_conversions' | 'all_conversions_value' | 'campaigns'> & {
    include_in_conversions: boolean | null; source: string; unavailable: string[];
  })[];
  goals: GoalKey[];
}

export async function fetchConversionGoals(brandId: number): Promise<GadsGoalActions> {
  const res = await api.get('/google-ads/conversion-goals', { params: { brandId } });
  return res.data;
}

export async function saveConversionGoal(brandId: number, customerId: string, conversionActionId: string, goal: GoalKey | null): Promise<GadsGoalActions> {
  const res = await api.put('/google-ads/conversion-goals', { brandId, customerId, conversionActionId, goal });
  return res.data;
}

export const GOAL_LABELS: Record<GoalKey | 'mixed', string> = {
  purchase: 'Purchase', lead: 'Lead', micro: 'Micro conversion', other: 'Lainnya', ignore: 'Abaikan', mixed: 'Campuran',
};

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

// ── optimisation (migration 042) ────────────────────────────────────
export type RecStatus = 'new' | 'reviewed' | 'planned' | 'in_progress' | 'monitoring' | 'completed' | 'dismissed';
export interface GadsRecommendation {
  id: number; entity_type: string; entity_id: string | null; entity_name: string | null; category: string; title: string; finding: string;
  evidence: string[]; possible_cause: string | null; recommended_action: string; expected_direction: string | null;
  priority: Severity; confidence: 'high' | 'medium' | 'low'; risk: string | null; success_metric: string | null; monitoring_period: string | null;
  status: RecStatus; notes: string | null; times_seen: number; first_seen_at: string; last_seen_at: string; period_start: string | null; period_end: string | null;
  status_updated_by_name: string | null; task_key: string | null; task_done: boolean | null; task_meeting_date: string | null;
}

export type ExpMetric = 'cpa' | 'conversions' | 'cvr' | 'ctr' | 'cpc' | 'roas' | 'cost' | 'conversions_value' | 'impressions' | 'clicks';
export interface GadsExperiment {
  id: number; customer_id: string | null; campaign_id: string | null; campaign_name: string | null; recommendation_id: number | null;
  hypothesis: string; planned_action: string | null; actual_change: string | null; pic: string | null; start_date: string; evaluation_date: string | null;
  baseline_start: string; baseline_end: string; eval_start: string; eval_end: string; success_metric: ExpMetric; expected_direction: 'increase' | 'decrease';
  status: 'planned' | 'running' | 'evaluating' | 'completed' | 'cancelled'; result: 'improved' | 'declined' | 'inconclusive' | null; notes: string | null;
  baseline_snapshot: (GadsMetrics & { captured_at: string }) | null; created_by_name: string | null;
  last_result: { evaluated_at: string; metric: ExpMetric; baseline: GadsMetrics; evaluation: GadsMetrics; change: number | null; verdict: 'improved' | 'declined' | 'inconclusive'; limitations: string[] } | null;
}

export interface GadsAlert {
  id: number; customer_id: string | null; alert_key: string; type: string; severity: Severity; title: string; message: string;
  status: 'open' | 'acknowledged' | 'resolved'; first_seen_at: string; last_seen_at: string;
}

const brandParam = (brandId: number) => ({ params: { brandId } });
export const optimizationApi = {
  recommendations: async (brandId: number): Promise<GadsRecommendation[]> => (await api.get('/google-ads/recommendations', brandParam(brandId))).data.recommendations,
  generate: async (brandId: number, p: PeriodPair): Promise<{ inserted: number; refreshed: number; skipped: number; data_limitations: string[]; recommendations: GadsRecommendation[] }> =>
    (await api.post('/google-ads/recommendations/generate', { brandId, ...p })).data,
  updateRecommendation: async (brandId: number, id: number, patch: { status?: RecStatus; notes?: string | null }): Promise<GadsRecommendation> =>
    (await api.patch(`/google-ads/recommendations/${id}`, { brandId, ...patch })).data,
  toTask: async (brandId: number, id: number, pic: string): Promise<GadsRecommendation> => (await api.post(`/google-ads/recommendations/${id}/task`, { brandId, pic })).data,
  experiments: async (brandId: number): Promise<GadsExperiment[]> => (await api.get('/google-ads/experiments', brandParam(brandId))).data.experiments,
  createExperiment: async (brandId: number, input: Partial<GadsExperiment>): Promise<GadsExperiment> => (await api.post('/google-ads/experiments', { brandId, ...input })).data,
  updateExperiment: async (brandId: number, id: number, input: Partial<GadsExperiment>): Promise<GadsExperiment> => (await api.patch(`/google-ads/experiments/${id}`, { brandId, ...input })).data,
  deleteExperiment: async (brandId: number, id: number) => (await api.delete(`/google-ads/experiments/${id}`, brandParam(brandId))).data,
  evaluate: async (brandId: number, id: number): Promise<{ experiment: GadsExperiment; related_changes: { changed_at: string; campaign_name: string | null; changes: string | null; user_email: string | null }[] }> =>
    (await api.post(`/google-ads/experiments/${id}/evaluate`, { brandId })).data,
  alerts: async (brandId: number): Promise<GadsAlert[]> => (await api.get('/google-ads/alerts', brandParam(brandId))).data.alerts,
  setAlert: async (brandId: number, id: number, status: GadsAlert['status']): Promise<GadsAlert[]> => (await api.patch(`/google-ads/alerts/${id}`, { brandId, status })).data.alerts,
};

export const apiError = (err: unknown, fallback: string) => {
  const e = err as { response?: { data?: { message?: string; details?: { msg?: string }[] } }; message?: string };
  return e.response?.data?.details?.[0]?.msg || e.response?.data?.message || e.message || fallback;
};

export interface GadsCopySuggestion { text: string; length: number; rationale: string | null; has_keyword: boolean }
export interface GadsAdCopy { ad_group: string; campaign: string; headlines: GadsCopySuggestion[]; descriptions: GadsCopySuggestion[]; dropped: { text: string; reason: string }[]; notes: string[] }
export async function fetchAdCopy(brandId: number, ad: { customer_id: string; ad_group_id: string }, p: PeriodPair): Promise<GadsAdCopy> {
  return (await api.post('/google-ads/ad-copy', { brandId, customerId: ad.customer_id, adGroupId: ad.ad_group_id, ...p })).data;
}
