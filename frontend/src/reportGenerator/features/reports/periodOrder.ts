import type { PeriodRole } from './types';

// Periode Ini may not start before Periode Lalu. When one side already holds
// a period, the pickers of the other side block what would break that order:
// Periode Ini cannot start before Periode Lalu's start, and Periode Lalu
// cannot start after Periode Ini's.
export interface PeriodBound {
  // The side being picked.
  role: PeriodRole;
  // The other side's first day ('YYYY-MM-DD') and its label, for the reason.
  otherStart: string;
  otherLabel: string;
}

export function periodBound(
  role: PeriodRole,
  old: { start: string | null; label: string } | null,
  cur: { start: string | null; label: string } | null,
): PeriodBound | null {
  const other = role === 'old' ? cur : old;
  return other?.start ? { role, otherStart: other.start.slice(0, 10), otherLabel: other.label } : null;
}

// A period starting on `start` ('YYYY-MM-DD', or 'YYYY-MM' for a whole month).
export function breaksOrder(bound: PeriodBound | null | undefined, start: string | null): boolean {
  if (!bound || !start) return false;
  const other = start.length === 7 ? bound.otherStart.slice(0, 7) : bound.otherStart;
  const s = start.slice(0, other.length);
  return bound.role === 'cur' ? s < other : s > other;
}

export function orderReason(bound: PeriodBound): string {
  return bound.role === 'cur'
    ? `Periode Ini tidak boleh sebelum Periode Lalu (${bound.otherLabel}).`
    : `Periode Lalu tidak boleh setelah Periode Ini (${bound.otherLabel}).`;
}
