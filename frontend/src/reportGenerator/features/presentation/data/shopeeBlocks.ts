import type { ItemMetricCell, MetricSelection, ProdukPivotRow } from '../../../lib/shopeeDeepDiveItemPivot';
import type { DailyTrendMetricSelection } from '../../../lib/shopeeDeepDiveInsights';
import type { PivotRow } from '../../../lib/shopeeDeepDivePivot';
import type { ShopeeDeepDiveReport } from '../../shopee/shopeeDeepDiveReport';
import type { ShopeeFunnelReport } from '../../shopee/shopeeFunnelReport';
import type { ShopeeReport } from '../../shopee/shopeeReport';
import { toneOf } from '../format';
import type { Cell, DataBlock, KpiRow, MissingAnalysis, RankedItem, TableRow, Text2, TopBottomBlock } from '../types';
import { addBlock, chartBlock, fromDisplayRow, kpiBlock, L, missing, pivotFmt, shortMiddle, shortName, tableBlock } from './helpers';
import { funnelFrom } from './metaBlocks';

// Shopee Ads. Ad-attributed GMV and the store's own sales are different numbers
// and every title says which one it shows; they are never added or compared.

// The selections the deep-dive report is rebuilt with, so one call yields every
// metric the product and keyword slides need.
export const SHOPEE_PRODUK_SELECTIONS: MetricSelection[] = ['biaya', 'penjualan', 'roas', 'pesanan', 'klik', 'conversionRate'].map((key) => ({ kind: 'builtin', key }) as MetricSelection);
export const SHOPEE_KEYWORD_SELECTIONS: MetricSelection[] = ['biaya', 'penjualan', 'roas', 'pesanan', 'klik'].map((key) => ({ kind: 'builtin', key }) as MetricSelection);
export const SHOPEE_DAILY_SELECTIONS: DailyTrendMetricSelection[] = ['penjualanDibuat', 'pengunjung'].map((key) => ({ kind: 'builtin', key }) as DailyTrendMetricSelection);

function fromPivot(r: PivotRow): KpiRow {
  const f = pivotFmt(pivotFmtOf(r));
  return {
    label: r.label,
    old: { n: r.oldNum, f },
    cur: { n: r.curNum, f },
    delta: r.deltaNum === null ? { n: null, s: r.delta, tone: toneOf(r.cls) } : { n: r.deltaNum, tone: toneOf(r.cls) },
  };
}

// PivotRow carries its value already formatted; the mark on the string says what
// unit it is in.
function pivotFmtOf(r: PivotRow): 'rp' | 'pct' | 'roas' | 'dec' | 'num' {
  const s = r.cur || r.old;
  if (s.startsWith('Rp')) return 'rp';
  if (s.endsWith('%')) return 'pct';
  if (s.endsWith('x')) return 'roas';
  if (s.includes(',')) return 'dec';
  return 'num';
}

const OVERVIEW_ORDER = ['penjualan', 'roas', 'biaya', 'dilihat', 'klik', 'ctr', 'cpc', 'pesanan', 'cpp', 'cvr', 'aov'];

function cellOf(row: ProdukPivotRow, id: string): ItemMetricCell | undefined {
  return row.metrics.find((m) => m.id === id);
}

function itemCell(c: ItemMetricCell | undefined): Cell {
  return c ? { n: c.cur, f: pivotFmt(c.fmt) } : { n: null, f: 'num' };
}

function productRows(rows: ProdukPivotRow[]): TableRow[] {
  return [...rows]
    .sort((a, b) => (cellOf(b, 'biaya')?.cur ?? 0) - (cellOf(a, 'biaya')?.cur ?? 0))
    .map((r) => {
      const sales = cellOf(r, 'penjualan');
      return {
        name: shortName(r.cleanName),
        cells: { biaya: itemCell(cellOf(r, 'biaya')), penjualan: itemCell(sales), roas: itemCell(cellOf(r, 'roas')), pesanan: itemCell(cellOf(r, 'pesanan')), klik: itemCell(cellOf(r, 'klik')) },
        delta: sales ? (sales.deltaNum === null ? { n: null, s: sales.delta, tone: toneOf(sales.cls) } : { n: sales.deltaNum, tone: toneOf(sales.cls) }) : undefined,
      };
    });
}

