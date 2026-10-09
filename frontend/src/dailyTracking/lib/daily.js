// Day-by-day readings of the month grid (GET /api/daily-tracking/entries):
// the series behind Brand Tracking's sparklines and pulse chart, and the
// fill map that shows which channel-days are still empty.
import { sumMaybe } from './summary.js';

const toNum = (v) => (v == null || v === '' || v === '-' || Number.isNaN(Number(v)) ? null : Number(v));

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A row counts as filled when any of its numbers is there — a zero typed in
// is an answer ("no sales that day"), an untouched cell is not.
export function rowFilled(kind, row) {
  if (!row) return false;
  if (kind === 'spend') return toNum(row.amount) != null;
  return toNum(row.revenue) != null || toNum(row.transaksi) != null || toNum(row.qtySold) != null;
}

// One value per day of `days`, summed across every channel of `kind`; null
// on a day nothing was entered, so a chart can tell "0" from "empty".
export function daySeries(grid, channels, days, kind, field) {
  const keys = (channels?.[kind] || []).map((c) => c.key);
  return days.map((date) => sumMaybe(keys.map((k) => grid?.[kind]?.[k]?.[date]?.[field])));
}

// Days that should already hold data: every day of a past month, up to
// yesterday in the running month (spend is synced H-1, and today is still
// being sold), none in a future month.
export function expectedDays(days, today = todayIso()) {
  return days.filter((d) => d < today);
}

// Per channel: which days are filled, and whether the channel is used at all
// this month. A channel nobody uses (no TikTok shop, no Google Ads) is not
// "incomplete" — it is simply not part of this brand — so completeness only
// counts channels with at least one entry.
export function coverage(grid, channels, days, today = todayIso()) {
  const due = new Set(expectedDays(days, today));
  const rows = [];
  for (const kind of ['sales', 'spend']) {
    for (const c of channels?.[kind] || []) {
      const byDate = grid?.[kind]?.[c.key] || {};
      const cells = days.map((date) => {
        if (rowFilled(kind, byDate[date])) return 'filled';
        if (date === today) return 'today';
        return due.has(date) ? 'missing' : 'future';
      });
      const filled = cells.filter((s) => s === 'filled').length;
      const filledDue = days.filter((d, i) => due.has(d) && cells[i] === 'filled').length;
      rows.push({ kind, key: c.key, label: c.label, cells, filled, filledDue, used: filled > 0 });
    }
  }
  const used = rows.filter((r) => r.used);
  const expected = used.length * due.size;
  const done = used.reduce((a, r) => a + r.filledDue, 0);
  return {
    rows,
    due: due.size,
    expected,
    done,
    ratio: expected > 0 ? done / expected : null,
    gaps: used.reduce((a, r) => a + (due.size - r.filledDue), 0),
  };
}

export const WEEKDAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
export const weekday = (iso) => new Date(`${iso}T00:00:00`).getDay();
export const isWeekend = (iso) => [0, 6].includes(weekday(iso));

// ── Performance Overview ────────────────────────────────────────────────

export const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const monthName = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// The grid cut to days 1..maxDay. A running month is compared with the same
// stretch of the month before — 9 days of October against all of September
// would always read as a collapse.
export function sliceGrid(grid, maxDay) {
  if (!grid?.days || maxDay == null) return grid;
  const keep = (d) => Number(d.slice(8)) <= maxDay;
  const cut = (byKind) => Object.fromEntries(Object.entries(byKind || {}).map(([k, byDate]) => [
    k, Object.fromEntries(Object.entries(byDate || {}).filter(([d]) => keep(d))),
  ]));
  return { ...grid, days: grid.days.filter(keep), sales: cut(grid.sales), spend: cut(grid.spend) };
}
