import * as dashboardRepo from '../repositories/dashboardRepository.js';
import { computeRfmAnalysis, RFM_SEGMENTS, SEGMENT_ACTIONS } from './rfm/rfmAnalysis.js';
import { computeProductPerformance } from './productPerformance/productPerformanceAnalysis.js';
import { snapshotGrainWarning } from '../utils/dateGrain.js';

// Root Cause Analysis tab — GMV decomposition tree. Kept in its own module
// (the tree layout + traffic-source section mapping is sizeable); re-exported
// here so the controller keeps importing one dashboard service.
export { getRootCauseAnalysis } from './rootCause/rootCauseTree.js';

// Helper to calculate growth percentage
function calculateGrowth(current, previous) {
  const currNum = Number(current || 0);
  const prevNum = Number(previous || 0);
  if (prevNum === 0) return currNum > 0 ? 100 : 0;
  return Number((((currNum - prevNum) / prevNum) * 100).toFixed(2));
}

// Indonesian comma-decimal percentage text for insight sentences built here
// server-side (e.g. "naik 12,5%") -- keeps generated text consistent with the
// frontend's Intl.NumberFormat('id-ID') formatting instead of a raw
// period-decimal `.toFixed()`.
function formatPct(value, decimals = 1) {
  return `${Number(value).toLocaleString('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}%`;
}

// Repeat Customer Rate: >1x transaksi (repeat) vs 1x transaksi, over every
// customer with a completed order in the period. A within-period repeat-
// order rate -- distinct from RFM's cohort "Customer Retention" (customers
// active in a PREVIOUS period who return in the current one). Shared by
// getRfmAnalysis() (both periods, when this data now lives) so there's only
// ever one computation.
function computeRepeatCustomerRate(retentionRow) {
  const totalCustomers = Number(retentionRow.total_customers || 0);
  const customersRetained = Number(retentionRow.customers_retained || 0);
  return {
    totalCustomers,
    customersSingle: Number(retentionRow.customers_single || 0),
    customersRetained,
    retentionRatePct: totalCustomers > 0 ? Number(((customersRetained / totalCustomers) * 100).toFixed(2)) : 0,
  };
}

// Fixed, meaningful order (not sorted by count) for the repeat-purchase
// distance bar chart — matches the notebook's bucket order exactly.
const REPEAT_CYCLE_DISTANCE_BUCKETS = [
  '0-1 hari', '2-3 hari', '4-7 hari', '8-14 hari', '15-30 hari',
  '31-60 hari', '61-90 hari', '91-180 hari', '181-365 hari', '>365 hari',
];

// Repeat purchase cycle (1st -> 2nd order gap): overall stats, fixed-order
// distance-bucket distribution, and same-product-vs-different comparison.
function computeRepeatCycle(repeatCycleData) {
  const distMap = new Map(repeatCycleData.distribution.map(d => [d.rentang, Number(d.jumlah_pelanggan || 0)]));
  const distTotal = [...distMap.values()].reduce((s, v) => s + v, 0);
  return {
    stats: {
      customerCount: Number(repeatCycleData.stats.jumlah_pelanggan || 0),
      avgDays: Number(Number(repeatCycleData.stats.rata2_hari || 0).toFixed(1)),
      medianDays: Number(Number(repeatCycleData.stats.median_hari || 0).toFixed(1)),
      // Rounded to whole days for display (unlike avg/median, these are a
      // single customer's actual observed gap, not an aggregate -- display
      // as a day count rather than the underlying timestamp-precision value).
      minDays: Math.round(Number(repeatCycleData.stats.min_hari || 0)),
      maxDays: Math.round(Number(repeatCycleData.stats.max_hari || 0)),
    },
    distribution: REPEAT_CYCLE_DISTANCE_BUCKETS.map(range => {
      const count = distMap.get(range) || 0;
      return {
        range,
        customerCount: count,
        percentage: distTotal > 0 ? Number(((count / distTotal) * 100).toFixed(1)) : 0,
      };
    }),
    comparison: repeatCycleData.comparison.map(c => ({
      type: c.tipe,
      customerCount: Number(c.jumlah_pelanggan || 0),
      avgDays: Number(Number(c.rata2_hari || 0).toFixed(1)),
      medianDays: Number(Number(c.median_hari || 0).toFixed(1)),
    })),
  };
}

