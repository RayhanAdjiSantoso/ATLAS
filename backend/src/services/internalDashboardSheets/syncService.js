import pool from '../../config/db.js';
import { AppError } from '../../utils/errors.js';
import * as repo from '../../repositories/internalDashboardRepository.js';
import { callSheetsAppsScript } from './sheetsGateway.js';
import { mapSheetToFacts } from './mapSheetToFacts.js';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "Jan" -> "01", … matches the "YYYY-MM" shape the rest of the Internal
// Dashboard backend speaks (see internalDashboardService.js's toPeriodDate).
const monthToPeriodSuffix = (month) => String(MONTH_LABELS.indexOf(month) + 1).padStart(2, '0');

async function getSheetSource(brandId) {
  const { rows } = await pool.query(
    `SELECT spreadsheet_id, spreadsheet_title, tab_name, is_active, is_verified
     FROM brand_sheet_sources WHERE brand_id = $1`,
    [brandId]
  );
  const source = rows[0];
  if (!source) throw new AppError('Brand ini belum punya sumber Google Sheets (brand_sheet_sources kosong)', 404);
  if (!source.is_active) throw new AppError(`Sumber Sheets untuk brand ini nonaktif: ${source.note || 'lihat brand_sheet_sources.note'}`, 409);
  return source;
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

// Syncs one brand's live Sheets data for every month that has a non-null
// "Total Revenue" cell (mapSheetToFacts returns monthlyMetric: null for a
// month with nothing entered yet — those are skipped, never written as
// zero). Writes go through the exact same repo upserts + logIngestion the
// manual forms use, just tagged source='google_sheets', so S1-S8 read
// identically regardless of how a brand's data arrived.
export async function syncBrandFromSheets(brandId, userId) {
  const source = await getSheetSource(brandId);

  let data;
  try {
    data = await callSheetsAppsScript('getMonthlyPerformance', {
      spreadsheetId: source.spreadsheet_id,
      tabName: source.tab_name,
    });
  } catch (err) {
    await repo.touchSheetSourceSync(brandId, err.message);
    throw err;
  }

  const results = { brandId, monthsSynced: [], monthsSkipped: [], platformRowsWritten: 0 };

  for (const month of MONTH_LABELS) {
    const facts = mapSheetToFacts(data.rows, month);
    if (!facts.monthlyMetric) {
      results.monthsSkipped.push(month);
      continue;
    }
    const period = `${data.year}-${monthToPeriodSuffix(month)}-01`;

    await inTransaction(async (db) => {
      const cmmRes = await repo.upsertMonthlyMetric(
        { brandId, period, ...facts.monthlyMetric, targetSales: null, isPartialMonth: false, userId },
        db
      );
      await repo.logIngestion(
        {
          brandId, targetTable: 'client_monthly_metrics', period, source: 'google_sheets',
          method: cmmRes.was_insert ? 'sheets sync (insert)' : 'sheets sync (update)',
          rowCount: 1, status: 'success', note: source.spreadsheet_title, userId,
        },
        db
      );

      for (const p of facts.platformSpend) {
        const cpsRes = await repo.upsertPlatformSpend({ brandId, period, platform: p.platform, userId, metrics: p.metrics }, db);
        await repo.logIngestion(
          {
            brandId, targetTable: 'client_platform_spend_monthly', period, source: 'google_sheets',
            method: `${cpsRes.was_insert ? 'sheets sync (insert)' : 'sheets sync (update)'} (${p.platform})`,
            rowCount: 1, status: 'success', note: source.spreadsheet_title, userId,
          },
          db
        );
        results.platformRowsWritten += 1;
      }
    });

    results.monthsSynced.push(month);
  }

  await repo.touchSheetSourceSync(brandId, null);
  return results;
}
