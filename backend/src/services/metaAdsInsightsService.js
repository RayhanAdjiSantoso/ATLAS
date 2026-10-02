import { randomUUID } from 'crypto';
import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
import * as brandService from './brandService.js';
import * as repo from '../repositories/metaAdsInsightsRepository.js';
import { callAppsScript } from './metaAutomationService.js';
import * as library from './brandLibraryService.js';
import { buildInsightsWorkbook } from './metaAdsLibraryExport.js';
import {
  metricCatalog, sanitizeExtraMetrics, requiredActionTypes, normalizeInsightRow,
} from '../config/metaAdsMetrics.js';
import { refreshInternalDashboard } from './internalDashboardSync/dailyTrackingSync.js';

const ACCOUNT_TYPES = ['MAIN', 'CPAS'];

async function assertBrand(brandId) {
  const brand = await brandService.getBrandById(brandId);
  if (!brand) throw new AppError('Client tidak ditemukan', 404);
  return brand;
}

function assertAccountType(accountType) {
  if (!ACCOUNT_TYPES.includes(accountType)) throw new AppError('accountType harus MAIN atau CPAS', 400);
}

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

// 'YYYY-MM' -> first/last day as 'YYYY-MM-DD'.
function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { startDate: `${month}-01`, endDate: `${month}-${String(last).padStart(2, '0')}` };
}

// The days a run fetched. Runs logged before daily fetching (migration 038)
// have no range and always covered their whole month.
function runRange(run) {
  const month = monthBounds(run.month.slice(0, 7));
  return { startDate: run.range_start ?? month.startDate, endDate: run.range_end ?? month.endDate };
}

// Longest custom range the Report Generator may ask for in one go — keeps the
// generated workbook well under Vercel's 4.5MB response cap.
const MAX_RANGE_DAYS = 93;
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// ---------------------------------------------------------------------
// UI-facing
// ---------------------------------------------------------------------
export async function getOverview(brandId) {
  await assertBrand(brandId);
  const [configs, months, runs] = await Promise.all([
    repo.listConfigs(brandId),
    repo.summariseMonths(brandId),
    repo.listRecentRuns(brandId),
  ]);
  const config = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t, { extraMetrics: [] }]));
  for (const c of configs) config[c.account_type] = { extraMetrics: sanitizeExtraMetrics(c.extra_metrics) };
  return {
    catalog: metricCatalog(),
    config,
    months: months.map((m) => ({
      accountType: m.account_type, month: m.month, rowCount: m.row_count, dayCount: m.day_count,
      campaignCount: m.campaign_count, amountSpent: Number(m.amount_spent), fetchedAt: m.fetched_at,
    })),
    runs: runs.map((r) => ({
      accountType: r.account_type, month: r.month, rangeStart: r.range_start, rangeEnd: r.range_end,
      trigger: r.trigger, status: r.status,
      rowCount: r.row_count, note: r.note, startedAt: r.started_at, finishedAt: r.finished_at,
    })),
  };
}

// Which Meta accounts of this ATLAS brand are registered under Meta Ads
// Automation › Brand & Langganan — i.e. brandList entries whose atlasBrandId
// is this brand. That registration IS the eligibility rule.
export async function listEligibleAccounts(brandId) {
  await assertBrand(brandId);
  const accounts = await callAppsScript('brandList', undefined, { deadline: Date.now() + 52000 });
  const mine = (accounts || []).filter((a) => Number(a.atlasBrandId) === Number(brandId));
  return ACCOUNT_TYPES.map((type) => ({
    accountType: type,
    registered: mine.some((a) => (a.type || 'MAIN').toUpperCase() === type),
  }));
}

export async function saveConfig({ brandId, accountType, extraMetrics, userId }) {
  await assertBrand(brandId);
  assertAccountType(accountType);
  const saved = await repo.upsertConfig({
    brandId, accountType, extraMetrics: sanitizeExtraMetrics(extraMetrics), userId,
  });
  return { accountType: saved.account_type, extraMetrics: saved.extra_metrics };
}

// Queues a background run in Apps Script for one month (the current month is
// fetched up to yesterday). It cannot be awaited here: a full
// month at age × gender × day grain outlives Vercel's 60s function limit, so
// Apps Script only enqueues (one-off trigger) and answers immediately; the
// run reports its own progress through the ingest endpoints below.
export async function requestFetch({ brandId, accountType, month }) {
  await assertBrand(brandId);
  assertAccountType(accountType);
  const eligible = (await listEligibleAccounts(brandId)).find((a) => a.accountType === accountType);
  if (!eligible?.registered) {
    throw new AppError(
      `Brand ini belum punya akun ${accountType} di Meta Ads Automation › Brand & Langganan`, 409,
    );
  }
  return callAppsScript(
    'metaAdsEnqueue',
    { atlasBrandId: brandId, type: accountType, month },
    { deadline: Date.now() + 52000 },
  );
}

