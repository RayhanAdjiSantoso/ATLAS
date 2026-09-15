import pool from '../config/db.js';
import { LIBRARY_CHANNELS, REFERENCE_CHANNELS } from './brandLibraryService.js';
import { openTasksOf } from '../utils/momTasks.js';
import { currentMonth, daysBetween, monthBounds, shiftMonth, todayJakarta } from '../utils/monthPeriod.js';

// Pusat Kendali: cross-brand readings that no single brand page can give —
// which brands are missing data this month, and which agreed follow-ups have
// been left open. Admin-only (see controlCenterRoutes), because every answer
// here spans every client.

/* ── Data completeness ────────────────────────────────────────────────── */

// Channels imported into the shopee.* fact tables. A file that never made it
// in is stored but invisible to Business Overview — as serious as missing.
export const DASHBOARD_CHANNELS = new Set(['order', 'performance_overview', 'product_performance']);
export const HISTORY_MONTHS = 2;
export const OVERDUE_DAYS = 7;

const PLATFORM_ORDER = Object.keys(LIBRARY_CHANNELS);
const channelRank = (platform, channel) => PLATFORM_ORDER.indexOf(platform) * 100 + (LIBRARY_CHANNELS[platform]?.indexOf(channel) ?? 99);

// How many days of the month should already be covered. Exports are pulled
// the day after, so the current month expects coverage through yesterday;
// a future month expects nothing yet.
export function expectedDaysFor(month, today = todayJakarta()) {
  const { days } = monthBounds(month);
  const now = today.slice(0, 7);
  if (month < now) return days;
  if (month > now) return 0;
  return Math.max(0, Number(today.slice(8, 10)) - 1);
}

// What one expected dataset looks like for the month. "Expected" is learnt
// from the brand's own recent history (see getDataCompleteness): ATLAS has no
// list of which exports each brand is supposed to send, and guessing one
// would flag every brand for platforms it doesn't use.
export function datasetState(parts, { days, expectedDays }) {
  if (!parts.length) return { state: expectedDays > 0 ? 'missing' : 'upcoming', coveredDays: 0, missingDays: expectedDays };
  if (parts.some((p) => DASHBOARD_CHANNELS.has(p.channel) && p.import_status !== 'success' && !p.dashboard_upload_id)) {
    return { state: 'failed', coveredDays: null, missingDays: null };
  }
  if (parts.some((p) => p.period_source === 'mismatch')) return { state: 'mismatch', coveredDays: null, missingDays: null };
  const dated = parts.filter((p) => p.day_bitmap);
  // A monthly snapshot export has no per-day dates; its presence is the whole signal.
  if (!dated.length) return { state: 'complete', snapshot: true, coveredDays: null, missingDays: 0 };
  const bits = new Array(days).fill(false);
  for (const part of dated) [...part.day_bitmap].slice(0, days).forEach((c, i) => { if (c === '1') bits[i] = true; });
  const coveredDays = bits.filter(Boolean).length;
  const missingDays = bits.slice(0, expectedDays).filter((b) => !b).length;
  return { state: missingDays > 0 ? 'partial' : 'complete', coveredDays, missingDays };
}

const SEVERITY = { failed: 3, mismatch: 3, missing: 3, partial: 2, complete: 0, upcoming: 0 };

export function brandStatusFrom(datasets) {
  if (!datasets.length) return 'idle';
  const worst = Math.max(...datasets.map((d) => SEVERITY[d.state] ?? 0));
  return worst >= 3 ? 'attention' : worst === 2 ? 'partial' : 'complete';
}

