import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
import { S1 as S1_CONFIG, CATEGORY_MAP } from '../config/internalDashboard.js';
import * as brandService from './brandService.js';
import * as repo from '../repositories/internalDashboardRepository.js';

// "YYYY-MM" (from the month picker) -> "YYYY-MM-01" (DATE the tables store).
const toPeriodDate = (period) => `${period}-01`;

async function assertBrand(brandId) {
  const brand = await brandService.getBrandById(brandId);
  if (!brand) throw new AppError('Client tidak ditemukan', 404);
  return brand;
}

// Run `work(client)` inside a transaction. `work` does the fact upsert AND
// the data_ingestion_log insert, so a failed log never leaves an orphan
// fact row and vice versa.
async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listClients() {
  return repo.listClients();
}

// --- §2.3 -----------------------------------------------------------
export async function listMonthlyMetrics(brandId) {
  await assertBrand(brandId);
  return repo.listMonthlyMetrics(brandId);
}

export async function saveMonthlyMetric(input) {
  await assertBrand(input.brandId);
  const period = toPeriodDate(input.period);

  return inTransaction(async (db) => {
    const res = await repo.upsertMonthlyMetric({
      brandId: input.brandId,
      period,
      revenue: input.revenue,
      transaksi: input.transaksi ?? null,
      qtySold: input.qtySold ?? null,
      targetSales: input.targetSales ?? null,
      isPartialMonth: input.isPartialMonth ?? false,
      userId: input.userId,
    }, db);

    await repo.logIngestion({
      brandId: input.brandId,
      targetTable: 'client_monthly_metrics',
      period,
      method: res.was_insert ? 'form entry' : 'edit',
      rowCount: 1,
      status: 'success',
      pic: input.pic ?? null,
      userId: input.userId,
    }, db);

    return { id: res.id, wasInsert: res.was_insert };
  });
}

export async function deleteMonthlyMetric(id, userId) {
  const deleted = await repo.deleteMonthlyMetric(id);
  if (!deleted) throw new AppError('Data tidak ditemukan', 404);
  await repo.logIngestion({
    brandId: deleted.brand_id,
    targetTable: 'client_monthly_metrics',
    period: `${deleted.period}-01`,
    method: 'delete',
    rowCount: 1,
    status: 'success',
    userId,
  });
  return deleted;
}

// --- §2.4 -----------------------------------------------------------
export async function listChannelSales(brandId) {
  await assertBrand(brandId);
  return repo.listChannelSales(brandId);
}

export async function saveChannelSales(input) {
  await assertBrand(input.brandId);
  const period = toPeriodDate(input.period);

  // dedupe channels (last value wins) so a malformed payload can't double-write
  const byChannel = new Map();
  for (const c of input.channels) byChannel.set(c.channel, c.sales);

  return inTransaction(async (db) => {
    let inserted = 0;
    let updated = 0;
    for (const [channel, sales] of byChannel) {
      const res = await repo.upsertChannelSale({
        brandId: input.brandId, period, channel, sales, userId: input.userId,
      }, db);
      if (res.was_insert) inserted += 1; else updated += 1;
    }

    await repo.logIngestion({
      brandId: input.brandId,
      targetTable: 'client_channel_sales_monthly',
      period,
      method: inserted && updated ? 'form entry + edit' : updated ? 'edit' : 'form entry',
      rowCount: byChannel.size,
      status: 'success',
      pic: input.pic ?? null,
      userId: input.userId,
    }, db);

    return { inserted, updated, channels: byChannel.size };
  });
}

export async function deleteChannelSale(id, userId) {
  const deleted = await repo.deleteChannelSale(id);
  if (!deleted) throw new AppError('Data tidak ditemukan', 404);
  await repo.logIngestion({
    brandId: deleted.brand_id,
    targetTable: 'client_channel_sales_monthly',
    period: `${deleted.period}-01`,
    method: `delete (${deleted.channel})`,
    rowCount: 1,
    status: 'success',
    userId,
  });
  return deleted;
}

// --- §2.5 -----------------------------------------------------------
export async function listPlatformSpend(brandId) {
  await assertBrand(brandId);
  return repo.listPlatformSpend(brandId);
}

export async function savePlatformSpend(input) {
  await assertBrand(input.brandId);
  const period = toPeriodDate(input.period);

  // Only the whitelisted metric columns are forwarded; anything else in the
  // body is ignored.
  const metrics = {};
  for (const col of repo.CPS_COLUMNS) {
    const raw = input.metrics?.[col];
    metrics[col] = raw === undefined || raw === null || raw === '' ? null : raw;
  }

  return inTransaction(async (db) => {
    const res = await repo.upsertPlatformSpend({
      brandId: input.brandId, period, platform: input.platform, userId: input.userId, metrics,
    }, db);

    await repo.logIngestion({
      brandId: input.brandId,
      targetTable: 'client_platform_spend_monthly',
      period,
      method: `${res.was_insert ? 'form entry' : 'edit'} (${input.platform})`,
      rowCount: 1,
      status: 'success',
      pic: input.pic ?? null,
      userId: input.userId,
    }, db);

    return { id: res.id, wasInsert: res.was_insert };
  });
}

export async function deletePlatformSpend(id, userId) {
  const deleted = await repo.deletePlatformSpend(id);
  if (!deleted) throw new AppError('Data tidak ditemukan', 404);
  await repo.logIngestion({
    brandId: deleted.brand_id,
    targetTable: 'client_platform_spend_monthly',
    period: `${deleted.period}-01`,
    method: `delete (${deleted.platform})`,
    rowCount: 1,
    status: 'success',
    userId,
  });
  return deleted;
}

// --- §2.7 -----------------------------------------------------------
export async function listIngestionLog(params) {
  return repo.listIngestionLog(params);
}

// =====================================================================
// S1 — Executive Overview
// =====================================================================
// All tunable analysis constants live in config/internalDashboard.js.

const GROWTH_BUCKETS = S1_CONFIG.growthBuckets;

