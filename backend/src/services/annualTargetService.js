import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';

// A brand's annual sales target and ad budget (migration 050).
//
// Set in Brand Setting, split across the 12 months in Brand Tracking. The
// monthly amounts are brand_tracking_targets rows (migration 046), so each
// month keeps its achievement, projection and channel allocation exactly as
// before; this service keeps them adding up to the year's current totals.
//
// The first figures are version 1, the original target. An update never
// overwrites it: it adds the next version, applied one of two ways the person
// picks when saving:
//   'even'      — the new totals split evenly over all 12 months;
//   'remaining' — months already over keep their targets (their achievement
//                 is history); the difference goes to the running month and
//                 the ones after it, in proportion to what each already held.
//
// An even split can also be a correction, for a target awal entered wrong
// (say a month's figure typed in as the year's): it becomes the baseline the
// current target is read against; the wrong figures stay in the history,
// marked as replaced.

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const pad = (n) => String(n).padStart(2, '0');
const monthStart = (year, m) => `${year}-${pad(m)}-01`;
const toInt = (v) => (v == null || v === '' ? null : Math.round(Number(v)));

// The month 'remaining' starts from: the running month (Jakarta time) in the
// running year, January in a later year; a past year has none left.
function runningMonth(year, now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit' })
    .format(now).split('-').map(Number);
  if (year > y) return 1;
  if (year < y) return null;
  return m;
}

async function assertBrand(db, brandId) {
  const { rows } = await db.query('SELECT 1 FROM brands WHERE brand_id = $1', [brandId]);
  if (!rows.length) throw new AppError('Brand tidak ditemukan', 404);
}

// Equal shares that add up exactly: whole rupiah, the last month takes the rounding.
function splitEqual(total, count) {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - base * (count - 1) : base));
}

// Shares in proportion to `weights`, adding up exactly to `total`; equal when
// every weight is zero.
function splitByWeight(total, weights) {
  const sum = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  if (!sum) return splitEqual(total, weights.length);
  const out = weights.map((w) => Math.floor((total * Math.max(w, 0)) / sum));
  out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
  return out;
}

export const __test = { splitEqual, splitByWeight, runningMonth };

async function readMonths(db, brandId, year) {
  const { rows } = await db.query(
    `SELECT EXTRACT(MONTH FROM month)::int AS m, target_sales, target_spend
       FROM brand_tracking_targets
      WHERE brand_id = $1 AND month BETWEEN $2 AND $3`,
    [brandId, monthStart(year, 1), monthStart(year, 12)],
  );
  const byMonth = new Map(rows.map((r) => [r.m, r]));
  return MONTHS.map((m) => ({
    m,
    sales: toInt(byMonth.get(m)?.target_sales) ?? 0,
    spend: toInt(byMonth.get(m)?.target_spend) ?? 0,
  }));
}

// One month's sales/spend target, leaving its channel allocation and notes
// as they are. `spend === undefined` leaves the month's budget untouched.
async function writeMonth(db, { brandId, year, m, sales, spend, userId }) {
  await db.query(
    `INSERT INTO brand_tracking_targets (brand_id, month, target_sales, target_spend, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (brand_id, month) DO UPDATE SET
       target_sales = EXCLUDED.target_sales,
       target_spend = CASE WHEN $6 THEN EXCLUDED.target_spend ELSE brand_tracking_targets.target_spend END,
       updated_by   = EXCLUDED.updated_by,
       updated_at   = now()`,
    [brandId, monthStart(year, m), sales, spend ?? null, userId, spend !== undefined],
  );
}

const shapeAnnual = (r) => (r ? {
  targetSales: toInt(r.target_sales),
  targetSpend: toInt(r.target_spend),
  updatedAt: r.updated_at,
  updatedByName: r.updated_by_name ?? null,
} : null);

