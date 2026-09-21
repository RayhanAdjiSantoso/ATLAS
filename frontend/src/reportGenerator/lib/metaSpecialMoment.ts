import { parseMetaDayValue } from './meta';
import { metaRevenueTotal, metaSpendTotal } from './metaFunnel';
import type { SheetRow } from './types';

// ══════════════════════════════════════════════════════
// META ADS — SPECIAL MOMENT
//
// A "special moment" is a recurring commerce date: a double date (9/9), a
// payday window, or something the brand names itself. The question asked of
// it is always the same two-part question — how much of the period did this
// moment carry, and is this occurrence better than the last one — so the
// occurrences are derived from the data rather than typed in: pick the kind,
// and every occurrence the uploaded file actually covers is found for you.
//
// This needs a Day breakdown. A Month-breakdown export cannot answer "what
// happened on the 9th", and the caller says so rather than drawing zeros.
// ══════════════════════════════════════════════════════

export type MomentKind = 'double-date' | 'payday' | 'custom';

export interface PaydayConfig {
  // Most brands read payday as the 25th itself; some read a window (25–27).
  startDay: number;
  lengthDays: number;
}

export const DEFAULT_PAYDAY: PaydayConfig = { startDay: 25, lengthDays: 1 };

export interface MomentOccurrence {
  key: string;
  label: string;
  start: Date;
  end: Date;
  revenue: number | null;
  spending: number | null;
}

export interface SpecialMomentResult {
  hasDayBreakdown: boolean;
  periodStart: Date | null;
  periodEnd: Date | null;
  occurrences: MomentOccurrence[];
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const within = (d: Date, start: Date, end: Date) => d.getTime() >= start.getTime() && d.getTime() <= end.getTime();

function rowsBetween(rows: SheetRow[], dayCol: string, start: Date, end: Date): SheetRow[] {
  return rows.filter((r) => {
    const d = parseMetaDayValue(r[dayCol]);
    return d != null && within(d, start, end);
  });
}

// Every distinct day the file covers, ascending.
function coveredDays(rows: SheetRow[], dayCol: string): Date[] {
  const seen = new Map<string, Date>();
  for (const r of rows) {
    const d = parseMetaDayValue(r[dayCol]);
    if (d) seen.set(dayKey(d), d);
  }
  return [...seen.values()].sort((a, b) => a.getTime() - b.getTime());
}

function doubleDateWindows(days: Date[]): { key: string; label: string; start: Date; end: Date }[] {
  return days
    .filter((d) => d.getDate() === d.getMonth() + 1)
    .map((d) => ({ key: dayKey(d), label: `${d.getDate()}/${d.getMonth() + 1}`, start: d, end: d }));
}

function paydayWindows(periodStart: Date, periodEnd: Date, cfg: PaydayConfig): { key: string; label: string; start: Date; end: Date }[] {
  const out: { key: string; label: string; start: Date; end: Date }[] = [];
  const length = Math.max(1, Math.round(cfg.lengthDays));
  const cursor = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
  while (cursor.getTime() <= periodEnd.getTime()) {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), cfg.startDay);
    const end = addDays(start, length - 1);
    // Keep a window the file actually covers some of — a payday that has not
    // happened yet in this export is not an occurrence.
    if (end.getTime() >= periodStart.getTime() && start.getTime() <= periodEnd.getTime()) {
      out.push({
        key: `payday-${start.getFullYear()}-${start.getMonth() + 1}`,
        label: `Payday ${MONTH_SHORT[start.getMonth()]}`,
        start,
        end,
      });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

export function buildSpecialMoment(
  rows: SheetRow[],
  dayCol: string | null,
  kind: MomentKind,
  payday: PaydayConfig = DEFAULT_PAYDAY,
  customWindows: { key: string; label: string; start: Date; end: Date }[] = [],
): SpecialMomentResult {
  const empty: SpecialMomentResult = {
    hasDayBreakdown: false,
    periodStart: null,
    periodEnd: null,
    occurrences: [],
  };
  if (!dayCol || !rows.length) return empty;

  const days = coveredDays(rows, dayCol);
  if (!days.length) return empty;

  const periodStart = days[0];
  const periodEnd = days[days.length - 1];

  const windows =
    kind === 'double-date'
      ? doubleDateWindows(days)
      : kind === 'payday'
        ? paydayWindows(periodStart, periodEnd, payday)
        : customWindows;

  const occurrences = windows.map((w) => {
    const slice = rowsBetween(rows, dayCol, w.start, w.end);
    return { ...w, revenue: metaRevenueTotal(slice), spending: metaSpendTotal(slice) };
  });

  return {
    hasDayBreakdown: true,
    periodStart,
    periodEnd,
    occurrences,
  };
}
