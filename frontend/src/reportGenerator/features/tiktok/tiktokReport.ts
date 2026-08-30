import type { KpiRowDisplay } from '../../components/KpiTable';
import { comparePeriodDays } from '../../lib/periodLabel';
import { buildTiktokKPIRows, calcTiktokMetrics } from '../../lib/tiktok';
import { toSummaryKpi, type SpendEntry, type SummaryKpi } from '../../lib/summary';
import type { SheetRow } from '../../lib/types';

export interface TiktokReport {
  p1: string;
  p2: string;
  rows: KpiRowDisplay[];
  // Fase 1: non-null when the old/cur periods differ in length by more than
  // a day.
  periodWarning: string | null;
  summary: {
    kpis: SummaryKpi[];
    spend: Record<string, SpendEntry | undefined>;
  };
}

// Ported from the TikTok branch of the original generate() — a single fixed
// KPI table (Cost, Order, Cost per Order, Gross Revenue, AOV, ROI), no
// Overview/Detailed split and no metric picker (TikTok never had one).
export function buildTiktokReport(p1: string, p2: string, periodOldDays: number | null, periodCurDays: number | null, oldRows: SheetRow[], curRows: SheetRow[]): TiktokReport {
  const mOld = calcTiktokMetrics(oldRows);
  const mCur = calcTiktokMetrics(curRows);
  const rows = buildTiktokKPIRows(mOld, mCur);
  const summaryKpis = rows.map((r) => toSummaryKpi(r));
  const spend: Record<string, SpendEntry | undefined> = { overall: { old: mOld.cost, cur: mCur.cost } };
  const periodWarning = comparePeriodDays(periodOldDays, periodCurDays);
  return { p1, p2, rows, periodWarning, summary: { kpis: summaryKpis, spend } };
}