export async function getAnnualTargets(brandId, year) {
  await assertBrand(pool, brandId);
  const [{ rows: [annual] }, { rows: revisions }, months, { rows: sales }, { rows: spend }] = await Promise.all([
    pool.query(
      `SELECT a.*, u.full_name AS updated_by_name FROM brand_annual_targets a
         LEFT JOIN users u ON u.user_id = a.updated_by
        WHERE a.brand_id = $1 AND a.year = $2`,
      [brandId, year],
    ),
    pool.query(
      `SELECT r.version, r.kind, r.target_sales, r.target_spend, to_char(r.effective_month, 'YYYY-MM') AS effective_month,
              r.note, r.created_at, u.full_name AS created_by_name
         FROM brand_annual_target_revisions r
         LEFT JOIN users u ON u.user_id = r.created_by
        WHERE r.brand_id = $1 AND r.year = $2
        ORDER BY r.version`,
      [brandId, year],
    ),
    readMonths(pool, brandId, year),
    pool.query(
      `SELECT EXTRACT(MONTH FROM entry_date)::int AS m, SUM(revenue) AS v FROM daily_channel_sales
        WHERE brand_id = $1 AND entry_date BETWEEN $2 AND $3 GROUP BY 1`,
      [brandId, `${year}-01-01`, `${year}-12-31`],
    ),
    pool.query(
      `SELECT EXTRACT(MONTH FROM entry_date)::int AS m, SUM(amount_spent) AS v FROM daily_channel_spend
        WHERE brand_id = $1 AND entry_date BETWEEN $2 AND $3 GROUP BY 1`,
      [brandId, `${year}-01-01`, `${year}-12-31`],
    ),
  ]);
  const realSales = new Map(sales.map((r) => [r.m, Number(r.v)]));
  const realSpend = new Map(spend.map((r) => [r.m, Number(r.v)]));
  const versions = revisions.map((r) => ({
    version: r.version,
    kind: r.kind,
    targetSales: toInt(r.target_sales),
    targetSpend: toInt(r.target_spend),
    effectiveMonth: r.effective_month,
    note: r.note,
    createdAt: r.created_at,
    createdByName: r.created_by_name,
  }));
  // The baseline: the latest correction, or the original when there is none.
  const baseline = [...versions].reverse().find((v) => v.kind !== 'revision') ?? null;
  return {
    year,
    annual: shapeAnnual(annual),
    original: baseline,
    corrected: baseline?.kind === 'correction',
    updates: baseline ? versions.filter((v) => v.version > baseline.version).length : 0,
    revisions: versions.map((v) => ({ ...v, superseded: Boolean(baseline && v.version < baseline.version) })),
    months: months.map(({ m, sales: s, spend: p }) => ({
      month: `${year}-${pad(m)}`,
      targetSales: annual ? s : null,
      targetSpend: annual && annual.target_spend != null ? p : null,
      actualSales: realSales.get(m) ?? null,
      actualSpend: realSpend.get(m) ?? null,
    })),
  };
}

