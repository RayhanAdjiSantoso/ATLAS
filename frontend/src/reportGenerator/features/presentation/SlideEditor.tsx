import { AlertTriangle, Check, Eye, EyeOff, ImagePlus, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { uploadAsset } from './api';
import { FIELD_TITLE } from './i18n';
import { LAYOUTS, newId } from './plan';
import { layoutChoices } from './SectionsStep';
import type { ActionItem, ActionPriority, AiSuggestion, LayoutKey, NarrativeField, NarrativePoint, PresentationDocument, SlideDoc, Snapshot, SupportingImage, SupportingKpi, SupportingNote } from './types';

// The right-hand panel of Step 3. Every field writes straight to the draft; the
// preview redraws from it. AI output stays in its own card until someone accepts it.

type AiField = NarrativeField | 'headline' | 'actions';

export interface AiControls {
  available: boolean;
  busyField: string | null;
  error: string | null;
  suggestions: AiSuggestion[];
  generate: (slide: SlideDoc, fields: AiField[]) => void;
  dismiss: (s: AiSuggestion) => void;
}

const KIND_LABEL = { fact: 'Fakta', hypothesis: 'Dugaan', recommendation: 'Rekomendasi' };

function AutoText({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string }) {
  return <textarea aria-label={label} rows={Math.min(6, Math.max(1, Math.ceil(value.length / 42), value.split('\n').length))} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function AiButton({ ai, slide, fields }: { ai: AiControls; slide: SlideDoc; fields: AiField[] }) {
  if (!ai.available) return null;
  const busy = ai.busyField === `${slide.id}:${fields.join(',')}`;
  return (
    <button type="button" className="prb-ai-btn" disabled={Boolean(ai.busyField)} onClick={() => ai.generate(slide, fields)}>
      {busy ? <Loader2 size={13} className="rg-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />} Generate
    </button>
  );
}

function SuggestionCard({ s, onReplace, onAppend, onDismiss }: { s: AiSuggestion; onReplace?: () => void; onAppend?: () => void; onDismiss: () => void }) {
  return (
    <div className="prb-suggestion" role="group" aria-label="Saran AI">
      <div className="prb-suggestion-head"><Sparkles size={13} aria-hidden /> Saran AI, belum dipakai</div>
      {s.headline && <p>{s.headline}</p>}
      {s.points && <ul>{s.points.map((p, i) => <li key={i}><span className={`prb-kind prb-kind-${p.kind}`}>{KIND_LABEL[p.kind]}</span>{p.text}</li>)}</ul>}
      {s.actions && <ul>{s.actions.map((a, i) => <li key={i}><b>{a.priority}</b> · {a.owner}: {a.action}</li>)}</ul>}
      {s.unmatched.length > 0 && (
        <p className="prb-suggestion-warn"><AlertTriangle size={13} aria-hidden /> Angka ini tidak ditemukan di data slide, periksa dulu: {s.unmatched.join(', ')}</p>
      )}
      <div className="prb-suggestion-actions">
        {onReplace && <button type="button" className="btn btn-primary prb-btn-sm" onClick={onReplace}><Check size={13} aria-hidden /> Ganti isi</button>}
        {onAppend && <button type="button" className="btn btn-ghost prb-btn-sm" onClick={onAppend}><Plus size={13} aria-hidden /> Tambahkan</button>}
        <button type="button" className="btn btn-ghost prb-btn-sm" onClick={onDismiss}><X size={13} aria-hidden /> Buang</button>
      </div>
    </div>
  );
}

function FieldHeader({ title, hidden, onToggle, children }: { title: string; hidden: boolean; onToggle: () => void; children?: ReactNode }) {
  return (
    <div className="prb-field-head">
      <span className="prb-field-title">{title}</span>
      {children}
      <button type="button" className="prb-icon" aria-pressed={hidden} aria-label={hidden ? `Tampilkan ${title}` : `Sembunyikan ${title}`} title={hidden ? 'Disembunyikan dari slide' : 'Tampil di slide'} onClick={onToggle}>
        {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

export function SlideEditor({ slide, doc, snapshot, reportId, patch, ai }: {
  slide: SlideDoc;
  doc: PresentationDocument;
  snapshot: Snapshot | null;
  reportId: number | null;
  patch: (p: Partial<SlideDoc>) => void;
  ai: AiControls;
}) {
  const def = LAYOUTS[slide.layout];
  const lang = doc.config.lang;
  const suggestionsFor = (field: AiField) => ai.suggestions.filter((s) => s.slideId === slide.id && s.field === field);
  const toggleHidden = (key: string) => patch({ hiddenFields: slide.hiddenFields.includes(key) ? slide.hiddenFields.filter((f) => f !== key) : [...slide.hiddenFields, key] });
  const setPoints = (field: NarrativeField, points: NarrativePoint[]) => patch({ narrative: { ...slide.narrative, [field]: points } });
  const blockOptions = Object.values(snapshot?.blocks ?? {});

  return (
    <div className="prb-editor">
      <label className="prb-field">Judul slide
        <input value={slide.title} onChange={(e) => patch({ title: e.target.value })} />
      </label>

      {(def.group !== 'structure' || slide.layout === 'divider') && (
        <div>
          <FieldHeader title="Headline" hidden={slide.hiddenFields.includes('headline')} onToggle={() => toggleHidden('headline')}>
            <AiButton ai={ai} slide={slide} fields={['headline']} />
          </FieldHeader>
          <AutoText label="Headline" value={slide.headline} placeholder="Contoh: Spending Declined While Conversion Efficiency Improved" onChange={(v) => patch({ headline: v })} />
          {suggestionsFor('headline').map((s, i) => <SuggestionCard key={i} s={s} onReplace={() => { patch({ headline: s.headline ?? '' }); ai.dismiss(s); }} onDismiss={() => ai.dismiss(s)} />)}
        </div>
      )}

      <div className="prb-grid2">
        <label className="prb-field">Layout
          <select value={slide.layout} onChange={(e) => { const layout = e.target.value as LayoutKey; patch({ layout, ...(LAYOUTS[layout].supporting && !slide.supporting ? { supporting: { kpis: [], notes: [], images: [] } } : {}) }); }}>
            {layoutChoices(slide.layout).map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </label>
        <label className="prb-field">Section
          <select value={slide.sectionId} onChange={(e) => patch({ sectionId: e.target.value })}>
            {doc.sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
      </div>

      {def.blocks > 0 && (
        <div className="prb-blocks">
          {Array.from({ length: def.blocks }, (_, i) => (
            <label className="prb-field" key={i}>{def.blocks > 1 ? `Data ATLAS ${i + 1}` : 'Data ATLAS'}
              <select
                value={slide.blockIds[i] ?? ''}
                onChange={(e) => {
                  const next = [...slide.blockIds];
                  if (e.target.value) next[i] = e.target.value;
                  else next.splice(i, 1);
                  patch({ blockIds: next.filter(Boolean), page: undefined });
                }}
              >
                <option value="">Tanpa data</option>
                {blockOptions.map((b) => <option key={b.id} value={b.id}>{b.title[lang]}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}

      {def.fields.map((field) => (
        <div key={field}>
          <FieldHeader title={FIELD_TITLE[field][lang]} hidden={slide.hiddenFields.includes(field)} onToggle={() => toggleHidden(field)}>
            <AiButton ai={ai} slide={slide} fields={[field]} />
          </FieldHeader>
          <ul className="prb-points">
            {slide.narrative[field].map((p, i) => (
              <li key={p.id}>
                <AutoText label={`${FIELD_TITLE[field][lang]} ${i + 1}`} value={p.text} onChange={(v) => setPoints(field, slide.narrative[field].map((x) => (x.id === p.id ? { ...x, text: v } : x)))} />
                {p.kind && p.kind !== 'fact' && <span className={`prb-kind prb-kind-${p.kind}`}>{KIND_LABEL[p.kind]}</span>}
                <button type="button" className="prb-icon" aria-label={`Hapus poin ${i + 1}`} onClick={() => setPoints(field, slide.narrative[field].filter((x) => x.id !== p.id))}><X size={14} /></button>
              </li>
            ))}
          </ul>
          <button type="button" className="prb-add" onClick={() => setPoints(field, [...slide.narrative[field], { id: newId('p'), text: '' }])}><Plus size={13} aria-hidden /> Tambah poin</button>
          {suggestionsFor(field).map((s, i) => {
            const incoming = (s.points ?? []).map((p) => ({ id: newId('p'), text: p.text, kind: p.kind }));
            return <SuggestionCard key={i} s={s} onReplace={() => { setPoints(field, incoming); ai.dismiss(s); }} onAppend={() => { setPoints(field, [...slide.narrative[field], ...incoming]); ai.dismiss(s); }} onDismiss={() => ai.dismiss(s)} />;
          })}
        </div>
      ))}

      {def.actions && <ActionsEditor slide={slide} patch={patch} ai={ai} suggestions={suggestionsFor('actions')} />}
      {def.supporting && <SupportingEditor slide={slide} patch={patch} reportId={reportId} />}
    </div>
  );
}

function ActionsEditor({ slide, patch, ai, suggestions }: { slide: SlideDoc; patch: (p: Partial<SlideDoc>) => void; ai: AiControls; suggestions: AiSuggestion[] }) {
  const set = (id: string, change: Partial<ActionItem>) => patch({ actions: slide.actions.map((a) => (a.id === id ? { ...a, ...change } : a)) });
  const toItems = (s: AiSuggestion): ActionItem[] => (s.actions ?? []).map((a) => ({ id: newId('a'), action: a.action, owner: a.owner, priority: a.priority }));
  return (
    <div>
      <div className="prb-field-head">
        <span className="prb-field-title">Next Action Items</span>
        <AiButton ai={ai} slide={slide} fields={['actions']} />
      </div>
      {slide.aggregateActions !== undefined && (
        <label className="prb-check prb-agg">
          <input type="checkbox" checked={slide.aggregateActions} onChange={(e) => patch({ aggregateActions: e.target.checked })} />
          Sertakan action item dari slide lain
        </label>
      )}
      <ul className="prb-actions-list">
        {slide.actions.map((a, i) => {
          const custom = a.owner !== 'MIL Digital' && a.owner !== 'Client';
          return (
            <li key={a.id}>
              <AutoText label={`Action ${i + 1}`} value={a.action} placeholder="Tindakan" onChange={(v) => set(a.id, { action: v })} />
              <div className="prb-action-meta">
                <select aria-label="Owner" value={custom ? '__custom' : a.owner} onChange={(e) => set(a.id, { owner: e.target.value === '__custom' ? '' : e.target.value })}>
                  <option>MIL Digital</option><option>Client</option><option value="__custom">Custom</option>
                </select>
                {custom && <input aria-label="Owner custom" placeholder="Nama owner" value={a.owner} onChange={(e) => set(a.id, { owner: e.target.value })} />}
                <select aria-label="Priority" value={a.priority} onChange={(e) => set(a.id, { priority: e.target.value as ActionPriority })}>
                  <option>High</option><option>Medium</option><option>Low</option>
                </select>
                <input type="date" aria-label="Target date" value={a.targetDate ?? ''} onChange={(e) => set(a.id, { targetDate: e.target.value })} />
                <input aria-label="Status" placeholder="Status" value={a.status ?? ''} onChange={(e) => set(a.id, { status: e.target.value })} />
                <button type="button" className="prb-icon" aria-label={`Hapus action ${i + 1}`} onClick={() => patch({ actions: slide.actions.filter((x) => x.id !== a.id) })}><Trash2 size={14} /></button>
              </div>
            </li>
          );
        })}
      </ul>
      <button type="button" className="prb-add" onClick={() => patch({ actions: [...slide.actions, { id: newId('a'), action: '', owner: 'MIL Digital', priority: 'Medium' }] })}><Plus size={13} aria-hidden /> Tambah action</button>
      {suggestions.map((s, i) => <SuggestionCard key={i} s={s} onReplace={() => { patch({ actions: toItems(s) }); ai.dismiss(s); }} onAppend={() => { patch({ actions: [...slide.actions, ...toItems(s)] }); ai.dismiss(s); }} onDismiss={() => ai.dismiss(s)} />)}
    </div>
  );
}

// Downscaled in the browser so a phone screenshot does not cost megabytes per page.
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d');
  if (!g) return file;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.88));
}

function SupportingEditor({ slide, patch, reportId }: { slide: SlideDoc; patch: (p: Partial<SlideDoc>) => void; reportId: number | null }) {
  const data = slide.supporting ?? { kpis: [], notes: [], images: [] };
  const set = (change: Partial<typeof data>) => patch({ supporting: { ...data, ...change } });
  const setKpi = (id: string, c: Partial<SupportingKpi>) => set({ kpis: data.kpis.map((k) => (k.id === id ? { ...k, ...c } : k)) });
  const setNote = (id: string, c: Partial<SupportingNote>) => set({ notes: data.notes.map((n) => (n.id === id ? { ...n, ...c } : n)) });
  const setImage = (id: string, c: Partial<SupportingImage>) => set({ images: data.images.map((n) => (n.id === id ? { ...n, ...c } : n)) });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !reportId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const blob = await shrinkImage(file);
      const { assetId } = await uploadAsset(reportId, blob, `${file.name.replace(/\.[^.]+$/, '')}.jpg`);
      set({ images: [...data.images, { id: newId('i'), assetId, caption: '', source: '' }] });
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="prb-supporting">
      <div className="prb-field-title">KPI pendukung (input manual)</div>
      {data.kpis.map((k) => (
        <div className="prb-sup-row" key={k.id}>
          <input aria-label="Nama KPI" placeholder="Nama KPI" value={k.label} onChange={(e) => setKpi(k.id, { label: e.target.value })} />
          <input aria-label="Nilai periode lalu" placeholder="Periode lalu" value={k.old} onChange={(e) => setKpi(k.id, { old: e.target.value })} />
          <input aria-label="Nilai periode ini" placeholder="Periode ini" value={k.cur} onChange={(e) => setKpi(k.id, { cur: e.target.value })} />
          <input aria-label="Sumber KPI" placeholder="Sumber (mis. Client)" value={k.source} onChange={(e) => setKpi(k.id, { source: e.target.value })} />
          <label className="prb-check" title="Bila turun berarti membaik, misalnya biaya"><input type="checkbox" checked={Boolean(k.lowerIsBetter)} onChange={(e) => setKpi(k.id, { lowerIsBetter: e.target.checked })} /> Turun = baik</label>
          <button type="button" className="prb-icon" aria-label="Hapus KPI" onClick={() => set({ kpis: data.kpis.filter((x) => x.id !== k.id) })}><X size={14} /></button>
        </div>
      ))}
      <button type="button" className="prb-add" onClick={() => set({ kpis: [...data.kpis, { id: newId('k'), label: '', old: '', cur: '', source: '' }] })}><Plus size={13} aria-hidden /> Tambah KPI</button>

      <div className="prb-field-title">Catatan aktivitas & operasional</div>
      {data.notes.map((n) => (
        <div className="prb-sup-note" key={n.id}>
          <input aria-label="Judul catatan" placeholder="Judul" value={n.title} onChange={(e) => setNote(n.id, { title: e.target.value })} />
          <AutoText label="Isi catatan" value={n.text} placeholder="Isi catatan" onChange={(v) => setNote(n.id, { text: v })} />
          <input aria-label="Sumber catatan" placeholder="Sumber / label" value={n.source} onChange={(e) => setNote(n.id, { source: e.target.value })} />
          <button type="button" className="prb-icon" aria-label="Hapus catatan" onClick={() => set({ notes: data.notes.filter((x) => x.id !== n.id) })}><X size={14} /></button>
        </div>
      ))}
      <button type="button" className="prb-add" onClick={() => set({ notes: [...data.notes, { id: newId('n'), title: '', text: '', source: '' }] })}><Plus size={13} aria-hidden /> Tambah catatan</button>

      <div className="prb-field-title">Gambar / screenshot (PNG, JPG, WebP)</div>
      {data.images.map((m) => (
        <div className="prb-sup-row" key={m.id}>
          <input aria-label="Keterangan gambar" placeholder="Keterangan" value={m.caption} onChange={(e) => setImage(m.id, { caption: e.target.value })} />
          <input aria-label="Sumber gambar" placeholder="Sumber" value={m.source} onChange={(e) => setImage(m.id, { source: e.target.value })} />
          <button type="button" className="prb-icon" aria-label="Hapus gambar" onClick={() => set({ images: data.images.filter((x) => x.id !== m.id) })}><X size={14} /></button>
        </div>
      ))}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
      <button type="button" className="prb-add" disabled={!reportId || uploading || data.images.length >= 2} onClick={() => fileRef.current?.click()}>
        {uploading ? <Loader2 size={13} className="rg-spin" aria-hidden /> : <ImagePlus size={13} aria-hidden />} Unggah gambar
      </button>
      {data.images.length >= 2 && <p className="prb-hint">Satu slide memuat dua gambar. Tambah slide lain untuk gambar berikutnya.</p>}
      {uploadError && <p className="prb-error-text">{uploadError}</p>}
    </div>
  );
}
