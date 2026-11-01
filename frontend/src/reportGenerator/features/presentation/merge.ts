import type { PresentationDocument, SectionDoc, SlideDoc } from './types';

// A brand's team works on one deck at once: one person on Meta, another on Shopee.
// When a save finds the draft has moved on, the two versions are combined against
// the version both started from. Only the same field of the same slide changed
// differently by both is a real conflict; nobody's work is overwritten silently.

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface MergeResult {
  doc: PresentationDocument;
  // Titles of slides both people changed in the same field.
  conflicts: string[];
}

function pickValue<T>(base: T, mine: T, theirs: T): T {
  return same(mine, base) ? theirs : mine;
}

// Field by field, so one person's headline and another's findings both survive.
function mergeSlide(base: SlideDoc, mine: SlideDoc, theirs: SlideDoc): { slide: SlideDoc; conflict: boolean } {
  const out = { ...theirs } as unknown as Record<string, unknown>;
  const b = base as unknown as Record<string, unknown>;
  const m = mine as unknown as Record<string, unknown>;
  const t = theirs as unknown as Record<string, unknown>;
  let conflict = false;
  for (const key of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)])) {
    const mineChanged = !same(m[key], b[key]);
    const theirsChanged = !same(t[key], b[key]);
    if (mineChanged && theirsChanged && !same(m[key], t[key])) conflict = true;
    else if (mineChanged) out[key] = m[key];
  }
  return { slide: out as unknown as SlideDoc, conflict };
}

// One list's order, with what only the other list has placed after its neighbour.
function orderIds(primary: string[], secondary: string[], keep: Set<string>): string[] {
  const seq = primary.filter((id) => keep.has(id));
  secondary.forEach((id, i) => {
    if (!keep.has(id) || seq.includes(id)) return;
    const after = i > 0 ? seq.indexOf(secondary[i - 1]) : -1;
    seq.splice(after + 1, 0, id);
  });
  return seq;
}

function mergeSections(base: SectionDoc[], mine: SectionDoc[], theirs: SectionDoc[]): SectionDoc[] {
  const byId = (list: SectionDoc[]) => new Map(list.map((s) => [s.id, s]));
  const b = byId(base);
  const m = byId(mine);
  const t = byId(theirs);
  const ids = (list: SectionDoc[]) => list.map((s) => s.id);
  const mineReordered = !same(ids(mine).filter((id) => b.has(id)), ids(base).filter((id) => m.has(id)));
  const keep = new Set([...m.keys(), ...t.keys()]);
  const order = mineReordered ? orderIds(ids(mine), ids(theirs), keep) : orderIds(ids(theirs), ids(mine), keep);
  return order.map((id) => {
    const a = m.get(id);
    const c = t.get(id);
    const o = b.get(id);
    if (!a) return c as SectionDoc;
    if (!c || !o) return a;
    return pickValue(o, a, c);
  });
}

export function mergeDocuments(base: PresentationDocument, mine: PresentationDocument, theirs: PresentationDocument): MergeResult {
  const b = new Map(base.slides.map((s) => [s.id, s]));
  const m = new Map(mine.slides.map((s) => [s.id, s]));
  const t = new Map(theirs.slides.map((s) => [s.id, s]));
  const conflicts: string[] = [];
  const merged = new Map<string, SlideDoc>();

  for (const id of new Set([...m.keys(), ...t.keys(), ...b.keys()])) {
    const bs = b.get(id);
    const ms = m.get(id);
    const ts = t.get(id);
    if (!bs) {
      // New on one side (ids are unique, so never new on both).
      const added = ms ?? ts;
      if (added) merged.set(id, added);
    } else if (ms && ts) {
      const { slide, conflict } = mergeSlide(bs, ms, ts);
      if (conflict) conflicts.push(ms.title || ts.title);
      merged.set(id, slide);
    } else if (ms && !same(ms, bs)) {
      // Deleted by them while I was editing it.
      conflicts.push(ms.title);
    } else if (ts && !same(ts, bs)) {
      conflicts.push(ts.title);
    }
    // Otherwise deleted on one side and untouched on the other: it stays deleted.
  }

  const ids = (list: SlideDoc[]) => list.map((s) => s.id);
  const mineReordered = !same(ids(mine.slides).filter((id) => b.has(id) && t.has(id)), ids(base.slides).filter((id) => m.has(id) && t.has(id)));
  const keep = new Set(merged.keys());
  const order = mineReordered ? orderIds(ids(mine.slides), ids(theirs.slides), keep) : orderIds(ids(theirs.slides), ids(mine.slides), keep);

  return {
    conflicts,
    doc: {
      ...theirs,
      config: pickValue(base.config, mine.config, theirs.config),
      aiContext: pickValue(base.aiContext, mine.aiContext, theirs.aiContext),
      sections: mergeSections(base.sections, mine.sections, theirs.sections),
      slides: order.map((id) => merged.get(id) as SlideDoc),
    },
  };
}
