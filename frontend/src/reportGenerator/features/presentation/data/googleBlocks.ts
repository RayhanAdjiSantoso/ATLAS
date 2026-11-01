import type { GadsMetrics, GadsReport } from '../../google/googleAds';
import type { Sentiment } from '../../../lib/types';
import type { Cell, DataBlock, KpiRow, MissingAnalysis, RankedItem, TableRow, TopBottomBlock } from '../types';
import { addBlock, chartBlock, count, dec, deltaOf, kpiBlock, kpiRow, L, missing, money, pct, shortMiddle, shortName, tableBlock, times } from './helpers';

// Google Ads, read from GET /google-ads/report (the Google Ads tab's own source).
// Its rates are fractions (0.0178), so they are scaled to percentage points here;
// conversions are fractional under data-driven attribution and stay so.

const asPct = (v: number | null | undefined) => (v === null || v === undefined ? null : v * 100);

const KPI: { label: string; cell: (m: GadsMetrics) => Cell; sentiment: Sentiment }[] = [
  { label: 'Cost', cell: (m) => money(m.cost), sentiment: 'neutral' },
  { label: 'Impressions', cell: (m) => count(m.impressions), sentiment: 'higher-better' },
  { label: 'Clicks', cell: (m) => count(m.clicks), sentiment: 'higher-better' },
  { label: 'CTR', cell: (m) => pct(asPct(m.ctr)), sentiment: 'higher-better' },
  { label: 'CPC', cell: (m) => money(m.avg_cpc), sentiment: 'lower-better' },
  { label: 'Conversions', cell: (m) => dec(m.conversions), sentiment: 'higher-better' },
  { label: 'Cost/Conversion', cell: (m) => money(m.cost_per_conv), sentiment: 'lower-better' },
  { label: 'Conversion Rate', cell: (m) => pct(asPct(m.cvr)), sentiment: 'higher-better' },
  { label: 'Conversion Value', cell: (m) => money(m.conversions_value), sentiment: 'higher-better' },
  { label: 'ROAS', cell: (m) => times(m.roas), sentiment: 'higher-better' },
];

const COLUMNS = [{ key: 'cost', label: 'Cost' }, { key: 'clicks', label: 'Clicks' }, { key: 'ctr', label: 'CTR' }, { key: 'conv', label: 'Conversions' }, { key: 'cpa', label: 'Cost/Conv.' }];
const cellsOf = (m: GadsMetrics): Record<string, Cell> => ({ cost: money(m.cost), clicks: count(m.clicks), ctr: pct(asPct(m.ctr)), conv: dec(m.conversions), cpa: money(m.cost_per_conv) });

// The same item from the previous period, for the delta column.
function rowsOf<T extends GadsMetrics>(cur: T[], old: T[], name: (x: T) => string): TableRow[] {
  const prior = new Map(old.map((x) => [name(x), x]));
  return [...cur].sort((a, b) => b.cost - a.cost).map((x) => ({ name: shortName(name(x)), cells: cellsOf(x), delta: deltaOf(prior.get(name(x))?.conversions, x.conversions, 'higher-better') }));
}

export interface GoogleBlocksResult {
  blocks: Record<string, DataBlock>;
  missing: MissingAnalysis[];
  ids: Record<'kpi' | 'daily' | 'campaigns' | 'chart' | 'rank' | 'keywords' | 'cities', string | null>;
  totalSpend: { old: number | null; cur: number | null };
  revenue: { old: number | null; cur: number | null } | null;
  currency: string | null;
  mixedCurrency: boolean;
}

