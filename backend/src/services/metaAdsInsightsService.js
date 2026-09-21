import { randomUUID } from 'crypto';
import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
import * as brandService from './brandService.js';
import * as repo from '../repositories/metaAdsInsightsRepository.js';
import { callAppsScript } from './metaAutomationService.js';
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

export async function deleteMonth({ brandId, accountType, month }) {
  await assertBrand(brandId);
  assertAccountType(accountType);
  const { startDate, endDate } = monthBounds(month);
  const deleted = await repo.deleteMonthRows({ brandId, accountType, startDate, endDate });
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
