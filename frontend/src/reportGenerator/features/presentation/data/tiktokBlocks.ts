import { calcTiktokMetrics, type TiktokMetrics } from '../../../lib/tiktok';
import type { SheetRow } from '../../../lib/types';
import type { TiktokReport } from '../../tiktok/tiktokReport';
import type { DataBlock, RankedItem, TableRow, TopBottomBlock } from '../types';
import { addBlock, chartBlock, deltaOf, fromDisplayRow, kpiBlock, L, money, shortMiddle, shortName, tableBlock, times, count } from './helpers';

// TikTok GMV Max: the fixed KPI table of the TikTok tab, and the same metrics
// read per campaign. The export has no impressions, clicks or creative columns,
// so nothing here pretends to show them.

export interface TiktokBlocksResult {
  blocks: Record<string, DataBlock>;
  ids: Record<'kpi' | 'campaigns' | 'chart' | 'rank', string | null>;
  totalSpend: { old: number | null; cur: number | null };
  revenue: { old: number | null; cur: number | null };
}

function byCampaign(rows: SheetRow[]): Map<string, TiktokMetrics> {
  const groups = new Map<string, SheetRow[]>();
  for (const r of rows) {
    const name = String(r['Campaign name'] ?? r['Campaign Name'] ?? r['campaign name'] ?? '').trim();
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(r);
  }
  return new Map([...groups].map(([k, v]) => [k, calcTiktokMetrics(v)]));
}

export function buildTiktokBlocks(report: TiktokReport, oldRows: SheetRow[], curRows: SheetRow[]): TiktokBlocksResult {
  const blocks: Record<string, DataBlock> = {};
  const kpi = addBlock(blocks, kpiBlock('tiktok.kpi', 'tiktok', L('TikTok GMV Max · Performance'), report.rows.map(fromDisplayRow), L('Gross revenue menurut laporan GMV Max TikTok.', 'Gross revenue as reported by TikTok GMV Max.')));

  const cur = byCampaign(curRows);
  const old = byCampaign(oldRows);
  const sorted = [...cur].sort((a, b) => b[1].cost - a[1].cost);
  const rows: TableRow[] = sorted.map(([name, m]) => ({
    name: shortName(name),
    cells: { cost: money(m.cost), revenue: money(m.revenue), roi: times(m.cost > 0 ? m.roi : null), orders: count(m.orders), cpo: money(m.orders > 0 ? m.cpo : null) },
    delta: deltaOf(old.get(name)?.revenue, m.revenue, 'higher-better'),
  }));
  const campaigns = addBlock(blocks, tableBlock('tiktok.campaigns', 'tiktok', L('Campaign Performance'), 'Campaign', [
    { key: 'cost', label: 'Cost' }, { key: 'revenue', label: 'Gross Revenue' }, { key: 'roi', label: 'ROI' }, { key: 'orders', label: 'Orders' }, { key: 'cpo', label: 'Cost/Order' },
  ], rows, { deltaLabel: 'Revenue Δ' }));

  const top = sorted.slice(0, 8);
  const chart = addBlock(blocks, chartBlock('tiktok.chart', 'tiktok', L('Gross Revenue per Campaign', 'Gross Revenue by Campaign'), 'hbar', top.map(([n]) => shortMiddle(n)), [
    { label: report.p1, role: 'old', values: top.map(([n]) => old.get(n)?.revenue ?? null) },
    { label: report.p2, role: 'cur', values: top.map(([, m]) => m.revenue) },
  ], 'money'));

  const ranked = sorted.filter(([, m]) => m.cost > 0).sort((a, b) => b[1].roi - a[1].roi);
  let rankBlock: TopBottomBlock | null = null;
  if (ranked.length >= 2) {
    const size = Math.min(5, Math.floor(ranked.length / 2) || 1);
    const item = ([name, m]: [string, TiktokMetrics]): RankedItem => ({ name: shortName(name, 60), value: times(m.roi), spend: money(m.cost) });
    rankBlock = {
      id: 'tiktok.rank', source: 'tiktok', kind: 'topBottom', title: L('Top & Bottom Campaigns'), metric: 'ROI',
      rule: L('Diurutkan menurut ROI; hanya campaign yang berbelanja pada periode ini.', 'Ranked by ROI; only campaigns with spend this period.'),
      top: ranked.slice(0, size).map(item),
      bottom: ranked.slice(-size).reverse().map(item),
    };
  }
  const rank = addBlock(blocks, rankBlock);

  const total = (m: Map<string, TiktokMetrics>, key: 'cost' | 'revenue') => [...m.values()].reduce((s, v) => s + v[key], 0);
  const overallOld = calcTiktokMetrics(oldRows);
  const overallCur = calcTiktokMetrics(curRows);
  return {
    blocks,
    ids: { kpi, campaigns, chart, rank },
    totalSpend: { old: oldRows.length ? overallOld.cost : total(old, 'cost') || null, cur: overallCur.cost },
    revenue: { old: oldRows.length ? overallOld.revenue : null, cur: overallCur.revenue },
  };
}
