import { computeDelta, deltaClassForSentiment, formatDeltaID } from './delta';
import type { PivotFmt } from './shopeeDeepDivePivot';
import { parseProductPerfRows, type ParetoRow, type ProductRankRow } from './shopeeProductAnalysis';
import { parseShopeeNum } from './shopeeAds';
import type { Sentiment, SheetRow } from './types';

// ══════════════════════════════════════════════════════
// SHOPEE — per-channel analysis for the report's channel tabs
// (Overall · Product Ads · Shop+ Ads · Live Ads · Banner Ads).
//
// Which Data Collection Hub dataset feeds which channel — read off the real
// Seller Centre exports, not assumed:
//
//   Product Ads  "Data Keseluruhan Iklan" (channel produk: one row per ad,
//                Jenis Iklan = Iklan Produk, incl. GMV Max) + "Rincian Data
//                Iklan Produk Otomatis" (produk_otomatis: the auto campaign
//                per product). Items = products.
//   Shop+ Ads    "Shop+ Ads Overall Data" (toko: one row per Shop+ ad
//                group — Nama Iklan, Status, Tampilan, Bidding). Items =
//                ad groups. "Keyword Level Data" (toko_keyword: one row per
//                Kata Pencarian inside its Nama Iklan) feeds the keyword
//                charts and the keyword Pareto, and stands in for the totals
//                when the overall file is missing. Neither file has an
//                Add-to-Cart column.
//   Live Ads     "Data Semua Iklan Live" (live: one row per live session —
//                Penonton, Pesanan, Omzet, Biaya; no impressions/clicks).
//                Items = sessions.
//   Banner Ads   No export in the hub yet — the tab says so.
//   Overall      the three above, plus "Product Performance" (store sales per
//                product, Pesanan Siap Dikirim) for the store-level analyses.
//
// One product advertised several times appears as "Nama Produk [2]",
// "[3]"… (sometimes "{2}"); every copy is the same product and is summed.
// ══════════════════════════════════════════════════════

export type ShopeeChannelKey = 'produk' | 'toko' | 'live' | 'banner';

export const SHOPEE_CHANNELS: readonly { key: ShopeeChannelKey; label: string; color: string; itemLabel: string }[] = [
  { key: 'produk', label: 'Product Ads', color: '#c93b1c', itemLabel: 'Produk' },
  { key: 'toko', label: 'Shop+ Ads', color: '#0f766e', itemLabel: 'Grup Iklan' },
  { key: 'live', label: 'Live Ads', color: '#7c3aed', itemLabel: 'Sesi Live' },
  { key: 'banner', label: 'Banner Ads', color: '#b45309', itemLabel: 'Banner' },
];

// A product's name without its duplicate-ad suffix, for matching and grouping.
export function productNameKey(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s*[[{]\s*\d+\s*[\]}]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
const displayName = (raw: unknown) => String(raw ?? '').replace(/\s*[[{]\s*\d+\s*[\]}]\s*$/, '').replace(/\s+/g, ' ').trim();

// Exact (case-insensitive) header lookup — the exports reuse words across
// columns ("Konversi" vs "Konversi Langsung"), so substring matching would
// pick the wrong one.
function headerMap(rows: SheetRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows.slice(0, 3)) for (const h of Object.keys(r)) map.set(h.toLowerCase().trim(), h);
  return map;
}

