import { formatCell, formatDelta, type FormatContext } from './format';
import { LAYOUTS, visibleSlides } from './plan';
import type { DataBlock, PresentationDocument, SlideDoc, Snapshot } from './types';

// Step 4's checks, and the facts handed to AI. Pure, so tests can pin them down.

export type IssueLevel = 'error' | 'warning' | 'info';
export interface ReviewIssue {
  level: IssueLevel;
  kind: 'missing-data' | 'empty-narrative' | 'overflow' | 'period' | 'brand' | 'empty-slide' | 'source';
  slideId?: string;
  message: string;
}

export function isEmptySlide(s: SlideDoc): boolean {
  const def = LAYOUTS[s.layout];
  if (def.group !== 'narrative' && s.layout !== 'executive') return false;
  if (def.actions) return !s.aggregateActions && !s.actions.some((a) => a.action.trim());
  if (def.supporting) return !s.supporting || (!s.supporting.kpis.length && !s.supporting.notes.length && !s.supporting.images.length);
  const hasData = s.blockIds.length > 0;
  return !hasData && !def.fields.some((f) => s.narrative[f].some((p) => p.text.trim()));
}

export function reviewDocument(doc: PresentationDocument, snapshot: Snapshot | null, overflow: ReadonlySet<string>): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const slides = visibleSlides(doc);
  const noHeadline: SlideDoc[] = [];
  if (!slides.length) issues.push({ level: 'error', kind: 'empty-slide', message: 'Semua slide tersembunyi: tidak ada yang bisa diekspor.' });
  if (!doc.config.brandName.trim()) issues.push({ level: 'error', kind: 'brand', message: 'Nama brand kosong.' });

  for (const src of snapshot?.sources ?? []) {
    if (src.status === 'error') issues.push({ level: 'error', kind: 'source', message: `${src.label} gagal dimuat: ${src.message ?? 'coba perbarui data.'}` });
    else if (src.status === 'unavailable') issues.push({ level: 'info', kind: 'source', message: `${src.label}: ${src.message ?? 'data tidak tersedia.'}` });
    if (src.periodMismatch) issues.push({ level: 'warning', kind: 'period', message: `${src.label} memakai periode ${src.periodCur} vs ${src.periodOld}, berbeda dari periode presentasi. Kolomnya memakai label periode aslinya.` });
    if (src.periodWarning) issues.push({ level: 'warning', kind: 'period', message: `${src.label}: ${src.periodWarning}` });
    if (src.currency && src.currency !== doc.config.currency) issues.push({ level: 'warning', kind: 'period', message: `${src.label} dilaporkan dalam ${src.currency}, sedangkan presentasi memakai ${doc.config.currency}. Angka tidak dikonversi.` });
  }

  for (const s of slides) {
    const label = s.title || LAYOUTS[s.layout].label;
    if (overflow.has(s.id)) issues.push({ level: 'error', kind: 'overflow', slideId: s.id, message: `"${label}": isi tidak muat di slide. Ringkas teks atau pilih layout lain.` });
    for (const id of s.blockIds) {
      if (!snapshot?.blocks[id]) issues.push({ level: 'warning', kind: 'missing-data', slideId: s.id, message: `"${label}": data tidak tersedia, slide menampilkan "Data not available".` });
    }
    if (isEmptySlide(s)) {
      issues.push({ level: 'warning', kind: 'empty-slide', slideId: s.id, message: `"${label}": masih kosong, tidak ikut ke PDF sampai diisi.` });
    } else if (LAYOUTS[s.layout].group === 'data' && !s.headline.trim() && !s.hiddenFields.includes('headline')) {
      noHeadline.push(s);
    }
  }
  // One line, not one per slide: on a fresh deck this would bury everything else.
  if (noHeadline.length) issues.push({ level: 'info', kind: 'empty-narrative', slideId: noHeadline[0].id, message: `${noHeadline.length} slide data belum punya headline.` });
  return issues;
}

