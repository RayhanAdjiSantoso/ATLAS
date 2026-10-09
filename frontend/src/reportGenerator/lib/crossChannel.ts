import { findCol } from './columns';
import { stripCampaignSubtotals } from './meta';
import { buildSalesAudience, findAdCol } from './metaAudience';
import { parseShopeeNum } from './shopeeAds';
import type { ProductPerfRecord } from './shopeeProductAnalysis';
import type { SheetRow } from './types';

// ══════════════════════════════════════════════════════
// META × SHOPEE — WHICH PRODUCT TO PUSH WHERE
//
// Two readings of the same catalogue:
//   • Shopee: each product's sales and shop funnel (Product Performance) and
//     its Iklan Produk spend / revenue, joined on Kode Produk — exact.
//   • Meta: CPAS read per ad (materi iklan) — spend, content views, adds to
//     cart, purchases and revenue "with shared items".
// A Meta ad names a creative, not a product, so it is tied to a Shopee
// product by the words they share. That tie is a guess and is shown as one.
//
// WHY NOT ROAS ALONE. A CPAS ad's purchases are few — most ads close 0–5 a
// month while their adds to cart run into the tens or hundreds — because
// people meet the product in the ad, cart it, and buy later or elsewhere.
// Ranking on ROAS then ranks on noise (a brand's median ROAS can be 0, which
// made every ad "above median"). So the Meta side is read where the volume
// is, at purchase intent, and purchases count only once there are enough:
//
//   Skor Meta (0–100) = percentile within the brand's own ads, weighted
//     • Biaya per Add to Cart (lower is better)  45%
//     • View → Add to Cart rate                    30%
//     • Purchase ROAS                              25%  — only when the ad has
//       ≥ MIN_PURCHASES purchases; otherwise its weight moves to the two above.
//   An ad needs ≥ MIN_ATC adds to cart to be scored at all ("data tipis").
//
//   Skor Shopee (0–100) = percentile within the brand's catalogue
//     • Penjualan                                  60%
//     • Tingkat konversi halaman produk            40%
//
// The user may rank by a single measure instead (basis); the composite is the
// default because no single CPAS measure is both frequent and close to money.
// "Strong" is the top half of the brand's own ads/products, so the rule adapts
// to each brand's economics instead of a fixed threshold.
// ══════════════════════════════════════════════════════

export const MIN_ATC = 10;
export const MIN_PURCHASES = 3;

export type MetaBasis = 'score' | 'costPerAtc' | 'atcRate' | 'roas';
export const META_BASIS: { id: MetaBasis; label: string; hint: string }[] = [
  { id: 'score', label: 'Skor gabungan', hint: 'Biaya per ATC 45% · View→ATC 30% · ROAS 25% (ROAS hanya bila ≥ 3 pembelian)' },
  { id: 'costPerAtc', label: 'Biaya per ATC', hint: 'Seberapa murah materi menghasilkan niat beli' },
  { id: 'atcRate', label: 'View → ATC', hint: 'Seberapa kuat materi membuat orang memasukkan ke keranjang' },
  { id: 'roas', label: 'ROAS', hint: 'Hanya materi dengan ≥ 3 pembelian yang dinilai' },
];

export interface ShopeeProduct {
  key: string;
  name: string;
  sales: number;
  adSpend: number;
  adRevenue: number;
  adRoas: number | null;
  clicks: number;
  conversionRate: number | null; // %
  visitToAtcRate: number | null; // %
  atc: number;
  shopeeScore: number;
}

export interface MetaAd {
  name: string;
  spend: number;
  impressions: number;
  contentViews: number;
  atc: number;
  orders: number;
  revenue: number;
  roas: number | null;
  costPerAtc: number | null;
  atcRate: number | null; // fraction
  ctr: number | null; // fraction
  scored: boolean;
  score: number | null;
  parts: { costPerAtc: number | null; atcRate: number | null; roas: number | null };
  // What the ad promotes, as far as its name says: one product, a collection
  // (every product sharing a word, "Shirt Coll", "DPA Essentials"), the whole
  // catalogue (DPA / "All Products"), or nothing readable.
  scope: 'product' | 'collection' | 'catalog' | 'none';
  products: ShopeeProduct[];
  product: ShopeeProduct | null; // the single product, scope 'product' only
  matchedOn: string[];
}

