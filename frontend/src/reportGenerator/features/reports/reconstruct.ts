import { buildMetaReport, type MetaReport } from '../meta/metaReport';
import { buildShopeeReport, type ShopeeReport } from '../shopee/shopeeReport';
import { buildShopeeDeepDiveReport, type ShopeeDeepDiveReport } from '../shopee/shopeeDeepDiveReport';
import { buildShopeeFunnelReport, type ShopeeFunnelReport } from '../shopee/shopeeFunnelReport';
import { buildTiktokReport, type TiktokReport } from '../tiktok/tiktokReport';
import { findCol } from '../../lib/columns';
import type { MetaIndustry } from '../../lib/meta';
import { daysBetweenInclusive } from '../../lib/periodLabel';
import type { ProductMasterEntry } from '../../lib/shopeeDeepDive';
import type { DailyTrendMetricSelection } from '../../lib/shopeeDeepDiveInsights';
import type { MetricSelection } from '../../lib/shopeeDeepDiveItemPivot';
import type { SheetRow } from '../../lib/types';
import type { ReportDetail } from './types';

// Rehydrates a saved report_run + its fact rows back into the same
// MetaReport/ShopeeReport/TiktokReport shape the tab's own generate() step
// produces, by feeding the rows' `extra` (the complete original parsed row,
// stashed verbatim at save time) back through the exact same
// buildXReport() functions — so Report History renders with zero
// duplicated report logic and stays byte-for-byte consistent with a live
// generate().
//
// Shopee's Product Overview IS persisted now (shopee_store_overview_daily,
// brand-scoped daily rows) — the detail endpoint returns the rows for each
// period's date range as detail.overviewOld/overviewCur. Product Performance
// (no date column) still isn't, so Pareto/Traffic/Conversion stay absent on
// a reopened report.

function extraOf(row: Record<string, unknown>): SheetRow {
  return (row.extra as SheetRow | null) ?? {};
}

function parseISODate(s: string | null): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function daysOf(start: string | null, end: string | null): number | null {
  const s = parseISODate(start);
  const e = parseISODate(end);
  return s && e ? daysBetweenInclusive(s, e) : null;
}

export function reconstructShopeeReport(detail: ReportDetail): ShopeeReport {
  const { report, rows } = detail;
  const byChannelRole = (channel: string, role: string) => rows.filter((r) => r.channel === channel && r.period_role === role).map((r) => extraOf(r));
  const config = (report.reportConfig ?? {}) as { omzetOld?: number; omzetCur?: number };
  return buildShopeeReport({
    p1: report.periodOldLabel ?? '',
    p2: report.periodCurLabel ?? '',
    periodOldDays: daysOf(report.periodOldStart, report.periodOldEnd),
    periodCurDays: daysOf(report.periodCurStart, report.periodCurEnd),
    tokoOld: byChannelRole('toko', 'old'),
    tokoCur: byChannelRole('toko', 'cur'),
    produkOld: byChannelRole('produk', 'old'),
    produkCur: byChannelRole('produk', 'cur'),
    omzetOld: config.omzetOld ?? 0,
    omzetCur: config.omzetCur ?? 0,
    overviewOldRows: detail.overviewOld ?? null,
    overviewCurRows: detail.overviewCur ?? null,
  });
}

interface ShopeeReconstructSelections {
  produkSelections?: readonly MetricSelection[] | null;
  keywordSelections?: readonly MetricSelection[] | null;
  dailyTrendSelections?: readonly DailyTrendMetricSelection[] | null;
}

// The deep-dive + funnel halves of the Shopee report — same builders the
// tab's generate() uses. Saved produk rows are already merged with Produk
// Otomatis (rowMapping folds them in at save time), so the *Otomatis inputs
// are empty here. Product Performance isn't persisted, so Pareto / Traffic /
// Conversion fall back to their "no data" states.
export function reconstructShopeeDeepDive(detail: ReportDetail, productMaster: ProductMasterEntry[], selections: ShopeeReconstructSelections = {}): ShopeeDeepDiveReport {
  const { report, rows } = detail;
  const byChannelRole = (channel: string, role: string) => rows.filter((r) => r.channel === channel && r.period_role === role).map((r) => extraOf(r));
  const config = (report.reportConfig ?? {}) as { omzetOld?: number; omzetCur?: number };
  return buildShopeeDeepDiveReport({
    produkOld: byChannelRole('produk', 'old'),
    produkCur: byChannelRole('produk', 'cur'),
    produkOtomatisOld: [],
    produkOtomatisCur: [],
    tokoOld: byChannelRole('toko', 'old'),
    tokoCur: byChannelRole('toko', 'cur'),
    tokoKeywordOld: byChannelRole('toko_keyword', 'old'),
    tokoKeywordCur: byChannelRole('toko_keyword', 'cur'),
    liveOld: byChannelRole('live', 'old'),
    liveCur: byChannelRole('live', 'cur'),
    productPerformanceRows: null,
    tingkatkanDenganIklanRows: null,
    overviewOldRows: detail.overviewOld ?? null,
    overviewCurRows: detail.overviewCur ?? null,
    productMaster,
    omzetOld: config.omzetOld ?? 0,
    omzetCur: config.omzetCur ?? 0,
    produkSelections: selections.produkSelections ?? null,
    keywordSelections: selections.keywordSelections ?? null,
    dailyTrendSelections: selections.dailyTrendSelections ?? null,
  });
}

