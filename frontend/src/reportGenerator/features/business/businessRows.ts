import type { KpiRowDisplay } from '../../components/KpiTable';
import {
  BIZ_ALL_CHANNELS,
  bizChannelValue,
  bizTotalMetric,
  fmtBizPct,
  type BizMetricKey,
  type BizPeriod,
  type BizState,
} from '../../lib/business';
import { computeDelta, deltaClassForSentiment } from '../../lib/delta';

// Row-builders shared by the Business Overview tab's own cards and the
// Summary Overview tab's Cost per Revenue card — both read the exact same
// BizState, ported from the original's renderBizChannelTable/renderBizCalcTable.

export function buildChannelRows(state: BizState, metric: BizMetricKey, fmt: (v: number | null) => string): KpiRowDisplay[] {
  const rows: KpiRowDisplay[] = BIZ_ALL_CHANNELS.map((ch) => {
    const vOld = bizChannelValue(state, ch.key, metric, 'old');
    const vCur = bizChannelValue(state, ch.key, metric, 'cur');
    const { deltaNum, deltaStr } = computeDelta(vOld, vCur);
    return { label: ch.label, old: fmt(vOld), cur: fmt(vCur), delta: deltaStr, cls: deltaClassForSentiment(deltaNum, 'higher-better') };
  });
  const totalOld = bizTotalMetric(state, metric, 'old');
  const totalCur = bizTotalMetric(state, metric, 'cur');
  const { deltaNum, deltaStr } = computeDelta(totalOld, totalCur);
  rows.push({ label: 'Total', old: fmt(totalOld), cur: fmt(totalCur), delta: deltaStr, cls: deltaClassForSentiment(deltaNum, 'higher-better'), isTotal: true });
  return rows;
}

export function buildCalcRows(state: BizState, calcFn: (state: BizState, period: BizPeriod, chKey: string) => number | null, fmt: (v: number | null) => string): KpiRowDisplay[] {
  const rows: KpiRowDisplay[] = BIZ_ALL_CHANNELS.map((ch) => {
    const vOld = calcFn(state, 'old', ch.key);
    const vCur = calcFn(state, 'cur', ch.key);
    const { deltaNum, deltaStr } = computeDelta(vOld, vCur);
    return { label: ch.label, old: fmt(vOld), cur: fmt(vCur), delta: deltaStr, cls: deltaClassForSentiment(deltaNum, 'higher-better') };
  });
  const totalOld = calcFn(state, 'old', '__total__');
  const totalCur = calcFn(state, 'cur', '__total__');
  const { deltaNum, deltaStr } = computeDelta(totalOld, totalCur);
  rows.push({ label: 'Total', old: fmt(totalOld), cur: fmt(totalCur), delta: deltaStr, cls: deltaClassForSentiment(deltaNum, 'higher-better'), isTotal: true });
  return rows;
}

export function buildCostPerRevenueRow(cprOld: number | null, cprCur: number | null): KpiRowDisplay {
  const { deltaNum, deltaStr } = computeDelta(cprOld, cprCur);
  return { label: 'Cost per Revenue', old: fmtBizPct(cprOld), cur: fmtBizPct(cprCur), delta: deltaStr, cls: deltaClassForSentiment(deltaNum, 'lower-better') };
}