export interface MetaSupport {
  ad: MetaAd;
  scope: 'product' | 'collection';
}

export interface Recommendation {
  product: ShopeeProduct;
  ad: MetaAd | null;
  scope?: 'product' | 'collection';
  reason: string;
  tag?: 'traffic' | 'unadvertised' | 'weakShopee' | 'noMeta' | 'weakMeta';
}

export interface CrossChannelResult {
  metaToShopee: Recommendation[];
  shopeeToMeta: Recommendation[];
  stars: Recommendation[];
  ads: MetaAd[];
  unmatched: MetaAd[];
  map: { product: ShopeeProduct; ad: MetaAd | null; scope: 'product' | 'collection' | null }[];
  catalog: MetaAd[]; // ads that promote the whole catalogue (DPA, All Products)
  basis: MetaBasis;
  unit: 'ad' | 'campaign';
  totals: { spend: number; atc: number; orders: number; revenue: number; scoredAds: number };
  medians: { costPerAtc: number | null; atcRate: number | null; shopeeRoas: number | null; shopeeCvr: number | null; clicks: number | null };
  products: number;
}

const num = (v: unknown) => parseShopeeNum(v);

function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Percentile rank of each value within its list, 0–100; `lowerIsBetter`
// flips it. Ties share a rank; a single value scores 50.
function percentiles(values: (number | null)[], lowerIsBetter = false): (number | null)[] {
  const present = values.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!present.length) return values.map(() => null);
  return values.map((v) => {
    if (v == null || !Number.isFinite(v)) return null;
    if (present.length === 1) return 50;
    const below = present.filter((x) => x < v).length;
    const equal = present.filter((x) => x === v).length;
    const p = ((below + (equal - 1) / 2) / (present.length - 1)) * 100;
    return lowerIsBetter ? 100 - p : p;
  });
}

// Shopee's ad export lists groups as well as products ("Iklan Produk
// Otomatis", "Testing | Mix Products"); only rows with a product code are
// one product.
export function shopeeAdsByProduct(rows: SheetRow[]): Map<string, { spend: number; revenue: number }> {
  const out = new Map<string, { spend: number; revenue: number }>();
  if (!rows.length) return out;
  const code = findCol(rows, ['kode produk']);
  const spend = Object.keys(rows[0]).find((h) => h.trim().toLowerCase() === 'biaya') ?? null;
  const revenue = findCol(rows, ['omzet penjualan']);
  if (!code || !spend || !revenue) return out;
  for (const r of rows) {
    const k = String(r[code] ?? '').trim();
    if (!k || k === '-' || !/^\d+$/.test(k)) continue;
    const cur = out.get(k) ?? { spend: 0, revenue: 0 };
    cur.spend += num(r[spend]);
    cur.revenue += num(r[revenue]);
    out.set(k, cur);
  }
  return out;
}

export function buildShopeeProducts(perf: ProductPerfRecord[], adRows: SheetRow[]): ShopeeProduct[] {
  const ads = shopeeAdsByProduct(adRows);
  const base = perf
    .filter((p) => p.produk)
    .map((p) => {
      const a = ads.get(p.kodeProduk) ?? { spend: 0, revenue: 0 };
      return {
        key: p.key,
        name: p.produk,
        sales: p.salesConfirmed,
        adSpend: a.spend,
        adRevenue: a.revenue,
        adRoas: a.spend > 0 ? a.revenue / a.spend : null,
        clicks: p.clicks,
        // A conversion rate on a handful of visits is noise; it needs traffic.
        conversionRate: p.clicks >= 50 ? p.conversionRate : null,
        visitToAtcRate: p.clicks >= 50 ? p.visitToAtcRate : null,
        atc: p.atc,
        shopeeScore: 0,
      };
    });
  const salesP = percentiles(base.map((p) => (p.sales > 0 ? p.sales : null)));
  const cvrP = percentiles(base.map((p) => p.conversionRate));
  base.forEach((p, i) => {
    const s = salesP[i];
    const c = cvrP[i];
    p.shopeeScore = s == null ? 0 : Math.round(c == null ? s : s * 0.6 + c * 0.4);
  });
  return base;
}