// "YYYY-MM" +/- n months, staying in UTC so DST never shifts the month.
export function shiftMonth(periodYm, deltaMonths) {
  const [y, m] = periodYm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Reusable like-for-like split — also the basis for the S2 waterfall.
// `valueAt(brandId, periodKey)` returns a number or null.
//   both    : present in BOTH periods  -> {brandId, current, prior}
//   entered : present in current only  -> {brandId, current}   ("new" / not-yet-input)
//   left    : present in prior only    -> {brandId, prior}     ("churned" / no data now)
export function buildCohort(brandIds, valueAt, currentKey, priorKey) {
  const both = [];
  const entered = [];
  const left = [];
  for (const id of brandIds) {
    const cur = valueAt(id, currentKey);
    const pri = valueAt(id, priorKey);
    if (cur != null && pri != null) both.push({ brandId: id, current: cur, prior: pri });
    else if (cur != null) entered.push({ brandId: id, current: cur });
    else if (pri != null) left.push({ brandId: id, prior: pri });
  }
  return { both, entered, left };
}

const growth = (cur, prior) => (prior != null && prior > 0 ? cur / prior - 1 : null);

// Cross-check the proxy new/churn classification. These NEVER move a client
// between buckets or touch the waterfall bridge — they are annotations only
// (breakdown / user direction: keep the validated proxy, add a flag layer).
//   "new"  : proxy = has current-period data, no compare-period data.
//            join_date older than the compare period => likely a not-yet-
//            input prior month, not a genuinely new client.
//   "churn": proxy = had compare-period data, none this period.
//            status still 'active' => likely un-input data, not real churn.
function newClientFlag(meta, comparePeriodYm) {
  if (!meta?.join_date || !comparePeriodYm) return null;
  const jdYm = meta.join_date.slice(0, 7);
  if (jdYm < comparePeriodYm) {
    return `Tercatat "baru" oleh sistem, tapi join_date ${meta.join_date} — client sudah ada sejak sebelum ${comparePeriodYm}. Kemungkinan data periode sebelumnya belum diinput, bukan client baru.`;
  }
  return null; // join_date jatuh di window (atau setelahnya) -> proxy sudah benar
}
function churnClientFlag(meta) {
  if (meta?.status === 'active') {
    return 'Tercatat "churn" oleh sistem, tapi status masih ACTIVE. Kemungkinan data periode ini belum diinput, bukan churn.';
  }
  return null;
}
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => percentile(xs, 50);
// Linear-interpolated percentile (p in 0..100). Returns null for empty input.
function percentile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
// % of `xs` at or below `x` (0..1).
const percentileRank = (xs, x) => (xs.length ? xs.filter((v) => v <= x).length / xs.length : null);
// Drop values outside [P1, P99] of the sample. DORMANT below 20 points:
// with a handful of values, interpolated P1/P99 land between the extremes
// and the true min/max, so trimming would wrongly discard legitimate
// endpoints. Sub-industry MONTHLY cohorts are always small, so in practice
// this only bites once the same routine is pointed at daily-level data.
const OUTLIER_TRIM_MIN_N = 20;
function trimP1P99(xs) {
  if (xs.length < OUTLIER_TRIM_MIN_N) return [...xs];
  const lo = percentile(xs, 1);
  const hi = percentile(xs, 99);
  return xs.filter((v) => v >= lo && v <= hi);
}
const bucketOf = (g) => (GROWTH_BUCKETS.find((b) => g >= b.min && g < b.max) ?? GROWTH_BUCKETS[GROWTH_BUCKETS.length - 1]).label;

// Shared loader — the per-brand / per-month revenue + spend + target grid
// for one filter set, plus accessor closures. S1/S3/S4 (and S2 later) all
// read the same numbers the same way through this.
async function loadMonthlyGrid({ status, kategoriBesar, period, compare }) {
  const brands = await repo.listBrandsForOverview({ status, kategoriBesar });
  const brandIds = brands.map((b) => b.brand_id);
  const brandById = new Map(brands.map((b) => [b.brand_id, b]));

  const comparePeriod = compare === 'yoy' ? shiftMonth(period, -12)
    : compare === 'mom' ? shiftMonth(period, -1)
      : null; // 'target' compares to target_sales, not a period
  const trendStart = shiftMonth(period, -(S1_CONFIG.trendWindowMonths - 1));
  const windowStart = comparePeriod && comparePeriod < trendStart ? comparePeriod : trendStart;

  const [revRows, spendRows] = await Promise.all([
    repo.monthlyRevenueByBrand(brandIds, windowStart, period),
    repo.monthlySpendByBrand(brandIds, windowStart, period),
  ]);

  const revByBP = new Map();
  const targetByBP = new Map();
  for (const r of revRows) {
    if (r.revenue != null) revByBP.set(`${r.brand_id}|${r.period}`, Number(r.revenue));
    if (r.target_sales != null) targetByBP.set(`${r.brand_id}|${r.period}`, Number(r.target_sales));
  }
  const spendByBP = new Map();
  for (const s of spendRows) if (s.spend != null) spendByBP.set(`${s.brand_id}|${s.period}`, Number(s.spend));

  const revAt = (id, p) => (revByBP.has(`${id}|${p}`) ? revByBP.get(`${id}|${p}`) : null);
  const spendAt = (id, p) => (spendByBP.has(`${id}|${p}`) ? spendByBP.get(`${id}|${p}`) : null);
  const targetAt = (id, p) => (targetByBP.has(`${id}|${p}`) ? targetByBP.get(`${id}|${p}`) : null);

  const months = [];
  for (let i = -(S1_CONFIG.trendWindowMonths - 1); i <= 0; i += 1) months.push(shiftMonth(period, i));

  const sumFor = (ids, p, at) => {
    let total = 0;
    let has = false;
    for (const id of ids) {
      const v = at(id, p);
      if (v != null) { total += v; has = true; }
    }
    return has ? total : null;
  };

  return { brands, brandIds, brandById, comparePeriod, months, revAt, spendAt, targetAt, sumFor };
}

export async function getOverview(params) {
  const period = params.period;
  const compare = params.compare || 'mom';
  const category = params.category || 'all';
  const status = params.status || 'active';
  const basis = params.basis || 'like_for_like';

  const kategoriBesar = category === 'all' ? null : (CATEGORY_MAP[category] ?? null);

  const grid = await loadMonthlyGrid({ status, kategoriBesar, period, compare });
  const { brands, brandIds, brandById, comparePeriod, months, revAt, spendAt, targetAt } = grid;
  const sumAt = (p, at) => grid.sumFor(brandIds, p, at);

  // ---- trend: 13 months ending at `period` (null, never 0, for gaps) ----
  const trend = months.map((mo) => {
    const sales = sumAt(mo, revAt);
    const spend = sumAt(mo, spendAt);
    return {
      period: mo,
      sales,
      spend,
      roas: sales != null && spend != null && spend > 0 ? sales / spend : null,
    };
  });

  // ---- KPI cards ----
  const salesNow = sumAt(period, revAt) ?? 0;
  const spendNow = sumAt(period, spendAt) ?? 0;
  const roasNow = spendNow > 0 ? salesNow / spendNow : null;

  // delta respects `basis`: like_for_like restricts both sides of the ratio
  // to brands present in both periods (revenue-defined cohort).
  const revCohort = compare === 'target' ? null : buildCohort(brandIds, revAt, period, comparePeriod);
  const deltaPct = (at) => {
    if (compare === 'target') {
      let now = 0;
      let tgt = 0;
      let has = false;
      for (const id of brandIds) {
        const r = revAt(id, period);
        const t = targetAt(id, period);
        if (r != null && t != null) { now += r; tgt += t; has = true; }
      }
      return has && tgt > 0 ? now / tgt - 1 : null;
    }
    const ids = basis === 'all_clients' ? brandIds : revCohort.both.map((c) => c.brandId);
    let now = 0;
    let cmp = 0;
    let has = false;
    for (const id of ids) {
      const a = at(id, period);
      const b = at(id, comparePeriod);
      if (a != null && b != null) { now += a; cmp += b; has = true; }
    }
    return has && cmp !== 0 ? now / cmp - 1 : null;
  };

  const salesCmp = compare === 'target' ? sumAt(period, targetAt) : sumAt(comparePeriod, revAt);
  const spendCmp = compare === 'target' ? null : sumAt(comparePeriod, spendAt);
  const roasCmp = compare !== 'target' && salesCmp != null && spendCmp != null && spendCmp > 0
    ? salesCmp / spendCmp : null;

  // Spend coverage: of the clients with sales this period, how many also
  // have ad-spend entered. blended_roas / total_spend are only
  // representative when this is close to "of". Data lands gradually across
  // 33+ clients, so this stays useful indefinitely.
  const withSales = brandIds.filter((id) => revAt(id, period) != null);
  const withSalesAndSpend = withSales.filter((id) => spendAt(id, period) != null);

  const kpi = {
    total_sales: { value: salesNow, compare: salesCmp, delta_pct: deltaPct(revAt) },
    total_spend: { value: spendNow, compare: spendCmp, delta_pct: compare === 'target' ? null : deltaPct(spendAt) },
    blended_roas: {
      value: roasNow,
      compare: roasCmp,
      delta_pct: roasNow != null && roasCmp != null && roasCmp !== 0 ? roasNow / roasCmp - 1 : null,
    },
    active_clients: { value: brands.filter((b) => b.status === 'active').length },
    clients_with_data: { value: withSales.length, of: brandIds.length },
    spend_coverage: { value: withSalesAndSpend.length, of: withSales.length },
  };

  // ---- category composition (period revenue by kategori_besar) ----
  const catAgg = new Map();
  for (const id of brandIds) {
    const rv = revAt(id, period);
    if (rv == null) continue;
    const key = brandById.get(id).kategori_besar || 'Belum terkategori';
    const cur = catAgg.get(key) || { kategori_besar: key, sales: 0, client_count: 0 };
    cur.sales += rv;
    cur.client_count += 1;
    catAgg.set(key, cur);
  }
  const category_composition = [...catAgg.values()]
    .map((c) => ({ ...c, share_pct: salesNow > 0 ? c.sales / salesNow : null }))
    .sort((a, b) => b.sales - a.sales);

  // ---- client contribution (Pareto) ----
  const contribRows = brandIds
    .map((id) => ({ id, sales: revAt(id, period) }))
    .filter((r) => r.sales != null)
    .sort((a, b) => b.sales - a.sales);
  let cumulative = 0;
  const client_contribution = contribRows.map((r) => {
    cumulative += r.sales;
    return {
      brand_id: r.id,
      brand_name: brandById.get(r.id).brand_name,
      sales: r.sales,
      share_pct: salesNow > 0 ? r.sales / salesNow : null,
      cumulative_pct: salesNow > 0 ? cumulative / salesNow : null,
    };
  });

  // ---- growth distribution ----
  const growthOf = (row) => (compare === 'target'
    ? growth(row.current, targetAt(row.brandId, period))
    : growth(row.current, row.prior));

  const cohort = compare === 'target'
    ? {
      both: brandIds
        .filter((id) => revAt(id, period) != null && targetAt(id, period) != null)
        .map((id) => ({ brandId: id, current: revAt(id, period), prior: targetAt(id, period) })),
      entered: [],
      left: [],
    }
    : revCohort;

  const perBrandGrowth = cohort.both
    .map((row) => ({ brandId: row.brandId, g: growthOf(row) }))
    .filter((x) => x.g != null);

  const bucketCounts = Object.fromEntries(GROWTH_BUCKETS.map((b) => [b.label, 0]));
  for (const x of perBrandGrowth) bucketCounts[bucketOf(x.g)] += 1;

  const withName = (r, extra) => ({
    brand_id: r.brandId, brand_name: brandById.get(r.brandId).brand_name, ...extra,
  });

  const growth_distribution = {
    basis,
    compare,
    buckets: GROWTH_BUCKETS.map((b) => ({ label: b.label, count: bucketCounts[b.label] })),
    // Proxy: "entered" = has current-period data, none in the compare
    // period. Each carries a cross-check `flag` (join_date older than the
    // compare period => probably un-input history, not a new client);
    // `left` carries one too (status still active => probably un-input, not
    // churn). Flags are annotations — the buckets above are unchanged.
    entered: cohort.entered.map((r) => withName(r, {
      current: r.current,
      flag: newClientFlag(brandById.get(r.brandId), comparePeriod),
    })),
    left: cohort.left.map((r) => withName(r, {
      prior: r.prior,
      flag: churnClientFlag(brandById.get(r.brandId)),
    })),
  };

  // ---- perlu perhatian (vs sub-industry peer average) ----
  const bySub = new Map();
  for (const x of perBrandGrowth) {
    const sub = brandById.get(x.brandId).sub_industry;
    if (!sub) continue; // no sub-industry -> can't peer-compare
    if (!bySub.has(sub)) bySub.set(sub, []);
    bySub.get(sub).push(x);
  }
  const perlu_perhatian = [];
  for (const [sub, members] of bySub) {
    const subAvg = avg(members.map((m) => m.g));
    for (const m of members) {
      const gap = m.g - subAvg;
      if (gap <= -S1_CONFIG.perluPerhatianGrowthGap) {
        perlu_perhatian.push({
          brand_id: m.brandId,
          brand_name: brandById.get(m.brandId).brand_name,
          sub_industry: sub,
          growth: m.g,
          sub_industry_avg_growth: subAvg,
          gap,
          peer_n: members.length,
        });
      }
    }
  }
  perlu_perhatian.sort((a, b) => a.gap - b.gap);

  return {
    period,
    compare_period: comparePeriod,
    filters: { compare, category, status, basis },
    thresholds: { perlu_perhatian_growth_gap: S1_CONFIG.perluPerhatianGrowthGap, provisional: true },
    kpi,
    trend,
    category_composition,
    client_contribution,
    growth_distribution,
    perlu_perhatian,
  };
}

// =====================================================================
// S3 — Kategori Besar  &  S4 — Industry / Sub-industry
// =====================================================================
// Same data model as S1. The key difference (breakdown §4): cross-GROUP
// comparison uses the MEDIAN client, not the mean, so one large client
// can't drag a group's headline number. Aggregate (sum/sum) figures are
// still returned alongside, clearly labelled.

// Per-client figures for one period + its compare, within a set of brands.
function clientFigures(ids, grid, period, comparePeriod, compare) {
  const { revAt, spendAt, targetAt } = grid;
  return ids.map((id) => {
    const rev = revAt(id, period);
    const spend = spendAt(id, period);
    const prior = compare === 'target' ? targetAt(id, period) : revAt(id, comparePeriod);
    return {
      brandId: id,
      revenue: rev,
      spend,
      roas: rev != null && spend != null && spend > 0 ? rev / spend : null,
      growth: rev != null ? growth(rev, prior) : null,
    };
  });
}

function groupBlock(ids, grid, period, comparePeriod, compare, basis) {
  const figs = clientFigures(ids, grid, period, comparePeriod, compare);
  const withRev = figs.filter((f) => f.revenue != null);
  const sales = withRev.reduce((a, f) => a + f.revenue, 0);
  const spendVals = figs.filter((f) => f.spend != null);
  const spend = spendVals.reduce((a, f) => a + f.spend, 0);

  // aggregate (like-for-like) growth for the group
  const lfl = figs.filter((f) => f.revenue != null && (
    compare === 'target' ? grid.targetAt(f.brandId, period) != null : grid.revAt(f.brandId, comparePeriod) != null
  ));
  let aggGrowth = null;
  if (lfl.length) {
    const now = lfl.reduce((a, f) => a + f.revenue, 0);
    const base = lfl.reduce((a, f) => a + (compare === 'target' ? grid.targetAt(f.brandId, period) : grid.revAt(f.brandId, comparePeriod)), 0);
    aggGrowth = base > 0 ? now / base - 1 : null;
  }
  const growthPool = basis === 'all_clients'
    ? withRev.map((f) => f.growth).filter((g) => g != null)
    : lfl.map((f) => f.growth).filter((g) => g != null);

  // spend coverage — same pattern as S1's spend_coverage: of the clients
  // with revenue here, how many also have spend. blended_roas (sales/spend)
  // is only representative when these are close.
  const withRevAndSpend = withRev.filter((f) => f.spend != null);

  return {
    n_clients: ids.length,
    n_with_data: withRev.length,
    n_with_spend: withRevAndSpend.length,
    sales,
    spend: spendVals.length ? spend : null,
    blended_roas: spendVals.length && spend > 0 ? sales / spend : null,
    aggregate_growth: aggGrowth,
    median_client_sales: median(withRev.map((f) => f.revenue)),
    median_client_growth: median(growthPool),
    median_client_roas: median(figs.map((f) => f.roas).filter((r) => r != null)),
  };
}

export async function getCategories(params) {
  const period = params.period;
  const compare = params.compare || 'mom';
  const status = params.status || 'active';
  const basis = params.basis || 'like_for_like';

  const grid = await loadMonthlyGrid({ status, kategoriBesar: null, period, compare });
  const { brands, brandById, comparePeriod, months } = grid;

  // bucket brand ids by kategori_besar
  const byKat = new Map();
  for (const b of brands) {
    const k = b.kategori_besar || null;
    if (!byKat.has(k)) byKat.set(k, []);
    byKat.get(k).push(b.brand_id);
  }

  const KATS = ['Retail', 'B2B/Service', 'F&B'];
  const totalNow = grid.sumFor(brands.map((b) => b.brand_id), period, grid.revAt) ?? 0;
  const totalCmp = compare === 'target'
    ? grid.sumFor(brands.map((b) => b.brand_id), period, grid.targetAt)
    : grid.sumFor(brands.map((b) => b.brand_id), comparePeriod, grid.revAt);

  const categories = KATS.map((kat) => {
    const ids = byKat.get(kat) || [];
    const block = groupBlock(ids, grid, period, comparePeriod, compare, basis);
    const shareNow = totalNow > 0 ? block.sales / totalNow : null;
    const katCmp = compare === 'target'
      ? grid.sumFor(ids, period, grid.targetAt)
      : grid.sumFor(ids, comparePeriod, grid.revAt);
    const shareCmp = totalCmp && totalCmp > 0 && katCmp != null ? katCmp / totalCmp : null;
    return {
      kategori_besar: kat,
      aggregate: {
        sales: block.sales,
        spend: block.spend,
        blended_roas: block.blended_roas,
        client_count: block.n_with_data,
        spend_coverage: { value: block.n_with_spend, of: block.n_with_data },
        delta_pct: block.aggregate_growth,
      },
      median: {
        client_sales: block.median_client_sales,
        client_growth: block.median_client_growth,
        client_roas: block.median_client_roas,
      },
      composition: {
        share_now: shareNow,
        share_compare: shareCmp,
        share_delta: shareNow != null && shareCmp != null ? shareNow - shareCmp : null,
      },
    };
  });

  const uncatIds = byKat.get(null) || [];
  const uncategorized = {
    client_count: uncatIds.length,
    client_with_data: uncatIds.filter((id) => grid.revAt(id, period) != null).length,
    sales: grid.sumFor(uncatIds, period, grid.revAt) ?? 0,
  };

  const trend = months.map((mo) => {
    const row = { period: mo };
    for (const kat of KATS) row[kat] = grid.sumFor(byKat.get(kat) || [], mo, grid.revAt);
    return row;
  });

  return {
    period,
    compare_period: comparePeriod,
    filters: { compare, status, basis },
    note: 'Perbandingan antar-kategori pakai median client; angka agregat (sum/sum) ditampilkan terpisah.',
    categories,
    uncategorized,
    trend,
  };
}

export async function getIndustries(params) {
  const period = params.period;
  const compare = params.compare || 'mom';
  const status = params.status || 'active';
  const basis = params.basis || 'like_for_like';
  const level = params.level === 'industry' ? 'industry' : 'sub_industry'; // default sub_industry (= S5 peer level)

  const grid = await loadMonthlyGrid({ status, kategoriBesar: null, period, compare });
  const { brands, comparePeriod } = grid;

  const byKey = new Map();
  for (const b of brands) {
    const key = b[level];
    if (!key) continue; // no industry / sub-industry set -> can't group
    if (!byKey.has(key)) byKey.set(key, { ids: [], sample: b });
    byKey.get(key).ids.push(b.brand_id);
  }

  const groups = [...byKey.entries()].map(([key, { ids, sample }]) => {
    const block = groupBlock(ids, grid, period, comparePeriod, compare, basis);
    return {
      key,
      level,
      industry: sample.industry || null,
      sub_industry: sample.sub_industry || null,
      kategori_besar: sample.kategori_besar || null,
      n_clients: block.n_clients,        // transparent N (breakdown §4: no min-n gate)
      n_with_data: block.n_with_data,
      n_with_spend: block.n_with_spend,  // spend coverage for blended_roas
      sales: block.sales,
      spend: block.spend,
      blended_roas: block.blended_roas,
      aggregate_growth: block.aggregate_growth,
      median_client_sales: block.median_client_sales,
      median_client_growth: block.median_client_growth,
      median_client_roas: block.median_client_roas,
    };
  }).sort((a, b) => b.sales - a.sales);

  const ungrouped = brands.filter((b) => !b[level]);

  return {
    period,
    compare_period: comparePeriod,
    filters: { compare, status, basis, level },
    note: 'N per grup ditampilkan apa adanya — tidak ada ambang minimum (breakdown §4). Median untuk perbandingan; treemap: size = sales, warna = aggregate_growth.',
    groups,
    ungrouped: { client_count: ungrouped.length, brand_names: ungrouped.map((b) => b.brand_name) },
  };
}

// =====================================================================
// S6 — Channel & Platform
// =====================================================================
// Sales side: client_channel_sales_monthly (4 sales channels).
// Ad side:    client_platform_spend_monthly (6 ad platforms).
// Efficiency ratios are ALWAYS recomputed from summed raw columns here —
// the stored ratio columns are never read. Platform-level "ROAS" is
// purchase_value / spend and is deliberately called
// `platform_attributed_roas`, NOT "ROAS" (that headline term is reserved
// for the revenue/spend blended figure in S1).

const SALES_CHANNELS = ['shopee', 'tiktok_shop', 'website', 'offline'];
const AD_PLATFORMS = ['meta_nonboost', 'meta_boost', 'meta_cpas', 'iklanku_shopee', 'gmv_max_tiktok', 'google_ads'];

export async function getChannels(params) {
  const period = params.period;
  const compare = params.compare === 'yoy' ? 'yoy' : 'mom';
  const status = params.status || 'active';
  const category = params.category || 'all';
  const kategoriBesar = category === 'all' ? null : (CATEGORY_MAP[category] ?? null);

  const brands = await repo.listBrandsForOverview({ status, kategoriBesar });
  const brandIds = brands.map((b) => b.brand_id);
  const brandById = new Map(brands.map((b) => [b.brand_id, b]));

  const comparePeriod = compare === 'yoy' ? shiftMonth(period, -12) : shiftMonth(period, -1);
  const trendStart = shiftMonth(period, -(S1_CONFIG.trendWindowMonths - 1));
  const windowStart = comparePeriod < trendStart ? comparePeriod : trendStart;

  const [chanRows, chanOtherRows, platRows] = await Promise.all([
    repo.channelSalesGrid(brandIds, windowStart, period),
    repo.channelSalesOtherGrid(brandIds, windowStart, period),
    repo.platformMetricsGrid(brandIds, windowStart, period),
  ]);

  const months = [];
  for (let i = -(S1_CONFIG.trendWindowMonths - 1); i <= 0; i += 1) months.push(shiftMonth(period, i));

  // --- sales channels (4 canonical + free-text "other", one flat list) ---
  // chanAgg[`${period}|${key}`] = { total, brands:Set, label, isOther }
  const chanAgg = new Map();
  const otherLabels = new Set();
  const addChan = (period_, key, label, isOther, sales, brandId) => {
    if (sales == null) return;
    const k = `${period_}|${key}`;
    if (!chanAgg.has(k)) chanAgg.set(k, { total: 0, brands: new Set(), label, isOther });
    const e = chanAgg.get(k);
    e.total += Number(sales);
    e.brands.add(brandId);
  };
  for (const r of chanRows) addChan(r.period, r.channel, r.channel, false, r.sales, r.brand_id);
  for (const r of chanOtherRows) {
    addChan(r.period, `other:${r.channel_label}`, r.channel_label, true, r.sales, r.brand_id);
    otherLabels.add(r.channel_label);
  }

  const channelKeys = [
    ...SALES_CHANNELS,
    ...[...otherLabels].map((l) => `other:${l}`),
  ];
  const chanTotalAt = (p) => channelKeys.reduce((sum, ch) => sum + (chanAgg.get(`${p}|${ch}`)?.total || 0), 0);
  const totalNow = chanTotalAt(period);

  const sales_channels = channelKeys
    .map((ch) => {
      const now = chanAgg.get(`${period}|${ch}`);
      const cmp = chanAgg.get(`${comparePeriod}|${ch}`);
      const sales = now?.total ?? null;
      const cmpSales = cmp?.total ?? null;
      const isOther = ch.startsWith('other:');
      return {
        channel: ch,
        channel_label: isOther ? ch.slice('other:'.length) : ch,
        is_other: isOther,
        sales,
        share_pct: sales != null && totalNow > 0 ? sales / totalNow : null,
        delta_pct: sales != null && cmpSales != null && cmpSales > 0 ? sales / cmpSales - 1 : null,
        client_count: now?.brands.size ?? 0,
      };
    })
    .filter((c) => c.sales != null) // drop channels with no data this period
    .sort((a, b) => b.sales - a.sales); // canonical + other, ranked by value together

  // --- ad platforms ----------------------------------------------
  // platAgg[`${period}|${platform}`] = summed raw + brand set
  const platAgg = new Map();
  for (const r of platRows) {
    const k = `${r.period}|${r.platform}`;
    if (!platAgg.has(k)) {
      platAgg.set(k, {
        spend: 0, impressions: 0, link_clicks: 0, purchase: 0, purchase_value: 0, ig_profile_visit: 0,
        hasImpr: false, hasClicks: false, hasPurch: false, hasPv: false, igpvHas: false, brands: new Set(),
      });
    }
    const e = platAgg.get(k);
    e.spend += Number(r.amount_spent || 0);
    // nullable raw: only sum + mark "has" when a real value is present, so a
    // spend-only row (impressions/purchase_value NULL) yields null ratios,
    // not a misleading 0.
    if (r.impressions != null) { e.impressions += Number(r.impressions); e.hasImpr = true; }
    if (r.link_clicks != null) { e.link_clicks += Number(r.link_clicks); e.hasClicks = true; }
    if (r.purchase != null) { e.purchase += Number(r.purchase); e.hasPurch = true; }
    if (r.purchase_value != null) { e.purchase_value += Number(r.purchase_value); e.hasPv = true; }
    if (r.ig_profile_visit != null) { e.ig_profile_visit += Number(r.ig_profile_visit); e.igpvHas = true; }
    e.brands.add(r.brand_id);
  }
  const spendTotalAt = (p) => AD_PLATFORMS.reduce((s, pl) => s + (platAgg.get(`${p}|${pl}`)?.spend || 0), 0);
  const spendNow = spendTotalAt(period);

  const EMPTY_PLATFORM = {
    spend: null, spend_share_pct: null, purchases: null, purchase_value: null,
    platform_attributed_roas: null, cost_per_purchase: null, cpm: null, ctr: null, cpc: null,
    cost_per_profile_visit_proxy: null, cost_per_profile_visit_is_proxy: null,
    delta_spend_pct: null, client_count: 0,
  };
  const ad_platforms = AD_PLATFORMS.map((pl) => {
    const e = platAgg.get(`${period}|${pl}`);
    const cmp = platAgg.get(`${comparePeriod}|${pl}`);
    if (!e) return { platform: pl, ...EMPTY_PLATFORM };
    const ratio = (num, den) => (den > 0 ? num / den : null);
    return {
      platform: pl,
      spend: e.spend,
      spend_share_pct: spendNow > 0 ? e.spend / spendNow : null,
      purchases: e.hasPurch ? e.purchase : null,
      purchase_value: e.hasPv ? e.purchase_value : null,
      // purchase_value / spend — NOT "ROAS" (see header note)
      platform_attributed_roas: e.hasPv ? ratio(e.purchase_value, e.spend) : null,
      cost_per_purchase: e.hasPurch ? ratio(e.spend, e.purchase) : null,
      cpm: e.hasImpr && e.impressions > 0 ? (e.spend / e.impressions) * 1000 : null,
      ctr: e.hasImpr && e.hasClicks ? ratio(e.link_clicks, e.impressions) : null,
      cpc: e.hasClicks ? ratio(e.spend, e.link_clicks) : null,
      // link_clicks is the proxy for IG profile visits (breakdown §4) — flag it
      cost_per_profile_visit_proxy: e.igpvHas && e.ig_profile_visit > 0 ? e.spend / e.ig_profile_visit : ratio(e.spend, e.link_clicks),
      cost_per_profile_visit_is_proxy: !e.igpvHas || e.ig_profile_visit === 0,
      delta_spend_pct: cmp && cmp.spend > 0 ? e.spend / cmp.spend - 1 : null,
      client_count: e.brands.size,
    };
  });

  // --- trends (13 months) --------------------------------------
  const channel_trend = months.map((mo) => {
    const row = { period: mo };
    for (const ch of channelKeys) {
      const label = ch.startsWith('other:') ? ch.slice('other:'.length) : ch;
      row[label] = chanAgg.get(`${mo}|${ch}`)?.total ?? null;
    }
    return row;
  });
  const spend_trend = months.map((mo) => {
    const row = { period: mo };
    for (const pl of AD_PLATFORMS) row[pl] = platAgg.get(`${mo}|${pl}`)?.spend ?? null;
    return row;
  });

  // --- client coverage (has ≥1 month of data in the window) -----
  const covChan = new Map(); // brandId -> Set(channel)
  for (const r of chanRows) {
    if (r.sales == null) continue;
    if (!covChan.has(r.brand_id)) covChan.set(r.brand_id, new Set());
    covChan.get(r.brand_id).add(r.channel);
  }
  const covPlat = new Map();
  for (const r of platRows) {
    if (!covPlat.has(r.brand_id)) covPlat.set(r.brand_id, new Set());
    covPlat.get(r.brand_id).add(r.platform);
  }
  const client_coverage = brands
    .map((b) => ({
      brand_id: b.brand_id,
      brand_name: b.brand_name,
      kategori_besar: b.kategori_besar || null,
      channels: Object.fromEntries(SALES_CHANNELS.map((ch) => [ch, covChan.get(b.brand_id)?.has(ch) || false])),
      platforms: Object.fromEntries(AD_PLATFORMS.map((pl) => [pl, covPlat.get(b.brand_id)?.has(pl) || false])),
    }))
    .filter((c) => Object.values(c.channels).some(Boolean) || Object.values(c.platforms).some(Boolean))
    .sort((a, b) => a.brand_name.localeCompare(b.brand_name));

  // portfolio sales from client_monthly_metrics, for reconciliation context
  const portfolioRev = await repo.monthlyRevenueByBrand(brandIds, period, period);
  const portfolio_sales = portfolioRev.reduce((s, r) => s + (r.revenue != null ? Number(r.revenue) : 0), 0) || null;

  return {
    period,
    compare_period: comparePeriod,
    filters: { compare, status, category },
    note: 'Efisiensi platform dihitung ulang dari kolom raw (spend/impressions/clicks/purchase). "platform_attributed_roas" = purchase_value / spend, bukan ROAS bisnis (revenue/spend ada di Executive Overview). Channel di luar 4 utama (chat/tokopedia/dst.) disimpan sebagai free-text di client_channel_sales_other dan ikut dijumlahkan ke total_channel_sales + tampil di "Sales per Channel" dengan label aslinya. Cakupan = client punya ≥1 bulan data channel/platform tsb dalam 13 bulan terakhir; client_sales_channels (§2.2) belum ada, jadi "tidak dipakai" vs "belum diinput" belum bisa dibedakan.',
    sales_channels,
    channel_trend_keys: channelKeys.map((ch) => (ch.startsWith('other:') ? ch.slice('other:'.length) : ch)),
    total_channel_sales: totalNow || null,
    portfolio_sales,
    ad_platforms,
    total_platform_spend: spendNow || null,
    channel_trend,
    spend_trend,
    client_coverage,
  };
}

// =====================================================================
// S2 — Business Checkup
// =====================================================================
// Reuses buildCohort() + shiftMonth() from S1 for the like-for-like split.
//
// DESIGN NOTE: S2 does NOT honour the `status` filter — it always spans
// every migrated client. Churn is detected as "had sales last period,
// none this period", which only works if the churned client stays in the
// set. (Same as S1, that "no data now" bucket also catches a client whose
// current month simply hasn't been input yet — no join_date to tell them
// apart.)
//
// KNOWN GAP (revisit when real partial-month data triggers it): S2 does
// NOT exclude is_partial_month rows the way S5 does. A partial month
// compared to a full month can mis-classify a client as "declining" in
// the waterfall / movement matrix. S1 is safe (portfolio totals only);
// S2 is per-client so it can bite. Left as-is until a real case appears
// — same "revisit on a concrete case" policy as the S6 coverage notes.

export async function getBusinessCheckup(params) {
  const period = params.period;
  const compare = params.compare === 'yoy' ? 'yoy' : 'mom';
  const category = params.category || 'all';
  const kategoriBesar = category === 'all' ? null : (CATEGORY_MAP[category] ?? null);

  const grid = await loadMonthlyGrid({ status: 'all', kategoriBesar, period, compare });
  const { brandIds, brandById, comparePeriod, months, revAt, spendAt, targetAt } = grid;

  const cohort = buildCohort(brandIds, revAt, period, comparePeriod);
  const name = (id) => brandById.get(id).brand_name;

  // ---- waterfall: prior_total -> current_total -------------------
  const priorTotal = cohort.both.reduce((a, c) => a + c.prior, 0) + cohort.left.reduce((a, c) => a + c.prior, 0);
  const currentTotal = cohort.both.reduce((a, c) => a + c.current, 0) + cohort.entered.reduce((a, c) => a + c.current, 0);

  let growAmt = 0;
  let declineAmt = 0;
  let growN = 0;
  let declineN = 0;
  let flatN = 0;
  for (const c of cohort.both) {
    const d = c.current - c.prior;
    if (d > 0) { growAmt += d; growN += 1; }
    else if (d < 0) { declineAmt += d; declineN += 1; }
    else flatN += 1;
  }
  const newAmt = cohort.entered.reduce((a, c) => a + c.current, 0);
  const churnAmt = -cohort.left.reduce((a, c) => a + c.prior, 0);

  const waterfall = {
    prior_period: comparePeriod,
    prior_total: priorTotal,
    growth: growAmt,
    decline: declineAmt, // <= 0
    new_clients: newAmt,
    churn: churnAmt, // <= 0
    current_total: currentTotal,
    // reconciliation: prior + growth + decline + new + churn === current
    reconciles: Math.abs((priorTotal + growAmt + declineAmt + newAmt + churnAmt) - currentTotal) < 1,
    counts: { growth: growN, decline: declineN, flat: flatN, new: cohort.entered.length, churn: cohort.left.length },
    // Cross-check annotations — do NOT affect the bridge above. A "new"
    // client whose join_date predates the prior period, or a "churn"
    // client still marked active, is probably un-input data.
    annotations: {
      new_needs_review: cohort.entered
        .map((c) => ({ brand_id: c.brandId, brand_name: name(c.brandId), current: c.current, flag: newClientFlag(brandById.get(c.brandId), comparePeriod) }))
        .filter((x) => x.flag),
      churn_needs_review: cohort.left
        .map((c) => ({ brand_id: c.brandId, brand_name: name(c.brandId), prior: c.prior, flag: churnClientFlag(brandById.get(c.brandId)) }))
        .filter((x) => x.flag),
    },
  };

  // ---- client movement matrix (like-for-like cohort only) -------
  const movement_matrix = cohort.both.map((c) => ({
    brand_id: c.brandId,
    brand_name: name(c.brandId),
    kategori_besar: brandById.get(c.brandId).kategori_besar || null,
    sales: c.current,
    growth: c.prior > 0 ? c.current / c.prior - 1 : null,
    ad_spend: spendAt(c.brandId, period),
    direction: c.current >= c.prior ? 'up' : 'down',
  }));

  // ---- spend vs sales (needs spend AND sales in both periods) ---
  const spend_vs_sales = cohort.both
    .map((c) => {
      const sp = spendAt(c.brandId, period);
      const spPrior = spendAt(c.brandId, comparePeriod);
      if (sp == null || spPrior == null || spPrior <= 0 || c.prior <= 0) return null;
      return {
        brand_id: c.brandId,
        brand_name: name(c.brandId),
        sales_delta_pct: c.current / c.prior - 1,
        spend_delta_pct: sp / spPrior - 1,
        sales: c.current,
      };
    })
    .filter(Boolean);

  // ---- top 10 movers by absolute contribution to portfolio delta ----
  const netChange = currentTotal - priorTotal;
  const contribRows = [
    ...cohort.both.map((c) => ({ id: c.brandId, type: c.current >= c.prior ? 'growth' : 'decline', prior: c.prior, current: c.current, contribution: c.current - c.prior })),
    ...cohort.entered.map((c) => ({ id: c.brandId, type: 'new', prior: null, current: c.current, contribution: c.current })),
    ...cohort.left.map((c) => ({ id: c.brandId, type: 'churn', prior: c.prior, current: null, contribution: -c.prior })),
  ];
  const top_movers = contribRows
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 10)
    .map((r) => ({
      brand_id: r.id,
      brand_name: name(r.id),
      type: r.type,
      prior: r.prior,
      current: r.current,
      delta_abs: r.contribution,
      delta_pct: r.prior != null && r.prior > 0 ? r.current / r.prior - 1 : null,
      contribution_pct_of_change: netChange !== 0 ? r.contribution / netChange : null,
    }));

  // ---- portfolio index (base = first non-null month = 100) ------
  const salesSeries = months.map((mo) => grid.sumFor(brandIds, mo, revAt));
  const spendSeries = months.map((mo) => grid.sumFor(brandIds, mo, spendAt));
  const indexTo100 = (series) => {
    const baseIdx = series.findIndex((v) => v != null && v > 0);
    if (baseIdx === -1) return series.map(() => null);
    const base = series[baseIdx];
    return series.map((v) => (v == null ? null : (v / base) * 100));
  };
  const salesIdx = indexTo100(salesSeries);
  const spendIdx = indexTo100(spendSeries);
  const portfolio_index = {
    base_note: 'Base 100 = bulan pertama dengan data di window. Belum dikontrol komposisi (client sama sepanjang window) — versi like-for-like penuh baru bermakna setelah ada histori.',
    series: months.map((mo, i) => ({ period: mo, sales_index: salesIdx[i], spend_index: spendIdx[i] })),
  };

  // ---- actual vs target per kategori --------------------------
  // Only clients that have BOTH an actual revenue and a target_sales for
  // `period` count. target_sales is nullable -> excluded, never treated as 0.
  const KATS = ['Retail', 'B2B/Service', 'F&B'];
  const actual_vs_target = KATS.map((kat) => {
    const ids = brandIds.filter((id) => (brandById.get(id).kategori_besar || null) === kat);
    let actual = 0;
    let target = 0;
    const included = [];
    const excludedNoTarget = [];
    for (const id of ids) {
      const rev = revAt(id, period);
      const tgt = targetAt(id, period);
      if (rev != null && tgt != null) { actual += rev; target += tgt; included.push(name(id)); }
      else if (rev != null) excludedNoTarget.push(name(id));
    }
    return {
      kategori_besar: kat,
      actual: included.length ? actual : null,
      target: included.length ? target : null,
      attainment_pct: included.length && target > 0 ? actual / target : null,
      n_included: included.length,
      n_excluded_no_target: excludedNoTarget.length,
      excluded_no_target: excludedNoTarget,
    };
  });

  return {
    period,
    compare_period: comparePeriod,
    filters: { compare, category },
    note: 'S2 selalu mencakup semua client (filter status diabaikan) supaya churn bisa terdeteksi dari hilangnya data. "New" & "churn" bisa jadi client baru/berhenti ATAU data yang belum/berhenti diinput — belum bisa dibedakan tanpa join_date.',
    waterfall,
    movement_matrix,
    spend_vs_sales,
    top_movers,
    portfolio_index,
    actual_vs_target,
  };
}

