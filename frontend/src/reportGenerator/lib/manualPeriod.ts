import { toISODate } from './dateFmt';
import { buildParsedPeriod, type ParsedPeriod } from './periodLabel';

// Period of a manual, not-stored upload made of one or more files — the
// "Upload file baru" path on Shopee and TikTok, for ranges the brand library's
// monthly slots can't express (a 1–12 report next to weekly 1–7 / 8–14 files).
//
// Shopee Ads and TikTok GMV Max exports carry totals for their whole date
// range with no per-day rows, so several files can only be combined by adding
// them up. That is sound for adjacent ranges (1–7 + 8–12 = 1–12) and silently
// wrong for overlapping ones (1–7 + 1–12 counts days 1–7 twice), which is why
// overlap is an error here rather than a warning. A gap is only a warning: a
// report for "1–7 and 15–21" is a legitimate thing to ask for, as long as the
// person generating it is told.

export interface ManualFilePeriod {
  name: string;
  period: ParsedPeriod;
}

export interface ManualPeriodResult {
  selection: { label: string; start: string | null; end: string | null };
  warning: string | null;
}

const shortDate = (d: Date) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function combineManualPeriods(parts: ManualFilePeriod[]): ManualPeriodResult {
  const dated = parts
    .filter((p) => p.period.start && p.period.end)
    .sort((a, b) => a.period.start!.getTime() - b.period.start!.getTime());
  const undated = parts.filter((p) => !(p.period.start && p.period.end));

  const gaps: string[] = [];
  for (let i = 1; i < dated.length; i += 1) {
    const prev = dated[i - 1];
    const next = dated[i];
    if (next.period.start!.getTime() <= prev.period.end!.getTime()) {
      throw new Error(
        `Rentang file tumpang tindih: "${prev.name}" (${prev.period.label}) dan "${next.name}" (${next.period.label}). `
        + 'Tanggal yang sama akan terhitung dua kali — pilih file yang rentangnya saling bersambung, misalnya 1–7 dan 8–12.',
      );
    }
    const dayAfterPrev = addDays(prev.period.end!, 1);
    if (next.period.start!.getTime() > dayAfterPrev.getTime()) {
      const lastMissing = addDays(next.period.start!, -1);
      gaps.push(dayAfterPrev.getTime() === lastMissing.getTime() ? shortDate(dayAfterPrev) : `${shortDate(dayAfterPrev)} – ${shortDate(lastMissing)}`);
    }
  }

  const warnings: string[] = [];
  if (gaps.length) warnings.push(`Ada tanggal yang tidak tercakup file mana pun: ${gaps.join(', ')}.`);
  if (undated.length) {
    warnings.push(
      `Periode tidak terbaca dari ${undated.map((p) => `"${p.name}"`).join(', ')}, jadi tumpang tindihnya tidak bisa diperiksa. `
      + 'Pastikan rentangnya benar dan isi label periode secara manual.',
    );
  }
  const warning = warnings.length ? warnings.join(' ') : null;

  if (!dated.length) return { selection: { label: '', start: null, end: null }, warning };

  const start = dated[0].period.start!;
  const end = dated.reduce((latest, p) => (p.period.end!.getTime() > latest.getTime() ? p.period.end! : latest), dated[0].period.end!);
  const combined = buildParsedPeriod(start, end);
  return { selection: { label: combined.label, start: toISODate(start), end: toISODate(end) }, warning };
}
