import type { KpiRowDisplay } from '../../components/KpiTable';
import { buildMetaOverviewRows, type MetaOverviewKind, type MetaOverviewRow } from '../../lib/metaOverview';
import type { DetailedRow } from '../../components/OverviewDetailedCard';
import {
  DEFS,
  META_OBJECTIVE_DEFS,
  META_OBJECTIVE_ORDER,
  agg,
  buildKPI,
  buildLabeledAggRow,
  displayName,
  groupByCamp,
  isAllValue,
  isNumericCol,
  isReachDependentCol,
  parseMetaMonthValue,
  reachIsApproximated,
  splitByDayRange,
  splitDayRowsByMonth,
  splitMonths,
  stripCampaignSubtotals,
  type CprRow,
  type MetaIndustry,
  type MetaKpiRow,
  type MetaObjectiveKey,
  resolveCampaignObjectives,
  type MetaObjectiveSource,
} from '../../lib/meta';
import { findCol, matchDef } from '../../lib/columns';
import { buildMetaBrandFunnel, buildMetaLeadFunnel, buildMetaSalesFunnel, leadResultKind, leadResultKinds, type LeadResultKind, type MetaFunnel } from '../../lib/metaFunnel';
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

// One objective's slice of the Non-Boost lane (Purchase / Leads / Traffic …).
export interface MetaObjectiveSegment {
  key: string;
  label: string;
  overview: OverviewDetailedData;
  spendOld: number | null;
  spendCur: number | null;
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
  // Root cause analysis for this channel — the sales funnel, same shape the
  // Shopee report draws.
  funnel?: MetaFunnel;
  // The same funnel, read for the New Visitor and Re-Marketing campaigns alone.
  nvFunnel?: MetaFunnel;
  rmFunnel?: MetaFunnel;
}

// Non-Boost Post read as two lanes, the way MIL plans it: Retail sells
// (purchase funnel), B2B Leads collects leads (form leads or chats). See
// laneOfCampaign for how each campaign is placed.
export type NonBoostLaneKey = 'retail' | 'b2b';

export interface NonBoostLane {
  key: NonBoostLaneKey;
  label: string;
  // The objectives that landed in this lane, for the "why" note.
  objectives: string[];
  // How the lane was decided for most of its spend.
  basis: 'name' | 'objective' | 'industry';
  overview: OverviewDetailedData;
  funnel: MetaFunnel;
  oldRows: SheetRow[];
  curRows: SheetRow[];
  campCol: string | null;
  ageCol: string | null;
  genderCol: string | null;
  // B2B only: the results this lane has a count for (leads / messaging
  // conversations started / messaging contacts), the one picked
  // automatically, and the table + root cause for each — the report lets the
  // user switch between them without generating again.
  leadResults?: {
    kinds: LeadResultKind[];
    auto: LeadResultKind;
    byKind: Partial<Record<LeadResultKind, { overviewRows: KpiRowDisplay[]; funnel: MetaFunnel }>>;
  };
}

export const NON_BOOST_LANE_LABEL: Record<NonBoostLaneKey, string> = { retail: 'Retail', b2b: 'B2B Leads' };

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
  // The Non-Boost lane. When the account runs one objective (or the file
  // carries no objective signal) this is the single Overview, industry-driven
  // as before. When it runs several, this holds the *blended* headline and
  // `nonBoostSegments` holds one Overview per objective.
  nonBoost?: OverviewDetailedData;
  nonBoostSegments?: MetaObjectiveSegment[];
  // How the split was derived — shown in the section note.
  nonBoostObjectiveSource?: MetaObjectiveSource;
  // Non-Boost objectives found (highest spend first), with their current rows.
  nonBoostObjectives?: { key: MetaObjectiveKey; label: string; rows: SheetRow[]; spend: number | null }[];
  // The objective Boost Post was bought on (highest spend), when recognisable.
  boostObjective?: { key: MetaObjectiveKey; label: string; source: MetaObjectiveSource; mixed: boolean };
  boostAgeDemo?: DemoData;
  boostGenderDemo?: DemoData;
  ageDemo?: DemoData;
  genderDemo?: DemoData;
  // Root cause analysis per channel. Boost Post decomposes Brand
  // Consideration; the two selling channels decompose GMV.
  boostFunnel?: MetaFunnel;
  nonBoostFunnel?: MetaFunnel;
  // Current-period rows per channel. Each section's Creative Performance
  // block breaks these down by
  // Ad, and it has to be the reported period alone — the combined row set
  // spans both periods and would silently average two months together.
  curRows?: { boost: SheetRow[]; nonBoost: SheetRow[]; cpas: SheetRow[] };
  cpas?: CpasSections;
  // Non-Boost split into Retail / B2B Leads; only lanes with rows.
  nonBoostLanes?: NonBoostLane[];
  // Columns the Audience/Creative sections need, per source.
  cols?: { campaign: string | null; age: string | null; gender: string | null; cpasCampaign: string | null; cpasAge: string | null; cpasGender: string | null };
  summary: {
    kpis: SummaryKpi[];
    cpasKpis: SummaryKpi[];
    spend: Record<string, SpendEntry | undefined>;
  };
}