export function reconstructShopeeFunnel(detail: ReportDetail): ShopeeFunnelReport {
  const { report, rows } = detail;
  const byChannelRole = (channel: string, role: string) => rows.filter((r) => r.channel === channel && r.period_role === role).map((r) => extraOf(r));
  const config = (report.reportConfig ?? {}) as { omzetOld?: number; omzetCur?: number };
  return buildShopeeFunnelReport({
    produkOld: byChannelRole('produk', 'old'),
    produkCur: byChannelRole('produk', 'cur'),
    tokoOld: byChannelRole('toko', 'old'),
    tokoCur: byChannelRole('toko', 'cur'),
    liveOld: byChannelRole('live', 'old'),
    liveCur: byChannelRole('live', 'cur'),
    omzetOld: config.omzetOld ?? 0,
    omzetCur: config.omzetCur ?? 0,
    productPerfOld: null,
    productPerfCur: null,
  });
}

export function reconstructMetaReport(detail: ReportDetail): MetaReport {
  const { report, rows } = detail;
  const config = (report.reportConfig ?? {}) as {
    industry?: MetaIndustry;
    customResultsCol?: string | null;
    metaHeaders?: string[];
    cpasHeaders?: string[];
  };
  const mainRows = rows.filter((r) => r.channel === 'boost' || r.channel === 'nonboost').map((r) => extraOf(r));
  const cpasRowsAll = rows.filter((r) => r.channel === 'cpas_overall').map((r) => extraOf(r));
  // Prefer the header order captured at save time (see MetaTab's
  // buildSavePayload) over Object.keys() on the rehydrated rows — Postgres's
  // jsonb storage does not preserve object key order, which would otherwise
  // silently corrupt buildMetaReport's order-sensitive column matching.
  const metaHeaders = config.metaHeaders ?? (mainRows.length ? Object.keys(mainRows[0]) : []);
  const cpasHeaders = config.cpasHeaders ?? (cpasRowsAll.length ? Object.keys(cpasRowsAll[0]) : []);
  // Day-breakdown Meta files have no Month column at all — buildMetaReport
  // needs an explicit dayRanges to split them, otherwise it falls through to
  // the month-mode splitMonths() path and finds nothing to split on. The
  // exact old/cur boundaries the user picked at save time are recoverable
  // from the persisted period start/end dates, regardless of mode.
  const dayCol = findCol(mainRows, ['day']);
  const oldStart = parseISODate(report.periodOldStart);
  const oldEnd = parseISODate(report.periodOldEnd);
  const curStart = parseISODate(report.periodCurStart);
  const curEnd = parseISODate(report.periodCurEnd);
  const dayRanges = dayCol && oldStart && oldEnd && curStart && curEnd ? { old: { start: oldStart, end: oldEnd }, cur: { start: curStart, end: curEnd } } : null;
  return buildMetaReport({
    metaRows: mainRows,
    metaHeaders,
    cpasRows: cpasRowsAll.length ? cpasRowsAll : null,
    cpasHeaders,
    industry: config.industry ?? null,
    customResultsCol: config.customResultsCol ?? null,
    dayRanges,
  });
}

export function reconstructTiktokReport(detail: ReportDetail): TiktokReport {
  const { report, rows } = detail;
  const oldRows = rows.filter((r) => r.period_role === 'old').map((r) => extraOf(r));
  const curRows = rows.filter((r) => r.period_role === 'cur').map((r) => extraOf(r));
  return buildTiktokReport(report.periodOldLabel ?? '', report.periodCurLabel ?? '', daysOf(report.periodOldStart, report.periodOldEnd), daysOf(report.periodCurStart, report.periodCurEnd), oldRows, curRows);
}
