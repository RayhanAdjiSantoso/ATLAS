import type { KpiRowDisplay } from '../../components/KpiTable';
import type { DetailedRow } from '../../components/OverviewDetailedCard';
import {
  DEFS,
  agg,
  buildCprRow,
  buildKPI,
  displayName,
  getOverviewDefs,
  groupByCamp,
  isAllValue,
  isNumericCol,
  isReachDependentCol,
  parseMetaMonthValue,
  reachIsApproximated,
  splitByDayRange,
  splitMonths,
  stripCampaignSubtotals,
  type CprRow,
  type MetaIndustry,
  type MetaKpiRow,
} from '../../lib/meta';
import { findCol, matchDef } from '../../lib/columns';
import { toISODate } from '../../lib/dateFmt';
import { buildParsedPeriod, comparePeriodDays, daysBetweenInclusive, type ParsedPeriod } from '../../lib/periodLabel';
import { toSummaryKpi, type SpendEntry, type SummaryKpi } from '../../lib/summary';
import type { SheetRow } from '../../lib/types';

export interface OverviewDetailedData {
  overviewRows: KpiRowDisplay[];
  detailedRows: DetailedRow[];
  allCols: string[];
}

export interface DemoData {
  rows: SheetRow[];
  dimCol: string;
  defaultCols: string[];
  allCols: string[];
}

export interface CpasSections {
  // CPAS is its own file with its own Month breakdown — its comparison
  // periods are whatever two months that file spans, independent of the
  // main-account file's periods (which can be a custom Day-breakdown
  // sub-range like "1-15 Jul"). Rendered as the CPAS cards' column headers
  // instead of the main report's p1/p2.
  p1: string;
  p2: string;
  overall?: OverviewDetailedData;
  ageDemo?: DemoData;
  genderDemo?: DemoData;
  nv?: OverviewDetailedData;
  rm?: OverviewDetailedData;
}

export interface MetaReport {
  p1: string;
  p2: string;
  // ISO "YYYY-MM-DD" dates backing p1/p2 (Fase 2: needed to key a saved
  // report_run's unique brand+platform+period scope) — null when the
  // "Month" column couldn't be parsed into a date.
  periodOldStart: string | null;
  periodOldEnd: string | null;
  periodCurStart: string | null;
  periodCurEnd: string | null;
  // Fase 1: non-null when the old/cur periods differ in length by more than
  // a day.
  periodWarning: string | null;
  // Non-null when the source file is a Day breakdown and the old or cur
  // selection spans more than one day — Reach/Frequency/Cost per Reach are
  // left out of every column list in that case (see the mAllCols filter in
  // buildMetaReport, right below the dayRanges branch that sets this).
  reachWarning: string | null;
  // Non-null (and reachWarning null) when the file has an Age or Gender
  // breakdown column — Reach/Frequency are still shown (summed per
  // campaign/month), but Meta's own Reach estimate for a breakdown cell
  // doesn't add up exactly to its collapsed "All ages/All genders" total, so
  // this sum can be a few percent off from Ads Manager. See buildMetaReport.
  reachApproxNote: string | null;
  boost?: OverviewDetailedData;
  nonBoost?: OverviewDetailedData;
  boostAgeDemo?: DemoData;
  boostGenderDemo?: DemoData;
  ageDemo?: DemoData;
  genderDemo?: DemoData;
  cpas?: CpasSections;
  summary: {
    kpis: SummaryKpi[];
    cpasKpis: SummaryKpi[];
    spend: Record<string, SpendEntry | undefined>;
  };
}

function toDisplayRows(rows: MetaKpiRow[]): DetailedRow[] {
  return rows.map((r) => ({ col: r.col, label: displayName(r.col), old: r.old, cur: r.val, delta: r.delta, cls: r.cls }));
}

// Feeds the Summary Overview tab: prefixes each Overview row's label with its
// section name (e.g. "Boost Post · Amount Spent") the same way the original
// generate() did inline while building each card.
function toSummaryRows(rows: (MetaKpiRow | CprRow)[], prefix: string): SummaryKpi[] {
  return rows.map((r) => {
    const label = 'col' in r ? displayName(r.col) : r.label;
    return toSummaryKpi({ ...r, label: `${prefix} · ${label}` });
  });
}