function productRank(rows: ProdukPivotRow[], title: Text2): TopBottomBlock | null {
  const ranked = rows
    .filter((r) => (cellOf(r, 'biaya')?.cur ?? 0) > 0)
    .sort((a, b) => (cellOf(b, 'roas')?.cur ?? 0) - (cellOf(a, 'roas')?.cur ?? 0));
  if (ranked.length < 2) return null;
  const size = Math.min(5, Math.floor(ranked.length / 2) || 1);
  const item = (r: ProdukPivotRow): RankedItem => ({ name: shortName(r.cleanName, 60), value: itemCell(cellOf(r, 'roas')), spend: itemCell(cellOf(r, 'biaya')) });
  return {
    id: 'shopee.products.rank', source: 'shopee', kind: 'topBottom', title, metric: 'ROAS',
    rule: L('Diurutkan menurut ROAS iklan; hanya produk yang berbelanja iklan pada periode ini.', 'Ranked by ad ROAS; only products with ad spend this period.'),
    top: ranked.slice(0, size).map(item),
    bottom: ranked.slice(-size).reverse().map(item),
  };
}

export interface ShopeeBlocksResult {
  blocks: Record<string, DataBlock>;
  missing: MissingAnalysis[];
  ids: Record<'kpi' | 'mixChart' | 'mixTable' | 'funnel' | 'products' | 'rank' | 'pareto' | 'traffic' | 'conversion' | 'daily' | 'store' | 'keywords', string | null>;
  channels: { key: string; label: string; kpi: string | null; funnel: string | null }[];
  totalSpend: { old: number | null; cur: number | null };
  revenue: { old: number | null; cur: number | null };
}

