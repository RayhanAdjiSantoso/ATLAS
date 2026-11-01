import { metaSalesMetrics, type MetaFunnel } from '../../../lib/metaFunnel';
import { buildB2bAudience, buildBrandAudience, buildSalesAudience, findAdCol, type AudienceSlice } from '../../../lib/metaAudience';
import { safeDiv } from '../../../lib/delta';
import type { SheetRow } from '../../../lib/types';
import type { FunnelTreeRow } from '../../../lib/shopeeFunnel';
import type { MetaAudienceSides, MetaReport, OverviewDetailedData } from '../../meta/metaReport';
import { toneOf } from '../format';
import type { Cell, DataBlock, DeltaCell, FunnelBlock, MissingAnalysis, RankedItem, TableRow, Text2, TopBottomBlock, ValueFmt } from '../types';
import { addBlock, chartBlock, deltaOf, fromDisplayRow, kpiBlock, L, missing, money, pivotFmt, shortMiddle, shortName, tableBlock, times } from './helpers';

// Meta Ads: one analysis per channel the report split the account into (Boost
// Post, Non-Boost lanes, CPAS). Every figure comes from lib/meta*.ts; the slices
// are the same builders the Meta tab's Audience & Creative sections use.

type Kind = 'sales' | 'brand' | 'b2b';
type Metrics = Record<string, number | null | undefined>;

interface SubChannel {
  key: string;
  label: string;
  kind: Kind;
  overview?: OverviewDetailedData;
  funnel?: MetaFunnel;
  audiences?: MetaAudienceSides;
  curRows: SheetRow[];
  oldRows: SheetRow[];
  campCol: string | null;
  ageCol: string | null;
  genderCol: string | null;
  p1: string;
  p2: string;
}

function subChannels(r: MetaReport): SubChannel[] {
  const list: SubChannel[] = [];
  const base = { campCol: r.cols?.campaign ?? null, ageCol: r.cols?.age ?? null, genderCol: r.cols?.gender ?? null, p1: r.p1, p2: r.p2 };
  if (r.boost) {
    list.push({ ...base, key: 'boost', label: 'Boost Post', kind: 'brand', overview: r.boost, funnel: r.boostFunnel, audiences: r.boostAudiences, curRows: r.curRows?.boost ?? [], oldRows: r.oldRows?.boost ?? [] });
  }
  if (r.nonBoostLanes?.length) {
    for (const lane of r.nonBoostLanes) {
      list.push({
        ...base, key: `nonboost_${lane.key}`, label: `Non-Boost Post (${lane.label})`, kind: lane.key === 'b2b' ? 'b2b' : 'sales',
        overview: lane.overview, funnel: lane.funnel, audiences: lane.audiences, curRows: lane.curRows, oldRows: lane.oldRows,
        campCol: lane.campCol, ageCol: lane.ageCol, genderCol: lane.genderCol,
      });
    }
  } else if (r.nonBoost) {
    list.push({ ...base, key: 'nonboost', label: 'Non-Boost Post', kind: 'sales', overview: r.nonBoost, funnel: r.nonBoostFunnel, curRows: r.curRows?.nonBoost ?? [], oldRows: r.oldRows?.nonBoost ?? [] });
  }
  if (r.cpas?.overall) {
    list.push({
      key: 'cpas', label: 'CPAS Marketplace', kind: 'sales', overview: r.cpas.overall, funnel: r.cpas.funnel,
      audiences: r.cpas.nv || r.cpas.rm ? {
        ...(r.cpas.nv ? { NV: { overview: r.cpas.nv, funnel: r.cpas.nvFunnel as MetaFunnel } } : {}),
        ...(r.cpas.rm ? { RM: { overview: r.cpas.rm, funnel: r.cpas.rmFunnel as MetaFunnel } } : {}),
      } : undefined,
      curRows: r.curRows?.cpas ?? [], oldRows: r.oldRows?.cpas ?? [],
      campCol: r.cols?.cpasCampaign ?? null, ageCol: r.cols?.cpasAge ?? null, genderCol: r.cols?.cpasGender ?? null, p1: r.cpas.p1, p2: r.cpas.p2,
    });
  }
  return list;
}