export function buildCompleteness({ month, brands, files, today = todayJakarta() }) {
  const { days } = monthBounds(month);
  const expectedDays = expectedDaysFor(month, today);
  const byBrand = new Map(brands.map((b) => [b.brand_id, []]));
  for (const f of files) if (byBrand.has(f.brand_id) && !REFERENCE_CHANNELS.has(f.channel)) byBrand.get(f.brand_id).push(f);

  const out = brands.map((brand) => {
    const brandFiles = byBrand.get(brand.brand_id);
    const keys = [...new Set(brandFiles.map((f) => `${f.platform}:${f.channel}`))];
    const datasets = keys.map((key) => {
      const [platform, channel] = key.split(':');
      const all = brandFiles.filter((f) => f.platform === platform && f.channel === channel);
      const parts = all.filter((f) => f.month === month);
      const history = all.filter((f) => f.month < month).map((f) => f.month).sort();
      return {
        platform, channel, parts: parts.length,
        lastMonthWithData: parts.length ? month : history[history.length - 1] ?? null,
        lastUploadAt: parts.map((p) => p.uploaded_at).sort().pop() ?? null,
        ...datasetState(parts, { days, expectedDays }),
      };
    }).sort((a, b) => channelRank(a.platform, a.channel) - channelRank(b.platform, b.channel));
    return { brand_id: brand.brand_id, brand_name: brand.brand_name, brand_status: brand.status, status: brandStatusFrom(datasets), datasets };
  });

  const order = { attention: 0, partial: 1, complete: 2, idle: 3 };
  out.sort((a, b) => order[a.status] - order[b.status] || a.brand_name.localeCompare(b.brand_name));
  const count = (status) => out.filter((b) => b.status === status).length;
  const allDatasets = out.flatMap((b) => b.datasets);
  return {
    month, days, expectedDays, historyMonths: HISTORY_MONTHS,
    totals: {
      brands: out.length, attention: count('attention'), partial: count('partial'), complete: count('complete'), idle: count('idle'),
      missing: allDatasets.filter((d) => d.state === 'missing').length,
      failed: allDatasets.filter((d) => d.state === 'failed').length,
      mismatch: allDatasets.filter((d) => d.state === 'mismatch').length,
    },
    brands: out,
  };
}

export async function getDataCompleteness({ month, scope = 'active' }) {
  const [brandsRes, filesRes] = await Promise.all([
    pool.query(
      `SELECT brand_id, brand_name, status::text AS status FROM public.brands
       WHERE ($1::text = 'all' OR status = 'active') ORDER BY brand_name`,
      [scope],
    ),
    // Bytes excluded: this reads only the metadata the library already keeps.
    pool.query(
      `SELECT f.brand_id, f.platform::text AS platform, f.channel, to_char(f.period_month, 'YYYY-MM') AS month,
              f.day_bitmap, f.covered_days, f.period_source, f.import_status, f.dashboard_upload_id,
              f.uploaded_at
       FROM ads_reports.brand_library_files f
       WHERE f.period_month BETWEEN $1::date AND $2::date`,
      [`${shiftMonth(month, -HISTORY_MONTHS)}-01`, `${month}-01`],
    ),
  ]);
  return buildCompleteness({ month, brands: brandsRes.rows, files: filesRes.rows });
}

/* ── Open MOM tasks ───────────────────────────────────────────────────── */

export async function listMinutesWithTasks() {
  const { rows } = await pool.query(
    `SELECT m.id, m.brand_id, b.brand_name, b.status::text AS brand_status,
            m.meeting_date::text AS meeting_date, m.meeting_type,
            m.todo_mil, m.todo_client, m.completed_task_keys
     FROM public.brand_minutes m
     JOIN public.brands b ON b.brand_id = m.brand_id
     WHERE coalesce(m.todo_mil, '') <> '' OR coalesce(m.todo_client, '') <> ''
     ORDER BY m.meeting_date DESC, m.id DESC`,
  );
  return rows;
}

export function countOpenTasks(minutes, { today = todayJakarta(), overdueDays = OVERDUE_DAYS } = {}) {
  let open = 0;
  let overdue = 0;
  for (const minute of minutes) {
    const tasks = openTasksOf(minute).length;
    open += tasks;
    if (daysBetween(minute.meeting_date, today) > overdueDays) overdue += tasks;
  }
  return { open, overdue };
}

/* ── Sidebar summary ──────────────────────────────────────────────────── */

export async function getSummary() {
  const [minutes, completeness] = await Promise.all([
    listMinutesWithTasks(),
    getDataCompleteness({ month: currentMonth() }),
  ]);
  const tasks = countOpenTasks(minutes);
  return {
    month: completeness.month,
    openTasks: tasks.open,
    overdueTasks: tasks.overdue,
    dataAttention: completeness.totals.attention,
    overdueDays: OVERDUE_DAYS,
  };
}
