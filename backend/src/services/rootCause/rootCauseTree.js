import * as dashboardRepo from '../../repositories/dashboardRepository.js';
import { snapshotGrain, snapshotGrainWarning } from '../../utils/dateGrain.js';
import { getMonthlyShopStats } from '../shopeeMonthly/monthlyShopStats.js';

// ===========================================================================
// Root Cause Analysis — GMV decomposition tree
// ===========================================================================
//
// One period in, one tree out. The controller calls this twice (main +
// comparison) and the frontend zips the two trees together by node `id` to
// draw a per-node delta, the same way the Report Generator's period-compare
// pairs its rows.
//
// Every node's number comes from the SAME table/stage the existing dashboard
// already reads for that figure (see dashboardRepository.js), so a node here
// agrees with the KPI or chart that shows the same thing on another tab. Where
// a parent could ALSO be computed from its children (GMV = Orders × AOV,
// Orders = Traffic × CR, AOV = ABS × AUR) the node carries both: `value` is
// the measured figure, `impliedValue` is the formula result, and `note`
// explains why they don't reconcile exactly (different funnel checkpoints /
// source files / order populations). Nothing is silently forced to match.

const n = (v) => {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

// Ratio that yields null (rendered as "—") rather than Infinity/NaN when the
// denominator is 0 or a side is missing.
const div = (a, b) => {
  const na = n(a);
  const nb = n(b);
  if (na == null || nb == null || nb === 0) return null;
  return na / nb;
};

const round = (v, dp) => (v == null ? null : Number(v.toFixed(dp)));

// unit: 'idr' | 'count' | 'percent' (0..1) | 'ratio' | 'unit_per_order' | 'idr_per_unit'
function node(id, label, opts = {}) {
  return {
    id,
    label,
    sublabel: opts.sublabel ?? null,
    unit: opts.unit ?? 'count',
    value: opts.value ?? null,
    absentReason: opts.absentReason ?? null,
    formula: opts.formula ?? null,
    impliedValue: opts.impliedValue ?? null,
    note: opts.note ?? null,
    placeholder: opts.placeholder ?? false,
    children: opts.children ?? [],
  };
}

// --- Traffic-source section layout ------------------------------------------
// Fixed structure (task spec). `db` is the sub_source_name in
// shopee.traffic_sub_sources; a section's own sub-sources that aren't listed
// here are folded into that section's "Others" node so no traffic is dropped,
// with their names surfaced in a note.

const TRAFFIC_SECTIONS = [
  {
    id: 'product-card',
    label: 'Product Card',
    sublabel: 'Halaman Produk',
    channel: 'Halaman Produk',
    subSources: [
      { db: 'Toko', label: 'Shop (Toko)' },
      { db: 'Pencarian', label: 'Search (Pencarian)' },
      { db: 'Rekomendasi', label: 'Recommendation' },
      { db: 'Keranjang', label: 'Cart (Keranjang)' },
      { db: 'Promosi', label: 'Promotion (Promosi)' },
      { db: 'Chat', label: 'Chat' },
      { db: 'Pesanan Saya', label: 'My Purchase (Pesanan Saya)' },
      { db: 'Lainnya', label: 'Others (Lainnya)', isOthers: true },
    ],
  },
  {
    id: 'seller-live',
    label: 'Seller Live',
    sublabel: 'Live Penjual',
    channel: 'Live Penjual',
    subSources: [
      { db: 'Chat', label: 'Chat' },
      { db: 'Halaman Utama Shopee Live', label: 'Homepage Live' },
      { db: 'Tab Live', label: 'Live Tab (Tab Live)' },
      { db: 'Pesanan Saya', label: 'My Purchase (Pesanan Saya)' },
      { db: 'Rekomendasi', label: 'Recommendation' },
      { db: 'Pencarian', label: 'Search (Pencarian)' },
      { db: 'Toko', label: 'Shop (Toko)' },
      { db: 'Keranjang', label: 'Cart (Keranjang)' },
      { db: 'Video', label: 'Video' },
      { db: 'Lainnya', label: 'Others (Lainnya)', isOthers: true },
    ],
  },
  {
    id: 'seller-video',
    label: 'Seller Video',
    sublabel: 'Video Penjual',
    channel: 'Video Penjual',
    subSources: [
      { db: 'Profil Kreator', label: 'Creator Profile (Profil Kreator)' },
      { db: 'Fitur Video', label: 'Feature Video (Fitur Video)' },
      { db: 'Halaman Utama Shopee Video', label: 'Homepage Video' },
      { db: 'Rekomendasi', label: 'Recommendation' },
      { db: 'Pencarian', label: 'Search (Pencarian)' },
      { db: 'Toko', label: 'Shop (Toko)' },
      { db: 'Pesanan Saya', label: 'My Purchase (Pesanan Saya)' },
      { db: 'Keranjang', label: 'Cart (Keranjang)' },
      { db: 'Lainnya', label: 'Others (Lainnya)', isOthers: true },
    ],
  },
  {
    id: 'shopee-affiliate',
    label: 'Shopee Affiliate',
    sublabel: 'Affiliate',
    channel: 'Affiliate',
    subSources: [
      { db: 'Video Affiliate', label: 'Affiliate Video (Video Affiliate)' },
      { db: 'Live Affiliate', label: 'Affiliate Live (Live Affiliate)' },
    ],
  },
];

const ORDER_FILE_ABSENT = 'Butuh file Order (Pesanan) Shopee dengan pesanan berstatus Selesai pada periode ini. Upload di Pengaturan Brand.';
const CPAS_NOTE =
  'Data CPAS (iklan Meta yang diarahkan ke Shopee) belum tersambung ke tree ini. Sumbernya ada di Meta Ads, bukan di file Shopee.';
const ADS_CTR_NOTE =
  'File Performance Overview Shopee tidak menyertakan klik untuk bagian Iklan Shopee (hanya Ads Impression, Pesanan, Biaya, ROAS), jadi CTR iklan belum bisa dihitung.';

function ctrChild(idPrefix, impressions, clicks) {
  return node(`${idPrefix}-ctr`, 'CTR', {
    unit: 'percent',
    value: round(div(clicks, impressions), 6),
    sublabel: 'Produk Diklik / Produk Dilihat',
  });
}
function impressionsChild(idPrefix, impressions) {
  return node(`${idPrefix}-impressions`, 'Impressions', {
    unit: 'count',
    value: impressions,
    sublabel: 'Jumlah Produk Dilihat',
  });
}

function buildTrafficSourceTree(rows) {
  // index: channel -> sub_source -> { impressions, clicks }
  const idx = new Map();
  for (const r of rows) {
    if (!idx.has(r.channel)) idx.set(r.channel, new Map());
    idx.get(r.channel).set(r.sub_source, {
      impressions: n(r.impressions) ?? 0,
      clicks: n(r.clicks) ?? 0,
    });
  }

  let overallImpressions = 0;
  const sectionNodes = TRAFFIC_SECTIONS.map((section) => {
    const bySub = idx.get(section.channel) || new Map();
    const mappedDbNames = new Set(section.subSources.map((s) => s.db));
    const othersSpec = section.subSources.find((s) => s.isOthers);

    // Sub-sources present in the data but not in the fixed layout → fold into
    // this section's Others bucket.
    let extraImpr = 0;
    let extraClicks = 0;
    const extraNames = [];
    for (const [subName, agg] of bySub.entries()) {
      if (!mappedDbNames.has(subName)) {
        extraImpr += agg.impressions;
        extraClicks += agg.clicks;
        extraNames.push(subName);
      }
    }

    let sectionImpr = 0;
    const subNodes = section.subSources.map((spec) => {
      const subId = `traffic-${section.id}-${slug(spec.label)}`;
      if (spec.placeholder) {
        return node(subId, spec.label, { placeholder: true });
      }
      let impr = (bySub.get(spec.db)?.impressions) ?? 0;
      let clicks = (bySub.get(spec.db)?.clicks) ?? 0;
      let note = null;
      if (spec.isOthers && extraNames.length) {
        impr += extraImpr;
        clicks += extraClicks;
        note = `Termasuk sumber kunjungan lain di section ini: ${extraNames.join(', ')}.`;
      }
      sectionImpr += impr;
      return node(subId, spec.label, {
        unit: 'count',
        value: impr,
        sublabel: 'Impressions',
        note,
        children: [impressionsChild(subId, impr), ctrChild(subId, impr, clicks)],
      });
    });

    // Section had extra sub-sources but no Others node in its layout → append one.
    if (!othersSpec && extraNames.length) {
      const subId = `traffic-${section.id}-others`;
      sectionImpr += extraImpr;
      subNodes.push(node(subId, 'Others (Lainnya)', {
        unit: 'count',
        value: extraImpr,
        sublabel: 'Impressions',
        note: `Sumber kunjungan lain: ${extraNames.join(', ')}.`,
        children: [impressionsChild(subId, extraImpr), ctrChild(subId, extraImpr, extraClicks)],
      }));
    }

    overallImpressions += sectionImpr;
    return node(`traffic-${section.id}`, section.label, {
      unit: 'count',
      value: sectionImpr,
      sublabel: `${section.sublabel} — Σ impressions`,
      children: subNodes,
    });
  });

  const overall = node('traffic-overall', 'Overall Traffic (organik)', {
    unit: 'count',
    value: overallImpressions,
    sublabel: 'Σ impressions seluruh sumber organik',
    formula: 'Σ impressions Product Card + Seller Live + Seller Video + Shopee Affiliate',
    children: sectionNodes,
  });

  return { overall, overallImpressions };
}

// Paid traffic: Iklan Shopee from the shop-stats file (Ads Impression and
// Pengeluaran Iklan per ad type). Impressions = Budget ÷ CPM × 1.000, so the
// budget and the price paid per thousand views are its two drivers.
function buildPaidTrafficTree(adRows) {
  const rows = adRows.map((r) => ({
    type: r.ad_type,
    impressions: n(r.impressions) ?? 0,
    spend: n(r.spend),
    sales: n(r.sales) ?? 0,
  }));
  const hasAds = rows.length > 0;
  const impressions = rows.reduce((s, r) => s + r.impressions, 0);
  const spendRows = rows.filter((r) => r.spend != null);
  const spend = spendRows.length ? spendRows.reduce((s, r) => s + r.spend, 0) : null;
  const sales = rows.reduce((s, r) => s + r.sales, 0);
  const cpm = spend != null && impressions > 0 ? (spend / impressions) * 1000 : null;
  const absent = hasAds ? null : 'Belum ada data Iklan Shopee untuk periode ini.';

  const perType = rows
    .filter((r) => r.impressions > 0 || (r.spend ?? 0) > 0)
    .map((r) => {
      const id = `traffic-paid-ads-${slug(r.type)}`;
      const typeCpm = r.spend != null && r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null;
      return node(id, r.type, {
        unit: 'count',
        value: r.impressions,
        sublabel: 'Ads Impression',
        formula: 'Budget ÷ CPM × 1.000',
        children: [
          node(`${id}-budget`, 'Budget', { unit: 'idr', value: r.spend, sublabel: 'Pengeluaran Iklan' }),
          node(`${id}-cpm`, 'CPM', { unit: 'idr', value: round(typeCpm, 2), sublabel: 'Biaya per 1.000 impression', formula: 'Budget ÷ Impression × 1.000' }),
          node(`${id}-roas`, 'ROAS', { unit: 'ratio', value: r.spend ? round(r.sales / r.spend, 2) : null, sublabel: 'Penjualan iklan ÷ Budget', formula: 'Penjualan dari iklan ÷ Budget' }),
        ],
      });
    });

  const adsEcosystem = node('traffic-paid-ads-ecosystem', 'Shopee Ads Ecosystem', {
    unit: 'count',
    value: hasAds ? impressions : null,
    absentReason: absent,
    sublabel: 'Σ Ads Impression Iklan Shopee',
    formula: 'Budget ÷ CPM × 1.000',
    children: [
      node('traffic-paid-ads-ecosystem-budget', 'Budget', { unit: 'idr', value: spend, absentReason: absent, sublabel: 'Σ Pengeluaran Iklan' }),
      node('traffic-paid-ads-ecosystem-cpm', 'CPM', { unit: 'idr', value: round(cpm, 2), absentReason: absent, sublabel: 'Biaya per 1.000 impression', formula: 'Budget ÷ Impression × 1.000' }),
      node('traffic-paid-ads-ecosystem-ctr', 'CTR', { unit: 'percent', placeholder: true, note: ADS_CTR_NOTE }),
      node('traffic-paid-ads-ecosystem-roas', 'ROAS', {
        unit: 'ratio',
        value: spend ? round(sales / spend, 2) : null,
        absentReason: absent,
        sublabel: 'Penjualan dari iklan ÷ Budget',
        formula: 'Penjualan dari iklan ÷ Budget',
      }),
      ...(perType.length ? [node('traffic-paid-ads-types', 'Per jenis iklan', {
        unit: 'count',
        value: impressions,
        sublabel: `${perType.length} jenis iklan aktif`,
        children: perType,
      })] : []),
    ],
  });

  return node('traffic-paid', 'Paid Traffic', {
    unit: 'count',
    value: hasAds ? impressions : null,
    absentReason: absent,
    sublabel: 'Σ impression berbayar',
    note: 'Iklan Shopee dibaca dari file Performance Overview (bagian Iklan Shopee). CPAS menyusul dari Meta Ads.',
    children: [adsEcosystem, node('traffic-paid-cpas', 'CPAS Shopee Ecosystem', { placeholder: true, note: CPAS_NOTE })],
  });
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function getRootCauseAnalysis({ brandId, startDate, endDate }) {
  const { isWholeCalendarMonth, monthsSpanned } = snapshotGrain(startDate, endDate);
  const [exec, funnelSnapshot, channelRows, adRows, basket, monthly] = await Promise.all([
    dashboardRepo.getExecutiveMetrics(brandId, startDate, endDate),
    dashboardRepo.getFunnelSnapshot(brandId, startDate, endDate),
    dashboardRepo.getChannelTrafficBreakdown(brandId, startDate, endDate),
    dashboardRepo.getAdsBreakdown(brandId, startDate, endDate),
    dashboardRepo.getBasketUnitMetrics(brandId, startDate, endDate),
    isWholeCalendarMonth ? getMonthlyShopStats(brandId, monthsSpanned[0]).catch(() => null) : null,
  ]);

  const gmv = n(exec.gmv);
  const orders = n(exec.transactions);
  // Unique visitors exist only as Shopee's monthly total; adding up daily
  // unique counts would count a returning visitor once per day. Outside a
  // whole calendar month the node says so instead of showing a sum.
  const visitors = monthly?.available ? n(monthly.stages['Pesanan Dibayar'].totals.visitors) : null;
  const visitorsAbsent = isWholeCalendarMonth
    ? 'Total pengunjung unik bulan ini belum tersedia. Upload file Performance Overview 1 bulan penuh di Pengaturan Brand.'
    : 'Pengunjung unik hanya tersedia per 1 bulan kalender penuh (angka Shopee tidak bisa dipecah per hari). Pilih periode 1 bulan untuk melihatnya.';
  const aov = div(gmv, orders);

  // Conversion Rate branch — Product Performance funnel (Pesanan Dibuat
  // checkpoint), exactly the columns getFunnelSnapshot already sums.
  const crVisitor = n(funnelSnapshot.funnel?.product_page_visitors);
  const crAtc = n(funnelSnapshot.funnel?.cart_visitors);
  const crPurchase = n(funnelSnapshot.funnel?.buyers_created);
  const visitToAtc = div(crAtc, crVisitor);
  const atcToPurchase = div(crPurchase, crAtc);
  const conversionRate = div(crPurchase, crVisitor);

  // AOV branch
  const ordersCount = n(basket.orders_count);
  const totalUnits = n(basket.total_units);
  const discountedRevenue = n(basket.discounted_revenue);
  const abs = div(totalUnits, ordersCount);
  const aur = div(discountedRevenue, totalUnits);

  const { overall: overallTrafficNode } = buildTrafficSourceTree(channelRows);
  const paidTrafficNode = buildPaidTrafficTree(adRows);

  const trafficNode = node('traffic', 'Traffic', {
    unit: 'count',
    value: visitors,
    sublabel: 'Total Pengunjung unik 1 bulan (Shopee)',
    absentReason: visitors == null ? visitorsAbsent : null,
    note:
      'Angka "Traffic" adalah pengunjung unik toko selama 1 bulan, dari baris total bulanan file Performance Overview. Anak-anaknya ("Overall Traffic" + "Paid Traffic") diukur dalam impression — satuan berbeda, jadi keduanya tidak saling menjumlah.',
    children: [overallTrafficNode, paidTrafficNode],
  });

  const conversionRateNode = node('conversion-rate', 'Conversion Rate', {
    unit: 'percent',
    value: round(conversionRate, 6),
    sublabel: 'Purchase (Pesanan Dibuat) / Visitor (Kunjungan Produk)',
    formula: '(ATC / Visitor) × (Purchase / ATC)',
    impliedValue: round(
      visitToAtc != null && atcToPurchase != null ? visitToAtc * atcToPurchase : null,
      6,
    ),
    children: [
      node('cr-visit-to-atc', 'Visit → ATC Rate', {
        unit: 'percent',
        value: round(visitToAtc, 6),
        formula: 'ATC / Visitor',
        children: [
          node('cr-visitor', 'Visitor', {
            unit: 'count',
            value: crVisitor,
            sublabel: 'Pengunjung Produk (Kunjungan)',
          }),
          node('cr-atc', 'ATC', {
            unit: 'count',
            value: crAtc,
            sublabel: 'Pengunjung Produk (Menambahkan Produk ke Keranjang)',
          }),
        ],
      }),
      node('cr-atc-to-purchase', 'ATC → Purchase Rate', {
        unit: 'percent',
        value: round(atcToPurchase, 6),
        formula: 'Purchase / ATC',
        children: [
          node('cr-atc-2', 'ATC', {
            unit: 'count',
            value: crAtc,
            sublabel: 'Pengunjung Produk (Menambahkan Produk ke Keranjang)',
          }),
          node('cr-purchase', 'Purchase', {
            unit: 'count',
            value: crPurchase,
            sublabel: 'Total Pembeli (Pesanan Dibuat)',
          }),
        ],
      }),
    ],
  });

  const ordersNode = node('orders', 'Orders', {
    unit: 'count',
    value: orders,
    sublabel: 'Total Pesanan (Pesanan Dibayar)',
    absentReason: orders == null ? 'Data pesanan belum tersedia untuk periode ini.' : null,
    formula: 'Traffic × Conversion Rate',
    impliedValue:
      visitors != null && conversionRate != null ? round(visitors * conversionRate, 2) : null,
    note:
      'Nilai terukur = Total Pesanan (Pesanan Dibayar). Cabang Traffic × Conversion Rate memakai checkpoint funnel berbeda (Pesanan Dibuat, pengunjung halaman produk), jadi hasil kalinya hanya pendekatan.',
    children: [trafficNode, conversionRateNode],
  });

  const aovNode = node('aov', 'Average Order Value (AOV)', {
    unit: 'idr',
    value: round(aov, 2),
    sublabel: 'GMV / Orders (Pesanan Dibayar)',
    formula: 'ABS × AUR',
    impliedValue: abs != null && aur != null ? round(abs * aur, 2) : null,
    note:
      'AOV = GMV / Orders (Pesanan Dibayar). ABS & AUR dihitung dari file Order (pesanan berstatus Selesai) — populasi & sumber berbeda, jadi ABS × AUR hanya mendekati AOV.',
    children: [
      node('aov-abs', 'ABS (Average Basket Size)', {
        unit: 'unit_per_order',
        value: round(abs, 4),
        absentReason: abs == null ? ORDER_FILE_ABSENT : null,
        sublabel: 'Σ Jumlah / Σ Pesanan (Selesai) — unit per pesanan',
        formula: 'Σ Jumlah / Σ Pesanan',
      }),
      node('aov-aur', 'AUR (Average Unit Retail)', {
        unit: 'idr_per_unit',
        value: round(aur, 2),
        absentReason: aur == null ? ORDER_FILE_ABSENT : null,
        sublabel: 'Σ (Harga Setelah Diskon × Jumlah) / Σ Jumlah',
        formula: 'Σ (Harga Setelah Diskon × Jumlah) / Σ Jumlah',
      }),
    ],
  });

  const gmvNode = node('gmv', 'GMV (Gross Merchandise Value)', {
    unit: 'idr',
    value: gmv,
    sublabel: 'Total Penjualan (IDR) — Pesanan Dibayar',
    absentReason: gmv == null ? 'GMV belum tersedia untuk periode ini.' : null,
    formula: 'Orders × AOV',
    impliedValue: orders != null && aov != null ? round(orders * aov, 2) : null,
    children: [ordersNode, aovNode],
  });

  return {
    tree: gmvNode,
    meta: {
      range: { startDate, endDate },
      // Conversion Rate branch (Visitor / ATC / Purchase) reads the monthly
      // Product Performance snapshot, matched by period overlap. Null when the
      // range is one clean calendar month; otherwise a caveat the UI renders.
      conversionRateGrain: snapshotGrainWarning(
        startDate, endDate, 'Cabang Conversion Rate (Visitor / ATC / Purchase)',
      ),
    },
  };
}