// =====================================================================
// S5 — Benchmarking
// =====================================================================
// Peer group = every client (any status) sharing the selected client's
// sub_industry — the S5 peer level (breakdown §4). No minimum-n gate; N
// is surfaced. Every metric is recomputed per-client from raw monthly
// sums. "Blended ROAS" here is revenue / spend (SAME definition as S1),
// NOT the platform-attributed purchase_value/spend used in S6.
//
// SAFEGUARDS (breakdown §4):
//   - P1–P99 outlier trim on cohort metric values ......... APPLIED
//   - exclude data with < 25 days of history .............. NOT APPLIED
//       (the monthly input form records no per-month day count)
//   - exclude clients with < 2 months of tenure ........... NOT APPLIED
//       (join_date does not exist yet — pending, no proxy)

const BENCHMARK_METRICS = [
  { key: 'cpm', label: 'CPM', lowerBetter: true },
  { key: 'cpc', label: 'CPC', lowerBetter: true },
  { key: 'ctr', label: 'CTR', lowerBetter: false },
  { key: 'blended_roas', label: 'Blended ROAS', lowerBetter: false },
  { key: 'cpp', label: 'Cost per Purchase', lowerBetter: true },
  { key: 'ad_cost_ratio', label: 'Ad Cost Ratio', lowerBetter: true },
];

