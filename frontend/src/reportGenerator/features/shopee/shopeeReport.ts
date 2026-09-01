import type { KpiRowDisplay } from '../../components/KpiTable';
import type { DetailedRow } from '../../components/OverviewDetailedCard';
import { comparePeriodDays } from '../../lib/periodLabel';
import { SHOPEE_METRIC_DEFS, buildShopeeKPIRows, calcShopeeMetrics } from '../../lib/shopeeAds';
import { buildOverviewCalcRows, buildOverviewKPIRows, calcOverviewMetrics, type OverviewKpiRow } from '../../lib/shopeeOverview';
import { toSummaryKpi, type SpendEntry, type SummaryKpi } from '../../lib/summary';
import type { SheetRow } from '../../lib/types';

// Fixed default metrics shown in the Shopee Ads Overview table (matches the
// original's shopeeOvKeys) — everything else is only shown once added via
// the Detailed picker.
const SHOPEE_OVERVIEW_KEYS = ['biaya', 'produkTerjual', 'aov', 'roas'];

export interface ShopeeReport {
  p1: string;
  p2: string;
  overviewRows: KpiRowDisplay[];
  detailedRows: DetailedRow[];
  allCols: string[];
  productOverviewRows: OverviewKpiRow[] | null;
  // Fase 1: non-null when the old/cur periods differ in length by more than
  // a day, so a %Change reader knows it isn't a like-for-like comparison.
  periodWarning: string | null;
  summary: {
    kpis: SummaryKpi[];
    spend: Record<string, SpendEntry | undefined>;
  };
}

export interface BuildShopeeReportInput {
  p1: string;
  p2: string;
  periodOldDays: number | null;
  periodCurDays: number | null;
  tokoOld: SheetRow[];
  tokoCur: SheetRow[];
  produkOld: SheetRow[];
  produkCur: SheetRow[];
  omzetOld: number;
  omzetCur: number;
  overviewOldRows: SheetRow[] | null;
  overviewCurRows: SheetRow[] | null;
}

// Ported from the Shopee branch of the original generate(): combines Iklan
// Toko + Iklan Produk into one KPI set (Overview + Detailed picker, same card
// shape as Meta's Boost/Non-Boost Post), plus an optional Product Overview
// table when both periods' overview files are present.
export function buildShopeeReport({ p1, p2, periodOldDays, periodCurDays, tokoOld, tokoCur, produkOld, produkCur, omzetOld, omzetCur, overviewOldRows, overviewCurRows }: BuildShopeeReportInput): ShopeeReport {
  const mOld = calcShopeeMetrics(tokoOld, produkOld, omzetOld);
  const mCur = calcShopeeMetrics(tokoCur, produkCur, omzetCur);
  const allRows = buildShopeeKPIRows(mOld, mCur);

  const overviewRows: KpiRowDisplay[] = allRows.filter((r) => SHOPEE_OVERVIEW_KEYS.includes(r.key));
  const detailedRows: DetailedRow[] = allRows.map((r) => ({ col: r.col, label: r.label, old: r.old, cur: r.cur, delta: r.delta, cls: r.cls }));
  const allCols = SHOPEE_METRIC_DEFS.map((d) => d.key);

  const overviewMOld = overviewOldRows ? calcOverviewMetrics(overviewOldRows) : null;
  const overviewMCur = overviewCurRows ? calcOverviewMetrics(overviewCurRows) : null;
  // Base 7 metrics + the 4 derived Conversion/Ratio metrics in one table.
  const productOverviewRows =
    overviewMOld && overviewMCur ? [...buildOverviewKPIRows(overviewMOld, overviewMCur), ...buildOverviewCalcRows(overviewMOld, overviewMCur)] : null;
  const periodWarning = comparePeriodDays(periodOldDays, periodCurDays);

  // Feeds the Summary Overview tab — unlike Meta (which only surfaces its
  // fixed Overview metrics), the original pushes *all* Shopee metrics here.
  const summaryKpis = allRows.map((r) => toSummaryKpi(r));
  const spend: Record<string, SpendEntry | undefined> = { ads: { old: mOld.biaya, cur: mCur.biaya } };

  return { p1, p2, overviewRows, detailedRows, allCols, productOverviewRows, periodWarning, summary: { kpis: summaryKpis, spend } };
}