// Same locale rule, for percentage-POINT values (no % suffix, unit is "pp").
function formatNum(value, decimals = 1) {
  return Number(value).toLocaleString('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Single source of truth for product revenue ranking -- fetches the raw rows
// and runs the exact same computeProductPerformance() classification used by
// the Product Performance tab. Shared by getProductPerformance() (full tab,
// user-selectable level) and getExecutiveSnapshot() (fixed 'category' level,
// top/bottom highlight only) so there is only ever one ranking calculation,
// never two divergent ones.
async function getProductRanking({ brandId, startDate, endDate, level = 'category' }) {
  const rawRows = await dashboardRepo.getProductPerformanceRawMetrics(brandId, startDate, endDate, level);
  return computeProductPerformance(rawRows, { level, windowStartDate: startDate });
}

export async function getExecutiveSnapshot({ brandId, startDate, endDate, compareStartDate, compareEndDate }) {
  const [current, discountData, uniqueCustomers, productRanking, funnelSnapshot, trend] = await Promise.all([
    dashboardRepo.getExecutiveMetrics(brandId, startDate, endDate),
    dashboardRepo.getDiscountSummary(brandId, startDate, endDate),
    dashboardRepo.getUniqueCustomerCount(brandId, startDate, endDate),
    getProductRanking({ brandId, startDate, endDate, level: 'category' }),
    dashboardRepo.getFunnelSnapshot(brandId, startDate, endDate),
    dashboardRepo.getGrowthMetrics(brandId, startDate, endDate),
  ]);

  // Top/bottom product highlight, read straight off Product Performance's
  // own ranked list (same list as its "Top 10 Revenue" chart / contribution
  // table) -- no separate ranking logic here.
  const topProductRow = productRanking.topByRevenue[0] || null;
  const bottomProductRow = productRanking.contributions[productRanking.contributions.length - 1] || null;

  // Calculate derived values for current period
  const gmv = Number(current.gmv || 0);
  const tx = Number(current.transactions || 0);
  const txGross = Number(current.transactions_gross || 0);
  const visitors = Number(current.visitors || 0);
  const unitsSold = Number(current.units_sold || 0);
  const cancelledOrders = Number(current.cancelled_orders || 0);
  // Average of the daily "Tingkat Konversi Pesanan" column (Pesanan Dibayar
  // sheet) over the selected range — read as-is, not recomputed, since it's
  // not reproducible from total_orders/total_visitors (verified separately).
  const cvr = Number(Number(current.cvr || 0).toFixed(4));

  const aov = tx > 0 ? Number((gmv / tx).toFixed(2)) : 0;
  // Denominator is the gross (pre-cancellation) order count, not the net
  // `tx` above — Tingkat Pembatalan means "% of paid orders that got
  // cancelled", which requires cancelled orders to still be part of the
  // denominator they're a fraction of.
  const cancellationRate = txGross > 0 ? Number((cancelledOrders / txGross).toFixed(4)) : 0;
  const totalDiscount = Object.values(discountData || {}).reduce((sum, v) => sum + Number(v || 0), 0);

  const funnelProductPageVisitors = Number(funnelSnapshot.funnel?.product_page_visitors || 0);
  const funnelCartVisitors = Number(funnelSnapshot.funnel?.cart_visitors || 0);
  const funnelBuyersCreated = Number(funnelSnapshot.funnel?.buyers_created || 0);
  const funnelBuyersReadyToShip = Number(funnelSnapshot.funnel?.buyers_ready_to_ship || 0);

  // Full daily trend (gmv/transactions/aov), not just gmv — the frontend
  // uses it both for the GMV KPI sparkline and to work out each metric's
  // best/worst performing day, same as the Business Growth tab (the full
  // "Tren GMV" line chart itself now lives only on Business Growth).
  const trends = trend.map((t) => {
    const dailyGmv = Number(t.gmv || 0);
    const dailyTx = Number(t.transactions || 0);
    return {
      date: t.date,
      gmv: dailyGmv,
      transactions: dailyTx,
      aov: dailyTx > 0 ? Number((dailyGmv / dailyTx).toFixed(2)) : 0,
    };
  });

  let comparison = null;

  if (compareStartDate && compareEndDate) {
    const [previous, prevDiscountData, prevUniqueCustomers] = await Promise.all([
      dashboardRepo.getExecutiveMetrics(brandId, compareStartDate, compareEndDate),
      dashboardRepo.getDiscountSummary(brandId, compareStartDate, compareEndDate),
      dashboardRepo.getUniqueCustomerCount(brandId, compareStartDate, compareEndDate),
    ]);
    const pGmv = Number(previous.gmv || 0);
    const pTx = Number(previous.transactions || 0);
    const pTxGross = Number(previous.transactions_gross || 0);
    const pUnitsSold = Number(previous.units_sold || 0);
    const pCancelledOrders = Number(previous.cancelled_orders || 0);
    const pTotalDiscount = Object.values(prevDiscountData || {}).reduce((sum, v) => sum + Number(v || 0), 0);

    const pAov = pTx > 0 ? Number((pGmv / pTx).toFixed(2)) : 0;
    const pCvr = Number(Number(previous.cvr || 0).toFixed(4));
    const pCancellationRate = pTxGross > 0 ? Number((pCancelledOrders / pTxGross).toFixed(4)) : 0;

    comparison = {
      gmvGrowth: calculateGrowth(gmv, pGmv),
      transactionsGrowth: calculateGrowth(tx, pTx),
      unitsSoldGrowth: calculateGrowth(unitsSold, pUnitsSold),
      aovGrowth: calculateGrowth(aov, pAov),
      cvrGrowth: calculateGrowth(cvr, pCvr),
      cancellationRateGrowth: calculateGrowth(cancellationRate, pCancellationRate),
      uniqueCustomersGrowth: calculateGrowth(uniqueCustomers, prevUniqueCustomers),
      totalDiscountGrowth: calculateGrowth(totalDiscount, pTotalDiscount),
    };
  }

  // Calculate Business Health Score (0-100)
  // Logic: weight CVR (40%), GMV growth if compared (30%), AOV stability (30%)
  let healthScore = 70; // baseline
  let healthLabel = 'Baik';

  if (cvr > 0.02) healthScore += 10;
  else if (cvr < 0.01) healthScore -= 15;

  if (comparison) {
    if (comparison.gmvGrowth > 5) healthScore += 15;
    else if (comparison.gmvGrowth < 0) healthScore -= 15;
  }

  healthScore = Math.max(0, Math.min(100, healthScore));

  if (healthScore >= 85) healthLabel = 'Sangat Sehat';
  else if (healthScore >= 65) healthLabel = 'Sehat';
  else if (healthScore >= 50) healthLabel = 'Cukup';
  else healthLabel = 'Perlu Perhatian';

  return {
    kpis: {
      gmv: { value: gmv, growth: comparison?.gmvGrowth ?? null },
      transactions: { value: tx, growth: comparison?.transactionsGrowth ?? null },
      unitsSold: { value: unitsSold, growth: comparison?.unitsSoldGrowth ?? null },
      aov: { value: aov, growth: comparison?.aovGrowth ?? null },
      cvr: { value: cvr, growth: comparison?.cvrGrowth ?? null },
      cancellationRate: { value: cancellationRate, growth: comparison?.cancellationRateGrowth ?? null },
      uniqueCustomers: { value: uniqueCustomers, growth: comparison?.uniqueCustomersGrowth ?? null },
      totalDiscount: { value: totalDiscount, growth: comparison?.totalDiscountGrowth ?? null },
    },
    buyerComposition: {
      newBuyers: Number(current.new_buyers || 0),
      existingBuyers: Number(current.existing_buyers || 0),
    },
    funnel: {
      impressions: funnelSnapshot.impressions,
      productPageVisitors: funnelProductPageVisitors,
      cartVisitors: funnelCartVisitors,
      buyersCreated: funnelBuyersCreated,
      buyersReadyToShip: funnelBuyersReadyToShip,
      atcRate: funnelProductPageVisitors > 0 ? Number((funnelCartVisitors / funnelProductPageVisitors).toFixed(4)) : 0,
      poRate: funnelCartVisitors > 0 ? Number((funnelBuyersCreated / funnelCartVisitors).toFixed(4)) : 0,
      coRate: funnelBuyersCreated > 0 ? Number((funnelBuyersReadyToShip / funnelBuyersCreated).toFixed(4)) : 0,
    },
    topProduct: topProductRow ? {
      name: topProductRow.label,
      revenue: Number(topProductRow.revenue || 0),
      quantity: Number(topProductRow.quantity || 0),
    } : null,
    bottomProduct: bottomProductRow ? {
      name: bottomProductRow.label,
      revenue: Number(bottomProductRow.revenue || 0),
      quantity: Number(bottomProductRow.quantity || 0),
    } : null,
    // Top/Bottom product highlight is the one figure here read from the
    // monthly Product Performance snapshot -- warn when the range isn't a
    // clean calendar month (see utils/dateGrain.js).
    productGrainWarning: snapshotGrainWarning(startDate, endDate, 'Highlight Produk Teratas/Terbawah'),
    trends,
    health: {
      score: healthScore,
      label: healthLabel,
      details: {
        productsClicked: Number(current.products_clicked || 0),
        visitors: visitors,
      }
    }
  };
}

// Shared by getBusinessGrowth() for both the main and comparison period --
// same per-day gmv/transactions/aov shape getExecutiveSnapshot already
// derives from the same getGrowthMetrics() rows (aov = gmv/tx, unweighted,
// no normalization), just kept local so the comparison-period branch below
// doesn't repeat the mapping a second time.
function formatDailyTrends(rows) {
  return rows.map((t) => {
    const gmv = Number(t.gmv || 0);
    const tx = Number(t.transactions || 0);
    return {
      date: t.date,
      gmv,
      transactions: tx,
      aov: tx > 0 ? Number((gmv / tx).toFixed(2)) : 0,
    };
  });
}

// Period totals from the daily trend rows: GMV and transactions summed, AOV
// re-derived as total GMV / total transactions (same ratio already used per
// day above, just applied to the aggregate -- not a distinct "normalized"
// formula).
function sumTrends(dailyTrends) {
  const gmv = dailyTrends.reduce((sum, t) => sum + t.gmv, 0);
  const transactions = dailyTrends.reduce((sum, t) => sum + t.transactions, 0);
  const aov = transactions > 0 ? Number((gmv / transactions).toFixed(2)) : 0;
  return { gmv, transactions, aov };
}

export async function getBusinessGrowth({ brandId, startDate, endDate, compareStartDate, compareEndDate }) {
  const trend = await dashboardRepo.getGrowthMetrics(brandId, startDate, endDate);
  const trends = formatDailyTrends(trend);
  const totals = sumTrends(trends);

  // No comparison period selected: still surface each metric's period total
  // (KpiCard already renders growth:null as "no badge"), just no delta yet.
  let summary = {
    gmv: { value: totals.gmv, previousValue: null, growth: null },
    transactions: { value: totals.transactions, previousValue: null, growth: null },
    aov: { value: totals.aov, previousValue: null, growth: null },
  };
  let compareRange = null;
  // Comparison period's own daily rows -- same shape as `trends` -- so the
  // frontend can render its own KPI cards/charts from it, not just the
  // aggregate delta in `summary`. Same getGrowthMetrics() call already used
  // above for the main period, just pointed at the compare range.
  let compareTrends = null;

  if (compareStartDate && compareEndDate) {
    const prevTrend = await dashboardRepo.getGrowthMetrics(brandId, compareStartDate, compareEndDate);
    compareTrends = formatDailyTrends(prevTrend);
    const prevTotals = sumTrends(compareTrends);

    // calculateGrowth() is the same helper getExecutiveSnapshot's KPI growth
    // badges use -- reused as-is so both tabs agree on what "X% growth"
    // means, not a second growth formula.
    summary = {
      gmv: { value: totals.gmv, previousValue: prevTotals.gmv, growth: calculateGrowth(totals.gmv, prevTotals.gmv) },
      transactions: { value: totals.transactions, previousValue: prevTotals.transactions, growth: calculateGrowth(totals.transactions, prevTotals.transactions) },
      aov: { value: totals.aov, previousValue: prevTotals.aov, growth: calculateGrowth(totals.aov, prevTotals.aov) },
    };
    compareRange = { startDate: compareStartDate, endDate: compareEndDate };
  }

  return {
    trends,
    summary,
    compareRange,
    compareTrends,
  };
}

// The only channel that represents Shopee's own paid advertising -- the
// existing getFunnelSnapshot() impression query already treats it this way
// (`tc.channel_name = 'Iklan Shopee'`), so Organic/Ads splitting below
// reuses that same established convention rather than inventing a new one.
// Every other channel (Halaman Produk/Live Penjual/Video Penjual/Affiliate)
// is organic/non-paid discovery traffic.
const ADS_CHANNEL_NAME = 'Iklan Shopee';

const FUNNEL_STAGE_RATES = [
  { key: 'atcRate', label: 'Product Visitor → Add to Cart' },
  { key: 'poRate', label: 'Add to Cart → Checkout' },
  { key: 'coRate', label: 'Checkout → Purchase' },
];

// Percentage-POINT difference (not percentage change) between two rates
// already expressed as 0..1 ratios -- e.g. 5% -> 4% is "-1 pp", never "-20%".
function ratePointsDiff(current, previous) {
  return Number(((Number(current || 0) - Number(previous || 0)) * 100).toFixed(2));
}

// Builds one period's full traffic+funnel snapshot from the raw repo rows.
// Pure/stateless so it's reused identically for the main and comparison
// periods -- one calculation, never two divergent ones.
function buildTrafficFunnelSnapshot(rawData, executiveMetrics) {
  const productPageVisitors = Number(rawData.funnel?.product_page_visitors || 0);
  const cartVisitors = Number(rawData.funnel?.cart_visitors || 0);
  const buyersCreated = Number(rawData.funnel?.buyers_created || 0);
  const buyersReady = Number(rawData.funnel?.buyers_ready_to_ship || 0);

  // Group traffic source clicks by sections as defined in mapping rules
  const sources = rawData.trafficSources || [];

  const filterBySubSources = (channelName, subSourceList) => sources
    .filter((s) => s.channel === channelName && subSourceList.includes(s.sub_source))
    .map((s) => ({ name: s.sub_source, value: Number(s.clicks) }));

  // Organic vs Ads totals reuse these exact same rows -- no separate query.
  // "Semua" is a pre-aggregated per-channel total some sheets include;
  // excluding it means summing every remaining row can't double-count.
  // Channels with no "Semua" row (Iklan Shopee) are unaffected since
  // there's nothing to exclude.
  const sumClicks = (predicate) => sources
    .filter((s) => s.sub_source !== 'Semua' && predicate(s))
    .reduce((sum, s) => sum + Number(s.clicks || 0), 0);
  const organicClicks = sumClicks((s) => s.channel !== ADS_CHANNEL_NAME);
  const adsClicks = sumClicks((s) => s.channel === ADS_CHANNEL_NAME);

  return {
    impressions: Number(rawData.impressions || 0),
    visitors: Number(executiveMetrics.visitors || 0),
    traffic: {
      total: organicClicks + adsClicks,
      organic: organicClicks,
      ads: adsClicks,
    },
    trafficSources: {
      universal: filterBySubSources('Halaman Produk', ['Toko', 'Pencarian', 'Rekomendasi', 'Lainnya']),
      shopping: filterBySubSources('Halaman Produk', ['Promosi', 'Keranjang', 'Pesanan Saya', 'Chat']),
      live: filterBySubSources('Live Penjual', ['Halaman Utama Shopee Live', 'Tab Live', 'Video']),
      video: filterBySubSources('Video Penjual', ['Halaman Utama Shopee Video', 'Tab Video', 'Profil Kreator', 'Rekomendasi']),
      affiliate: filterBySubSources('Affiliate', ['Video Affiliate', 'Live Affiliate']),
    },
    // Total-traffic funnel -- product_performance_summary (its source) has
    // no channel/sub-source column at all, so this cannot be split into
    // Organic vs Ads without fabricating an attribution the data doesn't
    // support. Kept at total-traffic level on purpose; the frontend labels
    // it as such explicitly.
    funnel: [
      { name: 'Kunjungan Produk', value: productPageVisitors },
      { name: 'Tambah Keranjang', value: cartVisitors },
      { name: 'Pesanan Dibuat', value: buyersCreated },
      { name: 'Pesanan Siap Dikirim', value: buyersReady },
    ],
    funnelRates: {
      atcRate: productPageVisitors > 0 ? Number((cartVisitors / productPageVisitors).toFixed(4)) : 0,
      poRate: cartVisitors > 0 ? Number((buyersCreated / cartVisitors).toFixed(4)) : 0,
      coRate: buyersCreated > 0 ? Number((buyersReady / buyersCreated).toFixed(4)) : 0,
      cvr: productPageVisitors > 0 ? Number((buyersReady / productPageVisitors).toFixed(4)) : 0,
    },
  };
}

// "Which traffic source is driving the change" -- same wording conventions
// established for Business Growth's headline (didorong oleh / dipengaruhi),
// reimplemented independently here since Business Growth's own logic must
// stay untouched in this phase. Picks the driver by absolute click
// contribution (not growth% alone), so a small channel swinging +200% can't
// outrank a dominant channel that actually moved more traffic in absolute
// terms.
const TRAFFIC_STABLE_THRESHOLD_PCT = 1;

function buildTrafficGrowthDriver(current, previous) {
  if (!previous) return null;

  const totalGrowth = calculateGrowth(current.traffic.total, previous.traffic.total);
  const organicGrowth = calculateGrowth(current.traffic.organic, previous.traffic.organic);
  const adsGrowth = calculateGrowth(current.traffic.ads, previous.traffic.ads);

  const isStable = Math.abs(totalGrowth) < TRAFFIC_STABLE_THRESHOLD_PCT;
  const tone = isStable ? 'stable' : totalGrowth > 0 ? 'up' : 'down';
  const label = tone === 'up' ? 'Traffic meningkat' : tone === 'down' ? 'Traffic menurun' : 'Traffic relatif stabil';

  if (isStable) {
    return { tone, label, detail: `Total traffic hanya berubah ${formatPct(Math.abs(totalGrowth))} dibandingkan periode sebelumnya.` };
  }

  const verb = totalGrowth > 0 ? 'naik' : 'turun';
  let detail = `Total traffic ${verb} ${formatPct(Math.abs(totalGrowth))} dibandingkan periode sebelumnya`;

  const organicSupports = Math.sign(organicGrowth) === Math.sign(totalGrowth) && Math.abs(organicGrowth) >= TRAFFIC_STABLE_THRESHOLD_PCT;
  const adsSupports = Math.sign(adsGrowth) === Math.sign(totalGrowth) && Math.abs(adsGrowth) >= TRAFFIC_STABLE_THRESHOLD_PCT;
  const phrase = tone === 'up' ? 'terutama didorong oleh peningkatan' : 'terutama disebabkan oleh penurunan';
  const organicContribution = Math.abs(current.traffic.organic - previous.traffic.organic);
  const adsContribution = Math.abs(current.traffic.ads - previous.traffic.ads);

  if (organicSupports && (!adsSupports || organicContribution >= adsContribution)) {
    detail += `, ${phrase} Organic Traffic sebesar ${formatPct(Math.abs(organicGrowth))}.`;
  } else if (adsSupports) {
    detail += `, ${phrase} Ads Traffic sebesar ${formatPct(Math.abs(adsGrowth))}.`;
  } else {
    detail += '.';
  }

  return { tone, label, detail };
}

// Funnel bottleneck: with a comparison period, flags whichever stage-to-
// stage rate dropped the most in percentage points (never "menyebabkan" --
// just reports where the biggest decline is). Without one, falls back to
// naming the weakest stage this period alone, explicitly not framed as a
// decline since there's no baseline to compare against.
function buildFunnelBottleneck(currentRates, previousRates) {
  if (previousRates) {
    let worst = null;
    for (const stage of FUNNEL_STAGE_RATES) {
      const diff = ratePointsDiff(currentRates[stage.key], previousRates[stage.key]);
      if (!worst || diff < worst.diff) {
        worst = { ...stage, diff, currentRate: currentRates[stage.key], previousRate: previousRates[stage.key] };
      }
    }
    if (worst && worst.diff < 0) {
      return {
        tone: 'down',
        label: `Funnel bottleneck: ${worst.label}`,
        detail: `Conversion rate ${formatPct(worst.currentRate * 100)}, turun ${formatNum(Math.abs(worst.diff))} pp dibandingkan periode sebelumnya (${formatPct(worst.previousRate * 100)}).`,
        hasComparison: true,
      };
    }
    return {
      tone: 'stable',
      label: 'Funnel bottleneck',
      detail: 'Tidak ada tahap funnel yang mengalami penurunan conversion rate dibandingkan periode sebelumnya.',
      hasComparison: true,
    };
  }

  let weakest = null;
  for (const stage of FUNNEL_STAGE_RATES) {
    const rate = currentRates[stage.key];
    if (!weakest || rate < weakest.rate) weakest = { ...stage, rate };
  }
  return {
    tone: 'stable',
    label: `Tahap dengan conversion rate terendah: ${weakest.label}`,
    detail: `Conversion rate ${formatPct(weakest.rate * 100)} pada periode ini. Aktifkan "Bandingkan Periode" untuk melihat perubahan dibanding periode sebelumnya.`,
    hasComparison: false,
  };
}

// Doesn't use the generic withCompare() helper other tabs use (independent
// calls, side-by-side rendering only) -- computing a growth driver and a
// bottleneck needs both periods' numbers at once, so this follows the same
// single-call-with-both-periods pattern Business Growth and Executive
// Snapshot already use.
export async function getTrafficAndFunnel({ brandId, startDate, endDate, compareStartDate, compareEndDate }) {
  const [rawData, executiveMetrics] = await Promise.all([
    dashboardRepo.getTrafficAndFunnelMetrics(brandId, startDate, endDate),
    dashboardRepo.getExecutiveMetrics(brandId, startDate, endDate),
  ]);
  const snapshot = buildTrafficFunnelSnapshot(rawData, executiveMetrics);

  // Named comparePeriod, not `compare` -- the frontend's generic tab wrapper
  // checks `data.compare` to trigger its own side-by-side split-render for
  // every other tab. This response builds its own main|compare pairing
  // internally, so a field literally named `compare` would make the generic
  // wrapper ALSO kick in and double-render everything.
  let comparePeriod = null;
  let trafficGrowthDriver = null;

  if (compareStartDate && compareEndDate) {
    const [prevRawData, prevExecutiveMetrics] = await Promise.all([
      dashboardRepo.getTrafficAndFunnelMetrics(brandId, compareStartDate, compareEndDate),
      dashboardRepo.getExecutiveMetrics(brandId, compareStartDate, compareEndDate),
    ]);
    const prevSnapshot = buildTrafficFunnelSnapshot(prevRawData, prevExecutiveMetrics);
    const prevTotal = prevSnapshot.traffic.total;

    comparePeriod = {
      range: { startDate: compareStartDate, endDate: compareEndDate },
      impressions: prevSnapshot.impressions,
      visitors: prevSnapshot.visitors,
      trafficOverview: {
        total: { value: prevTotal },
        organic: { value: prevSnapshot.traffic.organic, pct: prevTotal > 0 ? Number((prevSnapshot.traffic.organic / prevTotal * 100).toFixed(1)) : 0 },
        ads: { value: prevSnapshot.traffic.ads, pct: prevTotal > 0 ? Number((prevSnapshot.traffic.ads / prevTotal * 100).toFixed(1)) : 0 },
      },
      funnel: prevSnapshot.funnel,
      funnelRates: prevSnapshot.funnelRates,
      trafficSources: prevSnapshot.trafficSources,
    };

    trafficGrowthDriver = buildTrafficGrowthDriver(snapshot, prevSnapshot);
  }

  const funnelBottleneck = buildFunnelBottleneck(snapshot.funnelRates, comparePeriod?.funnelRates ?? null);
  const totalClicks = snapshot.traffic.total;

  return {
    kpis: {
      impressions: { value: snapshot.impressions, growth: comparePeriod ? calculateGrowth(snapshot.impressions, comparePeriod.impressions) : null },
      visitors: { value: snapshot.visitors, growth: comparePeriod ? calculateGrowth(snapshot.visitors, comparePeriod.visitors) : null },
    },
    trafficOverview: {
      total: { value: totalClicks, growth: comparePeriod ? calculateGrowth(totalClicks, comparePeriod.trafficOverview.total.value) : null },
      organic: {
        value: snapshot.traffic.organic,
        pct: totalClicks > 0 ? Number((snapshot.traffic.organic / totalClicks * 100).toFixed(1)) : 0,
        growth: comparePeriod ? calculateGrowth(snapshot.traffic.organic, comparePeriod.trafficOverview.organic.value) : null,
      },
      ads: {
        value: snapshot.traffic.ads,
        pct: totalClicks > 0 ? Number((snapshot.traffic.ads / totalClicks * 100).toFixed(1)) : 0,
        growth: comparePeriod ? calculateGrowth(snapshot.traffic.ads, comparePeriod.trafficOverview.ads.value) : null,
      },
    },
    trafficSources: snapshot.trafficSources,
    funnel: snapshot.funnel,
    funnelRates: snapshot.funnelRates,
    // Impressions + traffic-source clicks re-aggregate from daily_channel_
    // performance (range-exact). The funnel stages/rates are the exception --
    // product_performance_summary is monthly-only. Warn when the range isn't
    // one whole calendar month.
    funnelGrainWarning: snapshotGrainWarning(
      startDate, endDate, 'Corong konversi (Kunjungan Produk → Tambah Keranjang → Pesanan) beserta rasionya',
    ),
    comparePeriod,
    insights: {
      trafficGrowthDriver,
      funnelBottleneck,
    },
  };
}

// Percentage-POINT difference between two already-computed percentages
// (e.g. segment share 24.5% -> 26.6% is "+2.1 pp", never "+8.6%").
function pctPointsDiff(current, previous) {
  return Number((Number(current || 0) - Number(previous || 0)).toFixed(1));
}

// Runs the existing computeRfmAnalysis() (K-Means scoring + assignSegment,
// completely unchanged) on one period's raw rows, then enumerates every
// possible segment via RFM_SEGMENTS so a segment with zero customers this
// period still appears at count 0 instead of silently disappearing.
// assignSegment() is exhaustive (every row maps to exactly one segment,
// 'Others' as the final catch-all), so percentages always sum to ~100% --
// no customer is ever excluded from every segment.
function buildRfmSnapshot(rawRows) {
  const computed = computeRfmAnalysis(rawRows);
  const totalCustomers = rawRows.length;
  const bySegment = new Map(computed.segments.map((s) => [s.segment, s]));

  const toMatrix = (rows, aKey, bKey) => rows.map((m) => ({
    [aKey]: Number(m.aScore),
    [bKey]: Number(m.bScore),
    count: Number(m.count),
  }));

  const segments = RFM_SEGMENTS.map((name) => {
    const s = bySegment.get(name);
    const count = s ? Number(s.customer_count || 0) : 0;
    return {
      segment: name,
      count,
      pct: totalCustomers > 0 ? Number(((count / totalCustomers) * 100).toFixed(1)) : 0,
      // No customers in this segment this period -- an average is
      // undefined, not zero, so it's left null rather than fabricated.
      avgRecency: s ? Number(s.avg_recency) : null,
      avgFrequency: s ? Number(s.avg_frequency) : null,
      avgMonetary: s ? Number(s.avg_monetary) : null,
    };
  });

  return {
    totalCustomers,
    segments,
    matrices: {
      rf: toMatrix(computed.matrices.rf, 'rScore', 'fScore'),
      rm: toMatrix(computed.matrices.rm, 'rScore', 'mScore'),
      fm: toMatrix(computed.matrices.fm, 'fScore', 'mScore'),
    },
    customersBySegment: computed.customersBySegment,
    usernames: new Set(rawRows.map((r) => r.username)),
  };
}

const RISK_SEGMENTS = new Set(['At Risk', 'Hibernating', 'Lost', "Can't Lose Them", 'Need Attention']);
const GROWTH_SEGMENTS = new Set(['Champions', 'Loyal Customers', 'Potential Loyalist']);
const SEGMENT_CHANGE_STABLE_THRESHOLD_PP = 1;

// "Which segment changed the most" -- entirely derived from the pp changes
// already computed per segment, never a hardcoded segment name. Tone
// depends on whether the biggest mover is a growth-oriented or risk-oriented
// segment, using the same fixed classification for every brand/period.
// Text for "how much did this segment's customer count change" -- always
// derived from changePercent (count-based, same number the "% Perubahan"
// table column shows), with the naik/turun verb taken from THIS number's
// own sign so the sentence can never contradict itself (e.g. "meningkat
// -5%"). Kept separate from the pp-based selection logic below on purpose.
function describeSegmentCountChange(segment) {
  const pct = segment.changePercent ?? 0;
  const verb = pct >= 0 ? 'meningkat' : 'menurun';
  return `${segment.segment} ${verb} ${formatPct(Math.abs(pct))}`;
}

function buildSegmentChangeInsight(segments) {
  let biggestRiser = null;
  let biggestFaller = null;
  for (const s of segments) {
    if (s.changePct == null) continue;
    if (!biggestRiser || s.changePct > biggestRiser.changePct) biggestRiser = s;
    if (!biggestFaller || s.changePct < biggestFaller.changePct) biggestFaller = s;
  }
  if (!biggestRiser && !biggestFaller) return null;

  const riserMag = biggestRiser ? biggestRiser.changePct : 0;
  const fallerMag = biggestFaller ? Math.abs(biggestFaller.changePct) : 0;

  // The single biggest mover overall, by absolute PERCENTAGE-POINT
  // magnitude (composition-share change), regardless of direction -- a
  // segment falling 5.2pp in share is a bigger composition story than
  // another rising 3.7pp, even though "rising" sounds more notable in
  // isolation. This selection stays pp-based deliberately: ranking by
  // relative count-% instead would let a tiny segment's wild swing (e.g.
  // 2 -> 4 customers = "+100%") outrank a genuinely larger shift. The
  // SENTENCE describing whichever segment wins, though, is always phrased
  // in count-% terms (see describeSegmentCountChange) to match the table.
  const isRiserBigger = riserMag >= fallerMag;
  const overallBiggest = isRiserBigger ? biggestRiser : biggestFaller;
  const overallMagnitude = isRiserBigger ? riserMag : fallerMag;

  if (overallMagnitude < SEGMENT_CHANGE_STABLE_THRESHOLD_PP) {
    return {
      tone: 'stable',
      label: 'Komposisi segmen relatif stabil',
      detail: 'Tidak ada segmen yang berubah signifikan dibandingkan periode sebelumnya.',
    };
  }

  // Risk segment growing is the clearest bad-news headline, whatever else moved.
  if (isRiserBigger && RISK_SEGMENTS.has(overallBiggest.segment)) {
    return {
      tone: 'down',
      label: 'Komposisi customer bergeser ke segmen berisiko',
      detail: `${describeSegmentCountChange(overallBiggest)} dibandingkan periode sebelumnya.`,
    };
  }

  // Risk segment shrinking is good news even if it's a "faller".
  if (!isRiserBigger && RISK_SEGMENTS.has(overallBiggest.segment)) {
    return {
      tone: 'up',
      label: 'Segmen berisiko mengecil',
      detail: `${describeSegmentCountChange(overallBiggest)} dibandingkan periode sebelumnya.`,
    };
  }

  // Growth segment expanding -- headline good news, optionally paired with
  // a risk segment that shrank meaningfully in the same period.
  if (isRiserBigger && GROWTH_SEGMENTS.has(overallBiggest.segment)) {
    let detail = `${describeSegmentCountChange(overallBiggest)} dibandingkan periode sebelumnya`;
    detail += (biggestFaller && fallerMag >= SEGMENT_CHANGE_STABLE_THRESHOLD_PP && RISK_SEGMENTS.has(biggestFaller.segment))
      ? `, sementara ${describeSegmentCountChange(biggestFaller)}.`
      : '.';
    return { tone: 'up', label: 'Kualitas customer membaik', detail };
  }

  // Growth segment shrinking -- worth flagging even without a risk segment rising.
  if (!isRiserBigger && GROWTH_SEGMENTS.has(overallBiggest.segment)) {
    return {
      tone: 'down',
      label: 'Segmen loyal berkurang',
      detail: `${describeSegmentCountChange(overallBiggest)} dibandingkan periode sebelumnya.`,
    };
  }

  // Biggest mover is a neutral segment (e.g. New Customers, Promising,
  // Others) -- state it factually, no positive/negative framing implied.
  return {
    tone: 'stable',
    label: `Perubahan terbesar: ${overallBiggest.segment}`,
    detail: `${describeSegmentCountChange(overallBiggest)} dibandingkan periode sebelumnya.`,
  };
}

// Doesn't use the generic withCompare() helper (independent calls, no
// cross-period math) -- segment pp-change, cohort retention, and the
// segment-change insight all need both periods' numbers at once. Field is
// named comparePeriod, not `compare`, since the frontend's generic tab
// wrapper checks `data.compare` to trigger its own side-by-side split
// render for every other tab (see Traffic & Funnel's getTrafficAndFunnel).
export async function getRfmAnalysis({ brandId, startDate, endDate, compareStartDate, compareEndDate }) {
  const [rawRows, retentionRow, repeatCycleData, historyRow] = await Promise.all([
    dashboardRepo.getRfmRawMetrics(brandId, startDate, endDate),
    dashboardRepo.getCustomerRetention(brandId, startDate, endDate),
    dashboardRepo.getRepeatPurchaseCycle(brandId, startDate, endDate),
    dashboardRepo.getHistoricalRetention(brandId, startDate, endDate),
  ]);
  const snapshot = buildRfmSnapshot(rawRows);
  // Within-period repeat-order rate + 1st->2nd purchase gap (moved here from
  // Basket Analysis) -- distinct from the cross-period cohort `retention`
  // computed below when a comparison period is active.
  const repeatCustomerRate = computeRepeatCustomerRate(retentionRow);
  const repeatCycle = computeRepeatCycle(repeatCycleData);

  let segments = snapshot.segments.map((s) => ({ ...s, previousCount: null, previousPct: null, changePct: null, changePercent: null }));
  let comparePeriod = null;
  // Cohort retention is only meaningful with a comparison period to define
  // the cohort against -- "available: false" means genuinely not computed,
  // not a retention rate of 0.
  const cohortCount = Number(historyRow.cohort_count);
  const currentCount = Number(historyRow.current_count);
  const retainedCount = Number(historyRow.retained_count);
  const historicalRetention = {
    available: cohortCount > 0,
    cohortCount, currentCount, retainedCount,
    newCount: currentCount - retainedCount,
    rate: cohortCount ? Number((100 * retainedCount / cohortCount).toFixed(2)) : null,
    returningShare: currentCount ? Number((100 * retainedCount / currentCount).toFixed(2)) : null,
  };
  let retention = { available: false, rate: null, retainedCount: null, cohortCount: null, reason: 'Pilih periode pembanding yang berakhir sebelum periode utama.' };
  let segmentChange = null;

  if (compareStartDate && compareEndDate) {
    const [prevRawRows, prevRetentionRow, prevRepeatCycleData] = await Promise.all([
      dashboardRepo.getRfmRawMetrics(brandId, compareStartDate, compareEndDate),
      dashboardRepo.getCustomerRetention(brandId, compareStartDate, compareEndDate),
      dashboardRepo.getRepeatPurchaseCycle(brandId, compareStartDate, compareEndDate),
    ]);
    const prevSnapshot = buildRfmSnapshot(prevRawRows);
    const prevBySegment = new Map(prevSnapshot.segments.map((s) => [s.segment, s]));

    segments = snapshot.segments.map((s) => {
      const prev = prevBySegment.get(s.segment);
      return {
        ...s,
        previousCount: prev.count,
        previousPct: prev.pct,
        // Percentage-POINT change of the composition share (24.5% -> 26.6%
        // = "+2.1 pp") -- kept for buildSegmentChangeInsight() below, which
        // specifically needs pp so a tiny segment (e.g. 0.1% -> 0.2%, a
        // meaningless +100% relative swing) can't outrank a genuinely
        // larger composition shift when picking the "biggest mover".
        changePct: pctPointsDiff(s.pct, prev.pct),
        // Relative percentage change of the raw customer COUNT (Jumlah
        // Periode Pembanding -> Jumlah Periode Utama), reusing the same
        // calculateGrowth() helper used dashboard-wide -- this is what the
        // "Segmen Pelanggan & Rekomendasi Aksi" table's "% Perubahan" column
        // displays. Deliberately NOT the change in % Kontribusi (composition
        // share) -- a segment's customer count can grow faster or slower
        // than its share of the total, since the total itself also changes
        // between periods.
        changePercent: calculateGrowth(s.count, prev.count),
      };
    });

    // True cohort retention: of customers active in the comparison period,
    // how many also placed a completed order in the current period. Reuses
    // the username sets already fetched above for both periods -- no new
    // query. Deliberately NOT the same thing as "Repeat Customer Rate" below
    // (a within-period repeat-order rate, not a cross-period cohort return
    // rate) -- kept as a distinct definition rather than mislabeling one as
    // the other.
    const retainedCount = [...prevSnapshot.usernames].filter((u) => snapshot.usernames.has(u)).length;
    retention = {
      available: compareEndDate < startDate && prevSnapshot.usernames.size > 0,
      reason: compareEndDate >= startDate ? 'Periode pembanding harus berakhir sebelum periode utama agar transaksi yang sama tidak dihitung sebagai kembali.' : 'Tidak ada pelanggan pada periode pembanding.',
      rate: compareEndDate < startDate && prevSnapshot.usernames.size > 0 ? Number(((retainedCount / prevSnapshot.usernames.size) * 100).toFixed(1)) : null,
      retainedCount,
      cohortCount: prevSnapshot.usernames.size,
    };

    comparePeriod = {
      range: { startDate: compareStartDate, endDate: compareEndDate },
      totalCustomers: prevSnapshot.totalCustomers,
      // Full per-period snapshot (segments incl. avg R/F/M, matrices,
      // customersBySegment) so the UI can render the comparison period's own
      // Matrix Heatmap / Rincian Statistik Segmen / CSV export side-by-side
      // with the main period's -- same buildRfmSnapshot() already computed
      // above, just exposed in full instead of only totalCustomers.
      segments: prevSnapshot.segments,
      matrices: prevSnapshot.matrices,
      customersBySegment: prevSnapshot.customersBySegment,
      repeatCustomerRate: computeRepeatCustomerRate(prevRetentionRow),
      repeatCycle: computeRepeatCycle(prevRepeatCycleData),
    };
    segmentChange = buildSegmentChangeInsight(segments);
  }

  segments = segments.map((s) => ({ ...s, action: SEGMENT_ACTIONS[s.segment] || null }));

  return {
    totalCustomers: snapshot.totalCustomers,
    segments,
    matrices: snapshot.matrices,
    matrix: snapshot.matrices.rf, // kept for backward compatibility with existing R x F consumers
    customersBySegment: snapshot.customersBySegment,
    comparePeriod,
    retention,
    historicalRetention,
    repeatCustomerRate,
    repeatCycle,
    insights: { segmentChange },
  };
}

export async function getTransactionBehavior({ brandId, startDate, endDate }) {
  const data = await dashboardRepo.getTransactionBehaviorMetrics(brandId, startDate, endDate);
  
  const cities = data.cities.map(c => ({
    city: c.city,
    sales: Number(c.total_sales || 0),
    orders: Number(c.total_orders || 0)
  }));

  const provinces = data.provinces.map(p => ({
    province: p.province,
    sales: Number(p.total_sales || 0),
    orders: Number(p.total_orders || 0)
  }));

  const discounts = {
    sellerVoucher: Number(data.discounts?.seller_voucher || 0),
    shopeeVoucher: Number(data.discounts?.shopee_voucher || 0),
    creditCardDiscount: Number(data.discounts?.credit_card_discount || 0),
    bundleDiscountShopee: Number(data.discounts?.bundle_discount_shopee || 0),
    bundleDiscountSeller: Number(data.discounts?.bundle_discount_seller || 0),
    sellerDiscount: Number(data.discounts?.seller_discount || 0),
    shopeeDiscount: Number(data.discounts?.shopee_discount || 0)
  };

  const durations = data.durations.map(d => ({
    label: d.label,
    count: Number(d.count || 0)
  }));

  const payments = data.payments.map(p => ({
    name: p.method_name,
    sales: Number(p.total_sales || 0),
    orders: Number(p.total_orders || 0)
  }));

  const shippings = data.shippings.map(s => ({
    name: s.option_name,
    sales: Number(s.total_sales || 0),
    orders: Number(s.total_orders || 0)
  }));

  const cancellations = data.cancellations.map(c => ({
    cancelledBy: c.cancelled_by,
    reason: c.reason,
    count: Number(c.count || 0)
  }));

  return {
    cities,
    provinces,
    discounts,
    durations,
    payments,
    shippings,
    cancellations
  };
}

export async function getBasketAnalysis({ brandId, startDate, endDate }) {
  const [data, purchaseSequence] = await Promise.all([
    dashboardRepo.getBasketAnalysisMetrics(brandId, startDate, endDate),
    dashboardRepo.getFirstSecondPurchaseAnalysis(brandId, startDate, endDate),
  ]);

  const stats = {
    totalTransactions: Number(data.stats?.total_transactions || 0),
    totalCustomers: Number(data.stats?.total_customers || 0),
    totalItems: Number(data.stats?.total_items || 0),
    avgItemsPerTransaction: Number(Number(data.stats?.avg_items_per_transaction || 0).toFixed(2)),
    atv: Number(Number(data.stats?.atv || 0).toFixed(2))
  };

  const sizes = data.sizes.map(s => ({
    segment: s.basket_segment,
    orders: Number(s.total_orders || 0),
    avgTransactionValue: Number(Number(s.avg_transaction_value || 0).toFixed(2)),
    totalRevenue: Number(Number(s.total_revenue || 0).toFixed(2))
  }));

  const pairs = data.pairs.map(p => ({
    productA: p.product_a,
    productB: p.product_b,
    togetherCount: Number(p.together_count || 0),
    support: Number(p.support || 0),
    confidenceAToB: Number(p.confidence_a_to_b || 0),
    confidenceBToA: Number(p.confidence_b_to_a || 0),
    lift: Number(p.lift || 0)
  }));

  const topFirstProducts = purchaseSequence.topFirst.map(r => ({
    productName: r.product_name,
    customerCount: Number(r.customer_count || 0)
  }));

  const topSecondProducts = purchaseSequence.topSecond.map(r => ({
    productName: r.product_name,
    customerCount: Number(r.customer_count || 0)
  }));

  const productTransitions = purchaseSequence.transitions.map(r => ({
    productFirst: r.product_first,
    productSecond: r.product_second,
    customerCount: Number(r.customer_count || 0)
  }));

  return {
    stats,
    sizes,
    pairs,
    topFirstProducts,
    topSecondProducts,
    productTransitions,
  };
}

export async function getProductPerformance({ brandId, startDate, endDate, level = 'category' }) {
  const data = await getProductRanking({ brandId, startDate, endDate, level });

  const roundRevenue = (v) => Number(Number(v || 0).toFixed(2));

  return {
    level: data.level,
    months: data.months,
    // Whole domain is sourced from the monthly Product Performance snapshot
    // (deliberately -- it matches Shopee's own export figure). Warn whenever
    // the range spans more than / less than one clean calendar month.
    grainWarning: snapshotGrainWarning(startDate, endDate, `Seluruh angka ${data.level === 'variant' ? 'Variasi Produk' : 'Produk'} pada tab ini`),
    topByQuantity: data.topByQuantity.map(i => ({
      label: i.label,
      quantity: Number(i.quantity || 0),
      revenue: roundRevenue(i.revenue)
    })),
    topByRevenue: data.topByRevenue.map(i => ({
      label: i.label,
      quantity: Number(i.quantity || 0),
      revenue: roundRevenue(i.revenue)
    })),
    pareto: {
      total: roundRevenue(data.pareto.total),
      items: data.pareto.items.map(i => ({
        label: i.label,
        revenue: roundRevenue(i.revenue),
        contributionPct: Number(i.contributionPct.toFixed(4)),
        cumulativePct: Number(i.cumulativePct.toFixed(4))
      }))
    },
    // Every product's revenue contribution (uncapped, unlike pareto.items
    // above which is the top-10 slice used for the Pareto chart).
    contributions: data.contributions.map(i => ({
      label: i.label,
      revenue: roundRevenue(i.revenue),
      contributionPct: Number(i.contributionPct.toFixed(4)),
      cumulativePct: Number(i.cumulativePct.toFixed(4))
    })),
    // Products classified Growth/Decline by the same Theil-Sen trend logic
    // as the PLC stages below — top 10 by revenue within each stage.
    growthDrivers: data.growthDrivers.map(i => ({
      label: i.label,
      revenue: roundRevenue(i.revenue),
      quantity: Number(i.quantity || 0),
      growthPct: i.growthPct == null ? null : Number(i.growthPct.toFixed(2)),
      contributionPct: Number(i.contributionPct.toFixed(4))
    })),
    declining: data.declining.map(i => ({
      label: i.label,
      revenue: roundRevenue(i.revenue),
      quantity: Number(i.quantity || 0),
      growthPct: i.growthPct == null ? null : Number(i.growthPct.toFixed(2)),
      contributionPct: Number(i.contributionPct.toFixed(4))
    })),
    plc: {
      curve: data.plc.curve.map(i => ({
        label: i.label,
        revenue: roundRevenue(i.revenue),
        stage: i.stage
      })),
      stageDistribution: data.plc.stageDistribution
    }
  };
}