// A monthlyAdTotalsByBrand row -> summed-shape object. Nullable columns
// stay null (never coalesced to 0) so funnels render "no data" and
// adMetrics()'s `> 0` guards behave. (view_content/atc are undefined when
// the caller's query didn't select them -> also null.)
function adRowObj(r) {
  return {
    spend: Number(r.spend || 0), // SUM(amount_spent), never null
    impressions: r.impressions == null ? null : Number(r.impressions),
    link_clicks: r.link_clicks == null ? null : Number(r.link_clicks),
    purchase: r.purchase == null ? null : Number(r.purchase),
    purchase_value: r.purchase_value == null ? null : Number(r.purchase_value),
    view_content: r.view_content == null ? null : Number(r.view_content),
    atc: r.atc == null ? null : Number(r.atc),
  };
}

// Per-client ad metrics from raw monthly sums. blended_roas = revenue/spend
// (S1 definition — NOT S6's platform-attributed purchase_value/spend).
function adMetrics(rev, ad) {
  if (!ad) return null;
  const s = ad.spend;
  return {
    cpm: ad.impressions > 0 ? (s / ad.impressions) * 1000 : null,
    cpc: ad.link_clicks > 0 ? s / ad.link_clicks : null,
    ctr: ad.impressions > 0 ? ad.link_clicks / ad.impressions : null,
    blended_roas: rev != null && s > 0 ? rev / s : null,
    cpp: ad.purchase > 0 ? s / ad.purchase : null,
    ad_cost_ratio: rev != null && rev > 0 ? s / rev : null,
  };
}