// ---------------------------------------------------------------------
// Pengaturan Brand › Data & file library
//
// A fetched month is also filed in the brand's file library (Meta Ads for
// the MAIN account, CPAS for the CPAS account) as an Ads Manager-style
// .xlsx, because that library is what the Data & file grid and the Report
// Generator's "Pilih dari perpustakaan" read. The DB table stays the source
// of truth; the file is regenerated from it and can be rebuilt any time.
// ---------------------------------------------------------------------
const LIBRARY_CHANNEL = { MAIN: 'meta', CPAS: 'cpas' };
const AUTO_FILE_PREFIX = 'ATLAS-auto_';

const autoFilename = (brandName, accountType, month) => {
  const slug = String(brandName).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'brand';
  return `${AUTO_FILE_PREFIX}${LIBRARY_CHANNEL[accountType]}_${slug}_${month}.xlsx`;
};

async function findSlotParts(brandId, accountType, month) {
  const parts = await library.listSlotParts(brandId, 'meta', LIBRARY_CHANNEL[accountType], `${month}-01`);
  return {
    auto: parts.find((p) => p.original_filename.startsWith(AUTO_FILE_PREFIX)) ?? null,
    manual: parts.filter((p) => !p.original_filename.startsWith(AUTO_FILE_PREFIX)),
  };
}

// Files the month into the library. Never touches a file someone uploaded by
// hand: those cover the same days, so adding ours next to it would count the
// month twice, and replacing it would delete their upload.
export async function syncLibraryFile({ brandId, accountType, month, userId }) {
  const brand = await assertBrand(brandId);
  assertAccountType(accountType);
  const { startDate, endDate } = monthBounds(month);

  const { auto, manual } = await findSlotParts(brandId, accountType, month);
  if (manual.length) {
    throw new AppError(
      `Bulan ${month} sudah punya file manual di Data & file (${manual.map((p) => p.original_filename).join(', ')}). `
      + 'Hapus file itu dulu jika ingin memakai data hasil tarikan otomatis.', 409,
    );
  }

  const rows = await repo.listRowsInRange({ brandId, accountType, startDate, endDate });
  if (!rows.length) throw new AppError('Belum ada data tersimpan untuk bulan ini', 404);

  // Daily fetching files the running month too, so the file covers the days
  // actually stored (1st .. yesterday), not the whole calendar month.
  const firstDay = rows[0].entry_date;
  const lastDay = rows[rows.length - 1].entry_date;
  const extraMetrics = await repo.getExtraMetrics(brandId, accountType);
  const buffer = buildInsightsWorkbook({ start: firstDay, end: lastDay, rows, extraMetrics });
  const coverage = library.summariseRange({ start: firstDay, end: lastDay }, month);

  const file = await library.upsertLibraryFile({
    brandId, platform: 'meta', channel: LIBRARY_CHANNEL[accountType],
    periodMonth: coverage.periodMonth, periodStart: coverage.periodStart, periodEnd: coverage.periodEnd,
    coveredDays: coverage.coveredDays, dayBitmap: coverage.dayBitmap, rowCount: rows.length,
    periodSource: 'declared', partIndex: auto?.part_index ?? 1,
    filename: autoFilename(brand.brand_name, accountType, month), buffer, userId,
  });
  return { fileId: file.id, filename: file.original_filename, rowCount: rows.length };
}

// Called by Apps Script after a finished run. A month that already has a
// manual file is reported as a note, not an error: the run itself succeeded.
export async function syncLibraryFromRun(runId) {
  const run = await repo.getRun(runId);
  if (!run) throw new AppError('runId tidak dikenal', 404);
  if (run.status !== 'success') throw new AppError('Run ini belum selesai dengan sukses', 409);
  try {
    return { synced: true, ...(await syncLibraryFile({
      brandId: run.brand_id, accountType: run.account_type, month: run.month.slice(0, 7), userId: null,
    })) };
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) return { synced: false, reason: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------------
// Report Generator › Meta › custom range
//
// The library holds whole months; the stored daily rows can be cut at any
// day. The range is served as the same Ads Manager-style workbook, so the
// Report Generator parses it exactly like a library file or an upload.
// ---------------------------------------------------------------------
export async function getStoredDays(brandId) {
  await assertBrand(brandId);
  const rows = await repo.listStoredDays(brandId);
  const days = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t, []]));
  for (const r of rows) days[r.account_type]?.push(r.entry_date);
  return { days, maxRangeDays: MAX_RANGE_DAYS };
}

export async function exportRange({ brandId, accountType, start, end }) {
  await assertBrand(brandId);
  assertAccountType(accountType);
  if (start > end) throw new AppError('Tanggal mulai harus sebelum tanggal akhir', 400);
  if (dayDiff(start, end) + 1 > MAX_RANGE_DAYS) throw new AppError(`Rentang maksimal ${MAX_RANGE_DAYS} hari`, 400);
  const rows = await repo.listRowsInRange({ brandId, accountType, startDate: start, endDate: end });
  if (!rows.length) throw new AppError('Belum ada data tersimpan pada rentang ini', 404);
  const extraMetrics = await repo.getExtraMetrics(brandId, accountType);
  return {
    buffer: buildInsightsWorkbook({ start, end, rows, extraMetrics }),
    filename: `ATLAS-auto_${LIBRARY_CHANNEL[accountType]}_${start}_${end}.xlsx`,
    rowCount: rows.length,
  };
}