// A campaign name is treated as a "Boost Post" row if it looks like an
// Instagram/Facebook post-boost campaign rather than a regular ad set.
// Exported so the Fase 2 save-to-database row mapping can classify each raw
// row into the same boost/nonboost channel this report used, without
// duplicating the classification rule.
export function isBoostRow(campCol: string | null) {
  return (r: SheetRow) => {
    const v = String((campCol ? r[campCol] : '') || '').toLowerCase();
    return v.includes('profile visit') || v.includes('instagram post') || /\bpv\b/.test(v) || /\bpost\b/.test(v);
  };
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface BuildMetaReportInput {
  metaRows: SheetRow[];
  metaHeaders: string[];
  // CPAS is entirely optional and driven by whether a CPAS file was
  // actually uploaded — no separate enable/disable toggle. Pass null/[]
  // when there's no CPAS file and the report simply won't have a CPAS
  // section, no explicit "off" state needed.
  cpasRows: SheetRow[] | null;
  cpasHeaders: string[];
  industry: MetaIndustry;
  customResultsCol: string | null;
  // When metaRows came from Meta's per-day breakdown export (a "Day" column
  // instead of "Month"), old/cur are picked by these explicit date ranges
  // instead of relying on Meta's own month-bucket boundaries — see
  // lib/meta.ts's splitByDayRange. Ignored for a Month-breakdown file.
  dayRanges?: { old: DateRange; cur: DateRange } | null;
}

// Ported from the Meta branch of the original generate() — builds every
// section's data (Overview/Detailed rows, Age/Gender breakdown datasets) so
// the MetaTab component can render them as JSX instead of HTML strings. The
// cross-platform Summary Overview feed (platformState.meta) is intentionally
// not built here — that's designed together with the other platforms in the
// Business/Summary Overview checkpoint.
export function buildMetaReport({ metaRows, metaHeaders, cpasRows, cpasHeaders, industry, customResultsCol, dayRanges }: BuildMetaReportInput): MetaReport {
  const mMonthCol = findCol(metaRows, ['month']);
  const mDayCol = findCol(metaRows, ['day']);
  const mCampCol = findCol(metaRows, ['campaign']);
  const mAgeCol = findCol(metaRows, ['age']);
  const mGenderCol = findCol(metaRows, ['gender']);

  let mOld: SheetRow[];
  let mCur: SheetRow[];
  let oldPeriod: ParsedPeriod;
  let curPeriod: ParsedPeriod;
  // Non-null only for a Day-breakdown file whose old or cur selection spans
  // more than one day — see the mAllCols filter below for why that
  // specifically (not the Month-breakdown path, and not a single-day
  // selection) makes Reach/Frequency untrustworthy.
  let reachWarning: string | null = null;
  if (mDayCol && dayRanges) {
    const split = splitByDayRange(metaRows, mDayCol, dayRanges.old, dayRanges.cur);
    mOld = split.old;
    mCur = split.cur;
    oldPeriod = buildParsedPeriod(dayRanges.old.start, dayRanges.old.end);
    curPeriod = buildParsedPeriod(dayRanges.cur.start, dayRanges.cur.end);
    const oldSpansMultipleDays = daysBetweenInclusive(dayRanges.old.start, dayRanges.old.end) > 1;
    const curSpansMultipleDays = daysBetweenInclusive(dayRanges.cur.start, dayRanges.cur.end) > 1;
    if (oldSpansMultipleDays || curSpansMultipleDays) {
      reachWarning =
        'Reach, Frequency, dan Cost per Reach tidak ditampilkan (—): file ini memakai breakdown Day, hasil tidak valid saat dijumlahkan, hasil penjumlahannya dapat jauh lebih tinggi dari hasil sebenarnya di Ads Manager. Ganti ke breakdown Month untuk rentang tanggal yang sama, dengan format export "Formatted data table (.xlsx)".';
    }
  } else {
    const { old, cur, months } = splitMonths(metaRows, mMonthCol);
    mOld = old;
    mCur = cur;
    oldPeriod = parseMetaMonthValue(months[0]);
    curPeriod = parseMetaMonthValue(months[months.length - 1]);
  }
  // Keep only leaf rows (a specific campaign) — drop every pivot SUBTOTAL
  // row (Campaign name "All"/blank) before classification and aggregation.
  // A subtotal's "All" name matches no Boost-Post pattern, so it would
  // default into Non-Boost and add a full extra copy of the account's spend
  // there (verified against a real "Report Otomatis – Boost Post" export:
  // Non-Boost Amount Spent came out as leaf-total + one grand-total row).
  mOld = stripCampaignSubtotals(mOld);
  mCur = stripCampaignSubtotals(mCur);
  const p1 = oldPeriod.label;
  const p2 = curPeriod.label;
  const periodWarning = comparePeriodDays(oldPeriod.days, curPeriod.days);
  const mDimCols = [mMonthCol, mDayCol, mCampCol, mAgeCol, mGenderCol].filter((c): c is string => Boolean(c));
  let mAllCols = metaHeaders.filter((h) => isNumericCol(h, metaRows) && !mDimCols.includes(h));
  // Drop Reach/Frequency/Cost per Reach entirely when reachWarning is set,
  // instead of computing and showing a number that's known to be wrong (see
  // the dayRanges branch above) — neither the Boost/Non-Boost Detailed
  // picker nor the Age/Gender Breakdown cards (which both source their
  // column list from mAllCols) can offer them for a multi-day Day-breakdown
  // selection. None of getOverviewDefs' fixed default columns are
  // Reach/Frequency, so this never empties an Overview table.
  if (reachWarning) {
    mAllCols = mAllCols.filter((c) => !isReachDependentCol(c));
  }
  // Reach itself is read straight from a campaign's own Age=All/Gender=All
  // row when the file has one (agg()/sumReachPreferAllRows in lib/meta.ts) —
  // that matches Ads Manager's collapsed figure exactly, since Meta reports
  // it directly instead of us summing anything. reachApproxNote only fires
  // when at least one campaign has NO such row and had to be summed from its
  // individual Age/Gender breakdown cells instead — Meta's per-cell Reach is
  // its own separate estimate, not a slice of one precise total, so that sum
  // can land a few percent off Ads Manager's own number (verified against a
  // real export missing an "All" row: 1,367,235 summed vs 1,397,733 in Ads
  // Manager's Age=All/Gender=All pivot for the same campaign+month). This is
  // Meta's own non-additive reach modeling for a file with no coarser row to
  // read the exact figure from — only re-exporting without the Age/Gender
  // breakdown (or with the "All" rows Ads Manager's Pivot Table can include)
  // gets Ads Manager's exact number.
  const reachColName = metaHeaders.find((h) => h.toLowerCase().includes('reach') && !h.toLowerCase().includes('cost'));
  const reachApproxNote =
    !reachWarning && (mAgeCol || mGenderCol) && reachColName && mAllCols.some((c) => isReachDependentCol(c)) && (reachIsApproximated(mOld, reachColName) || reachIsApproximated(mCur, reachColName))
      ? 'Reach & Frequency di atas dijumlahkan dari breakdown Age/Gender per campaign yang tidak punya baris Age=All/Gender=All, dan bisa berbeda beberapa persen dari Meta Ads Manager — Reach adalah estimasi Meta sendiri yang tidak dijumlahkan persis dari breakdown-nya (Ads Manager pun menghitung ulang, bukan menjumlahkan, saat Age/Gender di-collapse ke "All"). Untuk angka yang persis sama dengan Ads Manager, export dari Meta Ads Reporting dengan format "Formatted data table (.xlsx)" — file ini menyertakan baris Age=All/Gender=All per campaign, dan begitu tersedia semua metrik otomatis memakai angka itu langsung.'
      : null;

  const isBoost = isBoostRow(mCampCol);
  const mBoostOld = mOld.filter(isBoost);
  const mBoostCur = mCur.filter(isBoost);
  const mNonOld = mOld.filter((r) => !isBoost(r));
  const mNonCur = mCur.filter((r) => !isBoost(r));
  const hasNonBoost = mNonOld.length > 0 || mNonCur.length > 0;
  const hasBoost = mBoostOld.length > 0 || mBoostCur.length > 0;
  const ovDefs = getOverviewDefs(industry, mAllCols, customResultsCol);
  const mSpentCol = mAllCols.find((c) => c.toLowerCase().includes('amount spent'));

  const report: MetaReport = {
    p1,
    p2,
    periodOldStart: toISODate(oldPeriod.start),
    periodOldEnd: toISODate(oldPeriod.end),
    periodCurStart: toISODate(curPeriod.start),
    periodCurEnd: toISODate(curPeriod.end),
    periodWarning,
    reachWarning,
    reachApproxNote,
    summary: { kpis: [], cpasKpis: [], spend: {} },
  };
  const metaKpis: SummaryKpi[] = [];
  const metaSpend: Record<string, SpendEntry | undefined> = {};

  if (hasBoost) {
    const boostKpiRows = buildKPI(mBoostOld, mBoostCur, ovDefs.boost.cols);
    const boostOvRows: KpiRowDisplay[] = toDisplayRows(boostKpiRows);
    const boostCpr = buildCprRow(ovDefs.boost.cprPair, mBoostOld, mBoostCur);
    if (boostCpr) boostOvRows.push(boostCpr);
    report.boost = { overviewRows: boostOvRows, detailedRows: toDisplayRows(buildKPI(mBoostOld, mBoostCur, mAllCols)), allCols: mAllCols };
    metaKpis.push(...toSummaryRows(boostKpiRows, 'Boost Post'));
    if (boostCpr) metaKpis.push(...toSummaryRows([boostCpr], 'Boost Post'));
    if (mSpentCol) metaSpend.boost = { old: agg(mBoostOld, mSpentCol), cur: agg(mBoostCur, mSpentCol) };
  }

  if (hasNonBoost && ovDefs.main && ovDefs.main.cols.length) {
    const mainKpiRows = buildKPI(mNonOld, mNonCur, ovDefs.main.cols);
    const mainOvRows: KpiRowDisplay[] = toDisplayRows(mainKpiRows);
    const mainCpr = buildCprRow(ovDefs.main.cprPair, mNonOld, mNonCur);
    if (mainCpr) mainOvRows.push(mainCpr);
    report.nonBoost = { overviewRows: mainOvRows, detailedRows: toDisplayRows(buildKPI(mNonOld, mNonCur, mAllCols)), allCols: mAllCols };
    metaKpis.push(...toSummaryRows(mainKpiRows, 'Non-Boost Post'));
    if (mainCpr) metaKpis.push(...toSummaryRows([mainCpr], 'Non-Boost Post'));
    if (mSpentCol) metaSpend.nonboost = { old: agg(mNonOld, mSpentCol), cur: agg(mNonCur, mSpentCol) };
  }

  const defDemo = matchDef(DEFS.nonBoostDemo, mAllCols);
  const demoDefCols = defDemo.length ? defDemo : mAllCols.slice(0, 3);
  // A "Formatted data table" export's Age=All/Gender=All rollup row (and,
  // for the age breakdown, its per-age Gender=All rollup rows) exist to give
  // agg() an exact per-campaign figure to prefer — not to be shown as if
  // "All" were itself an age/gender segment alongside 18-24, female, etc.
  // Left in, groupByDim would render it as its own pie slice/table row,
  // double-displaying the same spend the real segments already show.
  if (hasNonBoost && mAgeCol) report.ageDemo = { rows: mNonCur.filter((r) => !isAllValue(r[mAgeCol])), dimCol: mAgeCol, defaultCols: demoDefCols, allCols: mAllCols };
  if (hasNonBoost && mGenderCol) report.genderDemo = { rows: mNonCur.filter((r) => !isAllValue(r[mGenderCol])), dimCol: mGenderCol, defaultCols: demoDefCols, allCols: mAllCols };
  // Boost Post gets the same Age/Gender breakdown treatment as Non-Boost —
  // same demoDefCols/mAllCols, just sourced from the boost-classified current
  // period rows instead of mNonCur.
  if (hasBoost && mAgeCol) report.boostAgeDemo = { rows: mBoostCur.filter((r) => !isAllValue(r[mAgeCol])), dimCol: mAgeCol, defaultCols: demoDefCols, allCols: mAllCols };
  if (hasBoost && mGenderCol) report.boostGenderDemo = { rows: mBoostCur.filter((r) => !isAllValue(r[mGenderCol])), dimCol: mGenderCol, defaultCols: demoDefCols, allCols: mAllCols };

  if (cpasRows && cpasRows.length) {
    const cMonthCol = findCol(cpasRows, ['month']);
    const cCampCol = findCol(cpasRows, ['campaign']);
    const cAgeCol = findCol(cpasRows, ['age']);
    const cGenderCol = findCol(cpasRows, ['gender']);
    const cDimCols = [cMonthCol, cCampCol, cAgeCol, cGenderCol].filter((c): c is string => Boolean(c));
    // Same pivot-subtotal drop as the Boost/Non-Boost path above — without
    // it the "Overall" tab double-counts every absolute metric (the NV/RM
    // tabs happen to escape it only because groupByCamp's "NV"/"RM" regex
    // never matches a subtotal's "All" campaign name).
    const { old: cOld, cur: cCur, months: cMonths } = splitMonths(stripCampaignSubtotals(cpasRows), cMonthCol);
    // CPAS has its own comparison periods — the two calendar months its file
    // spans — not the main-account file's p1/p2 (which may be a custom
    // Day-breakdown sub-range). Fall back to the main periods only if the
    // CPAS Month column couldn't be parsed into labels.
    const cOldPeriod = parseMetaMonthValue(cMonths[0]);
    const cCurPeriod = parseMetaMonthValue(cMonths[cMonths.length - 1]);
    const cP1 = cOldPeriod.label || p1;
    const cP2 = cCurPeriod.label || p2;
    const cAllCols = cpasHeaders.filter((h) => isNumericCol(h, cpasRows) && !cDimCols.includes(h));
    const defCpasOverall = matchDef(DEFS.cpasOverall, cAllCols);
    const defCpasDemo = matchDef(DEFS.cpasDemo, cAllCols);
    const defCpasNV = matchDef(DEFS.cpasNV, cAllCols);
    const defCpasRM = matchDef(DEFS.cpasRM, cAllCols);
    const cpasGrpOld = groupByCamp(cOld, cCampCol, ['NV', 'RM']);
    const cpasGrpCur = groupByCamp(cCur, cCampCol, ['NV', 'RM']);
    const cSpentCol = cAllCols.find((c) => c.toLowerCase().includes('amount spent'));
    const cpasKpis: SummaryKpi[] = [];

    const cpas: CpasSections = { p1: cP1, p2: cP2 };
    if (defCpasOverall.length) {
      const overallKpiRows = buildKPI(cOld, cCur, defCpasOverall);
      cpas.overall = { overviewRows: toDisplayRows(overallKpiRows), detailedRows: toDisplayRows(buildKPI(cOld, cCur, cAllCols)), allCols: cAllCols };
      metaKpis.push(...toSummaryRows(overallKpiRows, 'CPAS Marketplace'));
      cpasKpis.push(...toSummaryRows(overallKpiRows, 'Overall'));
      if (cSpentCol) metaSpend.cpasOverall = { old: agg(cOld, cSpentCol), cur: agg(cCur, cSpentCol) };
    }
    if (defCpasDemo.length && cAgeCol) cpas.ageDemo = { rows: cCur.filter((r) => !isAllValue(r[cAgeCol])), dimCol: cAgeCol, defaultCols: defCpasDemo, allCols: cAllCols };
    if (defCpasDemo.length && cGenderCol) cpas.genderDemo = { rows: cCur.filter((r) => !isAllValue(r[cGenderCol])), dimCol: cGenderCol, defaultCols: defCpasDemo, allCols: cAllCols };
    if (defCpasNV.length) {
      const nvOld = cpasGrpOld['NV'] || [];
      const nvCur = cpasGrpCur['NV'] || [];
      const nvKpiRows = buildKPI(nvOld, nvCur, defCpasNV);
      cpas.nv = { overviewRows: toDisplayRows(nvKpiRows), detailedRows: toDisplayRows(buildKPI(nvOld, nvCur, cAllCols)), allCols: cAllCols };
      metaKpis.push(...toSummaryRows(nvKpiRows, 'CPAS Marketplace · NV'));
      cpasKpis.push(...toSummaryRows(nvKpiRows, 'NV'));
      if (cSpentCol) metaSpend.cpasNV = { old: agg(nvOld, cSpentCol), cur: agg(nvCur, cSpentCol) };
    }
    if (defCpasRM.length) {
      const rmOld = cpasGrpOld['RM'] || [];
      const rmCur = cpasGrpCur['RM'] || [];
      const rmKpiRows = buildKPI(rmOld, rmCur, defCpasRM);
      cpas.rm = { overviewRows: toDisplayRows(rmKpiRows), detailedRows: toDisplayRows(buildKPI(rmOld, rmCur, cAllCols)), allCols: cAllCols };
      metaKpis.push(...toSummaryRows(rmKpiRows, 'CPAS Marketplace · RM'));
      cpasKpis.push(...toSummaryRows(rmKpiRows, 'RM'));
      if (cSpentCol) metaSpend.cpasRM = { old: agg(rmOld, cSpentCol), cur: agg(rmCur, cSpentCol) };
    }
    // Only expose the CPAS section when at least one sub-section actually
    // matched — `cpas` always carries p1/p2, so an Object.keys() length check
    // downstream would otherwise treat a column-less file as "has CPAS".
    if (cpas.overall || cpas.nv || cpas.rm || cpas.ageDemo || cpas.genderDemo) {
      report.cpas = cpas;
      report.summary.cpasKpis = cpasKpis;
    }
  }

  report.summary.kpis = metaKpis;
  report.summary.spend = metaSpend;
  return report;
}