// A column with no value in either period belongs to another campaign type
// (the Boost file's profile visits read on Non-Boost rows, a CPAS-only
// column…), so it is not offered under "+ Tambah metrik" here.
function toDisplayRows(rows: MetaKpiRow[]): DetailedRow[] {
  return rows
    .filter((r) => r.old !== '—' || r.val !== '—')
    .map((r) => ({ col: r.col, label: displayName(r.col), old: r.old, cur: r.val, delta: r.delta, cls: r.cls }));
}

// Default Overview rows (lib/metaOverview) as Summary Overview entries.
function overviewSummary(rows: MetaOverviewRow[], prefix: string): SummaryKpi[] {
  return rows.map((r) => toSummaryKpi({ ...r, key: r.label, label: `${prefix} · ${r.label}` }));
}

// Which default set a Non-Boost objective opens with: selling → E-commerce,
// anything else (leads, messages, traffic…) → B2B. Without any objective, the
// Industry pick decides.
function nonBoostKind(key: MetaObjectiveKey | null, industry: MetaIndustry): MetaOverviewKind {
  if (key) return key === 'sales' ? 'ecommerce' : 'b2b';
  return industry === 'b2b' ? 'b2b' : 'ecommerce';
}

// A campaign name is treated as a "Boost Post" row if it looks like an
// Instagram/Facebook post-boost campaign rather than a regular ad set.
// Exported so the Fase 2 save-to-database row mapping can classify each raw
// row into the same boost/nonboost channel this report used, without
// duplicating the classification rule.
//
// Files written by ATLAS's Meta API fetch carry a "Campaign type" column
// (Boost Post / Non Boost Post) decided from the account's Kata Kunci Boost
// Post; where it is filled it wins over the name rule.
export function isBoostRow(campCol: string | null) {
  return (r: SheetRow) => {
    const type = String(r['Campaign type'] ?? '').trim().toLowerCase();
    if (type) return type.startsWith('boost');
    const v = String((campCol ? r[campCol] : '') || '').toLowerCase();
    return v.includes('profile visit') || v.includes('instagram post') || /\bpv\b/.test(v) || /\bpost\b/.test(v);
  };
}

// Which Non-Boost lane a campaign belongs to:
//   1. its name says so ("… | B2B", "… Retail", "… Lead …", or a chat
//      campaign — "Send Message", "WhatsApp", "WA", "Chat") — MIL's own
//      label wins. A Send Message campaign optimised for a custom conversion
//      reports no leads or messaging figures at all, so without the name
//      rule it fell through to the Industry and landed in Retail;
//   2. its objective: Sales → Retail; Leads and Engagement → B2B Leads
//      (Engagement whether or not it produced leads or chats in the period
//      — MIL runs it for B2B; a Send Message campaign optimised for a
//      custom conversion reports neither);
//   3. anything else (Traffic, Awareness, a post-engagement push) follows the
//      Industry picked in the form, Retail when none was picked.
export function laneOfCampaign(name: string, objective: MetaObjectiveKey | null, _rows: SheetRow[], industry: MetaIndustry): { lane: NonBoostLaneKey; basis: NonBoostLane['basis'] } {
  const lc = name.toLowerCase();
  if (/\bb2b\b|\blead(s|gen)?\b/.test(lc)) return { lane: 'b2b', basis: 'name' };
  if (/\bsend message|\bmessag(e|es|ing)\b|\bwhats\s?app\b|\bwa\b|\bchat\b/.test(lc)) return { lane: 'b2b', basis: 'name' };
  if (/\bretail\b|\bb2c\b/.test(lc)) return { lane: 'retail', basis: 'name' };
  if (objective === 'sales') return { lane: 'retail', basis: 'objective' };
  if (objective === 'leads') return { lane: 'b2b', basis: 'objective' };
  if (objective === 'engagement') return { lane: 'b2b', basis: 'objective' };
  return { lane: industry === 'b2b' ? 'b2b' : 'retail', basis: 'industry' };
}