// The year's totals — the first time (version 1, split evenly over the 12
// months) or an update (the next version, `split` 'even' or 'remaining';
// `correction` with 'even' makes it the new baseline).
export async function setAnnualTarget({ brandId, year, targetSales, targetSpend, note, split = 'remaining', correction = false, userId }) {
  const sales = toInt(targetSales);
  const spend = toInt(targetSpend);
  if (sales == null || sales <= 0) throw new AppError('Target sales tahunan wajib diisi dan lebih dari 0', 400);
  if (spend != null && spend < 0) throw new AppError('Budget iklan tidak boleh negatif', 400);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertBrand(client, brandId);
    const { rows: [current] } = await client.query(
      'SELECT * FROM brand_annual_targets WHERE brand_id = $1 AND year = $2 FOR UPDATE',
      [brandId, year],
    );

    if (!current) {
      const salesSplit = splitEqual(sales, 12);
      const spendSplit = spend != null ? splitEqual(spend, 12) : null;
      for (const m of MONTHS) {
        await writeMonth(client, { brandId, year, m, sales: salesSplit[m - 1], spend: spendSplit ? spendSplit[m - 1] : undefined, userId });
      }
      await client.query(
        `INSERT INTO brand_annual_targets (brand_id, year, target_sales, target_spend, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [brandId, year, sales, spend, userId],
      );
      await client.query(
        `INSERT INTO brand_annual_target_revisions (brand_id, year, version, kind, target_sales, target_spend, effective_month, note, created_by)
         VALUES ($1, $2, 1, 'original', $3, $4, $5, $6, $7)`,
        [brandId, year, sales, spend, monthStart(year, 1), note?.trim() || null, userId],
      );
    } else {
      const evenSplit = split === 'even';
      if (correction && !evenSplit) throw new AppError('Koreksi target awal selalu membagi ulang 12 bulan', 400);
      const eff = evenSplit ? 1 : runningMonth(year);
      if (eff == null) throw new AppError(`Semua bulan ${year} sudah lewat — pilih bagi rata 12 bulan`, 400);
      const months = await readMonths(client, brandId, year);
      const plan = (key, total) => {
        if (evenSplit) return new Map(splitEqual(total, 12).map((v, i) => [i + 1, v]));
        const past = months.filter((x) => x.m < eff);
        const rest = months.filter((x) => x.m >= eff);
        const pastSum = past.reduce((a, x) => a + x[key], 0);
        const remainder = total - pastSum;
        if (remainder < 0) {
          const what = key === 'sales' ? 'Target sales' : 'Budget iklan';
          throw new AppError(`${what} baru (Rp${total.toLocaleString('id-ID')}) lebih kecil dari total bulan yang sudah lewat (Rp${pastSum.toLocaleString('id-ID')}). Pilih bagi rata 12 bulan atau naikkan angkanya.`, 400);
        }
        const shares = splitByWeight(remainder, rest.map((x) => x[key]));
        return new Map([...past.map((x) => [x.m, x[key]]), ...rest.map((x, i) => [x.m, shares[i]])]);
      };
      const salesPlan = plan('sales', sales);
      // A budget first given in an update follows whatever monthly budgets
      // already exist, or an even split when there are none.
      const spendPlan = spend != null ? plan('spend', spend) : null;
      for (const m of MONTHS) {
        await writeMonth(client, { brandId, year, m, sales: salesPlan.get(m), spend: spendPlan ? spendPlan.get(m) : undefined, userId });
      }
      await client.query(
        `UPDATE brand_annual_targets SET target_sales = $3, target_spend = $4, updated_by = $5, updated_at = now()
          WHERE brand_id = $1 AND year = $2`,
        [brandId, year, sales, spend, userId],
      );
      await client.query(
        `INSERT INTO brand_annual_target_revisions (brand_id, year, version, kind, target_sales, target_spend, effective_month, note, created_by)
         SELECT $1, $2, COALESCE(MAX(version), 0) + 1, $8, $3, $4, $5, $6, $7
           FROM brand_annual_target_revisions WHERE brand_id = $1 AND year = $2`,
        [brandId, year, sales, spend, monthStart(year, eff), note?.trim() || null, userId, correction ? 'correction' : 'revision'],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getAnnualTargets(brandId, year);
}

// Brand Tracking's own split of the year: any distribution, as long as the
// 12 months add up to exactly the year's totals.
export async function saveAnnualSplit({ brandId, year, months, userId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertBrand(client, brandId);
    const { rows: [annual] } = await client.query(
      'SELECT * FROM brand_annual_targets WHERE brand_id = $1 AND year = $2 FOR UPDATE',
      [brandId, year],
    );
    if (!annual) throw new AppError(`Belum ada target tahunan ${year} — isi dulu di Brand Setting`, 400);
    const byMonth = new Map((Array.isArray(months) ? months : []).map((x) => [Number(String(x.month).slice(5, 7)), x]));
    if (MONTHS.some((m) => !byMonth.has(m))) throw new AppError('Pembagian harus berisi 12 bulan', 400);
    const totalSales = toInt(annual.target_sales);
    const totalSpend = toInt(annual.target_spend);
    const check = (key, total, label) => {
      const values = MONTHS.map((m) => toInt(byMonth.get(m)[key]) ?? 0);
      if (values.some((v) => v < 0)) throw new AppError(`${label} per bulan tidak boleh negatif`, 400);
      const sum = values.reduce((a, b) => a + b, 0);
      if (sum !== total) {
        throw new AppError(`Total ${label.toLowerCase()} 12 bulan harus tepat 100% (Rp${total.toLocaleString('id-ID')}); sekarang Rp${sum.toLocaleString('id-ID')}`, 400);
      }
      return values;
    };
    const salesValues = check('targetSales', totalSales, 'Target sales');
    const spendValues = totalSpend != null ? check('targetSpend', totalSpend, 'Budget iklan') : null;
    for (const m of MONTHS) {
      await writeMonth(client, { brandId, year, m, sales: salesValues[m - 1], spend: spendValues ? spendValues[m - 1] : undefined, userId });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return getAnnualTargets(brandId, year);
}

// Whether a month's sales/spend targets come from an annual plan (then the
// monthly form leaves them alone). False before migration 050 runs.
export async function isAnnualManaged(brandId, year) {
  try {
    const { rows } = await pool.query('SELECT target_spend FROM brand_annual_targets WHERE brand_id = $1 AND year = $2', [brandId, year]);
    if (!rows.length) return { sales: false, spend: false };
    return { sales: true, spend: rows[0].target_spend != null };
  } catch (err) {
    if (err.code === '42P01') return { sales: false, spend: false };
    throw err;
  }
}
