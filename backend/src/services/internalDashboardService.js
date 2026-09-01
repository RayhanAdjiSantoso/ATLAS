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
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
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

  const kpi = {
    total_sales: { value: salesNow, compare: salesCmp, delta_pct: deltaPct(revAt) },
    total_spend: { value: spendNow, compare: spendCmp, delta_pct: compare === 'target' ? null : deltaPct(spendAt) },
    blended_roas: {
      value: roasNow,
      compare: roasCmp,
      delta_pct: roasNow != null && roasCmp != null && roasCmp !== 0 ? roasNow / roasCmp - 1 : null,
    },
    active_clients: { value: brands.filter((b) => b.status === 'active').length },
    clients_with_data: { value: brandIds.filter((id) => revAt(id, period) != null).length, of: brandIds.length },
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
    // Until join_date exists, "entered" mixes genuinely-new clients with
    // ones whose prior month simply hasn't been input yet (see plan flag).
    entered: cohort.entered.map((r) => withName(r, { current: r.current })),
    left: cohort.left.map((r) => withName(r, { prior: r.prior })),
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

  return {
    n_clients: ids.length,
    n_with_data: withRev.length,
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

  const [chanRows, platRows] = await Promise.all([
    repo.channelSalesGrid(brandIds, windowStart, period),
    repo.platformMetricsGrid(brandIds, windowStart, period),
  ]);

  const months = [];
  for (let i = -(S1_CONFIG.trendWindowMonths - 1); i <= 0; i += 1) months.push(shiftMonth(period, i));

  // --- sales channels ---------------------------------------------
  // chanSales[`${period}|${channel}`] = { total, brands:Set }
  const chanAgg = new Map();
  for (const r of chanRows) {
    if (r.sales == null) continue;
    const k = `${r.period}|${r.channel}`;
    if (!chanAgg.has(k)) chanAgg.set(k, { total: 0, brands: new Set() });
    const e = chanAgg.get(k);
    e.total += Number(r.sales);
    e.brands.add(r.brand_id);
  }
  const chanTotalAt = (p) => SALES_CHANNELS.reduce((sum, ch) => sum + (chanAgg.get(`${p}|${ch}`)?.total || 0), 0);
  const totalNow = chanTotalAt(period);
  const totalCmp = chanTotalAt(comparePeriod);

  const sales_channels = SALES_CHANNELS.map((ch) => {
    const now = chanAgg.get(`${period}|${ch}`);
    const cmp = chanAgg.get(`${comparePeriod}|${ch}`);
    const sales = now?.total ?? null;
    const cmpSales = cmp?.total ?? null;
    return {
      channel: ch,
      sales,
      share_pct: sales != null && totalNow > 0 ? sales / totalNow : null,
      delta_pct: sales != null && cmpSales != null && cmpSales > 0 ? sales / cmpSales - 1 : null,
      client_count: now?.brands.size ?? 0,
    };
  });

  // --- ad platforms ----------------------------------------------
  // platAgg[`${period}|${platform}`] = summed raw + brand set
  const platAgg = new Map();
  for (const r of platRows) {
    const k = `${r.period}|${r.platform}`;
    if (!platAgg.has(k)) {
      platAgg.set(k, { spend: 0, impressions: 0, link_clicks: 0, purchase: 0, purchase_value: 0, ig_profile_visit: 0, igpvHas: false, brands: new Set() });
    }
    const e = platAgg.get(k);
    e.spend += Number(r.amount_spent || 0);
    e.impressions += Number(r.impressions || 0);
    e.link_clicks += Number(r.link_clicks || 0);
    e.purchase += Number(r.purchase || 0);
    e.purchase_value += Number(r.purchase_value || 0);
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
      purchases: e.purchase,
      purchase_value: e.purchase_value,
      // purchase_value / spend — NOT "ROAS" (see header note)
      platform_attributed_roas: ratio(e.purchase_value, e.spend),
      cost_per_purchase: ratio(e.spend, e.purchase),
      cpm: e.impressions > 0 ? (e.spend / e.impressions) * 1000 : null,
      ctr: ratio(e.link_clicks, e.impressions),
      cpc: ratio(e.spend, e.link_clicks),
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
    for (const ch of SALES_CHANNELS) row[ch] = chanAgg.get(`${mo}|${ch}`)?.total ?? null;
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
    note: 'Efisiensi platform dihitung ulang dari kolom raw (spend/impressions/clicks/purchase). "platform_attributed_roas" = purchase_value / spend, bukan ROAS bisnis (revenue/spend ada di Executive Overview). Cakupan = client punya ≥1 bulan data channel/platform tsb dalam 13 bulan terakhir; client_sales_channels (§2.2) belum ada, jadi "tidak dipakai" vs "belum diinput" belum bisa dibedakan.',
    sales_channels,
    total_channel_sales: totalNow || null,
    portfolio_sales,
    ad_platforms,
    total_platform_spend: spendNow || null,
    channel_trend,
    spend_trend,
    client_coverage,
  };
}
