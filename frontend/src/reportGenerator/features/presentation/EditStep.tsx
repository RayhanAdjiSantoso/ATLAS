import { Copy, Eye, EyeOff, GripVertical, Loader2, Plus, Sparkles, Square, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { generateNarrative, getAiStatus } from './api';
import { LAYOUTS, applyLanguage, newId, newSlide, orderedSlides, visibleSlides } from './plan';
import { renderContext, ScaledSlide, SlideView } from './slides/SlideView';
import { SlideEditor, type AiControls } from './SlideEditor';
import type { AiSuggestion, Lang, NarrativeField, PresentationDocument, SlideDoc, Snapshot, Tone } from './types';
import { exportableSlides, factsForSlide, otherNarratives } from './validate';

// Step 3: slides on the left, the selected one in the middle, its content on the
// right. Thumbnails are the real slides, drawn small.

type AiField = NarrativeField | 'headline' | 'actions';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function aiFieldsOf(slide: SlideDoc): AiField[] {
  const def = LAYOUTS[slide.layout];
  if (def.group === 'structure' || def.supporting) return [];
  const fields: AiField[] = [...def.fields];
  if (def.actions) fields.push('actions');
  if (def.group === 'data') fields.unshift('headline');
  return fields;
}

export function EditStep({ doc, snapshot, reportId, update, selectedId, onSelect }: {
  doc: PresentationDocument;
  snapshot: Snapshot | null;
  reportId: number | null;
  update: (fn: (d: PresentationDocument) => PresentationDocument) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const slides = orderedSlides(doc);
  const visible = useMemo(() => visibleSlides(doc), [doc]);
  const selected = slides.find((s) => s.id === selectedId) ?? slides[0] ?? null;
  const ctx = useMemo(() => renderContext(doc, snapshot), [doc, snapshot]);
  const thumbCtx = useMemo(() => renderContext(doc, snapshot, true), [doc, snapshot]);
  const exported = useMemo(() => exportableSlides(doc), [doc]);
  const numberOf = (id: string) => exported.findIndex((s) => s.id === id) + 1;
  const [previewRef, previewWidth] = useWidth<HTMLDivElement>();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const patch = (id: string, change: Partial<SlideDoc>) => update((d) => ({ ...d, slides: d.slides.map((s) => (s.id === id ? { ...s, ...change } : s)) }));

  // Drops the slide in front of the target, taking on the target's section.
  function moveBefore(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    update((d) => {
      const list = orderedSlides(d);
      const moved = list.find((s) => s.id === sourceId);
      const target = list.find((s) => s.id === targetId);
      if (!moved || !target) return d;
      const rest = list.filter((s) => s.id !== sourceId);
      rest.splice(rest.indexOf(target), 0, { ...moved, sectionId: target.sectionId });
      return { ...d, slides: rest };
    });
  }

  function duplicate(slide: SlideDoc) {
    const copy: SlideDoc = { ...JSON.parse(JSON.stringify(slide)), id: newId('s') };
    update((d) => {
      const list = orderedSlides(d);
      list.splice(list.findIndex((s) => s.id === slide.id) + 1, 0, copy);
      return { ...d, slides: list };
    });
    onSelect(copy.id);
  }

  function remove(id: string) {
    const i = slides.findIndex((s) => s.id === id);
    update((d) => ({ ...d, slides: d.slides.filter((s) => s.id !== id) }));
    const next = slides[i + 1] ?? slides[i - 1];
    if (next) onSelect(next.id);
    setConfirmDelete(null);
  }

  function addAfter() {
    const sectionId = selected?.sectionId ?? doc.sections[0]?.id;
    if (!sectionId) return;
    const slide = newSlide(sectionId, 'narrative', 'Custom Slide');
    update((d) => {
      const list = orderedSlides(d);
      const at = selected ? list.findIndex((s) => s.id === selected.id) + 1 : list.length;
      list.splice(at, 0, slide);
      return { ...d, slides: list };
    });
    onSelect(slide.id);
  }

  // ── AI ──────────────────────────────────────────────────────────────
  const [aiAvailable, setAiAvailable] = useState(false);
  const [busyField, setBusyField] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const stopRef = useRef(false);
  useEffect(() => { getAiStatus().then((s) => setAiAvailable(s.available)); }, []);

  async function draftFor(slide: SlideDoc, fields: AiField[]): Promise<AiSuggestion[]> {
    const { facts, rootCause } = factsForSlide(slide, doc, snapshot);
    if (!facts.length) throw new Error('Slide ini belum punya data ATLAS yang bisa dijadikan dasar. Tulis manual atau pilih data dulu.');
    const res = await generateNarrative({
      clientId: doc.config.brandId, lang: doc.config.lang, tone: doc.config.tone, fields, slideTitle: slide.title,
      period: `${doc.config.period.curLabel} vs ${doc.config.period.oldLabel}`, facts, rootCause, context: doc.aiContext, otherNarratives: otherNarratives(slide, visible),
    });
    const unmatchedFor = (field: string) => [...new Set(res.warnings.filter((w) => w.field === field).flatMap((w) => w.unmatched))];
    return fields.flatMap((field): AiSuggestion[] => {
      const base = { field, slideId: slide.id, unmatched: unmatchedFor(field) };
      if (field === 'headline') return res.suggestions.headline ? [{ ...base, headline: res.suggestions.headline }] : [];
      if (field === 'actions') return res.suggestions.actions?.length ? [{ ...base, actions: res.suggestions.actions }] : [];
      const points = res.suggestions[field];
      return points?.length ? [{ ...base, points }] : [];
    });
  }

  const replaceSuggestions = (slideId: string, incoming: AiSuggestion[]) => setSuggestions((prev) => [
    ...prev.filter((s) => !(s.slideId === slideId && incoming.some((n) => n.field === s.field))),
    ...incoming,
  ]);

  async function generateOne(slide: SlideDoc, fields: AiField[]) {
    setBusyField(`${slide.id}:${fields.join(',')}`);
    setAiError(null);
    try {
      const made = await draftFor(slide, fields);
      replaceSuggestions(slide.id, made);
      if (!made.length) setAiError('AI tidak menemukan hal yang cukup didukung data untuk ditulis di bagian ini.');
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setBusyField(null);
    }
  }

  // One slide per request, so a long deck never meets the function time limit.
  async function generateAll() {
    setConfirmAll(false);
    const targets = visible.filter((s) => aiFieldsOf(s).length && factsForSlide(s, doc, snapshot).facts.length);
    stopRef.current = false;
    setAiError(null);
    setProgress({ done: 0, total: targets.length });
    let failures = 0;
    let lastError = '';
    for (let i = 0; i < targets.length && !stopRef.current; i += 1) {
      try {
        replaceSuggestions(targets[i].id, await draftFor(targets[i], aiFieldsOf(targets[i])));
      } catch (err) {
        failures += 1;
        lastError = (err as Error).message;
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null);
    if (failures) setAiError(`${failures} slide gagal: ${lastError}`);
  }

  const aiControls: AiControls = {
    available: aiAvailable,
    busyField: busyField ?? (progress ? 'all' : null),
    error: aiError,
    suggestions,
    generate: (slide, fields) => void generateOne(slide, fields),
    dismiss: (s) => setSuggestions((prev) => prev.filter((x) => x !== s)),
  };

  const pendingBySlide = new Set(suggestions.map((s) => s.slideId));

  const onDragOver = (e: DragEvent, id: string) => {
    e.preventDefault();
    if (dropId !== id) setDropId(id);
  };

  return (
    <div className="prb-edit">
      <nav className="prb-rail" aria-label="Daftar slide">
        <button type="button" className="btn btn-ghost prb-btn-sm prb-rail-add" onClick={addAfter}><Plus size={14} aria-hidden /> Tambah slide</button>
        {doc.sections.filter((sec) => slides.some((s) => s.sectionId === sec.id)).map((sec) => (
          <div key={sec.id} className={sec.enabled ? '' : 'is-off'}>
            <div className="prb-rail-section">{sec.title}</div>
            {slides.filter((s) => s.sectionId === sec.id).map((s) => (
              <div
                key={s.id}
                className={`prb-thumb${s.id === selected?.id ? ' is-on' : ''}${s.hidden || !sec.enabled ? ' is-hidden' : ''}${dropId === s.id && dragId !== s.id ? ' is-drop' : ''}`}
                data-thumb={s.id}
                draggable
                onDragStart={() => setDragId(s.id)}
                onDragEnd={() => { setDragId(null); setDropId(null); }}
                onDragOver={(e) => onDragOver(e, s.id)}
                onDrop={(e) => { e.preventDefault(); if (dragId) moveBefore(dragId, s.id); setDragId(null); setDropId(null); }}
              >
                <button type="button" className="prb-thumb-open" aria-current={s.id === selected?.id} aria-label={`Slide ${s.title}`} onClick={() => onSelect(s.id)}>
                  <ScaledSlide width={168}>
                    <SlideView slide={s} doc={doc} snapshot={snapshot} reportId={reportId} number={numberOf(s.id)} deck={visible} ctx={thumbCtx} />
                  </ScaledSlide>
                </button>
                <div className="prb-thumb-meta">
                  <GripVertical size={13} aria-hidden className="prb-grip" />
                  <span className="prb-thumb-n">{numberOf(s.id) || '—'}</span>
                  <span className="prb-thumb-title" title={s.title}>{s.title}</span>
                  {pendingBySlide.has(s.id) && <Sparkles size={12} aria-label="Ada saran AI" className="prb-thumb-ai" />}
                </div>
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div className="prb-preview" ref={previewRef}>
        {selected && (
          <>
            <div className="prb-preview-tools">
              <span className="prb-preview-label">{LAYOUTS[selected.layout].label}</span>
              <button type="button" className="btn btn-ghost prb-btn-sm" aria-pressed={selected.hidden} onClick={() => patch(selected.id, { hidden: !selected.hidden })}>
                {selected.hidden ? <><EyeOff size={14} aria-hidden /> Tersembunyi</> : <><Eye size={14} aria-hidden /> Sembunyikan</>}
              </button>
              <button type="button" className="btn btn-ghost prb-btn-sm" onClick={() => duplicate(selected)}><Copy size={14} aria-hidden /> Duplikat</button>
              {confirmDelete === selected.id ? (
                <button type="button" className="btn btn-ghost prb-btn-sm prb-danger" onClick={() => remove(selected.id)}><Trash2 size={14} aria-hidden /> Yakin hapus?</button>
              ) : (
                <button type="button" className="btn btn-ghost prb-btn-sm" onClick={() => setConfirmDelete(selected.id)}><Trash2 size={14} aria-hidden /> Hapus</button>
              )}
            </div>
            {previewWidth > 0 && (
              <div className="prb-stage-frame">
                <ScaledSlide width={Math.max(320, previewWidth - 2)}>
                  <SlideView slide={selected} doc={doc} snapshot={snapshot} reportId={reportId} number={numberOf(selected.id)} deck={visible} ctx={ctx} hints />
                </ScaledSlide>
              </div>
            )}
          </>
        )}
      </div>

      <aside className="prb-panel" aria-label="Editor konten slide">
        {selected && <SlideEditor key={selected.id} slide={selected} doc={doc} snapshot={snapshot} reportId={reportId} patch={(p) => patch(selected.id, p)} ai={aiControls} />}
        <section className="prb-ai">
          <div className="prb-field-title"><Sparkles size={14} aria-hidden /> Bantuan AI (opsional)</div>
          {!aiAvailable ? (
            <p className="prb-hint">AI tidak tersedia di server ini. Semua fitur manual dan export tetap berjalan.</p>
          ) : (
            <>
              <label className="prb-field">Konteks tambahan untuk AI
                <textarea rows={3} value={doc.aiContext} placeholder="Mis. aktivasi Payday hanya berjalan di Agustus" onChange={(e) => update((d) => ({ ...d, aiContext: e.target.value }))} />
              </label>
              <div className="prb-grid2">
                <label className="prb-field">Bahasa
                  <select value={doc.config.lang} onChange={(e) => update((d) => applyLanguage(d, e.target.value as Lang))}><option value="id">Bahasa Indonesia</option><option value="en">English</option></select>
                </label>
                <label className="prb-field">Nada
                  <select value={doc.config.tone} onChange={(e) => update((d) => ({ ...d, config: { ...d.config, tone: e.target.value as Tone } }))}>
                    <option value="professional">Professional</option><option value="concise">Concise</option><option value="analytical">Analytical</option>
                  </select>
                </label>
              </div>
              {selected && aiFieldsOf(selected).length > 0 && (
                <button type="button" className="btn btn-ghost prb-btn-sm" disabled={Boolean(aiControls.busyField)} onClick={() => void generateOne(selected, aiFieldsOf(selected))}>
                  <Sparkles size={14} aria-hidden /> Draft slide ini
                </button>
              )}
              {progress ? (
                <button type="button" className="btn btn-ghost prb-btn-sm" onClick={() => { stopRef.current = true; }}><Square size={13} aria-hidden /> Hentikan ({progress.done}/{progress.total})</button>
              ) : confirmAll ? (
                <button type="button" className="btn btn-ghost prb-btn-sm prb-danger" onClick={() => void generateAll()}>
                  <Sparkles size={14} aria-hidden /> Yakin? Memakai {visible.filter((s) => aiFieldsOf(s).length && factsForSlide(s, doc, snapshot).facts.length).length} permintaan AI
                </button>
              ) : (
                <button type="button" className="btn btn-ghost prb-btn-sm" disabled={Boolean(busyField)} onClick={() => setConfirmAll(true)}>
                  {busyField ? <Loader2 size={14} className="rg-spin" aria-hidden /> : <Sparkles size={14} aria-hidden />} Generate All Drafts
                </button>
              )}
              <p className="prb-hint">AI hanya berjalan saat tombol Generate ditekan, dan hasilnya tidak menimpa isi sampai Anda memilih.</p>
            </>
          )}
          {aiError && <p className="prb-error-text" role="alert">{aiError}</p>}
        </section>
      </aside>
    </div>
  );
}