// What the PDF contains: an unfilled narrative slide is a blank page to a client,
// so it stays in the draft and out of the file until someone writes it.
export function exportableSlides(doc: PresentationDocument): SlideDoc[] {
  const deck = visibleSlides(doc);
  const anyAction = deck.some((s) => s.actions.some((a) => a.action.trim()));
  // A summary has something to list only if some slide has an action item.
  return deck.filter((s) => !isEmptySlide(s) && !(s.aggregateActions && !anyAction));
}

// ── Facts for AI ──────────────────────────────────────────────────────
// What the slide shows, as plain lines: the only numbers the model may use.
const FORMAT: FormatContext = { lang: 'en', currency: 'IDR' };

export function factsOfBlock(block: DataBlock, ctx: FormatContext = FORMAT): string[] {
  const t = block.title.en;
  switch (block.kind) {
    case 'kpi':
      return block.rows.map((r) => `${t} | ${r.label}: previous ${formatCell(r.old, ctx)}, current ${formatCell(r.cur, ctx)}, change ${formatDelta(r.delta, ctx)} (${r.delta.tone})`);
    case 'table':
      return block.rows.slice(0, 15).map((r) => `${t} | ${r.name}: ${block.columns.map((c) => `${c.label} ${formatCell(r.cells[c.key], ctx)}`).join(', ')}${r.delta ? `, change ${formatDelta(r.delta, ctx)}` : ''}`);
    case 'funnel':
      return block.nodes.map((n) => `${t} | ${n.label}: previous ${formatCell(n.old, ctx)}, current ${formatCell(n.cur, ctx)}, change ${formatDelta(n.delta, ctx)} (${n.delta.tone})`);
    case 'topBottom':
      return [
        ...block.top.map((i) => `${t} | Top: ${i.name}, ${block.metric} ${formatCell(i.value, ctx)}, spend ${formatCell(i.spend, ctx)}`),
        ...block.bottom.map((i) => `${t} | Bottom: ${i.name}, ${block.metric} ${formatCell(i.value, ctx)}, spend ${formatCell(i.spend, ctx)}`),
      ];
    case 'chart':
      if (block.labels.length > 15) {
        return block.series.map((s) => {
          const vals = s.values.filter((v): v is number => v !== null);
          return `${t} | ${s.role ?? s.label}: ${vals.length} points`;
        });
      }
      return block.series.flatMap((s) => block.labels.map((l, i) => `${t} | ${s.role === 'old' ? 'previous' : s.role === 'cur' ? 'current' : s.label} ${l}: ${formatCell({ n: s.values[i] ?? null, f: block.fmt }, ctx)}`));
    default:
      return [];
  }
}

export function factsForSlide(slide: SlideDoc, doc: PresentationDocument, snapshot: Snapshot | null): { facts: string[]; rootCause: string[] } {
  if (!snapshot) return { facts: [], rootCause: [] };
  const ctx: FormatContext = { lang: 'en', currency: doc.config.currency };
  const own = slide.blockIds.map((id) => snapshot.blocks[id]).filter((b): b is DataBlock => Boolean(b));
  const section = doc.sections.find((s) => s.id === slide.sectionId);
  // A narrative slide has no data of its own: it reads its channel, or for the
  // overview and conclusion, the cross-channel summary.
  const blocks = own.length
    ? own
    : Object.values(snapshot.blocks).filter((b) => (section?.channel ? b.source === section.channel && (b.kind === 'kpi' || b.kind === 'funnel') : b.source === 'overview' || (b.kind === 'kpi' && b.id.split('.').length <= 2)));
  const facts = blocks.flatMap((b) => factsOfBlock(b, ctx));
  const rootCause = blocks.flatMap((b) => (b.kind === 'funnel' ? b.reading ?? [] : []));
  return { facts: facts.slice(0, 200), rootCause: rootCause.slice(0, 40) };
}

// What other slides already say, so a draft does not repeat it.
export function otherNarratives(slide: SlideDoc, deck: SlideDoc[]): string[] {
  return deck
    .filter((s) => s.id !== slide.id)
    .flatMap((s) => [s.headline, ...Object.values(s.narrative).flat().map((p) => p.text)])
    .filter((t) => t.trim())
    .slice(0, 50);
}