// Peer distribution over BENCHMARK_METRICS + client position + efficiency
// index. `metricsAt(id)` -> a metrics object or null. Shared by S5
// (Benchmarking) and S7 (compact scorecard).
function peerDistribution(cohortIds, clientId, metricsAt) {
  const cm = metricsAt(clientId);
  const distribution = BENCHMARK_METRICS.map((m) => {
    const raw = cohortIds.map((id) => metricsAt(id)?.[m.key]).filter((v) => v != null);
    const vals = trimP1P99(raw);
    const med = median(vals);
    const cv = cm?.[m.key] ?? null;
    let effIndex = null;
    if (cv != null && med != null && med > 0 && cv > 0) {
      effIndex = (m.lowerBetter ? med / cv : cv / med) * 100; // >100 always = better than peer median
    }
    return {
      metric: m.key,
      label: m.label,
      lower_better: m.lowerBetter,
      n: vals.length,
      p25: percentile(vals, 25),
      median: med,
      p75: percentile(vals, 75),
      client_value: cv,
      client_percentile: cv != null && vals.length ? percentileRank(vals, cv) : null,
      efficiency_index: effIndex,
    };
  });
  const idxVals = distribution.map((d) => d.efficiency_index).filter((v) => v != null && v > 0);
  const composite = idxVals.length ? idxVals.reduce((a, b) => a * b, 1) ** (1 / idxVals.length) : null;
  return { distribution, composite };
}