const fold = (w: string) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !/^\d+(gr|g|kg|ml|pcs)?$/.test(w)).map(fold);

// Words that say nothing about which product it is: campaign shorthand, and
// any word in a large share of the brand's own product names (its name,
// "500gr", "slice"…) — learnt from the catalogue, not hard-coded per brand.
const CAMPAIGN_WORDS = new Set(['kol', 'dpa', 'coll', 'collection', 'promo', 'bundling', 'mixed', 'video', 'carousel', 'post', 'instagram', 'visit', 'store', 'the', 'and', 'dan', 'with', 'untuk', 'payday', 'double', 'date', 'deal', 'crazy', 'stock', 'best', 'seller', 'recommended', 'very', 'new', 'aug', 'jul', 'sep', 'image', 'teaser', 'reminder', 'catalog', 'products', 'product', 'all', 'drop', 'reels', 'testimoni', 'detail', 'material', 'display', 'prod', 'traffic', 'puller', 'recomm', 'mix', 'match', 'look', 'outfit', 'ootd']);

function wordCounts(products: ShopeeProduct[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of products) for (const w of new Set(tokenize(p.name))) counts.set(w, (counts.get(w) ?? 0) + 1);
  return counts;
}

function genericWords(counts: Map<string, number>, total: number): Set<string> {
  const limit = Math.max(3, total * 0.12);
  return new Set([...counts].filter(([, c]) => c > limit).map(([w]) => w));
}

// Reads what an ad promotes from its name.
//   product    — a word in at most two product names ("polaris"), or several
//                shared words: one product.
//   collection — a word shared by a group (3 to 35% of the catalogue: "shirt",
//                "essential", "blazer"): every product in that group.
//   catalog    — a DPA or "All Products" ad with no narrower word: everything.
function matchAd(
  adName: string, products: ShopeeProduct[], generic: Set<string>, counts: Map<string, number>,
): { scope: MetaAd['scope']; products: ShopeeProduct[]; product: ShopeeProduct | null; words: string[] } {
  const raw = adName.toLowerCase();
  const all = [...new Set(tokenize(adName))].filter((w) => !CAMPAIGN_WORDS.has(w) && !/^(sv|nv|rm|si|car|q[1-4]\d{2}|\d+)$/.test(w));
  const catalogAd = /\bdpa\b|all prod|catalog/.test(raw);
  const none = { scope: (catalogAd ? 'catalog' : 'none') as MetaAd['scope'], products: [], product: null, words: [] };

  // One product: the best overlap, accepted when it is distinctive.
  const specific = all.filter((w) => !generic.has(w));
  let best: { product: ShopeeProduct; hit: string[] } | null = null;
  for (const p of products) {
    const pw = new Set(tokenize(p.name));
    const hit = specific.filter((w) => pw.has(w));
    if (!hit.length) continue;
    if (!best || hit.length > best.hit.length || (hit.length === best.hit.length && p.sales > best.product.sales)) best = { product: p, hit };
  }
  if (best && (best.hit.length >= 2 || (counts.get(best.hit[0]) ?? 0) <= 2)) {
    return { scope: 'product', products: [best.product], product: best.product, words: best.hit };
  }

  // A collection: the narrowest shared word that still names a group.
  const ceiling = Math.max(3, products.length * 0.35);
  const group = all
    .map((w) => ({ w, c: counts.get(w) ?? 0 }))
    .filter(({ c }) => c >= 3 && c <= ceiling)
    .sort((x, y) => x.c - y.c)[0];
  if (group) {
    const members = products.filter((p) => tokenize(p.name).includes(group.w));
    return { scope: 'collection', products: members, product: null, words: [group.w] };
  }
  return none;
}

// The value an ad is ranked by under the chosen basis (higher = stronger).
function strength(ad: MetaAd, basis: MetaBasis): number | null {
  if (!ad.scored) return null;
  if (basis === 'score') return ad.score;
  return ad.parts[basis];
}

const TAG_ORDER: Record<string, number> = { traffic: 0, noMeta: 1, weakMeta: 2 };

