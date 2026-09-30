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
//   • Shopee: each product's sales (Product Performance) and its Iklan Produk
//     spend / GMV / ROAS, joined on Kode Produk — an exact join.
//   • Meta: CPAS, Meta ads that sell on Shopee, read per ad (materi iklan):
//     spend, orders and revenue "with shared items".
// A Meta ad names a creative, not a product, so it is tied to a Shopee
// product by the words they share. That tie is a guess and is shown as one:
// every match carries the words it rests on, and ads that tie to nothing
// (DPA, collections, seasonal pushes, recipes) are listed, not hidden.
//
// Two recommendations come out:
//   • strong on Meta, weak or absent in Iklan Shopee → push it in Shopee Ads;
//   • a Shopee best-seller with no Meta ad, or a weak one → push it on Meta.
// "Strong" and "weak" are relative to the brand's own median for the month,
// so the rule adapts to each brand's economics instead of a fixed ROAS.
// ══════════════════════════════════════════════════════

export interface ShopeeProduct {
  key: string;
  name: string;
  sales: number;
  adSpend: number;
  adRevenue: number;
  adRoas: number | null;
}

export interface MetaAd {
  name: string;
  spend: number;
  orders: number;
  revenue: number;
  roas: number | null;
  product: ShopeeProduct | null;
  matchedOn: string[];
}

export interface Recommendation {
  product: ShopeeProduct;
  ad: MetaAd | null;
  reason: string;
}

export interface CrossChannelResult {
  metaToShopee: Recommendation[];
  shopeeToMeta: Recommendation[];
  ads: MetaAd[];
  unmatched: MetaAd[];
  medians: { metaRoas: number | null; shopeeRoas: number | null };
  products: number;
}

const num = (v: unknown) => parseShopeeNum(v);

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
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
  return perf
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
      };
    });
}

const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !/^\d+(gr|g|kg|ml|pcs)?$/.test(w));

// Words that say nothing about which product it is: campaign shorthand, and
// any word in a large share of the brand's own product names (its name,
// "500gr", "slice"…) — learnt from the catalogue, not hard-coded per brand.
const CAMPAIGN_WORDS = new Set(['kol', 'dpa', 'coll', 'collection', 'promo', 'bundling', 'mixed', 'video', 'carousel', 'post', 'instagram', 'visit', 'store', 'the', 'and', 'dan', 'with', 'untuk', 'payday', 'double', 'date', 'deal', 'crazy', 'stock', 'best', 'seller', 'recommended', 'very', 'new', 'aug', 'jul', 'sep']);

function genericWords(products: ShopeeProduct[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of products) for (const w of new Set(tokenize(p.name))) counts.set(w, (counts.get(w) ?? 0) + 1);
  const limit = Math.max(3, products.length * 0.12);
  return new Set([...counts].filter(([, c]) => c > limit).map(([w]) => w));
}

function matchProduct(adName: string, products: ShopeeProduct[], generic: Set<string>): { product: ShopeeProduct | null; words: string[] } {
  const words = [...new Set(tokenize(adName))].filter((w) => !generic.has(w) && !CAMPAIGN_WORDS.has(w) && !/^(sv|nv|rm|si)$/.test(w));
  if (!words.length) return { product: null, words: [] };
  let best: { product: ShopeeProduct; hit: string[] } | null = null;
  for (const p of products) {
    const pw = new Set(tokenize(p.name));
    const hit = words.filter((w) => pw.has(w));
    if (!hit.length) continue;
    // More shared words wins; among equals, the product that sells more.
    if (!best || hit.length > best.hit.length || (hit.length === best.hit.length && p.sales > best.product.sales)) best = { product: p, hit };
  }
  return best ? { product: best.product, words: best.hit } : { product: null, words: [] };
}

export function buildCrossChannel(cpasRows: SheetRow[], products: ShopeeProduct[]): CrossChannelResult {
  const leaves = stripCampaignSubtotals(cpasRows);
  const adCol = leaves.length ? findAdCol(leaves) : null;
  const generic = genericWords(products);
  const ads: MetaAd[] = adCol
    ? buildSalesAudience(leaves, adCol).map((s) => {
      const spend = s.metrics.spend ?? 0;
      const revenue = s.metrics.gmv ?? 0;
      const m = matchProduct(s.label, products, generic);
      return { name: s.label, spend, orders: s.metrics.orders ?? 0, revenue, roas: spend > 0 ? revenue / spend : null, product: m.product, matchedOn: m.words };
    }).filter((a) => a.spend > 0)
    : [];

  const metaMedian = median(ads.map((a) => a.roas ?? NaN));
  const shopeeMedian = median(products.filter((p) => p.adRoas !== null).map((p) => p.adRoas as number));

  // Strong on Meta, weak or absent in Shopee Ads.
  const metaToShopee: Recommendation[] = [];
  const seen = new Set<string>();
  for (const a of [...ads].sort((x, y) => (y.roas ?? 0) - (x.roas ?? 0))) {
    if (!a.product || a.roas === null || metaMedian === null || a.roas < metaMedian || seen.has(a.product.key)) continue;
    const p = a.product;
    if (p.adRoas === null) {
      metaToShopee.push({ product: p, ad: a, reason: 'Belum diiklankan di Iklan Shopee, padahal materi Meta-nya menjual di atas median brand.' });
    } else if (shopeeMedian !== null && p.adRoas < shopeeMedian) {
      metaToShopee.push({ product: p, ad: a, reason: 'ROAS Iklan Shopee di bawah median brand, sementara materi Meta-nya di atas median.' });
    } else continue;
    seen.add(p.key);
  }

  // Shopee best-sellers that Meta is not pushing, or pushing badly.
  const byAd = new Map<string, MetaAd>();
  for (const a of ads) if (a.product && (!byAd.has(a.product.key) || (a.roas ?? 0) > (byAd.get(a.product.key)!.roas ?? 0))) byAd.set(a.product.key, a);
  const top = [...products].sort((x, y) => y.sales - x.sales).filter((p) => p.sales > 0).slice(0, 12);
  const shopeeToMeta: Recommendation[] = [];
  for (const p of top) {
    const a = byAd.get(p.key) ?? null;
    if (!a) shopeeToMeta.push({ product: p, ad: null, reason: 'Termasuk penjualan tertinggi di Shopee, tapi belum ada materi CPAS Meta yang mendorongnya.' });
    else if (metaMedian !== null && a.roas !== null && a.roas < metaMedian) shopeeToMeta.push({ product: p, ad: a, reason: 'Laris di Shopee, tapi materi CPAS-nya berjalan di bawah median brand — perbarui materi atau audiensnya.' });
  }

  return {
    metaToShopee,
    shopeeToMeta: shopeeToMeta.slice(0, 8),
    ads,
    unmatched: ads.filter((a) => !a.product),
    medians: { metaRoas: metaMedian, shopeeRoas: shopeeMedian },
    products: products.length,
  };
}
