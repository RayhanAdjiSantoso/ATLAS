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
      accountType: r.account_type, month: r.month, trigger: r.trigger, status: r.status,
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

// Queues a background run in Apps Script. It cannot be awaited here: a full
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

  const rows = await repo.listRowsForMonth({ brandId, accountType, startDate, endDate });
  if (!rows.length) throw new AppError('Belum ada data tersimpan untuk bulan ini', 404);

  const extraMetrics = await repo.getExtraMetrics(brandId, accountType);
  const buffer = buildInsightsWorkbook({ month, rows, extraMetrics });
  const coverage = library.summariseRange({ start: startDate, end: endDate }, month);

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

export async function deleteMonth({ brandId, accountType, month }) {
  await assertBrand(brandId);
  assertAccountType(accountType);
  const { startDate, endDate } = monthBounds(month);
  const deleted = await repo.deleteMonthRows({ brandId, accountType, startDate, endDate });
  // The auto-filed copy goes with it, or the library would keep offering a
  // month that no longer exists. A manual file is never removed here.
  const { auto } = await findSlotParts(brandId, accountType, month);
  if (auto) await library.deleteLibraryFile(brandId, auto.id);
  return { accountType, month, deleted };
}

// ---------------------------------------------------------------------
// Machine-to-machine (Apps Script), authenticated by the shared ingest key
// ---------------------------------------------------------------------
export async function startRun({ brandId, accountType, adAccountId, month, trigger }) {
  await assertBrand(brandId);
  assertAccountType(accountType);
  const runId = randomUUID();
  const extraMetrics = await repo.getExtraMetrics(brandId, accountType);
  await repo.insertRun({
    brandId, accountType, adAccountId, month: `${month}-01`,
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
  const { startDate, endDate } = monthBounds(run.month.slice(0, 7));

  // Rows outside the run's month are dropped rather than trusted: a stray
  // date would land in a month whose stale-row cleanup this run never owns.
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
  const { startDate, endDate } = monthBounds(run.month.slice(0, 7));

  return inTransaction(async (db) => {
    let removedStale = 0;
    // Zero rows on a "success" is treated as "Meta returned nothing", not as
    // proof the month is empty — clearing the existing data on that basis
    // would let one Meta hiccup wipe a good month.
    if (status === 'success' && rowCount > 0) {
      removedStale = await repo.deleteStaleRows({
        brandId: run.brand_id, accountType: run.account_type, adAccountId: run.ad_account_id,
        startDate, endDate, runId,
      }, db);
    }
    const noteParts = [];
    if (note) noteParts.push(note);
    if (status === 'success' && rowCount === 0) noteParts.push('Meta tidak mengembalikan data untuk bulan ini; data lama (jika ada) tidak diubah');
    if (removedStale) noteParts.push(`${removedStale} baris lama yang tidak ada lagi di Meta dihapus`);
    await repo.finishRun({ runId, status, rowCount, note: noteParts.join(' · ') || null }, db);
    return { status, rowCount, removedStale };
  });
}
