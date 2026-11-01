import { AlertTriangle, ArrowLeft, Check, Copy, FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { deleteDraft, duplicateDraft, getDraft, listDrafts } from './api';
import { ConfigStep } from './ConfigStep';
import { loadSnapshot } from './data/loadSnapshot';
import { EditStep } from './EditStep';
import { periodLabelFromDates } from './format';
import { planDocument, visibleSlides } from './plan';
import { ExportStep, ReviewStep } from './ReviewExportSteps';
import { SectionsStep } from './SectionsStep';
import { useDraft, type SaveState } from './useDraft';
import type { DraftSummary, PresentationConfig } from './types';
import './builder.css';

// Report Generator's second kind of output: a client deck built on the same saved
// reports as the Performance Report. Mounted beside the other report tabs and kept
// alive the same way; loaded on demand so the existing tabs carry none of its weight.

type Step = 'sections' | 'edit' | 'review' | 'export';
const STEPS: { key: Step; label: string }[] = [
  { key: 'sections', label: 'Sections' },
  { key: 'edit', label: 'Edit Content' },
  { key: 'review', label: 'Review' },
  { key: 'export', label: 'Export' },
];

const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  unsaved: 'Belum tersimpan',
  saving: 'Menyimpan…',
  saved: 'Tersimpan',
  error: 'Gagal menyimpan',
  conflict: 'Konflik draft',
  readonly: 'Akun lihat saja, tidak disimpan',
};

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  if (state === 'idle') return null;
  const Icon = state === 'saving' ? Loader2 : state === 'saved' ? Check : state === 'error' || state === 'conflict' ? AlertTriangle : null;
  return (
    <span className={`prb-save prb-save-${state}`} role="status" title={error ?? undefined}>
      {Icon && <Icon size={14} className={state === 'saving' ? 'rg-spin' : undefined} aria-hidden />} {SAVE_LABEL[state]}
    </span>
  );
}

