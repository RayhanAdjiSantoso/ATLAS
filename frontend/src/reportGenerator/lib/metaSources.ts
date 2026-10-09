// Which Meta files a month is read from — one rule for every reader
// (Business Overview's Meta tab, Report Generator's library picker), so no
// page can count the same spend twice.
//
// Data Collection Hub holds a month's Meta Ads export in one of two shapes:
//   · split   — 'boost' + 'nonboost' (what new uploads and the API auto-fetch
//               write);
//   · legacy  — 'meta', the combined export from before the split.
// Both describe the same campaigns, so a month must never be read from both.
// The split files always win: as soon as a month has either half, its
// legacy file is ignored — the API fills both halves, so a half-split month
// is a gap to close, not a reason to fall back to the old file. A month
// with only the legacy file is read from it unless the reader asked for
// split data only.
//
// CPAS ('cpas') is a separate ad account and is never part of this choice.

export type MetaSourceMode = 'auto' | 'split';

export interface MetaLibraryFile {
  channel: string;
  period_month: string | null;
}

export interface MetaMonthSource<F extends MetaLibraryFile = MetaLibraryFile> {
  month: string;
  /** What the month is read from. */
  used: 'split' | 'legacy' | 'none';
  /** Files to read for the main (non-CPAS) account. */
  files: F[];
  /** A split month missing one half — shown as a gap. */
  missing: ('boost' | 'nonboost')[];
  /** A legacy file existed but was left out (split data present, or split-only mode). */
  legacyIgnored: boolean;
}

const monthOf = (f: MetaLibraryFile) => String(f.period_month ?? '').slice(0, 7);

export function resolveMetaMonth<F extends MetaLibraryFile>(files: F[], month: string, mode: MetaSourceMode = 'auto'): MetaMonthSource<F> {
  const inMonth = files.filter((f) => monthOf(f) === month);
  const split = inMonth.filter((f) => f.channel === 'boost' || f.channel === 'nonboost');
  const legacy = inMonth.filter((f) => f.channel === 'meta');
  if (split.length) {
    const has = new Set(split.map((f) => f.channel));
    return {
      month, used: 'split', files: split,
      missing: (['boost', 'nonboost'] as const).filter((c) => !has.has(c)),
      legacyIgnored: legacy.length > 0,
    };
  }
  if (legacy.length && mode === 'auto') return { month, used: 'legacy', files: legacy, missing: [], legacyIgnored: false };
  return { month, used: 'none', files: [], missing: [], legacyIgnored: legacy.length > 0 };
}

export const META_SOURCE_LABEL: Record<MetaMonthSource['used'], string> = {
  split: 'Boost & Non-Boost (terpisah)',
  legacy: 'Meta Ads gabungan lama',
  none: 'Belum ada file',
};