export interface ItemSums {
  impressions: number; // Dilihat
  clicks: number; // Jumlah Klik
  atc: number; // Tambah ke Keranjang (Product Ads only)
  orders: number; // Konversi / Pesanan (Live)
  sold: number; // Produk Terjual
  gmv: number; // Omzet Penjualan
  spend: number; // Biaya
  viewers: number; // Penonton (Live only)
  // Shop+ only: the direct ("Langsung") share of orders and revenue, and the
  // product tiles inside the shop ad (Jumlah Produk Dilihat / Klik Produk).
  ordersDirect: number;
  gmvDirect: number;
  productViews: number;
  productClicks: number;
  // Clicks and orders of only the rows that report Add to Cart. The auto
  // campaign's file has no ATC column and many ads print "-" there, so the
  // ATC steps are read off these rows alone — a row with no ATC figure would
  // otherwise read as 0% ATC and push Purchase Rate past 100%.
  atcClicks: number;
  atcOrders: number;
}
const ZERO: ItemSums = { impressions: 0, clicks: 0, atc: 0, orders: 0, sold: 0, gmv: 0, spend: 0, viewers: 0, ordersDirect: 0, gmvDirect: 0, productViews: 0, productClicks: 0, atcClicks: 0, atcOrders: 0 };
export const addItemSums = (a: ItemSums, b: ItemSums): ItemSums => ({
  impressions: a.impressions + b.impressions, clicks: a.clicks + b.clicks, atc: a.atc + b.atc, orders: a.orders + b.orders,
  sold: a.sold + b.sold, gmv: a.gmv + b.gmv, spend: a.spend + b.spend, viewers: a.viewers + b.viewers,
  ordersDirect: a.ordersDirect + b.ordersDirect, gmvDirect: a.gmvDirect + b.gmvDirect,
  productViews: a.productViews + b.productViews, productClicks: a.productClicks + b.productClicks,
  atcClicks: a.atcClicks + b.atcClicks, atcOrders: a.atcOrders + b.atcOrders,
});

function rowSums(row: SheetRow, h: Map<string, string>): ItemSums {
  const v = (name: string) => {
    const col = h.get(name);
    return col ? parseShopeeNum(row[col]) : 0;
  };
  const atcCol = h.get('tambah ke keranjang');
  const atcRaw = atcCol ? String(row[atcCol] ?? '').trim() : '';
  const reportsAtc = atcRaw !== '' && atcRaw !== '-';
  const clicks = v('jumlah klik');
  const orders = h.has('konversi') ? v('konversi') : v('pesanan');
  return {
    impressions: v('dilihat'),
    clicks,
    atc: v('tambah ke keranjang'),
    orders,
    sold: v('produk terjual'),
    gmv: v('omzet penjualan'),
    spend: v('biaya'),
    viewers: v('penonton'),
    ordersDirect: v('konversi langsung'),
    gmvDirect: v('penjualan langsung (gmv langsung)'),
    productViews: v('jumlah produk dilihat'),
    productClicks: v('jumlah klik produk'),
    atcClicks: reportsAtc ? clicks : 0,
    atcOrders: reportsAtc ? orders : 0,
  };
}

export function sumRows(rows: SheetRow[]): ItemSums {
  const h = headerMap(rows);
  return rows.reduce<ItemSums>((acc, r) => addItemSums(acc, rowSums(r, h)), { ...ZERO });
}

export interface ItemAgg {
  key: string;
  name: string;
  sums: ItemSums;
  copies: number; // how many export rows were folded into this item ([2], [3]… duplicates)
}

// Rows → items. `keyOf` decides what counts as one item; rows sharing a key
// are summed. Rows with an empty key (subtotals, blank lines) are skipped.
function aggregate(rows: SheetRow[], keyOf: (r: SheetRow, h: Map<string, string>) => { key: string; name: string } | null): Map<string, ItemAgg> {
  const h = headerMap(rows);
  const out = new Map<string, ItemAgg>();
  for (const r of rows) {
    const id = keyOf(r, h);
    if (!id || !id.key) continue;
    const s = rowSums(r, h);
    const prev = out.get(id.key);
    if (prev) {
      prev.sums = addItemSums(prev.sums, s);
      prev.copies += 1;
    } else out.set(id.key, { key: id.key, name: id.name, sums: s, copies: 1 });
  }
  return out;
}

const col = (h: Map<string, string>, name: string) => h.get(name);
const cell = (r: SheetRow, h: Map<string, string>, name: string) => {
  const c = col(h, name);
  return c ? String(r[c] ?? '').trim() : '';
};

// Product Ads: one item per product — by Kode Produk when the row has one,
// else by its name without the [n] suffix. The auto campaign's own rollup
// row ("Iklan Produk Otomatis", no product) is not a product.
const productKey = (r: SheetRow, h: Map<string, string>) => {
  const rawName = cell(r, h, 'nama iklan') || cell(r, h, 'nama produk');
  const nameKey = productNameKey(rawName);
  if (!nameKey || nameKey === 'iklan produk otomatis') return null;
  const kode = cell(r, h, 'kode produk');
  return { key: kode && kode !== '-' ? `k:${kode}` : `n:${nameKey}`, name: displayName(rawName) };
};
// Shop+ and Live: one item per ad — a Shop+ ad group, or a live session (whose
// name already carries its date and time).
const adKey = (r: SheetRow, h: Map<string, string>) => {
  const name = cell(r, h, 'nama iklan');
  return name ? { key: name.toLowerCase(), name } : null;
};