export default function PresentationTab({ isActive, clientId }: { isActive: boolean; clientId: number | null }) {
  const { isViewOnly } = useAuth();
  const draft = useDraft(clientId);
  const [mode, setMode] = useState<'list' | 'config' | 'builder'>('list');
  const [step, setStep] = useState<Step>('sections');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const refreshList = useCallback(() => {
    if (!clientId) return;
    setError(null);
    listDrafts(clientId).then(setDrafts).catch((err) => setError(err.message));
  }, [clientId]);

  useEffect(() => {
    if (isActive && mode === 'list') refreshList();
  }, [isActive, mode, refreshList]);

  async function build(config: PresentationConfig, name: string) {
    setBuilding(true);
    setError(null);
    try {
      const snapshot = await loadSnapshot(config);
      const doc = planDocument(config, snapshot);
      draft.open({ doc, snapshot, name, reportId: null, revision: 0, isNew: true });
      setStep('sections');
      setSelectedId(doc.slides[0]?.id ?? null);
      setMode('builder');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  async function open(id: number) {
    setError(null);
    try {
      const row = await getDraft(id);
      draft.open({ doc: row.document, snapshot: row.snapshot, name: row.name, reportId: row.id, revision: row.revision });
      setStep('edit');
      setSelectedId(row.document.slides[0]?.id ?? null);
      setMode('builder');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function backToList() {
    await draft.saveNow();
    draft.close();
    setMode('list');
  }

  // Refreshes figures only. Slides keep their order and every word typed; a block
  // that no longer exists shows "Data not available" and Review lists it.
  async function refreshData() {
    if (!draft.doc) return;
    setRefreshing(true);
    setError(null);
    try {
      draft.setSnapshot(await loadSnapshot(draft.doc.config));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  const openSlide = (id: string) => {
    setSelectedId(id);
    setStep('edit');
  };

  if (!clientId) return isActive ? <div className="prb-root"><div className="prb-card">Pilih brand di atas untuk membuat presentasi.</div></div> : null;

  // Hidden rather than unmounted, like the other report tabs: an open draft and
  // its pending AI suggestions survive a look at another tab.
  return (
    <div className="prb-root" data-feature="presentation-report" hidden={!isActive}>
      {error && <div className="prb-card prb-error" role="alert">{error}</div>}

      {mode === 'list' && (
        <>
          <div className="prb-head">
            <div>
              <h2>Presentation Report</h2>
              <p>Monthly Overview 16:9 untuk meeting klien, memakai data laporan yang sudah tersimpan di ATLAS. Performance Report tidak berubah.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setMode('config')}><Plus size={15} aria-hidden /> Presentasi baru</button>
          </div>
          <section className="prb-card">
            <h3>Draft tersimpan</h3>
            {!drafts && !error && <p className="prb-hint"><Loader2 size={14} className="rg-spin" aria-hidden /> Memuat…</p>}
            {drafts?.length === 0 && <p className="prb-hint">Belum ada draft untuk brand ini.</p>}
            <ul className="prb-drafts">
              {drafts?.map((d) => (
                <li key={d.id}>
                  <button type="button" className="prb-draft-open" onClick={() => void open(d.id)}>
                    <FileText size={18} aria-hidden />
                    <span>
                      <b>{d.name}</b>
                      <small>
                        {d.period_cur_start && d.period_cur_end ? periodLabelFromDates(d.period_cur_start, d.period_cur_end, 'id') : 'Periode belum diisi'}
                        {d.channels.length ? ` · ${d.channels.join(', ')}` : ''}
                        {' · '}diubah {new Date(d.updated_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                        {d.updated_by_name ? ` oleh ${d.updated_by_name}` : ''}
                      </small>
                    </span>
                  </button>
                  {!isViewOnly && (
                    <>
                      <button type="button" className="prb-icon" aria-label={`Duplikat ${d.name}`} onClick={() => duplicateDraft(d.id).then(refreshList).catch((err) => setError(err.message))}><Copy size={15} /></button>
                      {confirmDelete === d.id ? (
                        <button type="button" className="btn btn-ghost prb-btn-sm prb-danger" onClick={() => deleteDraft(d.id).then(() => { setConfirmDelete(null); refreshList(); }).catch((err) => setError(err.message))}>Yakin hapus?</button>
                      ) : (
                        <button type="button" className="prb-icon" aria-label={`Hapus ${d.name}`} onClick={() => setConfirmDelete(d.id)}><Trash2 size={15} /></button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {mode === 'config' && (
        <>
          <div className="prb-head">
            <div>
              <button type="button" className="prb-back" onClick={() => setMode('list')}><ArrowLeft size={14} aria-hidden /> Daftar presentasi</button>
              <h2>Report Configuration</h2>
            </div>
          </div>
          <ConfigStep clientId={clientId} busy={building} onBuild={(c, n) => void build(c, n)} />
        </>
      )}

      {mode === 'builder' && draft.doc && (
        <>
          <div className="prb-head prb-head-builder">
            <button type="button" className="prb-back" onClick={() => void backToList()}><ArrowLeft size={14} aria-hidden /> Daftar presentasi</button>
            <input className="prb-name" aria-label="Nama presentasi" value={draft.name} onChange={(e) => draft.setName(e.target.value)} />
            <span className="prb-count">{visibleSlides(draft.doc).length} slide</span>
            <SaveIndicator state={draft.saveState} error={draft.saveError} />
            <div className="prb-steps" role="tablist" aria-label="Langkah">
              {STEPS.map((s, i) => (
                <button type="button" role="tab" aria-selected={step === s.key} key={s.key} className={step === s.key ? 'is-on' : ''} onClick={() => setStep(s.key)}>
                  <i>{i + 2}</i>{s.label}
                </button>
              ))}
            </div>
          </div>
          {draft.saveError && <div className="prb-card prb-error" role="alert">{draft.saveError}</div>}
          {draft.saveState === 'conflict' && (
            <div className="prb-card prb-conflict" role="alert">
              <p>Rekan satu tim mengubah bagian yang sama pada slide: <b>{draft.conflictSlides.join(', ')}</b>. Perubahan Anda belum tersimpan. Salin teks yang ingin dipertahankan, lalu muat versi terbaru.</p>
              <button type="button" className="btn btn-ghost prb-btn-sm" onClick={() => void draft.reloadLatest()}>Muat versi terbaru</button>
            </div>
          )}
          {step === 'sections' && <SectionsStep doc={draft.doc} snapshot={draft.snapshot} update={draft.update} onEditSlide={openSlide} />}
          {step === 'edit' && <EditStep doc={draft.doc} snapshot={draft.snapshot} reportId={draft.reportId} update={draft.update} selectedId={selectedId} onSelect={setSelectedId} />}
          {step === 'review' && <ReviewStep doc={draft.doc} snapshot={draft.snapshot} reportId={draft.reportId} refreshing={refreshing} onRefresh={() => void refreshData()} onOpenSlide={openSlide} />}
          {step === 'export' && <ExportStep doc={draft.doc} snapshot={draft.snapshot} reportId={draft.reportId} saveState={draft.saveState} name={draft.name} onName={draft.setName} onSave={draft.saveNow} />}
        </>
      )}
    </div>
  );
}
