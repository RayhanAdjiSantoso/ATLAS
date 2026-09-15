// Calendar-month helpers shared by the control center and targets. Months
// travel as 'YYYY-MM'; "today" is Asia/Jakarta, because a month boundary in
// UTC lands at 07:00 WIB and would make the first seven hours of every month
// read as the previous one.

const pad = (n) => String(n).padStart(2, '0');

export const isMonth = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function todayJakarta(now = Date.now()) {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

export const currentMonth = (now) => todayJakarta(now).slice(0, 7);

export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${pad(days)}`, days };
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// Whole days between two ISO dates (b - a), calendar-based.
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
