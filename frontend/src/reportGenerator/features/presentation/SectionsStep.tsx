import { ArrowDown, ArrowUp, ExternalLink, Plus } from 'lucide-react';
import { useState } from 'react';
import { LAYOUTS, newId, newSlide, orderedSlides } from './plan';
import type { LayoutKey, PresentationDocument, SectionDoc, SlideDoc, Snapshot } from './types';

// Step 2: which sections and slides the deck carries, in what order, plus the
// analyses this brand's data could not back, each with its three ways forward.

const LAYOUT_OPTIONS = Object.values(LAYOUTS);

export function layoutChoices(current: LayoutKey) {
  // A structural slide has no data region to swap; a content slide can become
  // any other layout that carries content.
  if (LAYOUTS[current].group === 'structure') return LAYOUT_OPTIONS.filter((l) => l.group === 'structure');
  return LAYOUT_OPTIONS.filter((l) => l.group !== 'structure');
}

export function SectionsStep({ doc, snapshot, update, onEditSlide }: {
  doc: PresentationDocument;
  snapshot: Snapshot | null;
  update: (fn: (d: PresentationDocument) => PresentationDocument) => void;
  onEditSlide: (id: string) => void;
}) {
  const [newLayout, setNewLayout] = useState<LayoutKey>('narrative');
  const slides = orderedSlides(doc);

  const moveSection = (id: string, by: number) => update((d) => {
    const list = [...d.sections];
    const i = list.findIndex((s) => s.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return d;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...d, sections: list };
  });
  const patchSection = (id: string, patch: Partial<SectionDoc>) => update((d) => ({ ...d, sections: d.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const patchSlide = (id: string, patch: Partial<SlideDoc>) => update((d) => ({ ...d, slides: d.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  function addSlide(sectionId: string) {
    const slide = newSlide(sectionId, newLayout, LAYOUTS[newLayout].label);
    update((d) => ({ ...d, slides: [...d.slides, slide] }));
    onEditSlide(slide.id);
  }

  // The section is created with the first slide that needs it, before Conclusion.
  function addSupporting(title: string) {
    const existing = doc.sections.find((s) => s.kind === 'supporting');
    const sectionId = existing?.id ?? newId('sec');
    const slide = newSlide(sectionId, 'supporting', title);
    update((d) => {
      const sections = [...d.sections];
      if (!existing) {
        const at = sections.findIndex((s) => s.kind === 'conclusion');
        sections.splice(at < 0 ? sections.length : at, 0, { id: sectionId, kind: 'supporting', title: 'Supporting Data & Context', enabled: true });
      }
      return { ...d, sections, slides: [...d.slides, slide] };
    });
    onEditSlide(slide.id);
  }

  const gaps = snapshot?.missing ?? [];
  const failed = (snapshot?.sources ?? []).filter((s) => s.status === 'error');

  return (
    <div className="prb-sections">
      <div className="prb-section-list">
        {doc.sections.map((sec, i) => {
          const own = slides.filter((s) => s.sectionId === sec.id);
          return (
            <section key={sec.id} className={`prb-card prb-section${sec.enabled ? '' : ' is-off'}`}>
              <header>
                <label className="prb-check">
                  <input type="checkbox" checked={sec.enabled} aria-label={`Tampilkan section ${sec.title}`} onChange={(e) => patchSection(sec.id, { enabled: e.target.checked })} />
                </label>
                <input className="prb-section-name" aria-label="Nama section" value={sec.title} onChange={(e) => patchSection(sec.id, { title: e.target.value })} />
                <span className="prb-count">{own.filter((s) => !s.hidden).length}/{own.length} slide</span>
                <button type="button" className="prb-icon" disabled={i === 0} aria-label={`Naikkan ${sec.title}`} onClick={() => moveSection(sec.id, -1)}><ArrowUp size={15} /></button>
                <button type="button" className="prb-icon" disabled={i === doc.sections.length - 1} aria-label={`Turunkan ${sec.title}`} onClick={() => moveSection(sec.id, 1)}><ArrowDown size={15} /></button>
              </header>
              <ul className="prb-slide-rows">
                {own.map((s) => (
                  <li key={s.id} className={s.hidden ? 'is-off' : ''}>
                    <label className="prb-check"><input type="checkbox" checked={!s.hidden} aria-label={`Tampilkan slide ${s.title}`} onChange={(e) => patchSlide(s.id, { hidden: !e.target.checked })} /></label>
                    <button type="button" className="prb-link" onClick={() => onEditSlide(s.id)}>{s.title || LAYOUTS[s.layout].label}</button>
                    <select aria-label={`Layout ${s.title}`} value={s.layout} onChange={(e) => patchSlide(s.id, { layout: e.target.value as LayoutKey, ...(LAYOUTS[e.target.value as LayoutKey].supporting && !s.supporting ? { supporting: { kpis: [], notes: [], images: [] } } : {}) })}>
                      {layoutChoices(s.layout).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
              <footer>
                <select aria-label={`Layout slide baru di ${sec.title}`} value={newLayout} onChange={(e) => setNewLayout(e.target.value as LayoutKey)}>
                  {LAYOUT_OPTIONS.filter((l) => l.group !== 'structure' || l.key === 'divider').map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                </select>
                <button type="button" className="btn btn-ghost prb-btn-sm" onClick={() => addSlide(sec.id)}><Plus size={14} aria-hidden /> Tambah custom slide</button>
              </footer>
            </section>
          );
        })}
      </div>

      <aside className="prb-gaps">
        <section className="prb-card">
          <h3>Supporting Data & Context</h3>
          <p className="prb-hint">Untuk data di luar ATLAS: offline sales, organic social, aktivasi, influencer, catatan operasional. Slide ini diberi tanda sumbernya agar tidak terbaca sebagai data ATLAS.</p>
          <button type="button" className="btn btn-ghost prb-btn-sm" onClick={() => addSupporting('Supporting Data & Context')}><Plus size={14} aria-hidden /> Tambah slide data pendukung</button>
        </section>
        {failed.length > 0 && (
          <section className="prb-card prb-error">
            <h3>Gagal dimuat</h3>
            <ul className="prb-gap-list">{failed.map((s) => <li key={s.source}><b>{s.label}</b><span>{s.message}</span></li>)}</ul>
          </section>
        )}
        <section className="prb-card">
          <h3>Data not available ({gaps.length})</h3>
          {gaps.length === 0 && <p className="prb-hint">Semua analisis standar punya data.</p>}
          <ul className="prb-gap-list">
            {gaps.map((g) => (
              <li key={g.id}>
                <b>{g.title.id}</b>
                <span>{g.reason} Slide-nya dihilangkan.</span>
                <div className="prb-gap-actions">
                  <button type="button" className="prb-link" onClick={() => addSupporting(g.title[doc.config.lang])}>Isi manual</button>
                  {g.importTo && <a className="prb-link" href={`/report-generator/${g.importTo}`}>Impor data <ExternalLink size={12} aria-hidden /></a>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