function slicesOf(kind: Kind, rows: SheetRow[], dim: string): AudienceSlice<Metrics>[] {
  const built = kind === 'sales' ? buildSalesAudience(rows, dim) : kind === 'brand' ? buildBrandAudience(rows, dim) : buildB2bAudience(rows, dim);
  return built as unknown as AudienceSlice<Metrics>[];
}

interface MetricDef {
  key: string;
  label: string;
  cell: (m: Metrics) => Cell;
}
const metric = (key: string, label: string, f: ValueFmt): MetricDef => ({ key, label, cell: (m) => ({ n: m[key] ?? null, f }) });

// The columns a slice table shows, and what it is ranked on, per kind of channel.
const READS: Record<Kind, {
  columns: MetricDef[];
  compact: string[];
  traffic: MetricDef;
  conversion: MetricDef;
  // What Top & Bottom rank on; `lowerIsBetter` for a cost.
  rank: MetricDef;
  lowerIsBetter: boolean;
}> = {
  sales: {
    columns: [metric('spend', 'Amount Spent', 'money'), metric('impressions', 'Impressions', 'num'), metric('ctr', 'CTR', 'pct'), metric('purchase', 'Purchases', 'num'), metric('costPerPurchase', 'Cost/Purchase', 'money'), { key: 'roas', label: 'ROAS', cell: (m) => times(safeDiv(m.gmv, m.spend)) }],
    compact: ['spend', 'purchase', 'costPerPurchase', 'roas'],
    traffic: metric('contentViews', 'Content Views', 'num'),
    conversion: metric('purchase', 'Purchases', 'num'),
    rank: { key: 'roas', label: 'ROAS', cell: (m) => times(safeDiv(m.gmv, m.spend)) },
    lowerIsBetter: false,
  },
  brand: {
    columns: [metric('spend', 'Amount Spent', 'money'), metric('impressions', 'Impressions', 'num'), metric('cpm', 'CPM', 'money'), metric('profileVisits', 'Profile Visits', 'num'), metric('costPerProfileVisit', 'Cost/Profile Visit', 'money'), metric('follows', 'Follows', 'num')],
    compact: ['spend', 'profileVisits', 'costPerProfileVisit', 'follows'],
    traffic: metric('profileVisits', 'Profile Visits', 'num'),
    conversion: metric('brandConsideration', 'Brand Consideration', 'num'),
    rank: metric('costPerProfileVisit', 'Cost/Profile Visit', 'money'),
    lowerIsBetter: true,
  },
  b2b: {
    columns: [metric('spend', 'Amount Spent', 'money'), metric('impressions', 'Impressions', 'num'), metric('ctr', 'CTR', 'pct'), metric('linkClicks', 'Link Clicks', 'num'), metric('leads', 'Leads', 'num'), metric('costPerLead', 'Cost/Lead', 'money')],
    compact: ['spend', 'linkClicks', 'leads', 'costPerLead'],
    traffic: metric('linkClicks', 'Link Clicks', 'num'),
    conversion: metric('leads', 'Leads', 'num'),
    rank: metric('costPerLead', 'Cost/Lead', 'money'),
    lowerIsBetter: true,
  },
};

// A rate over a handful of impressions is noise, so ranking starts here.
export const MIN_RANK_IMPRESSIONS = 1000;

export function funnelFrom(id: string, title: Text2, tree: FunnelTreeRow[], source: 'meta' | 'shopee', reading?: string[], note?: Text2): FunnelBlock | null {
  const nodes = tree.filter((n) => !n.na).map((n) => {
    const f = pivotFmt(n.fmt);
    return {
      label: n.label,
      depth: n.depth,
      old: { n: n.oldNum, f } as Cell,
      cur: { n: n.curNum, f } as Cell,
      delta: n.deltaNum === null ? { n: null, s: n.delta, tone: toneOf(n.cls) } : { n: n.deltaNum, tone: toneOf(n.cls) },
    };
  });
  return nodes.length ? { id, source, kind: 'funnel', title, nodes, reading, note } : null;
}

