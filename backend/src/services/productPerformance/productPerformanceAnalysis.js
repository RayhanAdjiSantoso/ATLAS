// Ported from kode/Product_Performance.ipynb -- same aggregation, ranking and
// PLC-classification logic as the notebook's visualisasi_product_performance*.py
// scripts and the "Metodologi Penentuan Tahap Product Life Cycle" methodology,
// re-pointed at shopee.order_items/orders (status "Selesai") instead of the
// standalone "Product Performance"/"Performance Overview" Excel exports the
// notebook reads, since that is the data this app actually has ingested.
//
// Level aggregation mirrors the notebook's two script variants:
//  - "variant": one row per product+variant (Kode Variasi != "-")
//  - "category": all variants rolled up into their parent product (Kode Variasi == "-")
//
// PLC classification mirrors the notebook's documented methodology exactly:
//  1. Tidak Ada Penjualan: all months in the window are zero.
//  2. Introduction: product's created_date falls within the observation window.
//  3. Introduction (belum terverifikasi tanggal dibuat): no created_date on
//     record, but the first two months are zero and sales appear afterward.
//  4. Otherwise, classify by Theil-Sen trend slope projected across the window:
//     growth% >= +20 -> Growth, <= -20 -> Decline, else Maturity.
// A "Data Tidak Cukup untuk Analisis Tren" label is used only for the edge
// case the notebook's fixed 6-month window never had to handle: fewer than 2
// monthly data points in the selected period, where no slope is definable.

const GROWTH_THRESHOLD_PCT = 20;
const TOP_N = 10;

function productIdentity(row, level) {
  if (level === 'variant') {
    const variant = row.variant_name && row.variant_name.trim() ? row.variant_name.trim() : '(Tanpa Variasi)';
    return `${row.product_name} | ${variant}`;
  }
  return row.product_name;
}

function productLabel(row, level) {
  if (level === 'variant') {
    return row.variant_name && row.variant_name.trim()
      ? `${row.product_name} - ${row.variant_name.trim()}`
      : row.product_name;
  }
  return row.product_name;
}

// Median of all pairwise slopes (Theil-Sen estimator) -- robust to outliers,
// unlike ordinary least squares. x is assumed to be 0..n-1 (month index).
function theilSenSlope(series) {
  const n = series.length;
  const slopes = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      slopes.push((series[j] - series[i]) / (j - i));
    }
  }
  slopes.sort((a, b) => a - b);
  const mid = Math.floor(slopes.length / 2);
  return slopes.length % 2 !== 0 ? slopes[mid] : (slopes[mid - 1] + slopes[mid]) / 2;
}

// Returns { stage, growthPct }. growthPct is the Theil-Sen projected change
// over the window, as a % of the item's mean monthly revenue — null for the
// stages that aren't slope-based (Introduction/Tidak Ada Penjualan/Data
// Tidak Cukup), since no trend value applies to those.
function classifyPlcStage(series, createdDate, windowStartDate) {
  const n = series.length;

  if (series.every((v) => v === 0)) {
    return { stage: 'Tidak Ada Penjualan', growthPct: null };
  }

  if (createdDate && new Date(createdDate) >= new Date(windowStartDate)) {
    return { stage: 'Introduction', growthPct: null };
  }

  if (!createdDate && n >= 3) {
    const firstTwoZero = series.slice(0, 2).every((v) => v === 0);
    const restNonzero = series.slice(2).some((v) => v > 0);
    if (firstTwoZero && restNonzero) {
      return { stage: 'Introduction (belum terverifikasi tanggal dibuat)', growthPct: null };
    }
  }

  if (n < 2) {
    return { stage: 'Data Tidak Cukup untuk Analisis Tren', growthPct: null };
  }

  const mean = series.reduce((s, v) => s + v, 0) / n;
  if (mean === 0) {
    return { stage: 'Data Tidak Cukup untuk Analisis Tren', growthPct: null };
  }

  const slope = theilSenSlope(series);
  const projectedChange = slope * (n - 1);
  const growthPct = (projectedChange / mean) * 100;

  if (growthPct >= GROWTH_THRESHOLD_PCT) return { stage: 'Growth', growthPct };
  if (growthPct <= -GROWTH_THRESHOLD_PCT) return { stage: 'Decline', growthPct };
  return { stage: 'Maturity', growthPct };
}