export interface DateRange {
  start: Date;
  end: Date;
}

interface NonBoostGroup {
  key: MetaObjectiveKey;
  label: string;
  old: SheetRow[];
  cur: SheetRow[];
}

// Splits the Non-Boost rows by objective, one objective per campaign — see
// resolveCampaignObjectives (Objective column → campaign name → metrics).
//   • `multi` true  → a blended headline + one sub-section per objective
//   • `multi` false → one objective found; the section is headlined by it
//   • null          → no signal at all; fall back to the Objective/industry pick
// `source` is the signal that decided the most spend, for the badge.
function groupNonBoostByObjective(
  nonOld: SheetRow[],
  nonCur: SheetRow[],
  campCol: string | null,
  spentCol: string | null,
): { groups: NonBoostGroup[]; source: MetaObjectiveSource; multi: boolean } | null {
  const resolved = resolveCampaignObjectives([...nonOld, ...nonCur], campCol);
  if (!campCol || !resolved.size) return null;
  const map = new Map<MetaObjectiveKey, { old: SheetRow[]; cur: SheetRow[] }>();
  const sourceSpend = new Map<MetaObjectiveSource, number>();
  const push = (rows: SheetRow[], period: 'old' | 'cur') => {
    for (const r of rows) {
      const hit = resolved.get(String(r[campCol] ?? '').trim());
      const key = hit?.key ?? 'other';
      if (!map.has(key)) map.set(key, { old: [], cur: [] });
      map.get(key)![period].push(r);
      if (hit) sourceSpend.set(hit.source, (sourceSpend.get(hit.source) ?? 0) + (spentCol ? Number(r[spentCol]) || 0 : 1));
    }
  };
  push(nonOld, 'old');
  push(nonCur, 'cur');
  if (!map.size || (map.size === 1 && map.has('other'))) return null;
  const groups = META_OBJECTIVE_ORDER.filter((k) => map.has(k)).map((k) => ({ key: k, label: META_OBJECTIVE_DEFS[k].label, ...map.get(k)! }));
  const source = ([...sourceSpend].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'campaign-name') as MetaObjectiveSource;
  return { groups, source, multi: groups.length >= 2 };
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
  // B2B / Retail — manual context (not in the Meta export). Not used to pick
  // metrics any more; kept for the saved report config.
  industry: MetaIndustry;
  customResultsCol: string | null;
  // The Non-Boost headline objective for a file with no "Objective" column
  // (Sales → Purchases/CpP, Leads → Leads/CpL, …). Ignored when the file
  // carries an Objective column — the lane is split per objective instead.
  objective?: MetaObjectiveKey | null;
  // When metaRows came from Meta's per-day breakdown export (a "Day" column
  // instead of "Month"), old/cur are picked by these explicit date ranges
  // instead of relying on Meta's own month-bucket boundaries — see
  // lib/meta.ts's splitByDayRange. Ignored for a Month-breakdown file.
  dayRanges?: { old: DateRange; cur: DateRange } | null;
}

// "Results" / "Cost per result" carry a global "(blended)" tag (see
// displayName in lib/meta.ts) because that raw column normally sums every
// campaign's own objective together. Once a card is scoped to one objective
// (a per-objective segment, or a single section headlined by one), those
// numbers aren't blended any more — the section heading already says which
// objective they're for — so the tag reads as a contradiction. Strip it
// there; the Blended card keeps it, since that one really is blended.
function deblend<T extends { label: string }>(rows: T[]): T[] {
  return rows.map((r) => (/\(blended\)/i.test(r.label) ? { ...r, label: r.label.replace(/\s*\(blended\)\s*/gi, '').trim() } : r));
}

