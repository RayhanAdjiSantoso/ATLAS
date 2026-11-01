import { periodLabelFromDates } from './format';
import type { PeriodRange } from './types';

export type { PeriodRange };

// Every channel has its own period. These decide what the deck as a whole calls
// its period, and whether the channels disagree.

interface RunDates {
  periodCurStart: string | null;
  periodCurEnd: string | null;
  periodOldStart: string | null;
  periodOldEnd: string | null;
}

export function runPeriod(r: RunDates): PeriodRange | null {
  if (!r.periodCurStart || !r.periodCurEnd || !r.periodOldStart || !r.periodOldEnd) return null;
  return { curStart: r.periodCurStart, curEnd: r.periodCurEnd, oldStart: r.periodOldStart, oldEnd: r.periodOldEnd };
}

export function periodKey(p: PeriodRange): string {
  return [p.curStart, p.curEnd, p.oldStart, p.oldEnd].join('|');
}

export function samePeriod(a: PeriodRange | null, b: PeriodRange | null): boolean {
  return Boolean(a && b && periodKey(a) === periodKey(b));
}

export function validPeriod(p: PeriodRange): boolean {
  return Boolean(p.curStart && p.curEnd && p.oldStart && p.oldEnd && p.curStart <= p.curEnd && p.oldStart <= p.oldEnd);
}

const curDays = (p: PeriodRange) => new Date(p.curEnd).getTime() - new Date(p.curStart).getTime();

// The newest report, and of those ending the same day the longest: a full month
// over the three-day check someone ran on its last days.
export function newestRun<T extends RunDates>(list: T[]): T | null {
  const dated = list.filter((r) => runPeriod(r));
  if (!dated.length) return null;
  return [...dated].sort((a, b) => {
    const pa = runPeriod(a) as PeriodRange;
    const pb = runPeriod(b) as PeriodRange;
    return pb.curEnd.localeCompare(pa.curEnd) || curDays(pb) - curDays(pa);
  })[0];
}

// What most channels use; a tie goes to the newest.
export function mostCommonPeriod(list: PeriodRange[]): PeriodRange | null {
  const usable = list.filter(validPeriod);
  if (!usable.length) return null;
  const counts = new Map<string, { period: PeriodRange; n: number }>();
  for (const p of usable) {
    const entry = counts.get(periodKey(p));
    if (entry) entry.n += 1;
    else counts.set(periodKey(p), { period: p, n: 1 });
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || b.period.curEnd.localeCompare(a.period.curEnd))[0].period;
}

// All of them when they do not all agree, so the warning can name each one.
export function differingPeriods<T extends { period: PeriodRange }>(list: T[]): T[] {
  return new Set(list.map((c) => periodKey(c.period))).size > 1 ? list : [];
}

export function describePeriod(p: PeriodRange): string {
  return `${periodLabelFromDates(p.curStart, p.curEnd, 'id') || '?'} vs ${periodLabelFromDates(p.oldStart, p.oldEnd, 'id') || '?'}`;
}

export function lastFinishedMonths(today: Date): PeriodRange {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const month = (back: number) => [new Date(today.getFullYear(), today.getMonth() - back, 1), new Date(today.getFullYear(), today.getMonth() - back + 1, 0)];
  const [curStart, curEnd] = month(1);
  const [oldStart, oldEnd] = month(2);
  return { curStart: iso(curStart), curEnd: iso(curEnd), oldStart: iso(oldStart), oldEnd: iso(oldEnd) };
}