// ── Derived metrics ──────────────────────────────────────────────────────
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
export const derived = {
  ctr: (s: ItemSums) => (s.impressions > 0 ? (s.clicks / s.impressions) * 100 : null),
  cr: (s: ItemSums) => (s.clicks > 0 ? (s.orders / s.clicks) * 100 : null),
  liveCr: (s: ItemSums) => (s.viewers > 0 ? (s.orders / s.viewers) * 100 : null),
  atcRate: (s: ItemSums) => (s.atcClicks > 0 ? (s.atc / s.atcClicks) * 100 : null),
  purchaseRate: (s: ItemSums) => (s.atc > 0 ? (s.atcOrders / s.atc) * 100 : null),
  roas: (s: ItemSums) => ratio(s.gmv, s.spend),
  cpa: (s: ItemSums) => ratio(s.spend, s.orders),
};

export interface ChannelMetricDef {
  key: string;
  label: string;
  fmt: PivotFmt;
  sentiment: Sentiment;
  get: (s: ItemSums) => number | null;
}

// Same row shape as the Product Performance rankings, so one table renders both.
export interface ChannelMetricRanking {
  metric: string;
  label: string;
  fmt: PivotFmt;
  rows: ProductRankRow[];
}

function rankItems(oldItems: Map<string, ItemAgg>, curItems: Map<string, ItemAgg>, defs: readonly ChannelMetricDef[]): { rankings: ChannelMetricRanking[]; hasOld: boolean } {
  const hasOld = [...curItems.keys()].some((k) => oldItems.has(k));
  const rankings = defs.map((def) => {
    const rows: ProductRankRow[] = [...curItems.values()].map((it) => {
      const cur = def.get(it.sums);
      const prev = oldItems.get(it.key);
      const old = hasOld && prev ? def.get(prev.sums) : null;
      const { deltaNum, deltaStr } = old === null || cur === null ? { deltaNum: null, deltaStr: '—' } : computeDelta(old, cur);
      return {
        key: it.key,
        produk: it.copies > 1 ? `${it.name} (${it.copies} iklan)` : it.name,
        old,
        cur,
        deltaNum,
        delta: hasOld && prev ? formatDeltaID(deltaNum, deltaStr) : hasOld ? 'New' : '—',
        cls: deltaClassForSentiment(deltaNum, def.sentiment),
      };
    });
    rows.sort((a, b) => (b.cur ?? -Infinity) - (a.cur ?? -Infinity));
    return { metric: def.key, label: def.label, fmt: def.fmt, rows };
  });
  return { rankings, hasOld };
}

