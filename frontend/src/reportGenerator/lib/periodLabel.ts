// ══════════════════════════════════════════════════════
// FREE-FORM PERIOD LABELS (Fase 1) — shared by Shopee Ads and TikTok GMV Max.
//
// The original collapsed every detected period straight to "NamaBulan Tahun"
// (formatShopeePeriod for Shopee, the month-name collapse in
// handleTiktokFile for TikTok), which silently misrepresents any period that
// isn't a full calendar month — e.g. "1-18 Jul 2026" displayed as "Jul 2026"
// looks identical to a full month in the report header, and the delta %
// comparison between two differently-sized periods reads as if it were an
// apples-to-apples monthly comparison when it isn't.
//
// Meta Ads is intentionally NOT touched here — it's tied to the "month"
// breakdown column Meta's own export provides, not a user-supplied date
// range, so there's no free-form period to preserve.
// ══════════════════════════════════════════════════════

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];

export interface ParsedPeriod {
  label: string;
  start: Date | null;
  end: Date | null;
  days: number | null;
}

export function emptyParsedPeriod(fallbackLabel = ''): ParsedPeriod {
  return { label: fallbackLabel, start: null, end: null, days: null };
}

export function daysBetweenInclusive(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.round(ms / 86_400_000) + 1;
}

function isFullCalendarMonth(start: Date, end: Date): boolean {
  if (start.getFullYear() !== end.getFullYear() || start.getMonth() !== end.getMonth()) return false;
  if (start.getDate() !== 1) return false;
  const lastDayOfMonth = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
  return end.getDate() === lastDayOfMonth;
}

// "Jul 2026" for a full month; "1-18 Jul 2026" for a partial same-month
// range; "25 Jun-5 Jul 2026" crossing months; "28 Des 2025-3 Jan 2026"
// crossing years; "18 Jul 2026" (no dash) for a single-day period.
export function formatPeriodLabel(start: Date, end: Date): string {
  const sameDay = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
  if (sameDay) {
    return `${start.getDate()} ${MONTHS_ID[start.getMonth()]} ${start.getFullYear()}`;
  }
  if (isFullCalendarMonth(start, end)) {
    return `${MONTHS_ID[start.getMonth()]} ${start.getFullYear()}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getDate()}-${end.getDate()} ${MONTHS_ID[start.getMonth()]} ${start.getFullYear()}`;
  }
  if (sameYear) {
    return `${start.getDate()} ${MONTHS_ID[start.getMonth()]}-${end.getDate()} ${MONTHS_ID[end.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTHS_ID[start.getMonth()]} ${start.getFullYear()}-${end.getDate()} ${MONTHS_ID[end.getMonth()]} ${end.getFullYear()}`;
}

export function buildParsedPeriod(start: Date, end: Date): ParsedPeriod {
  return { label: formatPeriodLabel(start, end), start, end, days: daysBetweenInclusive(start, end) };
}

// Shopee's CSV metadata line looks like "Periode,01/07/2026 - 31/07/2026"
// (DD/MM/YYYY).
export function parseDateRangeDMY(raw: string): { start: Date; end: Date } | null {
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const start = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const end = new Date(Number(m[6]), Number(m[5]) - 1, Number(m[4]));
  return { start, end };
}

// If the old/cur periods differ in length by more than `toleranceDays`, the
// %Change figures aren't a like-for-like comparison — surface that instead
// of letting it look like a normal period-over-period delta.
export function comparePeriodDays(oldDays: number | null, curDays: number | null, toleranceDays = 1): string | null {
  if (oldDays == null || curDays == null) return null;
  if (Math.abs(oldDays - curDays) <= toleranceDays) return null;
  return `Periode tidak sama panjang: ${oldDays} hari vs ${curDays} hari — bandingkan dengan hati-hati.`;
}
