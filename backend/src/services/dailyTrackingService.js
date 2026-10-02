import pool from '../config/db.js';
import { AppError } from '../utils/errors.js';
import * as brandService from './brandService.js';
import * as repo from '../repositories/dailyTrackingRepository.js';
import { callAppsScript } from './metaAutomationService.js';
import {
  FIXED_SALES_CHANNELS, FIXED_SPEND_CHANNELS,
  FIXED_SALES_KEYS, FIXED_SPEND_KEYS,
  FIXED_SALES_LABELS, FIXED_SPEND_LABELS,
  META_SYNC_CHANNEL_KEYS, slugifyChannelLabel, resolveChannelKey,
} from '../config/dailyTrackingChannels.js';
import { parseDailyTrackingFile } from './dailyTrackingImportParser.js';
import { refreshInternalDashboard } from './internalDashboardSync/dailyTrackingSync.js';

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
// Each channel carries how much data it holds (`usage`), so the delete /
// move confirmations can say exactly what will happen before it does.
export async function listChannels(brandId) {
  await assertBrand(brandId);
  const [customSales, customSpend, usageRows] = await Promise.all([
    repo.listCustomChannels(brandId, 'sales'),
    repo.listCustomChannels(brandId, 'spend'),
    repo.channelUsage(brandId),
  ]);
  const usage = (kind, key) => {
    const u = usageRows.find((r) => r.kind === kind && r.channel_key === key);
    return u
      ? { rows: u.rows, withQty: u.with_qty, withTrx: u.with_trx, withNotes: u.with_notes, negative: u.negative }
      : { rows: 0, withQty: 0, withTrx: 0, withNotes: 0, negative: 0 };
  };
  return {
    sales: [
      ...FIXED_SALES_CHANNELS.map((c) => ({ ...c, isCustom: false, usage: usage('sales', c.key) })),
      ...customSales.map((c) => ({ key: c.channel_key, label: c.label, isCustom: true, usage: usage('sales', c.channel_key) })),
    ],
    spend: [
      ...FIXED_SPEND_CHANNELS.map((c) => ({ ...c, isCustom: false, usage: usage('spend', c.key) })),
      ...customSpend.map((c) => ({ key: c.channel_key, label: c.label, isCustom: true, usage: usage('spend', c.channel_key) })),
    ],
  };
}

const KIND_LABEL = { sales: 'Revenue Data', spend: 'Spending Data' };

// Delete a custom channel (pill) and every entry saved under it. Fixed
// channels are app config and cannot be deleted.
export async function deleteCustomChannel({ brandId, kind, channelKey, userId }) {
  await assertBrand(brandId);
  const channel = await repo.getCustomChannel(brandId, kind, channelKey);
  if (!channel) throw new AppError('Hanya channel tambahan (bukan channel bawaan) yang bisa dihapus', 400);

  const result = await inTransaction(async (db) => {
    const deleted = await repo.deleteChannelEntries(brandId, kind, channelKey, db);
    await repo.deleteCustomChannel(brandId, kind, channelKey, db);
    await repo.logIngestion({
      brandId, targetTable: 'daily_tracking_channels', source: 'manual', rowCount: deleted, status: 'success',
      note: `Hapus channel "${channel.label}" (${KIND_LABEL[kind]}) beserta ${deleted} entri`, performedBy: userId,
    }, db);
    return { kind, key: channelKey, label: channel.label, deletedEntries: deleted };
  });
  await refreshInternalDashboard(brandId);
  return result;
}

