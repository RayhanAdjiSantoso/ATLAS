import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
import * as brandService from './brandService.js';
import * as repo from '../repositories/dailyTrackingRepository.js';
import { callAppsScript } from './metaAutomationService.js';
import {
  FIXED_SALES_CHANNELS, FIXED_SPEND_CHANNELS,
  FIXED_SALES_KEYS, FIXED_SPEND_KEYS,
  META_SYNC_CHANNEL_KEYS, slugifyChannelLabel,
} from '../config/dailyTrackingChannels.js';
import { parseDailyTrackingFile } from './dailyTrackingImportParser.js';

async function assertBrand(brandId) {
  const brand = await brandService.getBrandById(brandId);
  if (!brand) throw new AppError('Client tidak ditemukan', 404);
  return brand;
}

// Run `work(client)` inside a transaction — mirrors internalDashboardService's
// inTransaction, so a fact upsert and its ingestion-log row never diverge.
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

const slugify = slugifyChannelLabel;

// ---------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------
export async function listChannels(brandId) {
  await assertBrand(brandId);
  const [customSales, customSpend] = await Promise.all([
    repo.listCustomChannels(brandId, 'sales'),
    repo.listCustomChannels(brandId, 'spend'),
  ]);
  return {
    sales: [
      ...FIXED_SALES_CHANNELS.map((c) => ({ ...c, isCustom: false })),
      ...customSales.map((c) => ({ key: c.channel_key, label: c.label, isCustom: true })),
    ],
    spend: [
      ...FIXED_SPEND_CHANNELS.map((c) => ({ ...c, isCustom: false })),
      ...customSpend.map((c) => ({ key: c.channel_key, label: c.label, isCustom: true })),
    ],
  };
}

export async function addCustomChannel({ brandId, kind, label, userId }) {
  await assertBrand(brandId);
  if (!['sales', 'spend'].includes(kind)) throw new AppError('kind harus sales atau spend', 400);
  const trimmed = (label || '').trim();
  if (!trimmed) throw new AppError('Nama channel wajib diisi', 400);

  const channelKey = slugify(trimmed);
  if (!channelKey) throw new AppError('Nama channel tidak valid', 400);

  const fixedKeys = kind === 'sales' ? FIXED_SALES_KEYS : FIXED_SPEND_KEYS;
  if (fixedKeys.has(channelKey)) throw new AppError('Channel itu sudah ada', 409);

  try {
    const row = await repo.insertCustomChannel({ brandId, kind, channelKey, label: trimmed, userId });
    return { key: row.channel_key, label: row.label, isCustom: true };
  } catch (err) {
    if (err.code === '23505') throw new AppError('Channel itu sudah ada', 409);
    throw err;
  }
}

// ---------------------------------------------------------------------
// Month grid — feeds the entry table, KPI strip, and channel summary table
// in one round trip.
// ---------------------------------------------------------------------
function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = [];
  for (let d = 1; d <= last; d += 1) days.push(`${month}-${String(d).padStart(2, '0')}`);
  return days;
}

export async function getMonthEntries(brandId, month) {
  await assertBrand(brandId);
  const days = daysInMonth(month);
  const startDate = days[0];
  const endDate = days[days.length - 1];

  const [salesRows, spendRows] = await Promise.all([
    repo.listSalesForMonth(brandId, startDate, endDate),
    repo.listSpendForMonth(brandId, startDate, endDate),
  ]);

  const sales = {};
  for (const r of salesRows) {
    (sales[r.channel_key] ??= {})[r.entry_date] = {
      revenue: r.revenue == null ? null : Number(r.revenue),
      qtySold: r.qty_sold,
      transaksi: r.transaksi,
    };
  }

  const spend = {};
  for (const r of spendRows) {
    (spend[r.channel_key] ??= {})[r.entry_date] = {
      amount: r.amount_spent == null ? null : Number(r.amount_spent),
      source: r.source,
      lockedManual: r.locked_manual,
      syncedAt: r.synced_at,
    };
  }

  return { days, sales, spend };
}

// ---------------------------------------------------------------------
// Manual entry — always sets source='manual', locked_manual=TRUE on any
// spend row it touches (decision: a human edit permanently overrides
// whatever the Meta sync last wrote for that cell).
// ---------------------------------------------------------------------
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