export function computeProductPerformance(rows, { level = 'category', windowStartDate } = {}) {
  if (rows.length === 0) {
    return {
      level,
      months: [],
      topByQuantity: [],
      topByRevenue: [],
      pareto: { total: 0, items: [] },
      contributions: [],
      growthDrivers: [],
      declining: [],
      plc: { curve: [], stageDistribution: [] },
    };
  }

  const months = [...new Set(rows.map((r) => r.month))].sort();

  const items = new Map();
  for (const row of rows) {
    const id = productIdentity(row, level);
    if (!items.has(id)) {
      items.set(id, {
        id,
        label: productLabel(row, level),
        quantity: 0,
        revenue: 0,
        createdDate: null,
        monthly: new Map(),
      });
    }
    const item = items.get(id);
    item.quantity += Number(row.quantity);
    item.revenue += Number(row.revenue);
    if (!item.createdDate && row.created_date) {
      item.createdDate = row.created_date;
    }
    item.monthly.set(row.month, (item.monthly.get(row.month) || 0) + Number(row.revenue));
  }

  const allItems = [...items.values()];

  const topByQuantity = [...allItems]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, TOP_N)
    .map((i) => ({ label: i.label, quantity: i.quantity, revenue: i.revenue }));

  const topByRevenue = [...allItems]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_N)
    .map((i) => ({ label: i.label, quantity: i.quantity, revenue: i.revenue }));

  // Pareto: contribution/cumulative % computed over the FULL ranked
  // population first (so cumulative % stays accurate), top 10 sliced after.
  const totalRevenue = allItems.reduce((s, i) => s + i.revenue, 0);
  const rankedByRevenue = [...allItems].sort((a, b) => b.revenue - a.revenue);
  let cumulative = 0;
  const contributionById = new Map();
  const paretoFull = rankedByRevenue.map((i) => {
    const contributionPct = totalRevenue > 0 ? (i.revenue / totalRevenue) * 100 : 0;
    cumulative += contributionPct;
    contributionById.set(i.id, contributionPct);
    // quantity is carried through (not just label/revenue/%) so callers like
    // Executive Snapshot's top/bottom product highlight -- which reuses this
    // same ranked list as its source of truth -- can show unit counts too,
    // without a second query.
    return { label: i.label, revenue: i.revenue, quantity: i.quantity, contributionPct, cumulativePct: cumulative };
  });
  const pareto = { total: totalRevenue, items: paretoFull.slice(0, TOP_N) };

  // PLC: classify every item (not just the top 10), then attach stage to the
  // top-10-by-revenue set (same population as chart 2 / the notebook's
  // plc_curve_top10.py) for the curve visualization, plus a
  // stage-distribution summary across all items.
  const stageCounts = new Map();
  const stageById = new Map();
  const growthPctById = new Map();
  for (const item of allItems) {
    const series = months.map((m) => item.monthly.get(m) || 0);
    const { stage, growthPct } = classifyPlcStage(series, item.createdDate, windowStartDate);
    stageById.set(item.id, stage);
    growthPctById.set(item.id, growthPct);
    stageCounts.set(stage, (stageCounts.get(stage) || 0) + 1);
  }

  const curve = [...allItems]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_N)
    .map((i) => ({ label: i.label, revenue: i.revenue, stage: stageById.get(i.id) }));

  const stageDistribution = [...stageCounts.entries()].map(([stage, count]) => ({ stage, count }));

  // Growth drivers / declining products: same Theil-Sen classification used
  // for the PLC stages above (no new formula), just filtered to the two
  // stages that answer "which products are driving growth" and "which are
  // losing ground", ranked by revenue so the ones that matter most to the
  // business surface first, capped at TOP_N like every other list on this tab.
  const byStage = (stageName) => allItems
    .filter((i) => stageById.get(i.id) === stageName)
    .map((i) => ({
      label: i.label,
      revenue: i.revenue,
      quantity: i.quantity,
      growthPct: growthPctById.get(i.id),
      contributionPct: contributionById.get(i.id) || 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, TOP_N);

  const growthDrivers = byStage('Growth');
  const declining = byStage('Decline');

  return {
    level,
    months,
    topByQuantity,
    topByRevenue,
    pareto,
    contributions: paretoFull,
    growthDrivers,
    declining,
    plc: { curve, stageDistribution },
  };
}