export function buildShopeeBlocks(report: ShopeeReport, deep: ShopeeDeepDiveReport, funnel: ShopeeFunnelReport): ShopeeBlocksResult {
  const blocks: Record<string, DataBlock> = {};
  const gaps: MissingAnalysis[] = [];
  const { p1, p2 } = report;

  const byKey = new Map(deep.overall.map((r) => [r.key, r]));
  const overviewRows = OVERVIEW_ORDER.map((k) => byKey.get(k)).filter((r): r is PivotRow => Boolean(r)).map(fromPivot);
  const kpi = addBlock(blocks, kpiBlock('shopee.kpi', 'shopee', L('Shopee Ads · Performance'), overviewRows, L('GMV di sini adalah penjualan yang diatribusikan ke iklan (Produk, Toko, dan Live).', 'GMV here is sales attributed to ads (Product, Shop and Live).')));

  // Product Ads vs Shop Ads vs Live Ads
  const channels = [
    { key: 'produk', label: 'Product Ads', rows: deep.produk },
    { key: 'toko', label: 'Shop Ads', rows: deep.toko },
    { key: 'live', label: 'Live Ads', rows: deep.live },
  ].filter((c) => c.rows.some((r) => r.oldNum || r.curNum));
  const pick = (rows: PivotRow[], key: string) => rows.find((r) => r.key === key);
  const mixChart = channels.length > 1
    ? addBlock(blocks, chartBlock('shopee.mix.chart', 'shopee', L('GMV Iklan per Tipe Iklan', 'Ad GMV by Ad Type'), 'bar', channels.map((c) => c.label), [
      { label: p1, role: 'old', values: channels.map((c) => pick(c.rows, 'penjualan')?.oldNum ?? null) },
      { label: p2, role: 'cur', values: channels.map((c) => pick(c.rows, 'penjualan')?.curNum ?? null) },
    ], 'money'))
    : null;
  const mixRows: TableRow[] = channels.map((c) => {
    const sales = pick(c.rows, 'penjualan');
    const cellFor = (key: string, f: Cell['f']): Cell => ({ n: pick(c.rows, key)?.curNum ?? null, f });
    return {
      name: c.label,
      cells: { biaya: cellFor('biaya', 'money'), penjualan: cellFor('penjualan', 'money'), roas: cellFor('roas', 'x'), pesanan: cellFor('pesanan', 'num'), cvr: cellFor('cvr', 'pct') },
      delta: sales ? (sales.deltaNum === null ? { n: null, s: sales.delta, tone: toneOf(sales.cls) } : { n: sales.deltaNum, tone: toneOf(sales.cls) }) : undefined,
    };
  });
  const mixTable = channels.length > 1
    ? addBlock(blocks, tableBlock('shopee.mix.table', 'shopee', L('Product Ads vs Shop Ads vs Live Ads'), 'Channel', [
      { key: 'biaya', label: 'Spend' }, { key: 'penjualan', label: 'GMV (Ads)' }, { key: 'roas', label: 'ROAS' }, { key: 'pesanan', label: 'Orders' }, { key: 'cvr', label: 'CVR' },
    ], mixRows, { deltaLabel: 'GMV Δ' }))
    : null;

  const liveNote = funnel.liveGmv.hasData ? L('Iklan Live tidak ikut di pohon ini karena export-nya tidak memiliki impressions dan klik.', 'Live Ads is outside this tree because its export has no impressions or clicks.') : undefined;
  const funnelId = addBlock(blocks, funnelFrom('shopee.funnel', L('Shopee Ads · Root Cause Analysis'), funnel.tree, 'shopee', [funnel.symptom.headline, ...funnel.symptom.points, funnel.symptom.verdict].filter(Boolean), liveNote));

  const CHANNEL_NAME: Record<string, string> = { produk: 'Product Ads', toko: 'Shop Ads', live: 'Live Ads' };
  const channelReads = funnel.channels.map((c) => ({
    key: c.key,
    label: CHANNEL_NAME[c.key] ?? c.label,
    kpi: addBlock(blocks, kpiBlock(`shopee.channel.${c.key}.kpi`, 'shopee', L(`${CHANNEL_NAME[c.key] ?? c.label} · Performance`), c.values.filter((v) => !v.na && v.key !== 'gmvOverall').slice(0, 12).map((v) => {
      const f = pivotFmt(v.fmt);
      return { label: v.label, old: { n: v.oldNum, f }, cur: { n: v.curNum, f }, delta: v.deltaNum === null ? { n: null, s: v.delta, tone: toneOf(v.cls) } : { n: v.deltaNum, tone: toneOf(v.cls) } };
    }), c.atcNote ? L('Add to Cart hanya dilaporkan sebagian iklan pada export Shopee, sehingga rasio ATC bersifat indikatif.', 'Add to Cart is reported by only some ads in the Shopee export, so ATC ratios are indicative.') : undefined)),
    funnel: addBlock(blocks, funnelFrom(`shopee.channel.${c.key}.funnel`, L(`${CHANNEL_NAME[c.key] ?? c.label} · Root Cause Analysis`), c.tree, 'shopee', [c.symptom.headline, ...c.symptom.points].filter(Boolean))),
  }));

  // Products
  const productColumns = [{ key: 'biaya', label: 'Spend' }, { key: 'penjualan', label: 'GMV (Ads)' }, { key: 'roas', label: 'ROAS' }, { key: 'pesanan', label: 'Orders' }, { key: 'klik', label: 'Clicks' }];
  const products = addBlock(blocks, tableBlock('shopee.products.table', 'shopee', L('Performa Produk (Iklan)', 'Product Performance (Ads)'), 'Product', productColumns, productRows(deep.produkPivot), { deltaLabel: 'GMV Δ' }));
  const rank = addBlock(blocks, productRank(deep.produkPivot, L('Top & Bottom Products')));

  const bySales = [...deep.produkPivot].filter((r) => (cellOf(r, 'penjualan')?.cur ?? 0) > 0).sort((a, b) => (cellOf(b, 'penjualan')?.cur ?? 0) - (cellOf(a, 'penjualan')?.cur ?? 0));
  const salesTotal = bySales.reduce((s, r) => s + (cellOf(r, 'penjualan')?.cur ?? 0), 0);
  let running = 0;
  const shown = bySales.slice(0, 12);
  const pareto = salesTotal > 0 && bySales.length >= 3
    ? addBlock(blocks, chartBlock('shopee.pareto', 'shopee', L('Pareto · Kontribusi GMV Iklan per Produk', 'Pareto · Ad GMV Contribution by Product'), 'pareto', shown.map((r) => shortName(r.cleanName, 22)), [
      { label: L('Kontribusi', 'Contribution').en, values: shown.map((r) => ((cellOf(r, 'penjualan')?.cur ?? 0) / salesTotal) * 100) },
      { label: L('Kumulatif', 'Cumulative').en, values: shown.map((r) => { running += ((cellOf(r, 'penjualan')?.cur ?? 0) / salesTotal) * 100; return running; }) },
    ], 'pct', L('Dihitung dari GMV iklan per produk, bukan dari penjualan seluruh toko.', 'Computed from ad-attributed GMV per product, not whole-store sales.')))
    : null;
  if (!funnel.hasProductPerfCur) {
    gaps.push(missing('shopee.product_performance', 'shopee', L('Pareto & Traffic dari Product Performance toko', 'Store Product Performance Pareto & Traffic'), 'File Product Performance tidak ikut tersimpan pada laporan. Slide Pareto memakai GMV iklan per produk.', 'shopee'));
  }

  const topBy = (id: string, title: Text2, key: string, f: Cell['f'], list: ProdukPivotRow[]) => addBlock(blocks, chartBlock(id, 'shopee', title, 'hbar', list.map((r) => shortMiddle(r.cleanName)), [
    { label: p1, role: 'old', values: list.map((r) => cellOf(r, key)?.old ?? null) },
    { label: p2, role: 'cur', values: list.map((r) => cellOf(r, key)?.cur ?? null) },
  ], f));
  const byClicks = [...deep.produkPivot].sort((a, b) => (cellOf(b, 'klik')?.cur ?? 0) - (cellOf(a, 'klik')?.cur ?? 0)).slice(0, 8);
  const byOrders = [...deep.produkPivot].sort((a, b) => (cellOf(b, 'pesanan')?.cur ?? 0) - (cellOf(a, 'pesanan')?.cur ?? 0)).slice(0, 8);
  const traffic = topBy('shopee.traffic', L('Traffic Analysis · Klik per Produk', 'Traffic Analysis · Clicks by Product'), 'klik', 'num', byClicks);
  const conversion = topBy('shopee.conversion', L('Conversion Analysis · Pesanan per Produk', 'Conversion Analysis · Orders by Product'), 'pesanan', 'num', byOrders);

  // Daily trends read the store's Product Overview, not ads.
  const daily = deep.dailyTrendPivot;
  const metricIn = (r: (typeof daily)[number], id: string) => r.metrics.find((m) => m.id === id);
  const dailyId = daily.length
    ? addBlock(blocks, chartBlock('shopee.daily', 'shopee', L('Tren Harian · Penjualan Toko', 'Daily Trend · Store Sales'), 'line', daily.map((r) => String(r.day)), [
      { label: p1, role: 'old', values: daily.map((r) => metricIn(r, 'penjualanDibuat')?.old ?? null) },
      { label: p2, role: 'cur', values: daily.map((r) => metricIn(r, 'penjualanDibuat')?.cur ?? null) },
    ], 'money', L('Penjualan seluruh toko dari Product Overview Shopee, bukan penjualan yang diatribusikan ke iklan.', 'Whole-store sales from Shopee Product Overview, not ad-attributed sales.')))
    : null;
  if (!dailyId) gaps.push(missing('shopee.daily', 'shopee', L('Tren Harian Toko', 'Store Daily Trend'), 'Laporan tersimpan tidak punya data Product Overview harian untuk periode ini.', 'shopee'));

  const store = report.productOverviewRows?.length
    ? addBlock(blocks, kpiBlock('shopee.store', 'shopee', L('Performa Toko Shopee (Product Overview)', 'Shopee Store Performance (Product Overview)'), report.productOverviewRows.map((r) => fromDisplayRow({ label: r.label, old: r.old, cur: r.cur, delta: r.delta, cls: r.cls, deltaNum: r.deltaNum })), L('Seluruh penjualan toko, termasuk yang tidak berasal dari iklan.', 'All store sales, including those not from ads.')))
    : null;

  const keywordRows: TableRow[] = [...deep.keywordPivot]
    .sort((a, b) => (b.metrics.find((m) => m.id === 'biaya')?.cur ?? 0) - (a.metrics.find((m) => m.id === 'biaya')?.cur ?? 0))
    .map((r) => {
      const get = (id: string) => itemCell(r.metrics.find((m) => m.id === id));
      return { name: shortName(r.kataPencarian || r.namaIklan), cells: { biaya: get('biaya'), penjualan: get('penjualan'), roas: get('roas'), pesanan: get('pesanan'), klik: get('klik') } };
    });
  const keywords = addBlock(blocks, tableBlock('shopee.keywords', 'shopee', L('Performa Keyword Iklan Toko', 'Shop Ads Keyword Performance'), 'Keyword', productColumns, keywordRows));

  const spendRow = byKey.get('biaya');
  const salesRow = byKey.get('penjualan');
  return {
    blocks, missing: gaps,
    ids: { kpi, mixChart, mixTable, funnel: funnelId, products, rank, pareto, traffic, conversion, daily: dailyId, store, keywords },
    channels: channelReads,
    totalSpend: { old: spendRow?.oldNum ?? null, cur: spendRow?.curNum ?? null },
    revenue: { old: salesRow?.oldNum ?? null, cur: salesRow?.curNum ?? null },
  };
}