export async function upsertEntries({ brandId, entryDate, sales, spend, userId }) {
  await assertBrand(brandId);
  if (!Array.isArray(sales) || !sales.length) sales = [];
  if (!Array.isArray(spend) || !spend.length) spend = [];
  if (!sales.length && !spend.length) throw new AppError('Tidak ada data untuk disimpan', 400);

  return inTransaction(async (db) => {
    let salesCount = 0;
    let spendCount = 0;

    for (const s of sales) {
      await repo.upsertSalesEntry({
        brandId, entryDate, channelKey: s.channelKey,
        revenue: num(s.revenue), qtySold: num(s.qtySold), transaksi: num(s.transaksi),
        userId,
      }, db);
      salesCount += 1;
    }
    if (salesCount) {
      await repo.logIngestion({
        brandId, targetTable: 'daily_channel_sales', entryDate,
        source: 'manual', rowCount: salesCount, status: 'success', performedBy: userId,
      }, db);
    }

    for (const s of spend) {
      await repo.upsertManualSpendEntry({
        brandId, entryDate, channelKey: s.channelKey, amountSpent: num(s.amount), userId,
      }, db);
      spendCount += 1;
    }
    if (spendCount) {
      await repo.logIngestion({
        brandId, targetTable: 'daily_channel_spend', entryDate,
        source: 'manual', rowCount: spendCount, status: 'success', performedBy: userId,
      }, db);
    }

    return { saved: { sales: salesCount, spend: spendCount } };
  });
}

// ---------------------------------------------------------------------
// Meta sync — shared by the manual "Sync Meta Sekarang" button and the
// scheduled ingest (see routes for which one calls which entry point).
// Respects locked_manual: a channel already manually overridden is
// reported as skipped, never overwritten.
// ---------------------------------------------------------------------
async function applyMetaSpend({ brandId, entryDate, entries, userId }) {
  return inTransaction(async (db) => {
    const applied = [];
    const skipped = [];
    for (const e of entries) {
      if (!META_SYNC_CHANNEL_KEYS.includes(e.channelKey)) { skipped.push(e.channelKey); continue; }
      const amount = num(e.amount);
      if (amount == null) { skipped.push(e.channelKey); continue; }
      const row = await repo.upsertApiSpendEntry({
        brandId, entryDate, channelKey: e.channelKey, amountSpent: amount, userId,
      }, db);
      if (row) applied.push(e.channelKey); else skipped.push(e.channelKey);
    }
    await repo.logIngestion({
      brandId, targetTable: 'daily_channel_spend', entryDate,
      source: 'meta_api', rowCount: applied.length,
      status: applied.length === entries.length ? 'success' : applied.length ? 'partial' : 'failed',
      note: skipped.length ? `skipped (locked_manual atau channel tidak dikenal): ${skipped.join(', ')}` : null,
      performedBy: userId ?? null,
    }, db);
    return { applied, skipped };
  });
}

// Manual "Sync Meta Sekarang" — reuses an existing Apps Script dry-run
// action, which already computes {boostSpend, nonBoostSpend[, cpasSpend]}
// for H-1 without writing anywhere. Two sources, mutually exclusive:
// - trackingConfigId: a config from the Daily Tracking tab (writes to a
//   Google Sheet too, on the scheduled/real run) — action `trackingPreview`.
// - accountClient: a brand registered ONLY in Brand & Langganan (no Sheet
//   at all, see BrandsSection's "Kata Kunci Boost Post") — action
//   `accountTrackingPreview`. Both return the same {date, boostSpend,
//   nonBoostSpend, cpasSpend} shape, so the rest of this function doesn't
//   need to know which source it came from.
export async function runMetaSyncNow({ brandId, trackingConfigId, accountClient, accountType, userId }) {
  await assertBrand(brandId);

  // Cross-check the source's OWN atlasBrandId against the brandId the
  // caller sent, BEFORE pulling/writing anything — trackingPreview/
  // accountTrackingPreview don't echo it back in their result, so a caller
  // mistake (wrong brandId for this config/account) would otherwise write
  // one brand's Meta spend into another brand's Daily Tracking data with no
  // error at all. MetaSyncButton only ever offers sources whose atlasBrandId
  // already matches the open brand, so this never trips in normal use — it
  // only catches a mismatched call before it can do damage.
  if (trackingConfigId) {
    const configs = await callAppsScript('trackingList');
    const cfg = (configs || []).find((c) => c.id === trackingConfigId);
    if (!cfg) throw new AppError('Config tracking tidak ditemukan', 404);
    if (Number(cfg.atlasBrandId) !== Number(brandId)) {
      throw new AppError('Config ini tertaut ke brand ATLAS yang berbeda dari brand yang sedang dibuka', 403);
    }
  } else {
    const accounts = await callAppsScript('brandList');
    const acct = (accounts || []).find((a) => a.client === accountClient && (a.type || 'MAIN') === (accountType || 'MAIN'));
    if (!acct) throw new AppError('Akun Brand & Langganan tidak ditemukan', 404);
    if (Number(acct.atlasBrandId) !== Number(brandId)) {
      throw new AppError('Akun ini tertaut ke brand ATLAS yang berbeda dari brand yang sedang dibuka', 403);
    }
  }

  const preview = trackingConfigId
    ? await callAppsScript('trackingPreview', { id: trackingConfigId })
    // type is required whenever the same brand has both a MAIN and a CPAS
    // account — accountClient alone is ambiguous (see the long note on
    // findAccount_ in apps-script/DailyTrackingBoostPost.gs).
    : await callAppsScript('accountTrackingPreview', { client: accountClient, type: accountType });
  if (!preview || preview.date == null) {
    throw new AppError('Apps Script tidak mengembalikan data tracking yang valid', 502);
  }

  const entryDate = preview.date;
  const entries = [
    { channelKey: 'meta_boost_post', amount: preview.boostSpend },
    { channelKey: 'meta_nonboost_post', amount: preview.nonBoostSpend },
  ];
  // cpasSpend is only present when the tracking config has a CPAS ad account
  // configured (apps-script/DailyTrackingBoostPost.gs's cfg.cpasAccountId) —
  // null/undefined means "not tracked for this config", not "zero spend".
  const hasCpas = preview.cpasSpend != null;
  if (hasCpas) entries.push({ channelKey: 'cpas_shopee', amount: preview.cpasSpend });

  const { applied, skipped } = await applyMetaSpend({ brandId, entryDate, entries, userId });

  return {
    entryDate,
    boostSpend: preview.boostSpend,
    nonBoostSpend: preview.nonBoostSpend,
    cpasSpend: hasCpas ? preview.cpasSpend : null,
    applied: {
      boost: applied.includes('meta_boost_post'),
      nonBoost: applied.includes('meta_nonboost_post'),
      cpas: hasCpas ? applied.includes('cpas_shopee') : null,
    },
    skipped,
  };
}

