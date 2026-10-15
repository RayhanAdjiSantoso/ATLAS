// Shared by the annual target in Brand Setting (AnnualTargetCard) and its
// monthly split in Brand Tracking (AnnualPlan).

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const MONTH_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export const monthIndex = (ym) => Number(String(ym).slice(5, 7)) - 1;
export const monthShort = (ym) => `${MONTH_SHORT[monthIndex(ym)]} ${String(ym).slice(0, 4)}`;
export const monthLong = (ym) => `${MONTH_LONG[monthIndex(ym)]} ${String(ym).slice(0, 4)}`;

export const digits = (s) => String(s ?? '').replace(/[^\d]/g, '');
export const thousands = (v) => (v === '' || v == null ? '' : Number(v).toLocaleString('id-ID'));
export const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: d })}%`);
export const signedPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v * 100).toLocaleString('id-ID', { maximumFractionDigits: d })}%`);

// The month option B ("bulan berjalan") starts from: the running month in the
// running year, January in a later year, none (null) in a past year. The
// server decides the same way (in Jakarta time).
export function runningMonth(year, today = new Date()) {
  const y = today.getFullYear();
  if (year > y) return 1;
  if (year < y) return null;
  return today.getMonth() + 1;
}

// How far the current target moved from the original, as a ratio (0.125 = +12,5%).
export const changeFromOriginal = (current, original) => (current != null && original ? (current - original) / original : null);

// Whole-rupiah equal split that adds up exactly (the last month takes the rounding).
export function splitEqual(total, count = 12) {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - base * (count - 1) : base));
}

// Shares in proportion to `weights`, adding up exactly; even when all are zero.
export function splitByWeight(total, weights) {
  const sum = weights.reduce((a, w) => a + (w > 0 ? w : 0), 0);
  if (!sum) return splitEqual(total, weights.length);
  const out = weights.map((w) => Math.floor((total * Math.max(w, 0)) / sum));
  out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
  return out;
}

// The 12 monthly amounts an update would leave, mirroring the server:
// 'even' splits the year evenly; 'remaining' keeps the months before `from`
// and spreads the rest over the others in proportion to what they hold.
// Returns { values, past, rest } or null when `total` cannot fit.
export function planMonths(current, total, split, from) {
  if (split === 'even') return { values: splitEqual(total, 12), past: 0, rest: total };
  const cut = (from ?? 1) - 1;
  const past = current.slice(0, cut).reduce((a, v) => a + v, 0);
  const rest = total - past;
  if (rest < 0) return { values: null, past, rest };
  return { values: [...current.slice(0, cut), ...splitByWeight(rest, current.slice(cut))], past, rest };
}