export async function getBenchmark(params) {
  const clientId = Number(params.client_id);
  const period = params.period;
  const compare = params.compare === 'yoy' ? 'yoy' : 'mom';

  const client = await brandService.getBrandById(clientId);
  if (!client) throw new AppError('Client tidak ditemukan', 404);

  const allBrands = await repo.listBrandsForOverview({ status: 'all', kategoriBesar: null });
  const clientMeta = allBrands.find((b) => b.brand_id === clientId);
  const subIndustry = clientMeta?.sub_industry || null;
  if (!subIndustry) {
    throw new AppError('Client belum punya sub-industry di master — tidak bisa di-benchmark.', 422);
  }

  const cohort = allBrands.filter((b) => b.sub_industry === subIndustry);
  const cohortIds = cohort.map((b) => b.brand_id);
  const brandById = new Map(cohort.map((b) => [b.brand_id, b]));

  const comparePeriod = shiftMonth(period, compare === 'yoy' ? -12 : -1);
  const trendStart = shiftMonth(period, -(S1_CONFIG.trendWindowMonths - 1));
  const windowStart = comparePeriod < trendStart ? comparePeriod : trendStart;

  const [revRows, adRows] = await Promise.all([
    repo.monthlyRevenueByBrand(cohortIds, windowStart, period),
    repo.monthlyAdTotalsByBrand(cohortIds, windowStart, period),
  ]);

  const revBy = new Map();
  const partialBy = new Set(); // `${brandId}|${YYYY-MM}` flagged partial
  for (const r of revRows) {
    if (r.revenue != null) revBy.set(`${r.brand_id}|${r.period}`, Number(r.revenue));
    if (r.is_partial_month) partialBy.add(`${r.brand_id}|${r.period}`);
  }
  const adBy = new Map();
  for (const r of adRows) {
    adBy.set(`${r.brand_id}|${r.period}`, adRowObj(r));
    if (r.any_partial_spend) partialBy.add(`${r.brand_id}|${r.period}`);
  }
  const isPartial = (id, p) => partialBy.has(`${id}|${p}`);
  const revRaw = (id, p) => (revBy.has(`${id}|${p}`) ? revBy.get(`${id}|${p}`) : null);
  const adRaw = (id, p) => adBy.get(`${id}|${p}`) || null;
  // benchmark accessors: a partial client-month contributes NOTHING to S5
  // (breakdown §4 + user direction) — no peer average/median, no scorecard.
  const revAt = (id, p) => (isPartial(id, p) ? null : revRaw(id, p));
  const adAt = (id, p) => (isPartial(id, p) ? null : adRaw(id, p));

  const metricsFor = (id, p) => adMetrics(revAt(id, p), adAt(id, p));

  const clientPeriodPartial = isPartial(clientId, period);
  const clientMetrics = metricsFor(clientId, period);
  const peerIds = cohortIds.filter((id) => id !== clientId);

  const { distribution, composite: compositeIndex } = peerDistribution(
    cohortIds, clientId, (id) => metricsFor(id, period),
  );

  // --- market movement (like-for-like peer growth, client excluded) ---
  const peerCohort = buildCohort(peerIds, revAt, period, comparePeriod);
  const peerGrowths = peerCohort.both
    .map((c) => (c.prior > 0 ? c.current / c.prior - 1 : null))
    .filter((v) => v != null);
  const cCur = revAt(clientId, period);
  const cPri = revAt(clientId, comparePeriod);
  const clientGrowth = cCur != null && cPri != null && cPri > 0 ? cCur / cPri - 1 : null;

  const peerMed = median(peerGrowths);
  const peersUp = peerGrowths.filter((g) => g > 0).length;
  const peersDown = peerGrowths.filter((g) => g < 0).length;
  let verdict;
  if (!peerGrowths.length) {
    verdict = 'Belum cukup data peer untuk menilai pergerakan pasar sub-industry ini.';
  } else {
    const dir = peerMed > 0.02 ? `tumbuh (median ${(peerMed * 100).toFixed(1)}%)`
      : peerMed < -0.02 ? `turun (median ${(peerMed * 100).toFixed(1)}%)`
        : 'relatif flat';
    const share = `${peersUp} dari ${peerGrowths.length} peer naik, ${peersDown} turun`;
    const rel = clientGrowth == null ? ''
      : clientGrowth > peerMed ? ` Growth client (${(clientGrowth * 100).toFixed(1)}%) di ATAS median peer.`
        : clientGrowth < peerMed ? ` Growth client (${(clientGrowth * 100).toFixed(1)}%) di BAWAH median peer.`
          : ` Growth client setara median peer.`;
    verdict = `Peer group sub-industry "${subIndustry}" secara umum ${dir}. ${share}.${rel}`;
  }

  // --- CPM trend + peer CPM band (13 months, client excluded from band) ---
  const months = [];
  for (let i = -(S1_CONFIG.trendWindowMonths - 1); i <= 0; i += 1) months.push(shiftMonth(period, i));
  const cpm_trend = months.map((mo) => {
    const peerCpms = trimP1P99(peerIds.map((id) => metricsFor(id, mo)?.cpm).filter((v) => v != null));
    return {
      period: mo,
      client_cpm: metricsFor(clientId, mo)?.cpm ?? null,
      peer_p25: percentile(peerCpms, 25),
      peer_median: median(peerCpms),
      peer_p75: percentile(peerCpms, 75),
      peer_n: peerCpms.length,
    };
  });

  return {
    period,
    compare_period: comparePeriod,
    client: {
      brand_id: clientId,
      brand_name: client.brand_name,
      sub_industry: subIndustry,
      industry: clientMeta.industry || null,
      kategori_besar: clientMeta.kategori_besar || null,
      metrics: clientMetrics,
      growth: clientGrowth,
      // period flagged partial (business-data or platform-spend row) —
      // scorecard/comparison suppressed; raw data still shows in S7.
      client_period_partial: clientPeriodPartial,
    },
    peer_group: {
      sub_industry: subIndustry,
      n_total: cohortIds.length,
      n_with_ad_data: cohortIds.filter((id) => adAt(id, period)).length,
      peers: cohort
        .filter((b) => b.brand_id !== clientId)
        .map((b) => ({ brand_id: b.brand_id, brand_name: b.brand_name, status: b.status })),
    },
    safeguards: {
      p1_p99_trim: { applied: true, note: `dormant di cohort < ${OUTLIER_TRIM_MIN_N} nilai — untuk data bulanan sub-industry praktis tidak pernah aktif` },
      exclude_history_lt_25_days: { applied: true, via: 'is_partial_month', note: 'baris client-month yang ditandai parsial (business-data atau platform-spend) di-exclude penuh dari agregat peer & scorecard' },
      exclude_tenure_lt_2_months: { applied: false, reason: 'join_date baru terisi 40/139 — belum diaktifkan (flag layer S1/S2 dulu)' },
      min_n_gate: { applied: false, note: 'sengaja tidak ada; N ditampilkan transparan' },
    },
    market_movement: {
      peer_median_growth: peerMed,
      peers_up: peersUp,
      peers_down: peersDown,
      peers_measured: peerGrowths.length,
      client_growth: clientGrowth,
      verdict,
    },
    distribution,
    efficiency_index: {
      per_metric: distribution.map((d) => ({ metric: d.metric, label: d.label, index: d.efficiency_index })),
      composite: compositeIndex,
      note: 'Index 100 = setara median peer. Untuk metrik "lower is better" (CPM/CPC/CPP/Ad Cost Ratio) arah dibalik supaya >100 selalu berarti lebih efisien. Composite = rata-rata geometrik index antar-metrik yang tersedia.',
    },
    cpm_trend,
  };
}

