import type { KpiRowDisplay } from '../../../components/KpiTable';
import { computeDelta, deltaClassForSentiment } from '../../../lib/delta';
import type { PivotFmt } from '../../../lib/shopeeDeepDivePivot';
import type { Sentiment } from '../../../lib/types';
import { parseCell, parseDelta, toneOf } from '../format';
import type { BlockSource, Cell, ChartBlock, ChartType, DataBlock, DeltaCell, KpiBlock, KpiRow, MissingAnalysis, TableBlock, TableColumn, TableRow, Text2, ValueFmt } from '../types';

// Shared by the per-channel mappers: turns what ATLAS's report builders already
// computed into snapshot blocks. Nothing here calculates a metric of its own;
// percentage changes go through lib/delta.ts, the same as the Performance Report.

// Three slides' worth at the table layout's eight rows; plan.ts stops at the same
// point, so "showing the top N" always matches what the deck shows.
export const MAX_TABLE_ROWS = 24;

export const L = (id: string, en: string = id): Text2 => ({ id, en });

export const money = (n: number | null | undefined): Cell => ({ n: n ?? null, f: 'money' });
export const count = (n: number | null | undefined): Cell => ({ n: n ?? null, f: 'num' });
export const pct = (n: number | null | undefined): Cell => ({ n: n ?? null, f: 'pct' });
export const times = (n: number | null | undefined): Cell => ({ n: n ?? null, f: 'x' });
export const dec = (n: number | null | undefined): Cell => ({ n: n ?? null, f: 'dec' });

const PIVOT_FMT: Record<PivotFmt, ValueFmt> = { rp: 'money', num: 'num', pct: 'pct', roas: 'x', dec: 'dec' };
export const pivotFmt = (f: PivotFmt): ValueFmt => PIVOT_FMT[f];

export function deltaOf(old: number | null | undefined, cur: number | null | undefined, sentiment: Sentiment): DeltaCell {
  const { deltaNum, deltaStr } = computeDelta(old, cur);
  const tone = toneOf(deltaClassForSentiment(deltaNum, sentiment));
  return deltaNum === null ? { n: null, s: deltaStr, tone } : { n: deltaNum, tone };
}

export function kpiRow(label: string, old: Cell, cur: Cell, sentiment: Sentiment): KpiRow {
  return { label, old, cur, delta: deltaOf(old.n, cur.n, sentiment) };
}

// A row from any Performance Report table. `oldNum`/`curNum` win when the
// builder provides them; otherwise the display string is read back.
export function fromDisplayRow(r: KpiRowDisplay & { oldNum?: number | null; curNum?: number | null; deltaNum?: number | null }): KpiRow {
  const oldParsed = parseCell(r.old);
  const curParsed = parseCell(r.cur);
  const exact = (c: Cell, n: number | null | undefined): Cell => (n === undefined || c.f === 'text' ? c : { n, f: c.f });
  return { label: r.label, old: exact(oldParsed, r.oldNum), cur: exact(curParsed, r.curNum), delta: parseDelta(r.delta, r.cls, r.deltaNum) };
}

// A metric the export does not carry shows "—" on both sides; a slide has no use
// for such a row.
export const hasValue = (r: KpiRow): boolean => r.old.n !== null || r.cur.n !== null || r.old.f === 'text' || r.cur.f === 'text';

export function kpiBlock(id: string, source: BlockSource, title: Text2, rows: KpiRow[], note?: Text2): KpiBlock | null {
  const shown = rows.filter(hasValue);
  return shown.length ? { id, source, kind: 'kpi', title, rows: shown, note } : null;
}

export function chartBlock(id: string, source: BlockSource, title: Text2, chart: ChartType, labels: string[], series: ChartBlock['series'], fmt: ValueFmt, note?: Text2): ChartBlock | null {
  const live = series.filter((s) => s.values.some((v) => v !== null && v !== 0));
  return labels.length && live.length ? { id, source, kind: 'chart', title, chart, labels, series: live, fmt, note } : null;
}

export function tableBlock(id: string, source: BlockSource, title: Text2, nameLabel: string, columns: TableColumn[], rows: TableRow[], opts: { deltaLabel?: string; note?: Text2; limit?: number; compactColumns?: string[] } = {}): TableBlock | null {
  if (!rows.length) return null;
  const limit = opts.limit ?? MAX_TABLE_ROWS;
  const shown = rows.slice(0, limit);
  const trimmed = rows.length > shown.length;
  const note = trimmed ? mergeNote(opts.note, L(`Menampilkan ${shown.length} dari ${rows.length} baris teratas.`, `Showing the top ${shown.length} of ${rows.length} rows.`)) : opts.note;
  return { id, source, kind: 'table', title, nameLabel, columns, compactColumns: opts.compactColumns, deltaLabel: opts.deltaLabel, rows: shown, note };
}

function mergeNote(a: Text2 | undefined, b: Text2): Text2 {
  return a ? { id: `${a.id} ${b.id}`, en: `${a.en} ${b.en}` } : b;
}

// Long campaign/creative names are cut for the slide, never for the data.
export function shortName(name: string, max = 46): string {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// For chart axes, where names often differ only at the end ("… | Boost A", "… | Boost B").
export function shortMiddle(name: string, max = 34): string {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const tail = Math.floor((max - 1) / 2);
  return `${s.slice(0, max - 1 - tail).trimEnd()}…${s.slice(-tail).trimStart()}`;
}

export function addBlock(blocks: Record<string, DataBlock>, block: DataBlock | null): string | null {
  if (!block) return null;
  blocks[block.id] = block;
  return block.id;
}

export function missing(id: string, source: BlockSource, title: Text2, reason: string, importTo?: string): MissingAnalysis {
  return { id, source, title, reason, importTo };
}