export function buildGoogleBlocks(report: GadsReport, p1: string, p2: string): GoogleBlocksResult {
  const blocks: Record<string, DataBlock> = {};
  const gaps: MissingAnalysis[] = [];
  const { cur, old } = report;
  const rows: KpiRow[] = KPI.map((k) => kpiRow(k.label, k.cell(old.totals), k.cell(cur.totals), k.sentiment));
  const kpi = addBlock(blocks, kpiBlock('google.kpi', 'google', L('Google Ads · Performance'), rows));

  // Aligned by day number so two months of different length stay comparable.
  const days = Math.max(cur.daily.length, old.daily.length);
  const dayLabels = Array.from({ length: days }, (_, i) => String(i + 1));
  const daily = addBlock(blocks, chartBlock('google.daily', 'google', L('Tren Harian · Clicks', 'Daily Trend · Clicks'), 'line', dayLabels, [
    { label: p1, role: 'old', values: dayLabels.map((_, i) => old.daily[i]?.clicks ?? null) },
    { label: p2, role: 'cur', values: dayLabels.map((_, i) => cur.daily[i]?.clicks ?? null) },
  ], 'num'));

  const campaigns = addBlock(blocks, tableBlock('google.campaigns', 'google', L('Campaign Performance'), 'Campaign', COLUMNS, rowsOf(cur.campaigns, old.campaigns, (c) => c.campaign_name), { deltaLabel: 'Conv. Δ' }));
  const top = [...cur.campaigns].sort((a, b) => b.cost - a.cost).slice(0, 8);
  const priorCampaign = new Map(old.campaigns.map((c) => [c.campaign_name, c]));
  const chart = addBlock(blocks, chartBlock('google.campaigns.chart', 'google', L('Cost per Campaign', 'Cost by Campaign'), 'hbar', top.map((c) => shortMiddle(c.campaign_name)), [
    { label: p1, role: 'old', values: top.map((c) => priorCampaign.get(c.campaign_name)?.cost ?? null) },
    { label: p2, role: 'cur', values: top.map((c) => c.cost) },
  ], 'money'));

  const ranked = cur.campaigns.filter((c) => c.cost > 0 && c.conversions > 0 && c.cost_per_conv !== null).sort((a, b) => (a.cost_per_conv as number) - (b.cost_per_conv as number));
  let rankBlock: TopBottomBlock | null = null;
  if (ranked.length >= 2) {
    const size = Math.min(5, Math.floor(ranked.length / 2) || 1);
    const item = (c: (typeof ranked)[number]): RankedItem => ({ name: shortName(c.campaign_name, 60), value: money(c.cost_per_conv), spend: money(c.cost) });
    rankBlock = {
      id: 'google.rank', source: 'google', kind: 'topBottom', title: L('Top & Bottom Campaigns'), metric: 'Cost/Conversion',
      rule: L('Diurutkan menurut Cost per Conversion; hanya campaign yang menghasilkan konversi.', 'Ranked by Cost per Conversion; only campaigns with conversions.'),
      top: ranked.slice(0, size).map(item),
      bottom: ranked.slice(-size).reverse().map(item),
    };
  }
  const rank = addBlock(blocks, rankBlock);

  const keywords = addBlock(blocks, tableBlock('google.keywords', 'google', L('Keyword Performance'), 'Keyword', COLUMNS, rowsOf(cur.keywords, old.keywords, (k) => k.keyword), { deltaLabel: 'Conv. Δ' }));
  if (!keywords) gaps.push(missing('google.keywords', 'google', L('Keyword Performance'), 'Akun Google Ads belum mengirim data keyword untuk periode ini.', 'google'));
  const cities = addBlock(blocks, tableBlock('google.cities', 'google', L('Performa per Lokasi', 'Location Performance'), 'City', COLUMNS, rowsOf(cur.cities, old.cities, (c) => c.city), { deltaLabel: 'Conv. Δ' }));
  if (!cities) gaps.push(missing('google.cities', 'google', L('Performa per Lokasi', 'Location Performance'), 'Akun Google Ads belum mengirim data lokasi untuk periode ini.', 'google'));

  return {
    blocks, missing: gaps,
    ids: { kpi, daily, campaigns, chart, rank, keywords, cities },
    totalSpend: { old: old.totals.cost, cur: cur.totals.cost },
    revenue: cur.totals.conversions_value > 0 || old.totals.conversions_value > 0 ? { old: old.totals.conversions_value, cur: cur.totals.conversions_value } : null,
    currency: report.currency,
    mixedCurrency: report.mixedCurrency,
  };
}
