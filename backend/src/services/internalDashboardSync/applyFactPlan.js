import crypto from 'crypto';
import pool from '../../config/db.js';
import { currentMonth } from '../../utils/monthPeriod.js';
import * as repo from '../../repositories/internalDashboardRepository.js';

// =====================================================================
// Shared writer for every automatic source that feeds the Internal
// Dashboard's monthly fact tables (ATLAS Daily Tracking roll-up, Google
// Sheets). A source builds a *plan* (pure); this module writes it.
//
// Plan month shape:
//   { period: 'YYYY-MM', rejected?: string,
//     metric: { revenue, transaksi, qtySold } | null,
//     writeChannels: boolean,           // false = leave channel tables alone
//     channels: [{ channel, sales }],   // sales_channel enum values
//     otherChannels: [{ channelLabel, sales }],
//     platforms: [{ platform, metrics, sourceRef? }] }
//
// Rules (user decisions 2026-09-30):
//   - The automatic source WINS over a manual row for the same key; the
//     replaced values are kept in the run's data_ingestion_log.details.
//   - spendMode 'amount_only': the source only owns amount_spent. A manual
//     row keeps its funnel columns (impressions, clicks, purchases, …);
//     only amount_spent / provenance / partial flag change.
//   - Rows this source (or a retired source) wrote earlier that the plan
//     no longer produces, for a month being written, are deleted. Manual
//     rows are never deleted.
//   - One brand = one transaction. dryRun rolls it back (nothing written,
//     not even the log).
// =====================================================================

const num = (v) => (v === null || v === undefined ? null : Number(v));
const same = (a, b) => num(a) === num(b);