export async function deleteMonth({ brandId, accountType, month }) {
  await assertBrand(brandId);
  assertAccountType(accountType);
  const { startDate, endDate } = monthBounds(month);
  const deleted = await repo.deleteMonthRows({ brandId, accountType, startDate, endDate });
  await refreshInternalDashboard(brandId);
  // The auto-filed copy goes with it, or the library would keep offering a
  // month that no longer exists. A manual file is never removed here.
  const { auto } = await findSlotParts(brandId, accountType, month);
  if (auto) await library.deleteLibraryFile(brandId, auto.id);
  return { accountType, month, deleted };
}

// ---------------------------------------------------------------------
// Machine-to-machine (Apps Script), authenticated by the shared ingest key
// ---------------------------------------------------------------------
// A run covers `since`..`until` inside one month (the daily trigger fetches
// the last few days; the 1st and "Tarik sekarang" fetch a whole month).
// Without since/until — an Apps Script deployed before daily fetching — it
// is the whole month, as before.
export async function startRun({ brandId, accountType, adAccountId, month, since, until, trigger }) {
  await assertBrand(brandId);
  assertAccountType(accountType);
  const bounds = monthBounds(month);
  const rangeStart = since ?? bounds.startDate;
  const rangeEnd = until ?? bounds.endDate;
  if (rangeStart < bounds.startDate || rangeEnd > bounds.endDate || rangeStart > rangeEnd) {
    throw new AppError('since/until harus berada di dalam bulan yang sama dan berurutan', 400);
  }
  const runId = randomUUID();
  const extraMetrics = await repo.getExtraMetrics(brandId, accountType);
  await repo.insertRun({
    brandId, accountType, adAccountId, month: `${month}-01`, rangeStart, rangeEnd,
    trigger: trigger === 'scheduled' ? 'scheduled' : 'manual', runId,
  });
  return { runId, actionTypes: requiredActionTypes(extraMetrics) };
}

async function requireOpenRun(runId) {
  const run = await repo.getRun(runId);
  if (!run) throw new AppError('runId tidak dikenal', 404);
  if (run.status !== 'running') throw new AppError('Run ini sudah selesai', 409);
  return run;
}

export async function ingestRows({ runId, rows }) {
  const run = await requireOpenRun(runId);
  const extraMetrics = await repo.getExtraMetrics(run.brand_id, run.account_type);
  const { startDate, endDate } = runRange(run);

  // Rows outside the run's range are dropped rather than trusted: a stray
  // date would land on days whose stale-row cleanup this run never owns.
  const normalized = rows
    .map((raw) => normalizeInsightRow(raw, extraMetrics))
    .filter((r) => r && r.entry_date >= startDate && r.entry_date <= endDate);

  // Meta can return the same campaign/day/age/gender twice across page
  // boundaries; one INSERT ... ON CONFLICT cannot touch the same key twice,
  // so keep the last.
  const byKey = new Map();
  for (const r of normalized) byKey.set(`${r.entry_date}|${r.campaign_id}|${r.age}|${r.gender}`, r);

  const written = await repo.upsertInsightRows({
    brandId: run.brand_id, accountType: run.account_type, adAccountId: run.ad_account_id,
    runId, rows: [...byKey.values()],
  });
  return { received: rows.length, written };
}

export async function finishRun({ runId, status, rowCount, note }) {
  const run = await requireOpenRun(runId);
  const { startDate, endDate } = runRange(run);

  const result = await inTransaction(async (db) => {
    let removedStale = 0;
    // Zero rows on a "success" is treated as "Meta returned nothing", not as
    // proof the range is empty — clearing the existing data on that basis
    // would let one Meta hiccup wipe good days.
    if (status === 'success' && rowCount > 0) {
      removedStale = await repo.deleteStaleRows({
        brandId: run.brand_id, accountType: run.account_type, adAccountId: run.ad_account_id,
        startDate, endDate, runId,
      }, db);
    }
    const noteParts = [];
    if (note) noteParts.push(note);
    if (status === 'success' && rowCount === 0) noteParts.push('Meta tidak mengembalikan data untuk rentang ini; data lama (jika ada) tidak diubah');
    if (removedStale) noteParts.push(`${removedStale} baris lama yang tidak ada lagi di Meta dihapus`);
    await repo.finishRun({ runId, status, rowCount, note: noteParts.join(' · ') || null }, db);
    return { status, rowCount, removedStale };
  });
  // The Internal Dashboard's Meta funnel is rolled up from these rows.
  if (status === 'success') await refreshInternalDashboard(run.brand_id);
  return result;
}