// Ported from the Meta branch of the original generate() — builds every
// section's data (Overview/Detailed rows, Age/Gender breakdown datasets) so
// the MetaTab component can render them as JSX instead of HTML strings. The
// cross-platform Summary Overview feed (platformState.meta) is intentionally
// not built here — that's designed together with the other platforms in the
// Business/Summary Overview checkpoint.
export function buildMetaReport({ metaRows, metaHeaders, cpasRows, cpasHeaders, industry, customResultsCol, objective, dayRanges }: BuildMetaReportInput): MetaReport {
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
        'Reach, Frequency, dan Cost per Reach ditampilkan sebagai (—): file breakdown Day mencatat reach per hari, dan orang yang sama bisa terhitung berkali-kali bila dijumlahkan, jadi angkanya tidak bisa dipakai. Metrik lain dan Special Moment tetap akurat. Lihat Reach periode penuh langsung di Ads Manager bila dibutuhkan.';
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
  report.curRows = { boost: mBoostCur, nonBoost: mNonCur, cpas: [] };
  const metaKpis: SummaryKpi[] = [];
  const metaSpend: Record<string, SpendEntry | undefined> = {};

  if (hasBoost) {
    const boostOvRows = buildMetaOverviewRows('boost', mBoostOld, mBoostCur, !reachWarning);
    report.boost = { overviewRows: boostOvRows, detailedRows: toDisplayRows(buildKPI(mBoostOld, mBoostCur, mAllCols)), allCols: mAllCols };
    report.boostFunnel = buildMetaBrandFunnel(mBoostOld, mBoostCur);
    metaKpis.push(...overviewSummary(boostOvRows, 'Boost Post'));
    if (mSpentCol) metaSpend.boost = { old: agg(mBoostOld, mSpentCol), cur: agg(mBoostCur, mSpentCol) };
  }

  if (hasNonBoost) report.nonBoostFunnel = buildMetaSalesFunnel(mNonOld, mNonCur);

  const nbGroups = hasNonBoost ? groupNonBoostByObjective(mNonOld, mNonCur, mCampCol, mSpentCol ?? null) : null;
  // Every Non-Boost objective with its current-period rows, so the Age /
  // Gender / Creative breakdowns can be read per objective with that
  // objective's own metrics (a Leads campaign is judged on leads, not AOV).
  if (nbGroups) {
    report.nonBoostObjectives = nbGroups.groups
      .filter((g) => g.cur.length)
      .map((g) => ({ key: g.key, label: g.label, rows: g.cur, spend: mSpentCol ? agg(g.cur, mSpentCol) : null }))
      .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
    report.nonBoostObjectiveSource = nbGroups.source;
  }
  // Boost Post is recognised by its name (a promoted post), not its objective
  // — but which objective it was bought on is still worth a label.
  if (hasBoost) {
    const boostResolved = resolveCampaignObjectives(mBoostCur.length ? mBoostCur : mBoostOld, mCampCol);
    const spendBy = new Map<MetaObjectiveKey, number>();
    let src: MetaObjectiveSource | null = null;
    for (const r of mBoostCur.length ? mBoostCur : mBoostOld) {
      const hit = mCampCol ? boostResolved.get(String(r[mCampCol] ?? '').trim()) : undefined;
      if (!hit || hit.key === 'other') continue;
      spendBy.set(hit.key, (spendBy.get(hit.key) ?? 0) + (mSpentCol ? Number(r[mSpentCol]) || 0 : 1));
      src ??= hit.source;
    }
    const top = [...spendBy].sort((a, b) => b[1] - a[1])[0];
    if (top && src) report.boostObjective = { key: top[0], label: META_OBJECTIVE_DEFS[top[0]].label, source: src, mixed: spendBy.size > 1 };
  }

  if (nbGroups && nbGroups.multi) {
    // Multi-objective: a blended headline + per-objective spend split on top,
    // then one full sub-section per objective.
    // The blended card opens with the default set of the objective that spent
    // the most (report.nonBoostObjectives is sorted by spend).
    const leadKey = report.nonBoostObjectives?.[0]?.key ?? nbGroups.groups[0].key;
    const blendedOvRows: KpiRowDisplay[] = buildMetaOverviewRows(nonBoostKind(leadKey, industry), mNonOld, mNonCur, !reachWarning);
    // "Amount Spent · Sales / · Leads / …" — the split the user actually asked
    // for, right under the blended total so every figure is labelled.
    const spendSplitRows = nbGroups.groups
      .map((g) => buildLabeledAggRow(`${mSpentCol ? displayName(mSpentCol) : 'Amount spent'} · ${g.label}`, mSpentCol ?? null, g.old, g.cur))
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    const spentRowIdx = (blendedOvRows as MetaOverviewRow[]).findIndex((r) => r.key === 'spend');
    if (spentRowIdx >= 0) blendedOvRows.splice(spentRowIdx + 1, 0, ...spendSplitRows);
    else blendedOvRows.unshift(...spendSplitRows);
    report.nonBoost = { overviewRows: blendedOvRows, detailedRows: toDisplayRows(buildKPI(mNonOld, mNonCur, mAllCols)), allCols: mAllCols };
    metaKpis.push(...overviewSummary(blendedOvRows as MetaOverviewRow[], 'Non-Boost · Blended'));
    metaKpis.push(...spendSplitRows.map((r) => toSummaryKpi({ ...r, label: `Non-Boost · Blended · ${r.label}` })));
    if (mSpentCol) metaSpend.nonboost = { old: agg(mNonOld, mSpentCol), cur: agg(mNonCur, mSpentCol) };

    report.nonBoostSegments = nbGroups.groups.map((g) => {
      // Each objective opens with its own default set; the Amount Spent row
      // says which objective it is.
      const segOvRows = buildMetaOverviewRows(nonBoostKind(g.key, industry), g.old, g.cur, !reachWarning).map((r) =>
        r.key === 'spend' ? { ...r, label: `${r.label} (${g.label})` } : r,
      );
      metaKpis.push(...overviewSummary(segOvRows, `Non-Boost · ${g.label}`));
      return {
        key: g.key,
        label: g.label,
        overview: { overviewRows: segOvRows, detailedRows: deblend(toDisplayRows(buildKPI(g.old, g.cur, mAllCols))), allCols: mAllCols },
        spendOld: mSpentCol ? agg(g.old, mSpentCol) : null,
        spendCur: mSpentCol ? agg(g.cur, mSpentCol) : null,
      };
    });
  } else if (hasNonBoost) {
    // Single Non-Boost section. Its default set follows the file's sole
    // objective, else the Objective dropdown, else the Industry pick.
    const soleKey = nbGroups && !nbGroups.multi ? nbGroups.groups[0].key : null;
    const objKey = soleKey ?? objective ?? null;
    const objLabel = objKey ? META_OBJECTIVE_DEFS[objKey].label : null;
    const mainOvRows = buildMetaOverviewRows(nonBoostKind(objKey, industry), mNonOld, mNonCur, !reachWarning).map((r) =>
      objLabel && r.key === 'spend' ? { ...r, label: `${r.label} (${objLabel})` } : r,
    );
    let mainDetailedRows = toDisplayRows(buildKPI(mNonOld, mNonCur, mAllCols));
    if (objKey) mainDetailedRows = deblend(mainDetailedRows);
    report.nonBoost = { overviewRows: mainOvRows, detailedRows: mainDetailedRows, allCols: mAllCols };
    metaKpis.push(...overviewSummary(mainOvRows, 'Non-Boost Post'));
    if (mSpentCol) metaSpend.nonboost = { old: agg(mNonOld, mSpentCol), cur: agg(mNonCur, mSpentCol) };
  }

  // ── Non-Boost lanes: Retail / B2B Leads ──
  if (hasNonBoost) {
    const resolved = resolveCampaignObjectives([...mNonOld, ...mNonCur], mCampCol);
    const byCamp = new Map<string, SheetRow[]>();
    for (const r of [...mNonOld, ...mNonCur]) {
      const k = mCampCol ? String(r[mCampCol] ?? '').trim() : '';
      if (!byCamp.has(k)) byCamp.set(k, []);
      byCamp.get(k)!.push(r);
    }
    const laneOf = new Map<string, { lane: NonBoostLaneKey; basis: NonBoostLane['basis']; objective: MetaObjectiveKey | null }>();
    for (const [camp, rows] of byCamp) {
      const objective = resolved.get(camp)?.key ?? null;
      laneOf.set(camp, { ...laneOfCampaign(camp, objective, rows, industry), objective });
    }
    const keyOf = (r: SheetRow) => (mCampCol ? String(r[mCampCol] ?? '').trim() : '');
    const lanes: NonBoostLane[] = [];
    for (const key of ['retail', 'b2b'] as NonBoostLaneKey[]) {
      const inLane = (r: SheetRow) => laneOf.get(keyOf(r))?.lane === key;
      const oldRows = mNonOld.filter(inLane);
      const curRows = mNonCur.filter(inLane);
      if (!oldRows.length && !curRows.length) continue;
      const camps = [...laneOf].filter(([, v]) => v.lane === key);
      const basisSpend = new Map<NonBoostLane['basis'], number>();
      for (const [camp, v] of camps) {
        const spend = mSpentCol ? agg(byCamp.get(camp) ?? [], mSpentCol) ?? 0 : 1;
        basisSpend.set(v.basis, (basisSpend.get(v.basis) ?? 0) + spend);
      }
      const objectives = [...new Set(camps.map(([, v]) => (v.objective ? META_OBJECTIVE_DEFS[v.objective].label : null)).filter((x): x is string => Boolean(x)))];
      const ovRows = buildMetaOverviewRows(key === 'retail' ? 'ecommerce' : 'b2b', oldRows, curRows, !reachWarning);
      const leadKinds = key === 'b2b' ? leadResultKinds(oldRows, curRows) : [];
      const leadResults = key === 'b2b'
        ? {
          kinds: leadKinds,
          auto: leadResultKind(oldRows, curRows),
          byKind: Object.fromEntries(leadKinds.map((k) => [k, {
            overviewRows: buildMetaOverviewRows('b2b', oldRows, curRows, !reachWarning, k),
            funnel: buildMetaLeadFunnel(oldRows, curRows, k),
          }])),
        }
        : undefined;
      lanes.push({
        key,
        label: NON_BOOST_LANE_LABEL[key],
        objectives,
        basis: [...basisSpend].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'industry',
        overview: { overviewRows: ovRows, detailedRows: deblend(toDisplayRows(buildKPI(oldRows, curRows, mAllCols))), allCols: mAllCols },
        funnel: key === 'retail' ? buildMetaSalesFunnel(oldRows, curRows) : buildMetaLeadFunnel(oldRows, curRows),
        oldRows,
        curRows,
        campCol: mCampCol,
        ageCol: mAgeCol,
        genderCol: mGenderCol,
        leadResults,
      });
    }
    if (lanes.length) report.nonBoostLanes = lanes;
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
    const cDayCol = cMonthCol ? null : findCol(cpasRows, ['day']);
    const cCampCol = findCol(cpasRows, ['campaign']);
    const cAgeCol = findCol(cpasRows, ['age']);
    const cGenderCol = findCol(cpasRows, ['gender']);
    const cDimCols = [cMonthCol, cDayCol, cCampCol, cAgeCol, cGenderCol].filter((c): c is string => Boolean(c));
    // Same pivot-subtotal drop as the Boost/Non-Boost path above — without
    // it the "Overall" tab double-counts every absolute metric (the NV/RM
    // tabs happen to escape it only because groupByCamp's "NV"/"RM" regex
    // never matches a subtotal's "All" campaign name).
    // A Day-breakdown CPAS file read alongside picked date ranges is cut at
    // those same ranges — the two sides of a range comparison usually sit in
    // one calendar month, and splitting that by month put the whole file on
    // both sides. Otherwise (Month breakdown, or no ranges picked) CPAS
    // compares the first and last calendar month in its file(s).
    const cpasLeaves = stripCampaignSubtotals(cpasRows);
    const byRange = Boolean(cDayCol && dayRanges);
    const { old: cOld, cur: cCur, months: cMonths } = byRange
      ? { ...splitByDayRange(cpasLeaves, cDayCol!, dayRanges!.old, dayRanges!.cur), months: [] as string[] }
      : cDayCol
        ? splitDayRowsByMonth(cpasLeaves, cDayCol)
        : splitMonths(cpasLeaves, cMonthCol);
    // Month mode: CPAS's own months, not the main file's p1/p2. Fall back to
    // the main periods if the CPAS Month column couldn't be parsed.
    const cP1 = byRange ? p1 : parseMetaMonthValue(cMonths[0]).label || p1;
    const cP2 = byRange ? p2 : parseMetaMonthValue(cMonths[cMonths.length - 1]).label || p2;
    // A Day-breakdown CPAS file sums reach per day — same over-count as the
    // main file's, so Reach/Frequency/Cost per Reach are not offered either.
    const cAllCols = cpasHeaders.filter((h) => isNumericCol(h, cpasRows) && !cDimCols.includes(h) && !(cDayCol && isReachDependentCol(h)));
    const defCpasOverall = matchDef(DEFS.cpasOverall, cAllCols);
    const defCpasDemo = matchDef(DEFS.cpasDemo, cAllCols);
    const defCpasNV = matchDef(DEFS.cpasNV, cAllCols);
    const defCpasRM = matchDef(DEFS.cpasRM, cAllCols);
    const cpasGrpOld = groupByCamp(cOld, cCampCol, ['NV', 'RM']);
    const cpasGrpCur = groupByCamp(cCur, cCampCol, ['NV', 'RM']);
    const cSpentCol = cAllCols.find((c) => c.toLowerCase().includes('amount spent'));
    const cpasKpis: SummaryKpi[] = [];

    const cpas: CpasSections = { p1: cP1, p2: cP2 };
    // CPAS sells on the marketplace: every CPAS card opens with the
    // E-commerce set. A Day-breakdown file cannot sum reach (Frequency "—").
    const cpasReach = !cDayCol;
    if (defCpasOverall.length) {
      const overallOvRows = buildMetaOverviewRows('ecommerce', cOld, cCur, cpasReach);
      cpas.overall = { overviewRows: overallOvRows, detailedRows: toDisplayRows(buildKPI(cOld, cCur, cAllCols)), allCols: cAllCols };
      metaKpis.push(...overviewSummary(overallOvRows, 'CPAS Marketplace'));
      cpasKpis.push(...overviewSummary(overallOvRows, 'Overall'));
      if (cSpentCol) metaSpend.cpasOverall = { old: agg(cOld, cSpentCol), cur: agg(cCur, cSpentCol) };
    }
    cpas.funnel = buildMetaSalesFunnel(cOld, cCur);
    if (report.curRows) report.curRows.cpas = cCur;
    if (defCpasDemo.length && cAgeCol) cpas.ageDemo = { rows: cCur.filter((r) => !isAllValue(r[cAgeCol])), dimCol: cAgeCol, defaultCols: defCpasDemo, allCols: cAllCols };
    if (defCpasDemo.length && cGenderCol) cpas.genderDemo = { rows: cCur.filter((r) => !isAllValue(r[cGenderCol])), dimCol: cGenderCol, defaultCols: defCpasDemo, allCols: cAllCols };
    if (defCpasNV.length) {
      const nvOld = cpasGrpOld['NV'] || [];
      const nvCur = cpasGrpCur['NV'] || [];
      const nvOvRows = buildMetaOverviewRows('ecommerce', nvOld, nvCur, cpasReach);
      cpas.nvFunnel = buildMetaSalesFunnel(nvOld, nvCur);
      cpas.nv = { overviewRows: nvOvRows, detailedRows: toDisplayRows(buildKPI(nvOld, nvCur, cAllCols)), allCols: cAllCols };
      metaKpis.push(...overviewSummary(nvOvRows, 'CPAS Marketplace · NV'));
      cpasKpis.push(...overviewSummary(nvOvRows, 'NV'));
      if (cSpentCol) metaSpend.cpasNV = { old: agg(nvOld, cSpentCol), cur: agg(nvCur, cSpentCol) };
    }
    if (defCpasRM.length) {
      const rmOld = cpasGrpOld['RM'] || [];
      const rmCur = cpasGrpCur['RM'] || [];
      const rmOvRows = buildMetaOverviewRows('ecommerce', rmOld, rmCur, cpasReach);
      cpas.rmFunnel = buildMetaSalesFunnel(rmOld, rmCur);
      cpas.rm = { overviewRows: rmOvRows, detailedRows: toDisplayRows(buildKPI(rmOld, rmCur, cAllCols)), allCols: cAllCols };
      metaKpis.push(...overviewSummary(rmOvRows, 'CPAS Marketplace · RM'));
      cpasKpis.push(...overviewSummary(rmOvRows, 'RM'));
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

  report.cols = {
    campaign: mCampCol,
    age: mAgeCol,
    gender: mGenderCol,
    cpasCampaign: cpasRows?.length ? findCol(cpasRows, ['campaign']) : null,
    cpasAge: cpasRows?.length ? findCol(cpasRows, ['age']) : null,
    cpasGender: cpasRows?.length ? findCol(cpasRows, ['gender']) : null,
  };
  report.summary.kpis = metaKpis;
  report.summary.spend = metaSpend;
  return report;
}