function sliceTable(id: string, title: Text2, sub: SubChannel, curSlices: AudienceSlice<Metrics>[], oldSlices: AudienceSlice<Metrics>[], nameLabel: string, limit?: number): DataBlock | null {
  const read = READS[sub.kind];
  const oldByKey = new Map(oldSlices.map((s) => [s.key, s.metrics]));
  const rows: TableRow[] = [...curSlices]
    .sort((a, b) => (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0))
    .map((s) => ({
      name: shortName(s.label),
      cells: Object.fromEntries(read.columns.map((c) => [c.key, c.cell(s.metrics)])),
      delta: deltaOf(oldByKey.get(s.key)?.spend, s.metrics.spend, 'neutral'),
    }));
  return tableBlock(id, 'meta', title, nameLabel, read.columns.map((c) => ({ key: c.key, label: c.label })), rows, { deltaLabel: 'Spend Δ', limit, compactColumns: read.compact });
}

function rankBlock(id: string, title: Text2, sub: SubChannel, slices: AudienceSlice<Metrics>[]): TopBottomBlock | null {
  const read = READS[sub.kind];
  const ranked = slices
    .filter((s) => (s.metrics.impressions ?? 0) >= MIN_RANK_IMPRESSIONS && (s.metrics.spend ?? 0) > 0)
    .map((s) => ({ s, cell: read.rank.cell(s.metrics) }))
    .filter((x) => x.cell.n !== null);
  if (ranked.length < 2) return null;
  ranked.sort((a, b) => (read.lowerIsBetter ? (a.cell.n as number) - (b.cell.n as number) : (b.cell.n as number) - (a.cell.n as number)));
  const size = Math.min(5, Math.floor(ranked.length / 2) || 1);
  const item = (x: (typeof ranked)[number]): RankedItem => ({ name: shortName(x.s.label, 60), value: x.cell, spend: money(x.s.metrics.spend) });
  return {
    id, source: 'meta', kind: 'topBottom', title, metric: read.rank.label,
    rule: L(`Diurutkan menurut ${read.rank.label}, hanya materi dengan minimal ${MIN_RANK_IMPRESSIONS.toLocaleString('id-ID')} impressions.`, `Ranked by ${read.rank.label}; only items with at least ${MIN_RANK_IMPRESSIONS.toLocaleString('en-US')} impressions.`),
    top: ranked.slice(0, size).map(item),
    bottom: ranked.slice(-size).reverse().map(item),
  };
}

function audienceTable(id: string, sub: SubChannel): DataBlock | null {
  const nv = sub.audiences?.NV?.overview.overviewRows.map(fromDisplayRow);
  const rm = sub.audiences?.RM?.overview.overviewRows.map(fromDisplayRow);
  if (!nv?.length || !rm?.length) return null;
  const rows: TableRow[] = nv.flatMap((row) => {
    const other = rm.find((o) => o.label === row.label);
    if (row.cur.n === null && other?.cur.n == null) return [];
    return [{
      name: row.label,
      cells: { nv: row.cur, nvd: deltaCell(row.delta), rm: other?.cur ?? { n: null, f: 'num' }, rmd: deltaCell(other?.delta) },
    }];
  });
  return tableBlock(id, 'meta', L(`${sub.label} · New Visitor vs Remarketing`), 'Metric', [
    { key: 'nv', label: 'NV · {cur}' }, { key: 'nvd', label: 'NV Δ' }, { key: 'rm', label: 'RM · {cur}' }, { key: 'rmd', label: 'RM Δ' },
  ], rows);
}

function deltaCell(d: DeltaCell | undefined): Cell {
  if (!d) return { n: null, f: 'text', t: '—' };
  return d.n === null ? { n: null, f: 'text', t: d.s ?? '—' } : { n: d.n, f: 'signedPct' };
}

