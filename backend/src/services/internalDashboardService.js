import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
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