// =====================================================================
// S7 — Client Detail  &  Ranking
// =====================================================================
// Scorecard vs peer reuses the S5 peer-group logic (peerDistribution()).
// "Mulai kerja sama" is intentionally null/TBD — join_date does not exist
// yet and must NOT be proxied.

const AD_PLATFORMS_S7 = ['meta_nonboost', 'meta_boost', 'meta_cpas', 'iklanku_shopee', 'gmv_max_tiktok', 'google_ads'];

export async function getClientDetail(params) {
  const clientId = Number(params.client_id);
  const period = params.period;
  const compare = params.compare === 'yoy' ? 'yoy' : 'mom';

  const profile = await repo.getBrandProfile(clientId);
  if (!profile) throw new AppError('Client tidak ditemukan', 404);

  const comparePeriod = shiftMonth(period, compare === 'yoy' ? -12 : -1);
  const windowStart = shiftMonth(period, -(S1_CONFIG.trendWindowMonths - 1));
  const trendStartEff = comparePeriod < windowStart ? comparePeriod : windowStart;
  const months = [];
  for (let i = -(S1_CONFIG.trendWindowMonths - 1); i <= 0; i += 1) months.push(shiftMonth(period, i));

  // peer cohort (same sub_industry) for the scorecard
  const allBrands = await repo.listBrandsForOverview({ status: 'all', kategoriBesar: null });
  const subIndustry = profile.sub_industry || null;
  const cohortIds = subIndustry
    ? allBrands.filter((b) => b.sub_industry === subIndustry).map((b) => b.brand_id)
    : [clientId];

  const [revRows, adRows, platRows] = await Promise.all([
    repo.monthlyRevenueByBrand(cohortIds, trendStartEff, period),
    repo.monthlyAdTotalsByBrand(cohortIds, trendStartEff, period),
    repo.platformMetricsGrid([clientId], period, period),
  ]);

  const revBy = new Map();
  const targetBy = new Map();
  const partialBy = new Set();
  for (const r of revRows) {
    if (r.revenue != null) revBy.set(`${r.brand_id}|${r.period}`, Number(r.revenue));
    if (r.target_sales != null) targetBy.set(`${r.brand_id}|${r.period}`, Number(r.target_sales));
    if (r.is_partial_month) partialBy.add(`${r.brand_id}|${r.period}`);
  }
  const adBy = new Map();
  for (const r of adRows) {
    adBy.set(`${r.brand_id}|${r.period}`, adRowObj(r));
    if (r.any_partial_spend) partialBy.add(`${r.brand_id}|${r.period}`);
  }
  const isPartial = (id, p) => partialBy.has(`${id}|${p}`);
  // Raw accessors — trend / headline / funnel show partial data normally
  // (user: "Data mentahnya sendiri tetap tampil normal di S7").
  const revAt = (id, p) => (revBy.has(`${id}|${p}`) ? revBy.get(`${id}|${p}`) : null);
  const adAt = (id, p) => adBy.get(`${id}|${p}`) || null;
  // Scorecard-only: exclude partial client-months from the peer comparison.
  const metricsForScorecard = (id, p) => (isPartial(id, p) ? null : adMetrics(revAt(id, p), adAt(id, p)));

  // --- 13-month trend for this client ---
  const trend = months.map((mo) => {
    const rev = revAt(clientId, mo);
    const ad = adAt(clientId, mo);
    const spend = ad ? ad.spend : null;
    return {
      period: mo,
      revenue: rev,
      spend,
      roas: rev != null && spend != null && spend > 0 ? rev / spend : null,
      is_partial_month: isPartial(clientId, mo),
    };
  });

  // --- scorecard vs peer (compact S5) ---
  const scorecard = subIndustry
    ? {
      sub_industry: subIndustry,
      peer_n_total: cohortIds.length,
      peer_n_with_data: cohortIds.filter((id) => metricsForScorecard(id, period)).length,
      client_period_partial: isPartial(clientId, period),
      ...peerDistribution(cohortIds, clientId, (id) => metricsForScorecard(id, period)),
    }
    : { sub_industry: null, note: 'Client belum punya sub-industry — scorecard vs peer tidak tersedia.' };

  // --- funnel (aggregate from client_platform_spend_monthly for `period`) ---
  const cAd = adAt(clientId, period);
  const funnel = cAd
    ? (() => {
      const stages = [
        { key: 'impressions', label: 'Impression', value: cAd.impressions },
        { key: 'link_clicks', label: 'Link Click', value: cAd.link_clicks },
        { key: 'view_content', label: 'View Content', value: cAd.view_content },
        { key: 'atc', label: 'Add to Cart', value: cAd.atc },
        { key: 'purchase', label: 'Purchase', value: cAd.purchase },
      ];
      return stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        return {
          ...s,
          conv_from_prev: s.value != null && prev != null && prev > 0 ? s.value / prev : null,
        };
      });
    })()
    : null;

  // --- spend allocation per platform (this client, this period) ---
  const platByName = new Map(platRows.map((r) => [r.platform, r]));
  const totalSpend = platRows.reduce((a, r) => a + Number(r.amount_spent || 0), 0);
  const spend_allocation = AD_PLATFORMS_S7
    .map((pl) => {
      const r = platByName.get(pl);
      if (!r) return null;
      const spend = Number(r.amount_spent || 0);
      const pv = r.purchase_value == null ? null : Number(r.purchase_value);
      return {
        platform: pl,
        spend,
        share_pct: totalSpend > 0 ? spend / totalSpend : null,
        purchase_value: pv,
        platform_attributed_roas: pv != null && spend > 0 ? pv / spend : null,
      };
    })
    .filter(Boolean);

  const revNow = revAt(clientId, period);
  const revPrior = revAt(clientId, comparePeriod);
  const spendNow = cAd ? cAd.spend : null;

  return {
    period,
    compare_period: comparePeriod,
    profile: {
      brand_id: profile.brand_id,
      brand_name: profile.brand_name,
      status: profile.status,
      industry: profile.industry,
      sub_industry: profile.sub_industry,
      kategori_besar: profile.kategori_besar,
      bm_id: profile.bm_id,
      pic: profile.pic,
      ad_account_count: profile.ad_account_count,
      join_date: null,
      join_date_status: 'TBD', // join_date belum ada — jangan di-proxy
      data_review_note: profile.migration_review_note,
    },
    headline: {
      revenue: revNow,
      revenue_delta_pct: revNow != null && revPrior != null && revPrior > 0 ? revNow / revPrior - 1 : null,
      spend: spendNow,
      blended_roas: revNow != null && spendNow != null && spendNow > 0 ? revNow / spendNow : null,
      vs_target_pct: (() => {
        const t = targetBy.get(`${clientId}|${period}`);
        return revNow != null && t != null && t > 0 ? revNow / t - 1 : null;
      })(),
    },
    trend,
    scorecard,
    funnel,
    funnel_note: 'Dihitung agregat dari client_platform_spend_monthly (semua platform digabung). Stage dengan input kosong tampil null, bukan 0.',
    spend_allocation,
  };
}

const RANKING_METRICS = {
  revenue: { label: 'Revenue', dir: 'desc', source: 'rev' },
  spend: { label: 'Ad Spend', dir: 'desc', source: 'ad' },
  blended_roas: { label: 'Blended ROAS', dir: 'desc', source: 'metric' },
  growth: { label: 'Growth', dir: 'desc', source: 'growth' },
  cpp: { label: 'Cost per Purchase', dir: 'asc', source: 'metric' },
  ad_cost_ratio: { label: 'Ad Cost Ratio', dir: 'asc', source: 'metric' },
};