// is_partial_month for an automatically written row: the running calendar
// month is partial by definition; a hand-set flag on an older month is
// kept; an automatic flag left from when the month was running is cleared.
export function partialFor(period, existing, nowMonth) {
  if (period === nowMonth) return { isPartialMonth: true, partialMonthReason: 'current_month' };
  if (existing?.is_partial_month && existing.partial_month_reason !== 'current_month') {
    return { isPartialMonth: true, partialMonthReason: 'manual' };
  }
  return { isPartialMonth: false, partialMonthReason: null };
}

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query(result?.rollback ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @param {object} o
 * @param {number} o.brandId
 * @param {number|null} o.userId
 * @param {{months: object[], warnings: object[], rowsRead?: number, rowsSkipped?: number}} o.plan
 * @param {string} o.source              ingestion_source written on every row
 * @param {string} o.sourceRef           default source_ref for rows
 * @param {string[]} [o.retiredSources]  other sources whose stale rows may also be removed
 * @param {'full'|'amount_only'} [o.spendMode]
 * @param {string} o.runTarget           data_ingestion_log.target_table of the summary row
 * @param {string} o.method              label for log rows, e.g. 'daily tracking sync'
 * @param {string|null} [o.note]
 * @param {boolean} [o.dryRun]
 * @param {number} [o.now]
 * @param {object} [o.extraDetails]
 */
export async function applyFactPlan(o) {
  const {
    brandId, userId, plan, source, sourceRef, retiredSources = [], spendMode = 'full',
    runTarget, method, note = null, dryRun = false, now = Date.now(), extraDetails = {},
  } = o;
  const runId = crypto.randomUUID();
  const startedAt = new Date();
  const nowMonth = currentMonth(now);
  const writeMonths = plan.months.filter((m) => !m.rejected);
  const periods = writeMonths.map((m) => m.period);
  const deletable = [source, ...retiredSources];
  const warnings = [...plan.warnings];

  return inTransaction(async (db) => {
    const snap = periods.length ? await repo.brandFactSnapshot(brandId, periods, db) : { cmm: [], ccs: [], ccso: [], cps: [] };
    const overwrittenManual = [];
    const replacedRetired = [];
    const deletedStale = [];
    const manualKept = [];
    let rowsWritten = 0;

    const noteReplace = (existing, entry) => {
      if (existing?.source === 'manual_form') overwrittenManual.push(entry);
      else if (existing && existing.source !== source) replacedRetired.push({ ...entry, old_source: existing.source });
    };
    const log = (targetTable, period, what, rowCount) => repo.logIngestion({
      brandId, targetTable, period: `${period}-01`, source, method: `${method} (${what})`, rowCount,
      status: 'success', note, userId, runId,
    }, db);
    const sortStale = (rows, table, keyOf, valueOf) => {
      const del = [];
      for (const r of rows) {
        const item = { table, period: r.period, key: keyOf(r), value: valueOf(r), source: r.source };
        if (deletable.includes(r.source)) { deletedStale.push(item); del.push(r.id); } else manualKept.push(item);
      }
      return del;
    };

    for (const m of writeMonths) {
      const periodDate = `${m.period}-01`;

      // --- monthly metric --------------------------------------------
      // No metric in the plan: a row this source wrote earlier is stale
      // (e.g. the month was cleared at the source) and goes; manual stays.
      if (!m.metric) {
        const existing = snap.cmm.find((r) => r.period === m.period);
        if (existing) {
          const del = sortStale([existing], 'client_monthly_metrics', () => 'metric', (r) => num(r.revenue));
          await repo.deleteSyncedFactRows('client_monthly_metrics', del, deletable, db);
        }
      }
      if (m.metric) {
        const existing = snap.cmm.find((r) => r.period === m.period);
        if (existing && !(same(existing.revenue, m.metric.revenue) && same(existing.transaksi, m.metric.transaksi) && same(existing.qty_sold, m.metric.qtySold))) {
          noteReplace(existing, {
            table: 'client_monthly_metrics', period: m.period,
            old: { revenue: num(existing.revenue), transaksi: num(existing.transaksi), qty_sold: num(existing.qty_sold) },
            new: { revenue: m.metric.revenue, transaksi: m.metric.transaksi ?? null, qty_sold: m.metric.qtySold ?? null },
          });
        }
        const res = await repo.upsertMonthlyMetric({
          brandId, period: periodDate, revenue: m.metric.revenue, transaksi: m.metric.transaksi ?? null,
          qtySold: m.metric.qtySold ?? null, targetSales: null, keepTargetSales: true,
          ...partialFor(m.period, existing, nowMonth), userId, source, sourceRef: m.metricSourceRef ?? sourceRef,
        }, db);
        rowsWritten += 1;
        await log('client_monthly_metrics', m.period, res.was_insert ? 'insert' : 'update', 1);
      }

      // --- channel sales ---------------------------------------------
      if (m.writeChannels) {
        const planned = new Set(m.channels.map((c) => c.channel));
        for (const c of m.channels) {
          const existing = snap.ccs.find((r) => r.period === m.period && r.channel === c.channel);
          if (existing && !same(existing.sales, c.sales)) noteReplace(existing, { table: 'client_channel_sales_monthly', period: m.period, key: c.channel, old: { sales: num(existing.sales) }, new: { sales: c.sales } });
          await repo.upsertChannelSale({ brandId, period: periodDate, channel: c.channel, sales: c.sales, userId, source, sourceRef: m.channelSourceRef ?? sourceRef }, db);
          rowsWritten += 1;
        }
        const plannedOther = new Set(m.otherChannels.map((c) => c.channelLabel));
        for (const c of m.otherChannels) {
          const existing = snap.ccso.find((r) => r.period === m.period && r.channel_label === c.channelLabel);
          if (existing && !same(existing.sales, c.sales)) noteReplace(existing, { table: 'client_channel_sales_other', period: m.period, key: c.channelLabel, old: { sales: num(existing.sales) }, new: { sales: c.sales } });
          await repo.upsertChannelSaleOther({ brandId, period: periodDate, channelLabel: c.channelLabel, sales: c.sales, userId, source, sourceRef: m.channelSourceRef ?? sourceRef }, db);
          rowsWritten += 1;
        }
        const delCcs = sortStale(snap.ccs.filter((r) => r.period === m.period && !planned.has(r.channel)), 'client_channel_sales_monthly', (r) => r.channel, (r) => num(r.sales));
        const delCcso = sortStale(snap.ccso.filter((r) => r.period === m.period && !plannedOther.has(r.channel_label)), 'client_channel_sales_other', (r) => r.channel_label, (r) => num(r.sales));
        await repo.deleteSyncedFactRows('client_channel_sales_monthly', delCcs, deletable, db);
        await repo.deleteSyncedFactRows('client_channel_sales_other', delCcso, deletable, db);
        const n = m.channels.length + m.otherChannels.length;
        if (n) await log('client_channel_sales_monthly', m.period, 'channel sales', n);
      }

      // --- platform spend --------------------------------------------
      const plannedPlatforms = new Set(m.platforms.map((p) => p.platform));
      for (const p of m.platforms) {
        const existing = snap.cps.find((r) => r.period === m.period && r.platform === p.platform);
        let metrics = p.metrics;
        if (spendMode === 'amount_only') {
          // The source owns amount_spent only. Funnel columns on the row were
          // typed by hand (possibly before an earlier run of this same sync)
          // and are kept; only a row from a RETIRED source is fully replaced,
          // since its funnel came from a source that no longer owns it.
          metrics = existing && !retiredSources.includes(existing.source)
            ? { ...Object.fromEntries(repo.CPS_COLUMNS.map((c) => [c, existing[c]])), amount_spent: p.metrics.amount_spent }
            : { amount_spent: p.metrics.amount_spent };
        }
        if (existing) {
          const changed = repo.CPS_COLUMNS.filter((c) => !same(existing[c], metrics[c] ?? null));
          if (changed.length) {
            noteReplace(existing, {
              table: 'client_platform_spend_monthly', period: m.period, key: p.platform,
              old: Object.fromEntries(changed.map((c) => [c, num(existing[c])])),
              new: Object.fromEntries(changed.map((c) => [c, metrics[c] ?? null])),
            });
          }
        }
        await repo.upsertPlatformSpend({
          brandId, period: periodDate, platform: p.platform, userId, metrics,
          source, sourceRef: p.sourceRef ?? sourceRef, ...partialFor(m.period, existing, nowMonth),
        }, db);
        rowsWritten += 1;
      }
      const delCps = sortStale(snap.cps.filter((r) => r.period === m.period && !plannedPlatforms.has(r.platform)), 'client_platform_spend_monthly', (r) => r.platform, (r) => num(r.amount_spent));
      await repo.deleteSyncedFactRows('client_platform_spend_monthly', delCps, deletable, db);
      if (m.platforms.length) await log('client_platform_spend_monthly', m.period, 'platform spend', m.platforms.length);
    }

    if (overwrittenManual.length) warnings.push({ code: 'overwrote_manual', severity: 'warning', message: `${overwrittenManual.length} baris data manual ditimpa (nilai lama tersimpan di log).` });
    if (manualKept.length) warnings.push({ code: 'manual_rows_not_in_source', severity: 'info', message: `${manualKept.length} baris data manual tidak ada padanannya di sumber — dibiarkan.` });

    const rejected = plan.months.filter((m) => m.rejected).map((m) => m.period);
    const status = rejected.length ? 'partial' : 'success';
    const warningCount = warnings.filter((w) => w.severity === 'warning').length;
    const details = {
      dry_run: dryRun,
      ...extraDetails,
      months_written: periods,
      months_rejected: rejected,
      overwritten_manual: overwrittenManual,
      replaced_retired_source: replacedRetired,
      deleted_stale: deletedStale,
      manual_rows_kept: manualKept,
      warnings: warnings.slice(0, 300),
    };

    await repo.logIngestion({
      brandId, targetTable: runTarget, source, method: dryRun ? `${method} (dry run)` : method,
      rowCount: rowsWritten, status, note, userId,
      runId, startedAt, finishedAt: new Date(), rowsRead: plan.rowsRead ?? null, rowsWritten,
      rowsSkipped: plan.rowsSkipped ?? 0, warningCount, details,
    }, db);
    if (o.afterWrite && !dryRun) await o.afterWrite(db);

    return {
      rollback: dryRun,
      result: {
        brandId, runId, dryRun, status,
        monthsSynced: periods,
        monthsSkipped: rejected,
        rowsWritten,
        warningCount,
        warnings: details.warnings,
        overwrittenManual,
        replacedRetiredSource: replacedRetired,
        deletedStale,
        manualRowsKept: manualKept,
      },
    };
  }).then((r) => r.result);
}

// A run that failed before anything could be written still leaves a trace.
export async function logFailedRun({ brandId, userId, source, runTarget, method, note = null, error }) {
  const now = new Date();
  await repo.logIngestion({
    brandId, targetTable: runTarget, source, method, rowCount: 0, status: 'failed', note, userId,
    runId: crypto.randomUUID(), startedAt: now, finishedAt: now, rowsRead: 0, rowsWritten: 0, rowsSkipped: 0,
    warningCount: 0, details: { error },
  });
}
