import type { DeltaClassName } from '../../lib/types';
import type { Cell, Currency, DeltaCell, Lang, Sentiment3, ValueFmt } from './types';

// How a figure reads on a slide. Currency and number style follow the report's
// settings; the values themselves come untouched from ATLAS's report builders.

export interface FormatContext {
  lang: Lang;
  currency: Currency;
}

const PREFIX: Record<Currency, string> = { IDR: 'Rp', MYR: 'RM' };

// Indonesian decks group with dots, English ones with commas (as MIL's own
// English monthly reports do). A ringgit amount keeps its sen; rupiah has none.
function locale(ctx: FormatContext): string {
  return ctx.lang === 'id' ? 'id-ID' : 'en-US';
}

function number(n: number, ctx: FormatContext, digits: number): string {
  return n.toLocaleString(locale(ctx), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatValue(n: number | null | undefined, f: ValueFmt, ctx: FormatContext, rounded = false): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  switch (f) {
    case 'money': {
      const digits = ctx.currency === 'MYR' && !rounded ? 2 : 0;
      return PREFIX[ctx.currency] + number(n, ctx, digits);
    }
    case 'pct':
      return `${number(n, ctx, 2)}%`;
    case 'signedPct':
      return `${n >= 0 ? '+' : ''}${number(n, ctx, 2)}%`;
    case 'x':
      return `${number(n, ctx, 2)}x`;
    case 'dec':
      return number(n, ctx, 2);
    case 'num':
      return number(n, ctx, n % 1 === 0 ? 0 : 2);
    default:
      return String(n);
  }
}

export function formatCell(c: Cell | undefined, ctx: FormatContext): string {
  if (!c) return '—';
  if (c.f === 'text') return c.t ?? '—';
  return formatValue(c.n, c.f, ctx, c.rounded);
}

export function formatDelta(d: DeltaCell | undefined, ctx: FormatContext): string {
  if (!d) return '—';
  if (d.s) return d.s;
  if (d.n === null) return '—';
  return `${d.n >= 0 ? '+' : ''}${number(d.n, ctx, 2)}%`;
}

// Short form for axes and bar labels: Rp1,2 M / Rp350 jt in Indonesian,
// Rp1.2B / Rp350M in English.
export function formatCompact(n: number | null | undefined, f: ValueFmt, ctx: FormatContext): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (f === 'pct' || f === 'x' || f === 'dec') return formatValue(Number(n.toFixed(2)), f, ctx).replace(/([.,])00(?=[%x]?$)/, '');
  const prefix = f === 'money' ? PREFIX[ctx.currency] : '';
  const abs = Math.abs(n);
  const units: [number, string, string][] = [[1e9, 'M', 'B'], [1e6, 'jt', 'M'], [1e3, 'rb', 'K']];
  for (const [size, id, en] of units) {
    if (abs >= size) {
      const value = (n / size).toLocaleString(locale(ctx), { maximumFractionDigits: abs / size >= 100 ? 0 : 1 });
      return ctx.lang === 'id' ? `${prefix}${value} ${id}` : `${prefix}${value}${en}`;
    }
  }
  return prefix + n.toLocaleString(locale(ctx), { maximumFractionDigits: f === 'money' && ctx.currency === 'MYR' ? 2 : 0 });
}

export function toneOf(cls: DeltaClassName): Sentiment3 {
  return cls === 'delta-good' ? 'good' : cls === 'delta-bad' ? 'bad' : 'neutral';
}

// Report builders hand over display strings ("Rp1.234.567", "12,34%", "12.34%",
// "1,23x"). They use two decimal conventions, told apart by the rule each
// formatter follows: a comma is always the decimal mark, and a dot followed by
// three digits groups thousands, while any other dot is a decimal point.
function parseNumber(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseCell(display: string | null | undefined): Cell {
  const s = String(display ?? '').trim();
  if (!s || s === '—' || s === '-' || s === 'N/A') return { n: null, f: 'num' };
  if (/^(Rp|RM)/i.test(s)) return { n: parseNumber(s.replace(/^(Rp|RM)\s*/i, '')), f: 'money', rounded: true };
  if (s.endsWith('%')) return { n: parseNumber(s.slice(0, -1)), f: 'pct' };
  if (/x$/i.test(s)) return { n: parseNumber(s.slice(0, -1)), f: 'x' };
  const n = parseNumber(s);
  if (n === null) return { n: null, f: 'text', t: s };
  // An unmarked decimal is a ratio (TikTok ROI, Frequency); a whole number a count.
  return { n, f: n % 1 === 0 ? 'num' : 'dec' };
}

// The same two conventions for a delta string. "New", "N/A" and "—" are kept as
// they are: they say why there is no percentage.
export function parseDelta(display: string | null | undefined, cls: DeltaClassName, deltaNum?: number | null): DeltaCell {
  const tone = toneOf(cls);
  if (deltaNum !== null && deltaNum !== undefined && Number.isFinite(deltaNum)) return { n: deltaNum, tone };
  const s = String(display ?? '').trim();
  if (/%$/.test(s)) {
    const n = parseNumber(s.slice(0, -1).replace(/^\+/, ''));
    if (n !== null) return { n, tone };
  }
  return { n: null, s: s || '—', tone };
}

export function plainNumber(cell: Cell): number | null {
  return cell.f === 'text' ? null : cell.n;
}

// Monthly labels and the default file name.
const MONTHS: Record<Lang, string[]> = {
  id: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const MONTHS_SHORT: Record<Lang, string[]> = {
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

function parts(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? [Number(m[1]), Number(m[2]) - 1, Number(m[3])] : null;
}

function lastDay(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

// "September 2026" for a whole month, "1-15 Sep 2026" or "28 Ags - 3 Sep 2026"
// otherwise.
export function periodLabelFromDates(start: string, end: string, lang: Lang): string {
  const a = parts(start);
  const b = parts(end);
  if (!a || !b) return '';
  const [ay, am, ad] = a;
  const [by, bm, bd] = b;
  if (ay === by && am === bm) {
    if (ad === 1 && bd === lastDay(by, bm)) return `${MONTHS[lang][bm]} ${by}`;
    return `${ad}-${bd} ${MONTHS_SHORT[lang][bm]} ${by}`;
  }
  return `${ad} ${MONTHS_SHORT[lang][am]}${ay === by ? '' : ` ${ay}`} - ${bd} ${MONTHS_SHORT[lang][bm]} ${by}`;
}

export function monthYearOf(iso: string, lang: Lang): string {
  const a = parts(iso);
  return a ? `${MONTHS[lang][a[1]]} ${a[0]}` : '';
}

// `[Brand Name] - Monthly Overview - [Month Year].pdf`
export function defaultFileName(brandName: string, curEnd: string, lang: Lang): string {
  const month = monthYearOf(curEnd, lang);
  const raw = `${brandName} - Monthly Overview${month ? ` - ${month}` : ''}.pdf`;
  return raw.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}