function paretoOf(items: Map<string, ItemAgg>, value: (s: ItemSums) => number): ParetoRow[] {
  const ranked = [...items.values()].map((it) => ({ it, v: value(it.sums) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const total = ranked.reduce((s, x) => s + x.v, 0);
  let running = 0;
  return ranked.map(({ it, v }) => {
    const contribution = total > 0 ? (v / total) * 100 : 0;
    running += contribution;
    return { key: it.key, produk: it.copies > 1 ? `${it.name} (${it.copies} iklan)` : it.name, sales: v, contribution, cumulative: running };
  });
}

// ── Potential ────────────────────────────────────────────────────────────

// Product Ads / Overall: products that SELL in the store (Product
// Performance, Pesanan Siap Dikirim) but have no individual Iklan Produk —
// the headroom an ad could add to. Matched on Kode Produk first, then on the
// name without its [n]/{n} suffix; one product listed twice under the same
// name counts once.
export interface UnadvertisedProduct {
  key: string;
  produk: string;
  revenue: number;
  conversionRate: number;
  share: number; // % of the store's sales in the period
  visitors: number;
  status: 'none' | 'auto'; // no ad at all · only in Iklan Produk Otomatis
  merged: number; // product rows folded together under one name
}

export function buildUnadvertisedProducts(
  perfRows: SheetRow[] | null,
  individualAdRows: SheetRow[],
  autoAdRows: SheetRow[],
  count = 60,
): { products: UnadvertisedProduct[]; advertisedCount: number; totalProducts: number } {
  const records = perfRows ? parseProductPerfRows(perfRows) : [];
  if (!records.length) return { products: [], advertisedCount: 0, totalProducts: 0 };

  const collect = (rows: SheetRow[]) => {
    const h = headerMap(rows);
    const codes = new Set<string>();
    const names = new Set<string>();
    for (const r of rows) {
      const kode = cell(r, h, 'kode produk');
      if (kode && kode !== '-') codes.add(kode);
      const n = productNameKey(cell(r, h, 'nama iklan') || cell(r, h, 'nama produk'));
      if (n && n !== 'iklan produk otomatis') names.add(n);
    }
    return { codes, names };
  };
  const indiv = collect(individualAdRows);
  const auto = collect(autoAdRows);

  // Same name = same product, whatever its code or [n] suffix.
  type Group = { name: string; codes: Set<string>; revenue: number; visitors: number; crWeighted: number; rows: number };
  const groups = new Map<string, Group>();
  for (const r of records) {
    const k = productNameKey(r.produk) || r.key;
    const g = groups.get(k) ?? { name: displayName(r.produk) || r.key, codes: new Set<string>(), revenue: 0, visitors: 0, crWeighted: 0, rows: 0 };
    if (r.kodeProduk && r.kodeProduk !== '-') g.codes.add(r.kodeProduk);
    g.revenue += r.salesConfirmed;
    g.visitors += r.visitors;
    g.crWeighted += r.conversionRate * r.salesConfirmed;
    g.rows += 1;
    groups.set(k, g);
  }
  const totalRevenue = [...groups.values()].reduce((s, g) => s + g.revenue, 0);
  const hits = (set: { codes: Set<string>; names: Set<string> }, nameKey: string, codes: Set<string>) => set.names.has(nameKey) || [...codes].some((c) => set.codes.has(c));

  let advertisedCount = 0;
  const out: UnadvertisedProduct[] = [];
  for (const [nameKey, g] of groups) {
    if (hits(indiv, nameKey, g.codes)) { advertisedCount += 1; continue; }
    // Shopee's placeholder for a product it can no longer describe (deleted
    // or delisted) is not something an ad could be put on.
    if (g.revenue <= 0 || /^tidak dapat memperoleh informasi produk/i.test(g.name)) continue;
    out.push({
      key: nameKey,
      produk: g.name,
      revenue: g.revenue,
      conversionRate: g.revenue > 0 ? g.crWeighted / g.revenue : 0,
      share: totalRevenue > 0 ? (g.revenue / totalRevenue) * 100 : 0,
      visitors: g.visitors,
      status: hits(auto, nameKey, g.codes) ? 'auto' : 'none',
      merged: g.rows,
    });
  }
  out.sort((a, b) => b.revenue - a.revenue);
  return { products: out.slice(0, count), advertisedCount, totalProducts: groups.size };
}

// Live sessions: what is already paying back best and could take more budget.
export interface PotentialItem {
  key: string;
  name: string;
  gmv: number;
  spend: number;
  roas: number;
  orders: number;
  spendShare: number; // % of the channel's spend
  note: string;
}

function potentialSessions(items: Map<string, ItemAgg>, count = 10): PotentialItem[] {
  const all = [...items.values()];
  const spend = all.reduce((s, it) => s + it.sums.spend, 0);
  const gmv = all.reduce((s, it) => s + it.sums.gmv, 0);
  const channelRoas = spend > 0 ? gmv / spend : 0;
  return all
    .filter((it) => it.sums.orders > 0 && it.sums.spend > 0 && it.sums.gmv / it.sums.spend >= channelRoas)
    .map((it) => ({
      key: it.key,
      name: it.name,
      gmv: it.sums.gmv,
      spend: it.sums.spend,
      roas: it.sums.gmv / it.sums.spend,
      orders: it.sums.orders,
      spendShare: spend > 0 ? (it.sums.spend / spend) * 100 : 0,
      note: 'Sesi dengan ROAS di atas rata-rata — ulangi jam & format ini',
    }))
    .sort((a, b) => b.roas - a.roas || b.gmv - a.gmv)
    .slice(0, count);
}

// ── Channel report ───────────────────────────────────────────────────────

const AD_TRAFFIC: readonly ChannelMetricDef[] = [
  { key: 'clicks', label: 'Clicks', fmt: 'num', sentiment: 'higher-better', get: (s) => s.clicks },
  { key: 'impressions', label: 'Impressions', fmt: 'num', sentiment: 'higher-better', get: (s) => s.impressions },
  { key: 'ctr', label: 'CTR', fmt: 'pct', sentiment: 'higher-better', get: derived.ctr },
];
// Conversion Rate = Purchases ÷ Clicks, split into its two steps: Clicks →
// ATC (ATC Rate) and ATC → Purchase (Purchase Rate).
const AD_CONVERSION: readonly ChannelMetricDef[] = [
  { key: 'cr', label: 'Conversion Rate', fmt: 'pct', sentiment: 'higher-better', get: derived.cr },
  { key: 'atcRate', label: 'ATC Rate', fmt: 'pct', sentiment: 'higher-better', get: derived.atcRate },
  { key: 'purchaseRate', label: 'Purchase Rate', fmt: 'pct', sentiment: 'higher-better', get: derived.purchaseRate },
];
// Shop+ exports carry no Add-to-Cart, so Shop+ reads conversion by count,
// rate and return instead of the ATC steps.
const TOKO_CONVERSION: readonly ChannelMetricDef[] = [
  { key: 'orders', label: 'Konversi', fmt: 'num', sentiment: 'higher-better', get: (s) => s.orders },
  { key: 'cr', label: 'Conversion Rate', fmt: 'pct', sentiment: 'higher-better', get: derived.cr },
  { key: 'roas', label: 'ROAS', fmt: 'roas', sentiment: 'higher-better', get: derived.roas },
];
const LIVE_TRAFFIC: readonly ChannelMetricDef[] = [
  { key: 'viewers', label: 'Penonton', fmt: 'num', sentiment: 'higher-better', get: (s) => s.viewers },
];
const LIVE_CONVERSION: readonly ChannelMetricDef[] = [
  { key: 'orders', label: 'Pesanan', fmt: 'num', sentiment: 'higher-better', get: (s) => s.orders },
  { key: 'liveCr', label: 'Conversion Rate', fmt: 'pct', sentiment: 'higher-better', get: derived.liveCr },
  { key: 'roas', label: 'ROAS', fmt: 'roas', sentiment: 'higher-better', get: derived.roas },
];

export interface ChannelAnalysis {
  key: ShopeeChannelKey;
  label: string;
  itemLabel: string;
  source: string; // which hub dataset(s) the tab reads
  hasData: boolean;
  totals: { old: ItemSums; cur: ItemSums };
  traffic: { rankings: ChannelMetricRanking[]; hasOld: boolean };
  conversion: { rankings: ChannelMetricRanking[]; hasOld: boolean };
  pareto: ParetoRow[];
  potentialItems: PotentialItem[];
  // Shop+ only: every ad group of both periods, side by side, and its keywords.
  groups?: ShopPlusGroup[];
  keywords?: ShopPlusKeywords;
}

// Shop+ keywords ("Keyword Level Data"). `all` ranks each keyword summed over
// every campaign it runs in; `byCampaign` ranks each keyword inside its own
// campaign (Nama Iklan), for a chart filtered to one campaign.
export interface ShopPlusKeywordRankings {
  all: ChannelMetricRanking[];
  byCampaign: ChannelMetricRanking[];
  hasOld: boolean;
}
export interface ShopPlusKeywords {
  hasData: boolean;
  campaigns: string[];
  campaignOf: Record<string, string>; // byCampaign item key → campaign name
  traffic: ShopPlusKeywordRankings;
  conversion: ShopPlusKeywordRankings;
}

const keywordOnly = (r: SheetRow, h: Map<string, string>) => {
  const kw = cell(r, h, 'kata pencarian');
  return kw ? { key: kw.toLowerCase(), name: kw } : null;
};
const campaignKeyword = (r: SheetRow, h: Map<string, string>) => {
  const campaign = cell(r, h, 'nama iklan');
  const kw = cell(r, h, 'kata pencarian');
  return campaign && kw ? { key: `${campaign.toLowerCase()}\u0000${kw.toLowerCase()}`, name: kw } : null;
};

function buildShopPlusKeywords(oldRows: SheetRow[], curRows: SheetRow[], defsTraffic: readonly ChannelMetricDef[], defsConversion: readonly ChannelMetricDef[]): ShopPlusKeywords {
  const allOld = aggregate(oldRows, keywordOnly);
  const allCur = aggregate(curRows, keywordOnly);
  const pairOld = aggregate(oldRows, campaignKeyword);
  const pairCur = aggregate(curRows, campaignKeyword);
  const campaignOf: Record<string, string> = {};
  const h = headerMap(curRows);
  for (const r of curRows) {
    const id = campaignKeyword(r, h);
    if (id) campaignOf[id.key] = cell(r, h, 'nama iklan');
  }
  // Campaigns in this period's order of spend, biggest first.
  const spendBy = new Map<string, number>();
  for (const it of pairCur.values()) {
    const c = campaignOf[it.key];
    spendBy.set(c, (spendBy.get(c) ?? 0) + it.sums.spend);
  }
  const rank = (defs: readonly ChannelMetricDef[]): ShopPlusKeywordRankings => {
    const all = rankItems(allOld, allCur, defs);
    return { all: all.rankings, byCampaign: rankItems(pairOld, pairCur, defs).rankings, hasOld: all.hasOld };
  };
  return {
    hasData: allCur.size > 0,
    campaigns: [...spendBy.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c),
    campaignOf,
    traffic: rank(defsTraffic),
    conversion: rank(defsConversion),
  };
}

export interface ShopeeChannelInput {
  produkOld: SheetRow[]; // Iklan Produk with Produk Otomatis merged in
  produkCur: SheetRow[];
  tokoOld: SheetRow[]; // Shop+ overall
  tokoCur: SheetRow[];
  tokoKeywordOld: SheetRow[];
  tokoKeywordCur: SheetRow[];
  liveOld: SheetRow[];
  liveCur: SheetRow[];
}

export function buildChannelAnalyses(input: ShopeeChannelInput): ChannelAnalysis[] {
  const produkOld = aggregate(input.produkOld, productKey);
  const produkCur = aggregate(input.produkCur, productKey);
  const tokoOldItems = aggregate(input.tokoOld, adKey);
  const tokoCurItems = aggregate(input.tokoCur, adKey);
  const groups = buildShopPlusGroups(input.tokoOld, input.tokoCur);
  const liveOld = aggregate(input.liveOld, adKey);
  const liveCur = aggregate(input.liveCur, adKey);

  // Channel totals come from the files that hold the channel's whole spend:
  // Product Ads from every row (the auto campaign included), Shop+ from its
  // overall file (keyword rows do not add up to it), Live from its sessions.
  const produkTotals = { old: sumRows(input.produkOld), cur: sumRows(input.produkCur) };
  const tokoTotals = { old: sumRows(input.tokoOld.length ? input.tokoOld : input.tokoKeywordOld), cur: sumRows(input.tokoCur.length ? input.tokoCur : input.tokoKeywordCur) };
  const liveTotals = { old: sumRows(input.liveOld), cur: sumRows(input.liveCur) };
  const has = (t: { old: ItemSums; cur: ItemSums }) => t.old.spend + t.cur.spend + t.old.gmv + t.cur.gmv > 0;

  return [
    {
      key: 'produk', label: 'Product Ads', itemLabel: 'Produk',
      source: 'Data Keseluruhan Iklan + Iklan Produk Otomatis',
      hasData: has(produkTotals), totals: produkTotals,
      traffic: rankItems(produkOld, produkCur, AD_TRAFFIC),
      conversion: rankItems(produkOld, produkCur, AD_CONVERSION),
      pareto: paretoOf(produkCur, (s) => s.gmv),
      potentialItems: [],
    },
    {
      key: 'toko', label: 'Shop+ Ads', itemLabel: 'Grup Iklan',
      source: 'Shop+ Ads Overall Data',
      hasData: has(tokoTotals), totals: tokoTotals,
      traffic: rankItems(tokoOldItems, tokoCurItems, AD_TRAFFIC),
      conversion: rankItems(tokoOldItems, tokoCurItems, TOKO_CONVERSION),
      // Pareto reads keywords only — which search terms earn the revenue.
      pareto: paretoOf(aggregate(input.tokoKeywordCur, keywordOnly), (s) => s.gmv),
      potentialItems: [],
      groups,
      keywords: buildShopPlusKeywords(input.tokoKeywordOld, input.tokoKeywordCur, AD_TRAFFIC, TOKO_CONVERSION),
    },
    {
      key: 'live', label: 'Live Ads', itemLabel: 'Sesi Live',
      source: 'Data Semua Iklan Live',
      hasData: has(liveTotals), totals: liveTotals,
      traffic: rankItems(liveOld, liveCur, LIVE_TRAFFIC),
      conversion: rankItems(liveOld, liveCur, LIVE_CONVERSION),
      pareto: paretoOf(liveCur, (s) => s.gmv),
      potentialItems: potentialSessions(liveCur),
    },
    {
      key: 'banner', label: 'Banner Ads', itemLabel: 'Banner',
      source: 'belum ada di Data Collection Hub',
      hasData: false, totals: { old: { ...ZERO }, cur: { ...ZERO } },
      traffic: { rankings: [], hasOld: false }, conversion: { rankings: [], hasOld: false },
      pareto: [], potentialItems: [],
    },
  ];
}

// ── Product Ads: individual ads vs the auto campaign ─────────────────────
// Shopee files Iklan Produk Otomatis under Iklan Produk, so Product Ads keeps
// both (its total is what Overall and the ROI root add up); this splits it
// back so the two can be judged against each other. Individual = "Data
// Keseluruhan Iklan" minus its auto rollup row; auto = the Otomatis file's
// products, or that rollup row when the file was not uploaded — the same
// figures mergeProdukOtomatis puts into the Product Ads total.

export interface ProductAdsSplit {
  individual: { old: ItemSums; cur: ItemSums };
  auto: { old: ItemSums; cur: ItemSums };
}

const isAutoRollup = (r: SheetRow, h: Map<string, string>) => productNameKey(cell(r, h, 'nama iklan') || cell(r, h, 'nama produk')) === 'iklan produk otomatis';

function splitPeriod(individualRows: SheetRow[], autoRows: SheetRow[]): { individual: ItemSums; auto: ItemSums } {
  const hi = headerMap(individualRows);
  const ha = headerMap(autoRows);
  const individual = individualRows.filter((r) => !isAutoRollup(r, hi));
  const auto = autoRows.length ? autoRows.filter((r) => !isAutoRollup(r, ha)) : individualRows.filter((r) => isAutoRollup(r, hi));
  return { individual: sumRows(individual), auto: sumRows(auto) };
}

export function buildProductAdsSplit(individualOld: SheetRow[], individualCur: SheetRow[], autoOld: SheetRow[], autoCur: SheetRow[]): ProductAdsSplit {
  const o = splitPeriod(individualOld, autoOld);
  const c = splitPeriod(individualCur, autoCur);
  return { individual: { old: o.individual, cur: c.individual }, auto: { old: o.auto, cur: c.auto } };
}

// ── Shop+ ad groups, both periods ────────────────────────────────────────
// One entry per Nama Iklan across the two exports. Groups come and go month
// to month (a promo group runs a week, then ends), so a group present in only
// one period is kept and marked rather than dropped — "what stopped" and
// "what is new" is half of the comparison.

export interface ShopPlusGroup {
  key: string;
  name: string;
  status: string; // Berjalan / Dijeda / Berakhir — from the latest period it appears in
  display: string; // Manual / Otomatis (Tampilan Iklan)
  bidding: string; // Manual / Otomatis (Mode Bidding)
  start: string;
  end: string;
  presence: 'both' | 'new' | 'gone'; // in both periods · this period only · last period only
  old: ItemSums | null;
  cur: ItemSums | null;
}

const shortMode = (v: string) => v.replace(/^(tampilan iklan|bidding)\s+/i, '').trim();
// The CSV reader turns an ambiguous "03/08/2026" (3 Aug) into an Excel serial
// read month-first; printing it back month-first restores the text Shopee
// wrote, which is day-first.
const shortDate = (v: string) => {
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
  }
  return v.replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '').trim();
};

export function buildShopPlusGroups(oldRows: SheetRow[], curRows: SheetRow[]): ShopPlusGroup[] {
  const read = (rows: SheetRow[]) => {
    const h = headerMap(rows);
    const out = new Map<string, { row: SheetRow; h: Map<string, string>; sums: ItemSums }>();
    for (const r of rows) {
      const id = adKey(r, h);
      if (!id) continue;
      const prev = out.get(id.key);
      out.set(id.key, { row: prev?.row ?? r, h, sums: prev ? addItemSums(prev.sums, rowSums(r, h)) : rowSums(r, h) });
    }
    return out;
  };
  const o = read(oldRows);
  const c = read(curRows);
  const groups: ShopPlusGroup[] = [];
  for (const key of new Set([...c.keys(), ...o.keys()])) {
    const src = c.get(key) ?? o.get(key)!;
    const { row, h } = src;
    groups.push({
      key,
      name: cell(row, h, 'nama iklan'),
      status: cell(row, h, 'status'),
      display: shortMode(cell(row, h, 'tampilan iklan')),
      bidding: shortMode(cell(row, h, 'mode bidding')),
      start: shortDate(cell(row, h, 'tanggal mulai')),
      end: shortDate(cell(row, h, 'tanggal selesai')),
      presence: c.has(key) && o.has(key) ? 'both' : c.has(key) ? 'new' : 'gone',
      old: o.get(key)?.sums ?? null,
      cur: c.get(key)?.sums ?? null,
    });
  }
  // This period's groups first, biggest spend first; then the ones that ran
  // only last period.
  return groups.sort((a, b) => Number(!a.cur) - Number(!b.cur) || (b.cur?.spend ?? b.old?.spend ?? 0) - (a.cur?.spend ?? a.old?.spend ?? 0));
}

// ── ROI root: ROI = Revenue ÷ Spend, each split by channel ────────────────

export interface RoiBranchRow {
  key: ShopeeChannelKey;
  label: string;
  color: string;
  hasData: boolean;
  old: number;
  cur: number;
  deltaNum: number | null;
  delta: string;
  cls: string;
  share: number; // % of the branch total, current period
  roasOld: number | null;
  roasCur: number | null;
}
export interface RoiBranch {
  old: number;
  cur: number;
  deltaNum: number | null;
  delta: string;
  cls: string;
  rows: RoiBranchRow[];
}
export interface RoiRoot {
  roi: { old: number | null; cur: number | null; deltaNum: number | null; delta: string; cls: string };
  revenue: RoiBranch;
  spend: RoiBranch;
}

const deltaOf = (old: number | null, cur: number | null, sentiment: Sentiment) => {
  const { deltaNum, deltaStr } = computeDelta(old, cur);
  return { deltaNum, delta: formatDeltaID(deltaNum, deltaStr), cls: deltaClassForSentiment(deltaNum, sentiment) };
};

export function buildRoiRoot(channels: ChannelAnalysis[]): RoiRoot {
  const branch = (field: 'gmv' | 'spend', sentiment: Sentiment): RoiBranch => {
    const old = channels.reduce((s, c) => s + c.totals.old[field], 0);
    const cur = channels.reduce((s, c) => s + c.totals.cur[field], 0);
    return {
      old, cur, ...deltaOf(old, cur, sentiment),
      rows: channels.map((c) => {
        const meta = SHOPEE_CHANNELS.find((m) => m.key === c.key)!;
        return {
          key: c.key, label: c.label, color: meta.color, hasData: c.hasData,
          old: c.totals.old[field], cur: c.totals.cur[field],
          ...deltaOf(c.hasData ? c.totals.old[field] : null, c.hasData ? c.totals.cur[field] : null, sentiment),
          share: cur > 0 ? (c.totals.cur[field] / cur) * 100 : 0,
          roasOld: derived.roas(c.totals.old), roasCur: derived.roas(c.totals.cur),
        };
      }),
    };
  };
  const revenue = branch('gmv', 'higher-better');
  // Spend has no good direction on its own — it is read against revenue.
  const spend = branch('spend', 'neutral');
  const roiOld = spend.old > 0 ? revenue.old / spend.old : null;
  const roiCur = spend.cur > 0 ? revenue.cur / spend.cur : null;
  return { roi: { old: roiOld, cur: roiCur, ...deltaOf(roiOld, roiCur, 'higher-better') }, revenue, spend };
}