// ---------------------------------------------------------------------
// Bulk file upload ("Upload File Daily Tracking") — a client's own Google
// Sheet export (CSV/XLS/XLSX), best-effort parsed by
// dailyTrackingImportParser and written the same way a human bulk-editing
// the table would: source='manual', locked_manual=TRUE on every spend cell
// touched, so a later Meta sync never silently overwrites an imported value.
// ---------------------------------------------------------------------
export async function importFromFile({ brandId, buffer, filename, userId }) {
  await assertBrand(brandId);
  const parsed = parseDailyTrackingFile(buffer, filename);

  return inTransaction(async (db) => {
    for (const c of parsed.recognizedSales) {
      if (!c.isCustom) continue;
      await repo.upsertCustomChannelIfMissing({ brandId, kind: 'sales', channelKey: c.key, label: c.label, userId }, db);
    }
    for (const c of parsed.recognizedSpend) {
      if (!c.isCustom) continue;
      await repo.upsertCustomChannelIfMissing({ brandId, kind: 'spend', channelKey: c.key, label: c.label, userId }, db);
    }

    for (const r of parsed.salesRows) {
      await repo.upsertSalesEntry({
        brandId, entryDate: r.entryDate, channelKey: r.channelKey,
        revenue: r.revenue, qtySold: r.qtySold, transaksi: r.transaksi, userId,
      }, db);
    }
    for (const r of parsed.spendRows) {
      await repo.upsertManualSpendEntry({
        brandId, entryDate: r.entryDate, channelKey: r.channelKey, amountSpent: r.amount, userId,
      }, db);
    }

    const monthsAffected = [...new Set([...parsed.salesRows, ...parsed.spendRows].map((r) => r.entryDate.slice(0, 7)))].sort();
    for (const month of monthsAffected) {
      const entryDate = `${month}-01`;
      const salesCount = parsed.salesRows.filter((r) => r.entryDate.startsWith(month)).length;
      const spendCount = parsed.spendRows.filter((r) => r.entryDate.startsWith(month)).length;
      if (salesCount) {
        await repo.logIngestion({
          brandId, targetTable: 'daily_channel_sales', entryDate, source: 'manual',
          rowCount: salesCount, status: 'success', note: `Impor file: ${filename}`, performedBy: userId,
        }, db);
      }
      if (spendCount) {
        await repo.logIngestion({
          brandId, targetTable: 'daily_channel_spend', entryDate, source: 'manual',
          rowCount: spendCount, status: 'success', note: `Impor file: ${filename}`, performedBy: userId,
        }, db);
      }
    }

    return {
      fileName: filename,
      dataRowsParsed: parsed.dataRowsParsed,
      salesSaved: parsed.salesRows.length,
      spendSaved: parsed.spendRows.length,
      recognizedSales: parsed.recognizedSales,
      recognizedSpend: parsed.recognizedSpend,
      monthsAffected,
    };
  });
}

// Scheduled 1am WIB ingest — called by apps-script/DailyTrackingBoostPost.gs's
// new postToAtlas_ step (see plan). No ATLAS user/session on this call, so
// there's no userId to attribute the ingestion log to.
export async function ingestFromAppsScript({ brandId, entryDate, entries }) {
  await assertBrand(brandId);
  if (!Array.isArray(entries) || !entries.length) throw new AppError('entries wajib diisi', 400);
  return applyMetaSpend({ brandId, entryDate, entries, userId: null });
}