// Move a custom channel between Revenue Data and Spending Data, with its
// entries: revenue <-> amount spent. Revenue -> spend drops qty /
// transaksi / notes (spend has no such columns) and refuses negative
// days (a spend amount cannot be negative).
export async function moveCustomChannel({ brandId, kind, channelKey, userId }) {
  await assertBrand(brandId);
  const toKind = kind === 'sales' ? 'spend' : 'sales';
  const channel = await repo.getCustomChannel(brandId, kind, channelKey);
  if (!channel) throw new AppError('Hanya channel tambahan (bukan channel bawaan) yang bisa dipindahkan', 400);

  const fixedTarget = (toKind === 'sales' ? FIXED_SALES_KEYS : FIXED_SPEND_KEYS).has(resolveChannelKey(toKind, channelKey));
  const customTarget = await repo.getCustomChannel(brandId, toKind, channelKey);
  if (fixedTarget || customTarget) {
    throw new AppError(`${KIND_LABEL[toKind]} sudah punya channel "${channel.label}" — tidak bisa dipindahkan tanpa menggabungkan data`, 409);
  }
  const usage = (await repo.channelUsage(brandId)).find((r) => r.kind === kind && r.channel_key === channelKey);
  if (kind === 'sales' && usage?.negative) {
    throw new AppError(`"${channel.label}" punya ${usage.negative} hari dengan nilai negatif — spend tidak boleh negatif, perbaiki dulu`, 422);
  }

  const result = await inTransaction(async (db) => {
    const moved = kind === 'sales'
      ? await repo.copySalesToSpend(brandId, channelKey, userId, db)
      : await repo.copySpendToSales(brandId, channelKey, userId, db);
    await repo.deleteChannelEntries(brandId, kind, channelKey, db);
    await repo.setCustomChannelKind(brandId, kind, toKind, channelKey, db);
    await repo.logIngestion({
      brandId, targetTable: 'daily_tracking_channels', source: 'manual', rowCount: moved, status: 'success',
      note: `Pindah channel "${channel.label}" dari ${KIND_LABEL[kind]} ke ${KIND_LABEL[toKind]} (${moved} entri)`, performedBy: userId,
    }, db);
    return {
      fromKind: kind, toKind, key: channelKey, label: channel.label, movedEntries: moved,
      droppedFields: kind === 'sales' ? { qty: usage?.with_qty ?? 0, trx: usage?.with_trx ?? 0, notes: usage?.with_notes ?? 0 } : null,
    };
  });
  await refreshInternalDashboard(brandId);
  return result;
}

