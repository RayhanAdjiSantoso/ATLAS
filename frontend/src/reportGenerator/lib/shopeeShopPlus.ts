import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
import { sumRows, type ItemSums, type ShopPlusGroup } from './shopeeChannelAnalysis';
import type { PivotFmt } from './shopeeDeepDivePivot';
import type { FunnelMetrics, FunnelTreeRow, FunnelValueRow } from './shopeeFunnel';
import { buildSymptomSummary, type SymptomSummary } from './shopeeFunnelSummary';
import type { Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// SHOPEE — Shop+ Ads (Iklan Toko): the channel table and its root cause, read
// only off "Shop+ Ads Overall Data".
//
// The Product Ads funnel does not fit this export. Shop+ has no Add-to-Cart
// column (the ATC nodes would sit at 0 forever) and no store-level GMV; it
// does report what Product Ads does not — direct ("Langsung") orders and
// revenue, ACOS, and the product tiles inside the shop ad (Jumlah Produk
// Dilihat / Jumlah Klik Produk). So it gets its own metric set and a tree
// without the ATC branch.
// ══════════════════════════════════════════════════════

export interface ShopPlusMetrics {
  gmv: number;
  gmvDirect: number;
  roas: number;
  roasDirect: number;
  spend: number;
  acos: number; // spend ÷ GMV (%)
  impressions: number;
  cpm: number;
  clicks: number;
  ctr: number;
  cpc: number;
  productViews: number;
  productClicks: number;
  productCtr: number;
  orders: number;
  ordersDirect: number;
  cpp: number;
  cvr: number;
  sold: number;
  aov: number;
  abs: number;
  aur: number;
}

const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function shopPlusMetrics(s: ItemSums): ShopPlusMetrics {
  return {
    gmv: s.gmv,
    gmvDirect: s.gmvDirect,
    roas: div(s.gmv, s.spend),
    roasDirect: div(s.gmvDirect, s.spend),
    spend: s.spend,
    acos: div(s.spend, s.gmv) * 100,
    impressions: s.impressions,
    cpm: div(s.spend, s.impressions) * 1000,
    clicks: s.clicks,
    ctr: div(s.clicks, s.impressions) * 100,
    cpc: div(s.spend, s.clicks),
    productViews: s.productViews,
    productClicks: s.productClicks,
    productCtr: div(s.productClicks, s.productViews) * 100,
    orders: s.orders,
    ordersDirect: s.ordersDirect,
    cpp: div(s.spend, s.orders),
    cvr: div(s.orders, s.clicks) * 100,
    sold: s.sold,
    aov: div(s.gmv, s.orders),
    abs: div(s.sold, s.orders),
    aur: div(s.gmv, s.sold),
  };
}

interface Def {
  key: keyof ShopPlusMetrics;
  label: string;
  fmt: PivotFmt;
  sentiment: Sentiment;
}

// Outcome first (revenue, return, spend), then the funnel that explains it —
// the same reading order as Fundamental Analysis, with Shop+'s own columns.
const VALUE_DEFS: readonly Def[] = [
  { key: 'gmv', label: 'GMV (Ads)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'gmvDirect', label: 'GMV Langsung', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'roas', label: 'ROAS', fmt: 'roas', sentiment: 'higher-better' },
  { key: 'roasDirect', label: 'ROAS Langsung', fmt: 'roas', sentiment: 'higher-better' },
  { key: 'spend', label: 'Amount Spend', fmt: 'rp', sentiment: 'neutral' },
  { key: 'acos', label: 'ACOS', fmt: 'pct', sentiment: 'lower-better' },
  { key: 'impressions', label: 'Impressions', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cpm', label: 'Cost per Miles (CPM)', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'clicks', label: 'Clicks', fmt: 'num', sentiment: 'higher-better' },
  { key: 'ctr', label: 'Click-Through Rate (CTR)', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cpc', label: 'Cost per Click (CPC)', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'productViews', label: 'Produk Dilihat', fmt: 'num', sentiment: 'higher-better' },
  { key: 'productClicks', label: 'Klik Produk', fmt: 'num', sentiment: 'higher-better' },
  { key: 'productCtr', label: 'CTR Produk', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'orders', label: 'Purchases', fmt: 'num', sentiment: 'higher-better' },
  { key: 'ordersDirect', label: 'Purchases Langsung', fmt: 'num', sentiment: 'higher-better' },
  { key: 'cpp', label: 'Cost per Purchase (CPP)', fmt: 'rp', sentiment: 'lower-better' },
  { key: 'cvr', label: 'Conversion Rate (CVR)', fmt: 'pct', sentiment: 'higher-better' },
  { key: 'sold', label: 'Items Sold', fmt: 'num', sentiment: 'higher-better' },
  { key: 'aov', label: 'Average Order Value (AOV)', fmt: 'rp', sentiment: 'higher-better' },
  { key: 'abs', label: 'Average Basket Size (ABS)', fmt: 'num', sentiment: 'higher-better' },
  { key: 'aur', label: 'Average Unit Retail (AUR)', fmt: 'rp', sentiment: 'higher-better' },
];

// GMV = Transaction × AOV; Transaction = Traffic × CVR; Traffic = Impressions
// × CTR; Impressions = Spend ÷ CPM. No ATC branch — Shop+ does not report it.
const TREE_DEFS: readonly (Def & { depth: number })[] = [
  { key: 'gmv', label: 'Gross Merchandise Value', depth: 0, fmt: 'rp', sentiment: 'higher-better' },
  { key: 'orders', label: 'Transaction', depth: 1, fmt: 'num', sentiment: 'higher-better' },
  { key: 'clicks', label: 'Traffic', depth: 2, fmt: 'num', sentiment: 'higher-better' },
  { key: 'impressions', label: 'Impressions', depth: 3, fmt: 'num', sentiment: 'higher-better' },
  { key: 'spend', label: 'Spending', depth: 4, fmt: 'rp', sentiment: 'neutral' },
  { key: 'cpm', label: 'CPM', depth: 4, fmt: 'rp', sentiment: 'lower-better' },
  { key: 'ctr', label: 'CTR', depth: 3, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'cvr', label: 'Conversion Rate', depth: 2, fmt: 'pct', sentiment: 'higher-better' },
  { key: 'aov', label: 'Average Order Value', depth: 1, fmt: 'rp', sentiment: 'higher-better' },
  { key: 'abs', label: 'Average Basket Size', depth: 2, fmt: 'num', sentiment: 'higher-better' },
  { key: 'aur', label: 'Average Unit Retail', depth: 2, fmt: 'rp', sentiment: 'higher-better' },
];

function row(def: Def, o: ShopPlusMetrics, c: ShopPlusMetrics) {
  const { deltaNum, deltaStr } = computeDelta(o[def.key], c[def.key]);
  return {
    key: def.key,
    label: def.label,
    fmt: def.fmt,
    oldNum: o[def.key],
    curNum: c[def.key],
    deltaNum,
    delta: formatDeltaID(deltaNum, deltaStr),
    cls: deltaClassForSentiment(deltaNum, def.sentiment),
  };
}

// The plain-language read reuses the account-level one — its ATC step drops
// out on its own when ATC is 0 in both periods.
function asFunnel(m: ShopPlusMetrics): FunnelMetrics {
  return {
    gmvOverall: 0, gmvAds: m.gmv, adContribution: 0, roas: m.roas, spend: m.spend, impressions: m.impressions, cpm: m.cpm,
    clicks: m.clicks, ctr: m.ctr, cpc: m.cpc, addToCart: 0, clicksToAtcRate: 0, cpAtc: 0, purchases: m.orders,
    atcToPurchaseRate: 0, cpp: m.cpp, cvr: m.cvr, itemsSold: m.sold, aov: m.aov, abs: m.abs, aur: m.aur,
  };
}

const pctTxt = (v: number) => `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;

// What the ad groups did — the one thing the funnel cannot say for Shop+.
function groupsPoint(groups: ShopPlusGroup[]): string | null {
  const cur = groups.filter((g) => g.cur);
  const old = groups.filter((g) => g.old);
  if (!cur.length && !old.length) return null;
  const fresh = groups.filter((g) => g.presence === 'new').length;
  const gone = groups.filter((g) => g.presence === 'gone').length;
  const total = cur.reduce((s, g) => s + (g.cur?.gmv ?? 0), 0);
  const top = [...cur].sort((a, b) => (b.cur?.gmv ?? 0) - (a.cur?.gmv ?? 0))[0];
  const parts = [`${cur.length} grup iklan aktif periode ini (periode lalu ${old.length})`];
  if (fresh || gone) parts.push(`${fresh} grup baru, ${gone} grup tidak berjalan lagi`);
  let text = `${parts.join('; ')}.`;
  if (top && total > 0) text += ` "${top.name}" menyumbang ${pctTxt(((top.cur?.gmv ?? 0) / total) * 100)} omzet Shop+.`;
  return text;
}

export interface ShopPlusFunnel {
  values: FunnelValueRow[];
  tree: FunnelTreeRow[];
  symptom: SymptomSummary;
}

export function buildShopPlusFunnel(oldRows: SheetRow[], curRows: SheetRow[], groups: ShopPlusGroup[]): ShopPlusFunnel | null {
  const so = sumRows(oldRows);
  const sc = sumRows(curRows);
  if (!(so.spend || sc.spend || so.impressions || sc.impressions)) return null;
  const o = shopPlusMetrics(so);
  const c = shopPlusMetrics(sc);
  const symptom = buildSymptomSummary(asFunnel(o), asFunnel(c));
  const extra = groupsPoint(groups);
  return {
    values: VALUE_DEFS.map((d) => row(d, o, c)),
    tree: TREE_DEFS.map((d) => ({ ...row(d, o, c), prefix: '', depth: d.depth })),
    symptom: extra ? { ...symptom, points: [...symptom.points, extra] } : symptom,
  };
}