export async function getClientRanking(params) {
  const period = params.period;
  const compare = params.compare === 'yoy' ? 'yoy' : 'mom';
  const metricKey = RANKING_METRICS[params.metric] ? params.metric : 'revenue';
  const metricCfg = RANKING_METRICS[metricKey];
  const status = params.status || 'active';
  const category = params.category || 'all';
  const kategoriBesar = category === 'all' ? null : (CATEGORY_MAP[category] ?? null);

  const brands = await repo.listBrandsForOverview({ status, kategoriBesar });
  const brandIds = brands.map((b) => b.brand_id);
  const brandById = new Map(brands.map((b) => [b.brand_id, b]));

  const comparePeriod = shiftMonth(period, compare === 'yoy' ? -12 : -1);
  const [revRows, adRows] = await Promise.all([
    repo.monthlyRevenueByBrand(brandIds, comparePeriod, period),
    repo.monthlyAdTotalsByBrand(brandIds, comparePeriod, period),
  ]);
  const revBy = new Map();
  for (const r of revRows) if (r.revenue != null) revBy.set(`${r.brand_id}|${r.period}`, Number(r.revenue));
  const adBy = new Map();
  for (const r of adRows) adBy.set(`${r.brand_id}|${r.period}`, adRowObj(r));
  const revAt = (id, p) => (revBy.has(`${id}|${p}`) ? revBy.get(`${id}|${p}`) : null);
  const adAt = (id, p) => adBy.get(`${id}|${p}`) || null;

  const rows = brandIds.map((id) => {
    const rev = revAt(id, period);
    const ad = adAt(id, period);
    const m = adMetrics(rev, ad);
    const priorRev = revAt(id, comparePeriod);
    let value = null;
    if (metricCfg.source === 'rev') value = rev;
    else if (metricCfg.source === 'ad') value = ad ? ad.spend : null;
    else if (metricCfg.source === 'growth') value = rev != null && priorRev != null && priorRev > 0 ? rev / priorRev - 1 : null;
    else value = m?.[metricKey] ?? null;
    const b = brandById.get(id);
    return {
      brand_id: id,
      brand_name: b.brand_name,
      sub_industry: b.sub_industry,
      kategori_besar: b.kategori_besar,
      value,
      revenue: rev,
      spend: ad ? ad.spend : null,
      blended_roas: m?.blended_roas ?? null,
    };
  });

  const withVal = rows.filter((r) => r.value != null);
  const noVal = rows.filter((r) => r.value == null);
  withVal.sort((a, b) => (metricCfg.dir === 'asc' ? a.value - b.value : b.value - a.value));

  return {
    period,
    compare_period: comparePeriod,
    filters: { compare, metric: metricKey, status, category },
    metric: { key: metricKey, label: metricCfg.label, direction: metricCfg.dir, lower_better: metricCfg.dir === 'asc' },
    available_metrics: Object.entries(RANKING_METRICS).map(([k, v]) => ({ key: k, label: v.label })),
    ranked: withVal.map((r, i) => ({ rank: i + 1, ...r })),
    no_data: noVal.map((r) => ({ brand_id: r.brand_id, brand_name: r.brand_name, sub_industry: r.sub_industry })),
  };
}

// =====================================================================
// S8 — Data Quality
// =====================================================================

const SALES_CHANNEL_ALL = ['shopee', 'tiktok_shop', 'website', 'offline'];
// A channel-sales total within this fraction of revenue counts as reconciled.
const RECON_TOLERANCE = 0.005;

export async function getDataQuality(params) {
  const period = params.period;

  const [snapshot, csc, unmappedAcc, recon, log] = await Promise.all([
    repo.dataQualitySnapshot(period),
    repo.allClientSalesChannels(),
    repo.metaSpendAdAccountGaps(),
    repo.channelReconciliation(period),
    repo.listIngestionLog({ limit: 40 }),
  ]);

  // csc lookup: brandId -> { channel -> {is_used, source} }
  const cscByBrand = new Map();
  for (const r of csc) {
    if (!cscByBrand.has(r.brand_id)) cscByBrand.set(r.brand_id, new Map());
    cscByBrand.get(r.brand_id).set(r.channel, { is_used: r.is_used, source: r.source });
  }

  // --- 1. Matriks Kelengkapan Data --------------------------------
  const clients = snapshot.map((s) => {
    const cscMap = cscByBrand.get(s.brand_id) || new Map();
    const channels = SALES_CHANNEL_ALL.map((ch) => {
      const flag = cscMap.get(ch);
      // has channel-level data this period? (only client_channel_sales_monthly
      // carries canonical channels; "other" is separate)
      return {
        channel: ch,
        is_used: flag ? flag.is_used : null, // true / false / null(=belum dinilai)
        source: flag ? flag.source : null,
      };
    });
    return {
      brand_id: s.brand_id,
      brand_name: s.brand_name,
      status: s.status,
      kategori_besar: s.kategori_besar,
      join_date: s.join_date,
      has_monthly_metrics: s.has_monthly_metrics,
      has_channel_sales: s.has_channel_sales,
      has_platform_spend: s.has_platform_spend,
      revenue: s.revenue == null ? null : Number(s.revenue),
      channel_sales_total: Number(s.channel_sales_total),
      platform_spend_total: Number(s.platform_spend_total),
      channels,
    };
  });

  const active = clients.filter((c) => c.status === 'active');
  const completeness_matrix = {
    clients,
    summary: {
      total_migrated: clients.length,
      active: active.length,
      active_with_monthly_metrics: active.filter((c) => c.has_monthly_metrics).length,
      active_with_channel_sales: active.filter((c) => c.has_channel_sales).length,
      active_with_platform_spend: active.filter((c) => c.has_platform_spend).length,
      active_with_all_three: active.filter((c) => c.has_monthly_metrics && c.has_channel_sales && c.has_platform_spend).length,
      channels_assessed: csc.length, // client_sales_channels rows
    },
    note: 'is_used null = channel belum dinilai (belum ada di client_sales_channels), bukan "tidak dipakai".',
  };

  // --- 2. Ad account belum ter-mapping (2 tier) ------------------
  const accRow = (r) => ({
    brand_id: r.brand_id, brand_name: r.brand_name, bm_id: r.bm_id,
    meta_spend_total: Number(r.meta_spend_total), months: Number(r.months),
  });
  const ad_accounts_unmapped = {
    hard: unmappedAcc.filter((r) => r.hard).map(accRow),
    soft: unmappedAcc.filter((r) => !r.hard).map(accRow),
    note: 'HARD = punya spend Meta tapi bm_id kosong → spend tidak terikat ke Business Manager mana pun. SOFT = bm_id ada tapi 0 baris brand_ad_accounts → daftar akun iklan belum diisi (semua client sekarang; sheet cuma punya angka "# Ad account", bukan act_ ID). brand_ad_accounts akan diisi dari input manual / CONFIG.ACCOUNTS proyek automation.',
  };

  // --- 3. Campaign belum terklasifikasi -------------------------
  const campaign_classification = {
    available: false,
    note: 'Belum ada data campaign-level di skema. client_platform_spend_monthly menyimpan agregat per-platform yang sudah diklasifikasi manual saat input (Boost/Non-boost/CPAS). Komponen ini baru relevan setelah ada import campaign export / integrasi Meta API.',
  };

  // --- 4. Selisih rekonsiliasi ---------------------------------
  const channel_sales_vs_revenue = recon
    .map((r) => {
      const revenue = r.revenue == null ? null : Number(r.revenue);
      const channelTotal = Number(r.channel_total);
      const channelRows = Number(r.channel_rows);
      if (channelRows === 0) return { brand_id: r.brand_id, brand_name: r.brand_name, revenue, channel_total: null, diff: null, diff_pct: null, status: 'no_channel_data' };
      const diff = channelTotal - (revenue ?? 0);
      const diffPct = revenue && revenue > 0 ? diff / revenue : null;
      const ok = revenue != null && Math.abs(diffPct ?? 1) <= RECON_TOLERANCE;
      return {
        brand_id: r.brand_id, brand_name: r.brand_name,
        revenue, channel_total: channelTotal, diff, diff_pct: diffPct,
        status: ok ? 'reconciled' : 'mismatch',
      };
    })
    .sort((a, b) => Math.abs(b.diff_pct ?? 0) - Math.abs(a.diff_pct ?? 0));

  const reconciliation = {
    channel_sales_vs_revenue,
    spend: {
      available: false,
      note: 'Rekonsiliasi spend butuh total spend referensi independen (mis. dari sheet daily tracking) yang belum ada di ATLAS. Untuk sekarang hanya cek: baris platform spend ada tapi jumlah 0, atau spend > revenue.',
      anomalies: clients
        .filter((c) => c.has_platform_spend && (c.platform_spend_total === 0 || (c.revenue != null && c.platform_spend_total > c.revenue)))
        .map((c) => ({
          brand_id: c.brand_id, brand_name: c.brand_name,
          platform_spend_total: c.platform_spend_total, revenue: c.revenue,
          issue: c.platform_spend_total === 0 ? 'spend rows exist but sum to 0' : 'spend exceeds revenue (ROAS < 1)',
        })),
    },
  };

  return {
    period,
    completeness_matrix,
    ad_accounts_unmapped,
    campaign_classification,
    reconciliation,
    ingestion_log: log,
  };
}