export async function addCustomChannel({ brandId, kind, label, userId }) {
  await assertBrand(brandId);
  if (!['sales', 'spend'].includes(kind)) throw new AppError('kind harus sales atau spend', 400);
  const trimmed = (label || '').trim();
  if (!trimmed) throw new AppError('Nama channel wajib diisi', 400);

  const channelKey = slugify(trimmed);
  if (!channelKey) throw new AppError('Nama channel tidak valid', 400);

  const fixedKeys = kind === 'sales' ? FIXED_SALES_KEYS : FIXED_SPEND_KEYS;
  const resolved = resolveChannelKey(kind, channelKey);
  if (fixedKeys.has(resolved)) {
    const fixedLabel = (kind === 'sales' ? FIXED_SALES_LABELS : FIXED_SPEND_LABELS)[resolved];
    throw new AppError(`Channel itu sudah ada sebagai "${fixedLabel}"`, 409);
  }

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
      notes: r.notes,
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
// Delete a whole month — for a bad import (e.g. wrong dates in the source
// spreadsheet). Removes every sales + spend row of the brand in that month
// and leaves an audit row per table. Custom channels are kept: they are
// brand config, not month data.
// ---------------------------------------------------------------------
export async function deleteMonthEntries({ brandId, month, userId }) {
  await assertBrand(brandId);
  const days = daysInMonth(month);
  const startDate = days[0];
  const endDate = days[days.length - 1];

  const result = await inTransaction(async (db) => {
    const salesDeleted = await repo.deleteSalesForMonth(brandId, startDate, endDate, db);
    const spendDeleted = await repo.deleteSpendForMonth(brandId, startDate, endDate, db);

    const note = `Hapus data bulan ${month}`;
    if (salesDeleted) {
      await repo.logIngestion({
        brandId, targetTable: 'daily_channel_sales', entryDate: startDate,
        source: 'manual', rowCount: salesDeleted, status: 'success', note, performedBy: userId,
      }, db);
    }
    if (spendDeleted) {
      await repo.logIngestion({
        brandId, targetTable: 'daily_channel_spend', entryDate: startDate,
        source: 'manual', rowCount: spendDeleted, status: 'success', note, performedBy: userId,
      }, db);
    }
    return { month, deleted: { sales: salesDeleted, spend: spendDeleted } };
  });
  // Keep the Internal Dashboard's monthly tables in step with this write.
  await refreshInternalDashboard(brandId);
  return result;
}

// ---------------------------------------------------------------------
// Manual entry — always sets source='manual', locked_manual=TRUE on any
// spend row it touches (decision: a human edit permanently overrides
// whatever the Meta sync last wrote for that cell).
// ---------------------------------------------------------------------
// A lone "-" (mid-typing a negative retur value in the sales table) is not a
// number yet — treat it as empty rather than handing NaN to Postgres.
const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function upsertEntries({ brandId, entryDate, sales, spend, userId }) {
  await assertBrand(brandId);
  if (!Array.isArray(sales) || !sales.length) sales = [];
  if (!Array.isArray(spend) || !spend.length) spend = [];
  if (!sales.length && !spend.length) throw new AppError('Tidak ada data untuk disimpan', 400);

  const result = await inTransaction(async (db) => {
    let salesCount = 0;
    let spendCount = 0;

    for (const s of sales) {
      await repo.upsertSalesEntry({
        brandId, entryDate, channelKey: s.channelKey,
        revenue: num(s.revenue), qtySold: num(s.qtySold), transaksi: num(s.transaksi),
        notes: s.notes === undefined ? undefined : (String(s.notes ?? '').trim() || null),
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
  // Keep the Internal Dashboard's monthly tables in step with this write.
  await refreshInternalDashboard(brandId);
  return result;
}

// ---------------------------------------------------------------------
// Meta sync — shared by the manual "Sync Meta Sekarang" button and the
// scheduled ingest (see routes for which one calls which entry point).
// Respects locked_manual: a channel already manually overridden is
// reported as skipped, never overwritten.
// ---------------------------------------------------------------------
async function applyMetaSpend({ brandId, entryDate, entries, userId }) {
  const result = await inTransaction(async (db) => {
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
  // Keep the Internal Dashboard's monthly tables in step with this write.
  await refreshInternalDashboard(brandId);
  return result;
}

// Google Ads — called after every successful Google Ads Script run with the
// brand's daily cost (all campaigns of all connected accounts) for the run's
// range. Same rule as Meta: a day a person saved stays theirs. A day in the
// range with no row from Google means nothing was spent, so it is written
// as 0 rather than left looking unsynced.
export async function applyGoogleAdsSpend({ brandId, days }) {
  if (!days.length) return { applied: 0, skipped: 0 };
  const result = await inTransaction(async (db) => {
    let applied = 0;
    const skipped = [];
    for (const d of days) {
      const row = await repo.upsertApiSpendEntry({
        brandId, entryDate: d.date, channelKey: 'google_ads', amountSpent: Math.round(d.cost * 100) / 100, source: 'google_ads_api',
      }, db);
      if (row) applied += 1; else skipped.push(d.date);
    }
    await repo.logIngestion({
      brandId, targetTable: 'daily_channel_spend', entryDate: days[days.length - 1].date,
      source: 'google_ads_api', rowCount: applied,
      status: applied === days.length ? 'success' : applied ? 'partial' : 'failed',
      note: `Google Ads ${days[0].date} s.d. ${days[days.length - 1].date}${skipped.length ? ` · dilewati (diisi manual): ${skipped.join(', ')}` : ''}`,
    }, db);
    return { applied, skipped: skipped.length };
  });
  await refreshInternalDashboard(brandId);
  return result;
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

  // Vercel's function limit is 60s (vercel.json) and a slow Meta pull can eat
  // most of it, so every Apps Script call below shares ONE deadline just
  // under that -- a slow run then fails with a readable message instead of
  // an opaque platform 504.
  const deadline = Date.now() + 52000;

  // The preview is read-only (a dry run in Apps Script), so it is safe to
  // fetch BEFORE the brand cross-check; nothing is written until both have
  // passed.
  const preview = trackingConfigId
    ? await callAppsScript('trackingPreview', { id: trackingConfigId }, { deadline })
    // type is required whenever the same brand has both a MAIN and a CPAS
    // account — accountClient alone is ambiguous (see the long note on
    // findAccount_ in apps-script/DailyTrackingBoostPost.gs).
    : await callAppsScript('accountTrackingPreview', { client: accountClient, type: accountType }, { deadline });
  if (!preview || preview.date == null) {
    throw new AppError('Apps Script tidak mengembalikan data tracking yang valid', 502);
  }

  // Cross-check the source's OWN atlasBrandId against the brandId the caller
  // sent, so a caller mistake (wrong brandId for this config/account) can't
  // write one brand's Meta spend into another brand's Daily Tracking data
  // with no error at all. MetaSyncButton only ever offers sources already
  // linked to the open brand, so this never trips in normal use.
  // Current Apps Script echoes atlasBrandId in the preview, which costs no
  // extra round trip; an older deployment doesn't, so fall back to listing
  // configs/accounts (an extra ~5s Apps Script call) rather than skipping
  // the check.
  let sourceBrandId = preview.atlasBrandId;
  if (sourceBrandId == null) {
    if (trackingConfigId) {
      const configs = await callAppsScript('trackingList', undefined, { deadline });
      sourceBrandId = (configs || []).find((c) => c.id === trackingConfigId)?.atlasBrandId;
    } else {
      const accounts = await callAppsScript('brandList', undefined, { deadline });
      sourceBrandId = (accounts || []).find((a) => a.client === accountClient && (a.type || 'MAIN') === (accountType || 'MAIN'))?.atlasBrandId;
    }
  }
  if (Number(sourceBrandId) !== Number(brandId)) {
    throw new AppError(
      trackingConfigId
        ? 'Config ini tertaut ke brand ATLAS yang berbeda dari brand yang sedang dibuka'
        : 'Akun ini tertaut ke brand ATLAS yang berbeda dari brand yang sedang dibuka',
      403,
    );
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
// Step 1 of an import: read the file, store nothing. Lists every column the
// parser recognised as a channel (with row count + total) so the user picks
// what to keep, and flags the ones this brand ignored on an earlier upload.
export async function previewImport({ brandId, buffer, filename }) {
  await assertBrand(brandId);
  const parsed = parseDailyTrackingFile(buffer, filename);
  const [ignored, customSales, customSpend] = await Promise.all([
    repo.listIgnoredColumns(brandId),
    repo.listCustomChannels(brandId, 'sales'),
    repo.listCustomChannels(brandId, 'spend'),
  ]);
  const ignoredSet = new Set(ignored.map((r) => `${r.kind}|${r.column_label}`));
  const existingCustom = new Set([...customSales.map((c) => `sales|${c.channel_key}`), ...customSpend.map((c) => `spend|${c.channel_key}`)]);

  const columns = parsed.columns.map((c) => ({
    ...c,
    isNew: c.isCustom && !existingCustom.has(`${c.kind}|${c.key}`),
    previouslyIgnored: c.fileLabels.some((l) => ignoredSet.has(`${c.kind}|${l}`)),
  }));
  const months = [...new Set([...parsed.salesRows, ...parsed.spendRows].map((r) => r.entryDate.slice(0, 7)))].sort();
  return {
    fileName: filename,
    dataRowsParsed: parsed.dataRowsParsed,
    months,
    columns,
    previouslyIgnored: columns.filter((c) => c.previouslyIgnored).map((c) => ({ id: c.id, kind: c.kind, label: c.label, fileLabels: c.fileLabels })),
  };
}

// Step 2: import only the chosen columns (`selected` = column ids from the
// preview; omitted = everything, for older callers). Columns left out are
// remembered as ignored for this brand; a column picked again is forgotten.
export async function importFromFile({ brandId, buffer, filename, userId, selected }) {
  await assertBrand(brandId);
  const parsed = parseDailyTrackingFile(buffer, filename);
  const chosen = Array.isArray(selected) ? new Set(selected) : new Set(parsed.columns.map((c) => c.id));
  const salesRows = parsed.salesRows.filter((r) => chosen.has(r.columnId));
  const spendRows = parsed.spendRows.filter((r) => chosen.has(r.columnId));
  const keptColumns = parsed.columns.filter((c) => chosen.has(c.id));
  const skippedColumns = parsed.columns.filter((c) => !chosen.has(c.id));

  const result = await inTransaction(async (db) => {
    for (const c of keptColumns) {
      if (c.isCustom) await repo.upsertCustomChannelIfMissing({ brandId, kind: c.kind, channelKey: c.key, label: c.label, userId }, db);
      for (const l of c.fileLabels) await repo.forgetIgnoredColumn(brandId, c.kind, l, db);
    }
    for (const c of skippedColumns) {
      for (const l of c.fileLabels) await repo.rememberIgnoredColumn(brandId, c.kind, l, userId, db);
    }

    for (const r of salesRows) {
      await repo.upsertSalesEntry({
        brandId, entryDate: r.entryDate, channelKey: r.channelKey,
        revenue: r.revenue, qtySold: r.qtySold, transaksi: r.transaksi, notes: r.notes, userId,
      }, db);
    }
    for (const r of spendRows) {
      await repo.upsertManualSpendEntry({
        brandId, entryDate: r.entryDate, channelKey: r.channelKey, amountSpent: r.amount, userId,
      }, db);
    }

    const monthsAffected = [...new Set([...salesRows, ...spendRows].map((r) => r.entryDate.slice(0, 7)))].sort();
    for (const month of monthsAffected) {
      const entryDate = `${month}-01`;
      const salesCount = salesRows.filter((r) => r.entryDate.startsWith(month)).length;
      const spendCount = spendRows.filter((r) => r.entryDate.startsWith(month)).length;
      const note = `Impor file: ${filename}${skippedColumns.length ? ` (diabaikan: ${skippedColumns.map((c) => c.label).join(', ')})` : ''}`;
      if (salesCount) {
        await repo.logIngestion({
          brandId, targetTable: 'daily_channel_sales', entryDate, source: 'manual',
          rowCount: salesCount, status: 'success', note, performedBy: userId,
        }, db);
      }
      if (spendCount) {
        await repo.logIngestion({
          brandId, targetTable: 'daily_channel_spend', entryDate, source: 'manual',
          rowCount: spendCount, status: 'success', note, performedBy: userId,
        }, db);
      }
    }

    const pick = (kind) => keptColumns.filter((c) => c.kind === kind).map((c) => ({ key: c.key, label: c.label, isCustom: c.isCustom }));
    return {
      fileName: filename,
      dataRowsParsed: parsed.dataRowsParsed,
      salesSaved: salesRows.length,
      spendSaved: spendRows.length,
      recognizedSales: pick('sales'),
      recognizedSpend: pick('spend'),
      ignoredColumns: skippedColumns.map((c) => ({ kind: c.kind, label: c.label })),
      monthsAffected,
    };
  });
  // Keep the Internal Dashboard's monthly tables in step with this write.
  await refreshInternalDashboard(brandId);
  return result;
}

// Scheduled 1am WIB ingest — called by apps-script/DailyTrackingBoostPost.gs's
// new postToAtlas_ step (see plan). No ATLAS user/session on this call, so
// there's no userId to attribute the ingestion log to.
export async function ingestFromAppsScript({ brandId, entryDate, entries }) {
  await assertBrand(brandId);
  if (!Array.isArray(entries) || !entries.length) throw new AppError('entries wajib diisi', 400);
  return applyMetaSpend({ brandId, entryDate, entries, userId: null });
}