export function buildCrossChannel(cpasRows: SheetRow[], products: ShopeeProduct[], basis: MetaBasis = 'score'): CrossChannelResult {
  const leaves = stripCampaignSubtotals(cpasRows);
  // Exports pulled at campaign level (the auto-fetch for some brands) carry
  // no Ad name; the campaign is then the unit that is read and scored.
  const adLevel = leaves.length ? findAdCol(leaves) : null;
  const adCol = adLevel ?? (leaves.length ? findCol(leaves, ['campaign']) : null);
  const unit: 'ad' | 'campaign' = adLevel ? 'ad' : 'campaign';
  const counts = wordCounts(products);
  const generic = genericWords(counts, products.length);
  const ads: MetaAd[] = adCol
    ? buildSalesAudience(leaves, adCol).map((s) => {
      const m = s.metrics;
      const spend = m.spend ?? 0;
      const revenue = m.gmv ?? 0;
      const atc = m.atc ?? 0;
      const orders = m.orders ?? 0;
      const contentViews = m.contentViews ?? 0;
      const match = matchAd(s.label, products, generic, counts);
      return {
        name: s.label,
        spend,
        impressions: m.impressions ?? 0,
        contentViews,
        atc,
        orders,
        revenue,
        roas: spend > 0 ? revenue / spend : null,
        costPerAtc: atc > 0 ? spend / atc : null,
        atcRate: contentViews > 0 ? atc / contentViews : null,
        ctr: m.ctr ?? null,
        scored: atc >= MIN_ATC,
        score: null,
        parts: { costPerAtc: null, atcRate: null, roas: null },
        scope: match.scope,
        products: match.products,
        product: match.product,
        matchedOn: match.words,
      } as MetaAd;
    }).filter((a) => a.spend > 0)
    : [];

  // Scores are ranked among the ads with enough volume only.
  const scored = ads.filter((a) => a.scored);
  const pCost = percentiles(scored.map((a) => a.costPerAtc), true);
  const pRate = percentiles(scored.map((a) => a.atcRate));
  const pRoas = percentiles(scored.map((a) => (a.orders >= MIN_PURCHASES ? a.roas : null)));
  scored.forEach((a, i) => {
    a.parts = { costPerAtc: pCost[i], atcRate: pRate[i], roas: pRoas[i] };
    const parts: [number | null, number][] = [[pCost[i], 0.45], [pRate[i], 0.3], [pRoas[i], 0.25]];
    const used = parts.filter(([v]) => v != null) as [number, number][];
    const w = used.reduce((t, [, x]) => t + x, 0);
    a.score = w ? Math.round(used.reduce((t, [v, x]) => t + v * x, 0) / w) : null;
  });

  const medians = {
    costPerAtc: median(scored.map((a) => a.costPerAtc)),
    atcRate: median(scored.map((a) => a.atcRate)),
    shopeeRoas: median(products.map((p) => p.adRoas)),
    // Among products that sell — most of a catalogue converts nothing, which
    // would put the median at 0 and make every product "above median".
    shopeeCvr: median(products.filter((p) => p.sales > 0 && (p.conversionRate ?? 0) > 0).map((p) => p.conversionRate)),
    clicks: median(products.filter((p) => p.sales > 0).map((p) => p.clicks)),
  };

  // The strongest ad promoting each product — its own or its collection's —
  // stands for it. Catalogue-wide ads (DPA) touch every product equally, so
  // they say nothing about one product and are reported separately.
  const byProduct = new Map<string, MetaSupport>();
  for (const a of ads) {
    if (a.scope !== 'product' && a.scope !== 'collection') continue;
    for (const p of a.products) {
      const cur = byProduct.get(p.key);
      if (!cur || (strength(a, basis) ?? -1) > (strength(cur.ad, basis) ?? -1)) byProduct.set(p.key, { ad: a, scope: a.scope });
    }
  }
  const STRONG = 50; // top half of the brand's own ads / products

  // Strong on Meta, weak or absent in Shopee Ads.
  const metaToShopee: Recommendation[] = [];
  const productOf = new Map(products.map((p) => [p.key, p]));
  for (const [key, sup] of [...byProduct].sort((x, y) => ((strength(y[1].ad, basis) ?? -1) - (strength(x[1].ad, basis) ?? -1)) || ((productOf.get(y[0])?.sales ?? 0) - (productOf.get(x[0])?.sales ?? 0)))) {
    const s = strength(sup.ad, basis);
    if (s == null || s < STRONG) continue;
    const p = productOf.get(key)!;
    if (p.sales <= 0) continue;
    const via = sup.scope === 'collection' ? `Materi koleksinya (“${sup.ad.matchedOn[0]}”)` : 'Materi Meta-nya';
    if (p.adRoas === null) metaToShopee.push({ product: p, ad: sup.ad, scope: sup.scope, tag: 'unadvertised', reason: `${via} termasuk paling efektif membuat orang memasukkan ke keranjang, tapi produk ini belum diiklankan di Iklan Shopee.` });
    else if (medians.shopeeRoas !== null && p.adRoas < medians.shopeeRoas) metaToShopee.push({ product: p, ad: sup.ad, scope: sup.scope, tag: 'weakShopee', reason: `${via} diminati, tapi ROAS Iklan Shopee produk ini di bawah median brand — cek kata kunci, harga, atau halaman produknya.` });
  }

  // Shopee products that convert, which Meta is not pushing or pushing weakly.
  const top = [...products].filter((p) => p.sales > 0).sort((x, y) => y.shopeeScore - x.shopeeScore).slice(0, 20);
  const shopeeToMeta: Recommendation[] = [];
  const stars: Recommendation[] = [];
  for (const p of top) {
    const sup = byProduct.get(p.key) ?? null;
    const a = sup?.ad ?? null;
    const s = a ? strength(a, basis) : null;
    const highCvr = p.conversionRate != null && medians.shopeeCvr != null && p.conversionRate >= medians.shopeeCvr;
    const lowTraffic = medians.clicks != null && p.clicks <= medians.clicks;
    if (!a) {
      shopeeToMeta.push({
        product: p, ad: null, tag: highCvr && lowTraffic ? 'traffic' : 'noMeta',
        reason: highCvr && lowTraffic
          ? 'Konversinya di atas median tapi kunjungannya sedikit — kandidat terbaik untuk diberi traffic lewat CPAS.'
          : 'Termasuk produk terkuat di Shopee, tapi belum ada materi CPAS Meta yang mendorongnya.',
      });
    } else if (s != null && s < STRONG) {
      shopeeToMeta.push({ product: p, ad: a, scope: sup!.scope, tag: 'weakMeta', reason: sup!.scope === 'collection' ? 'Kuat di Shopee, tapi hanya didorong materi koleksi yang lemah — buat materi khusus produk ini.' : 'Kuat di Shopee, tapi materi CPAS-nya di bawah rata-rata brand — perbarui kreatif atau audiensnya.' });
    } else if (s != null) {
      stars.push({ product: p, ad: a, scope: sup!.scope, reason: 'Kuat di Shopee dan materi Meta-nya juga di atas rata-rata — pertahankan dan jadikan acuan kreatif.' });
    }
  }

  const map = top.map((p) => ({ product: p, ad: byProduct.get(p.key)?.ad ?? null, scope: byProduct.get(p.key)?.scope ?? null }));
  return {
    metaToShopee: metaToShopee.slice(0, 8),
    // High conversion on little traffic first: the clearest case for Meta.
    shopeeToMeta: [...shopeeToMeta].sort((x, y) => (TAG_ORDER[x.tag ?? ''] ?? 9) - (TAG_ORDER[y.tag ?? ''] ?? 9)).slice(0, 8),
    stars: stars.slice(0, 6),
    ads,
    unmatched: ads.filter((a) => a.scope === 'none'),
    catalog: ads.filter((a) => a.scope === 'catalog'),
    map,
    basis,
    unit,
    totals: {
      spend: ads.reduce((t, a) => t + a.spend, 0),
      atc: ads.reduce((t, a) => t + a.atc, 0),
      orders: ads.reduce((t, a) => t + a.orders, 0),
      revenue: ads.reduce((t, a) => t + a.revenue, 0),
      scoredAds: scored.length,
    },
    medians,
    products: products.length,
  };
}