export interface MetaBlocksResult {
  blocks: Record<string, DataBlock>;
  missing: MissingAnalysis[];
  // Per channel inside Meta, in report order: drives one run of slides each.
  subs: { key: string; label: string; kind: Kind; kpi: string | null; funnel: string | null; traffic: string | null; conversion: string | null; campaigns: string | null; age: string | null; ageChart: string | null; gender: string | null; audience: string | null; creative: string | null }[];
  splitChart: string | null;
  splitTable: string | null;
  totalSpend: { old: number | null; cur: number | null };
  revenue: { old: number | null; cur: number | null } | null;
}

export function buildMetaBlocks(report: MetaReport): MetaBlocksResult {
  const blocks: Record<string, DataBlock> = {};
  const gaps: MissingAnalysis[] = [];
  const subs: MetaBlocksResult['subs'] = [];
  const list = subChannels(report);

  for (const sub of list) {
    const id = (s: string) => `meta.${sub.key}.${s}`;
    const kpi = addBlock(blocks, kpiBlock(id('kpi'), 'meta', L(`${sub.label} · Performance`), (sub.overview?.overviewRows ?? []).map(fromDisplayRow)));
    const funnel = sub.funnel?.hasData
      ? addBlock(blocks, funnelFrom(id('funnel'), L(`${sub.label} · Root Cause Analysis`), sub.funnel.tree, 'meta', undefined, sub.funnel.missing.length ? L(`Tidak tersedia di export: ${sub.funnel.missing.join(', ')}.`, `Not in this export: ${sub.funnel.missing.join(', ')}.`) : undefined))
      : null;

    const read = READS[sub.kind];
    let campaigns: string | null = null;
    let traffic: string | null = null;
    let conversion: string | null = null;
    if (sub.campCol) {
      const cur = slicesOf(sub.kind, sub.curRows, sub.campCol);
      const old = slicesOf(sub.kind, sub.oldRows, sub.campCol);
      campaigns = addBlock(blocks, sliceTable(id('campaigns'), L(`${sub.label} · Campaign Performance`), sub, cur, old, 'Campaign'));
      const bySpend = [...cur].sort((a, b) => (b.metrics.spend ?? 0) - (a.metrics.spend ?? 0)).slice(0, 8);
      const oldByKey = new Map(old.map((s) => [s.key, s.metrics]));
      const compare = (def: MetricDef, title: Text2, suffix: string) => addBlock(blocks, chartBlock(id(suffix), 'meta', title, 'hbar', bySpend.map((s) => shortMiddle(s.label)), [
        { label: sub.p1, role: 'old', values: bySpend.map((s) => { const m = oldByKey.get(s.key); return m ? def.cell(m).n : null; }) },
        { label: sub.p2, role: 'cur', values: bySpend.map((s) => def.cell(s.metrics).n) },
      ], def.cell({}).f));
      traffic = compare(read.traffic, L(`${sub.label} · Traffic per Campaign (${read.traffic.label})`, `${sub.label} · Traffic by Campaign (${read.traffic.label})`), 'traffic');
      conversion = compare(read.conversion, L(`${sub.label} · Konversi per Campaign (${read.conversion.label})`, `${sub.label} · Conversion by Campaign (${read.conversion.label})`), 'conversion');
    }

    let age: string | null = null;
    let ageChart: string | null = null;
    if (sub.ageCol) {
      const cur = slicesOf(sub.kind, sub.curRows, sub.ageCol);
      age = addBlock(blocks, sliceTable(id('age'), L(`${sub.label} · Audience by Age`), sub, cur, slicesOf(sub.kind, sub.oldRows, sub.ageCol), 'Age'));
      ageChart = addBlock(blocks, chartBlock(id('age_chart'), 'meta', L(`${sub.label} · Spend per Usia`, `${sub.label} · Spend by Age`), 'donut', cur.map((s) => s.label), [{ label: 'Amount Spent', values: cur.map((s) => s.metrics.spend ?? null) }], 'money'));
    }
    // One gender with spend is not a comparison, and not worth a slide.
    const genders = sub.genderCol ? slicesOf(sub.kind, sub.curRows, sub.genderCol).filter((s) => (s.metrics.spend ?? 0) > 0) : [];
    const gender = sub.genderCol && genders.length > 1
      ? addBlock(blocks, sliceTable(id('gender'), L(`${sub.label} · Audience by Gender`), sub, genders, slicesOf(sub.kind, sub.oldRows, sub.genderCol), 'Gender'))
      : null;
    const audience = addBlock(blocks, audienceTable(id('nvrm'), sub));

    const adCol = sub.curRows.length ? findAdCol(sub.curRows) : null;
    let creative: string | null = null;
    if (adCol) {
      creative = addBlock(blocks, rankBlock(id('creative'), L(`${sub.label} · Top & Bottom Creative`), sub, slicesOf(sub.kind, sub.curRows, adCol)));
      if (!creative) gaps.push(missing(id('creative'), 'meta', L(`${sub.label} · Top & Bottom Creative`), `Kurang dari dua materi iklan mencapai ${MIN_RANK_IMPRESSIONS.toLocaleString('id-ID')} impressions.`));
    } else {
      gaps.push(missing(id('creative'), 'meta', L(`${sub.label} · Creative Performance`), 'File Meta yang tersimpan tidak dipecah per Ad.', 'meta'));
    }
    if (!sub.ageCol) gaps.push(missing(id('age'), 'meta', L(`${sub.label} · Audience by Age`), 'File Meta yang tersimpan tidak punya breakdown Age.', 'meta'));
    if (!sub.campCol) gaps.push(missing(id('campaigns'), 'meta', L(`${sub.label} · Campaign Performance`), 'File Meta yang tersimpan tidak punya kolom Campaign.', 'meta'));

    subs.push({ key: sub.key, label: sub.label, kind: sub.kind, kpi, funnel, traffic, conversion, campaigns, age, ageChart, gender, audience, creative });
  }

  // Boost vs Non-Boost: spend as the report totals it. CPAS's Overall already
  // holds its NV and RM campaigns, so those are not added on top.
  const spend = report.summary.spend;
  const parts: { label: string; old: number | null; cur: number | null }[] = [];
  if (spend.boost) parts.push({ label: 'Boost Post', old: spend.boost.old, cur: spend.boost.cur });
  if (spend.nonboost) parts.push({ label: 'Non-Boost Post', old: spend.nonboost.old, cur: spend.nonboost.cur });
  if (spend.cpasOverall) parts.push({ label: 'CPAS Marketplace', old: spend.cpasOverall.old, cur: spend.cpasOverall.cur });

  const splitChart = parts.length > 1
    ? addBlock(blocks, chartBlock('meta.split.chart', 'meta', L('Amount Spent per Tipe Campaign', 'Amount Spent by Campaign Type'), 'bar', parts.map((p) => p.label), [
      { label: report.p1, role: 'old', values: parts.map((p) => p.old) },
      { label: report.p2, role: 'cur', values: parts.map((p) => p.cur) },
    ], 'money'))
    : null;
  const splitTable = parts.length > 1
    ? addBlock(blocks, kpiBlock('meta.split.kpi', 'meta', L('Amount Spent per Tipe Campaign', 'Amount Spent by Campaign Type'), parts.map((p) => ({ label: p.label, old: money(p.old), cur: money(p.cur), delta: deltaOf(p.old, p.cur, 'neutral') }))))
    : null;

  const sum = (key: 'old' | 'cur') => {
    const present = parts.map((p) => p[key]).filter((v): v is number => v !== null && v !== undefined);
    return present.length ? present.reduce((a, b) => a + b, 0) : null;
  };

  // Purchase value attributed to ads, only where the channel sells.
  const selling = list.filter((s) => s.kind === 'sales');
  const totalOf = (rows: (s: SubChannel) => SheetRow[]) => {
    const vals = selling.map((s) => metaSalesMetrics(rows(s)).gmv).filter((v): v is number => v !== null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const revCur = totalOf((s) => s.curRows);
  const revOld = totalOf((s) => s.oldRows);

  return {
    blocks, missing: gaps, subs, splitChart, splitTable,
    totalSpend: { old: sum('old'), cur: sum('cur') },
    revenue: revCur === null && revOld === null ? null : { old: revOld, cur: revCur },
  };
}
