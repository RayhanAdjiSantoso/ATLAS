// Formats a local Date as a "YYYY-MM-DD" string without any timezone
// conversion (Date#toISOString() shifts to UTC, which can land on the wrong
// calendar day) — used wherever a parsed period's start/end needs to travel
// as a plain date string (e.g. into the report-persistence payload).
export function toISODate(d: Date | null | undefined): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The inverse: an <input type="date">'s value ("YYYY-MM-DD") parsed as a
// local Date. `new Date("YYYY-MM-DD")` parses as UTC midnight per spec,
// which lands on the wrong calendar day in negative-UTC-offset timezones —
// this builds the Date from the parts directly instead.
export function fromISODate(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
