import { AlertTriangle, CheckCircle2, Download, Info, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportDeckToPdf } from './exportPdf';
import { defaultFileName } from './format';
import { visibleSlides } from './plan';
import { renderContext, ScaledSlide, SlideView, STAGE_H, STAGE_W } from './slides/SlideView';
import type { PresentationDocument, Snapshot } from './types';
import { exportableSlides, reviewDocument, type ReviewIssue } from './validate';

// Steps 4 and 5. Review draws every slide for real, which is also how overflow is
// detected: each slide reports whether its content fit the stage.

const LEVEL_ICON = { error: XCircle, warning: AlertTriangle, info: Info };

export function ReviewStep({ doc, snapshot, reportId, refreshing, onRefresh, onOpenSlide, onIssues }: {
  doc: PresentationDocument;
  snapshot: Snapshot | null;
  reportId: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenSlide: (id: string) => void;
  onIssues?: (issues: ReviewIssue[]) => void;
}) {
  const slides = useMemo(() => visibleSlides(doc), [doc]);
  const ctx = useMemo(() => renderContext(doc, snapshot, true), [doc, snapshot]);
  const exported = useMemo(() => exportableSlides(doc), [doc]);
  const [overflow, setOverflow] = useState<ReadonlySet<string>>(new Set());
  const reportFit = useCallback((id: string, over: boolean) => {
    setOverflow((prev) => {
      if (prev.has(id) === over) return prev;
      const next = new Set(prev);
      if (over) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const issues = useMemo(() => reviewDocument(doc, snapshot, overflow), [doc, snapshot, overflow]);
  useEffect(() => { onIssues?.(issues); }, [issues, onIssues]);
  const counts = { error: issues.filter((i) => i.level === 'error').length, warning: issues.filter((i) => i.level === 'warning').length };

  return (
    <div className="prb-review">
      <aside className="prb-review-side">
        <section className="prb-card">
          <h3>Pemeriksaan</h3>
          <dl className="prb-review-facts">
            <div><dt>Brand</dt><dd>{doc.config.brandName}</dd></div>
            <div><dt>Periode</dt><dd>{doc.config.period.curLabel}</dd></div>
            <div><dt>Pembanding</dt><dd>{doc.config.period.oldLabel}</dd></div>
            <div><dt>Halaman PDF</dt><dd>{exported.length}</dd></div>
            <div><dt>Data diambil</dt><dd>{snapshot ? new Date(snapshot.builtAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd></div>
          </dl>
          <button type="button" className="btn btn-ghost prb-btn-sm" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? <Loader2 size={14} className="rg-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />} Perbarui data dari ATLAS
          </button>
          <p className="prb-hint">Angka di draft dibekukan sampai tombol ini ditekan, sehingga PDF tetap sama dengan yang sudah ditinjau.</p>
        </section>
        <section className="prb-card">
          <h3>{counts.error ? `${counts.error} masalah, ${counts.warning} peringatan` : counts.warning ? `${counts.warning} peringatan` : 'Siap diekspor'}</h3>
          {issues.length === 0 && <p className="prb-status ok"><CheckCircle2 size={14} aria-hidden /> Tidak ada yang perlu diperiksa.</p>}
          <ul className="prb-issues">
            {issues.map((issue, i) => {
              const Icon = LEVEL_ICON[issue.level];
              const body = <><Icon size={14} aria-hidden /><span>{issue.message}</span></>;
              return (
                <li key={i} className={`prb-issue-${issue.level}`}>
                  {issue.slideId ? <button type="button" onClick={() => onOpenSlide(issue.slideId as string)}>{body}</button> : <div>{body}</div>}
                </li>
              );
            })}
          </ul>
        </section>
      </aside>
      <div className="prb-review-grid">
        {slides.map((s) => {
          const page = exported.indexOf(s) + 1;
          return (
            <button type="button" key={s.id} className={`prb-review-slide${overflow.has(s.id) ? ' is-over' : ''}${page ? '' : ' is-skipped'}`} aria-label={`Buka slide ${s.title}`} onClick={() => onOpenSlide(s.id)}>
              <ScaledSlide width={360}>
                <SlideView slide={s} doc={doc} snapshot={snapshot} reportId={reportId} number={page} deck={slides} ctx={ctx} onFit={(over) => reportFit(s.id, over)} />
              </ScaledSlide>
              <span>{page ? `${page}. ${s.title}` : `Kosong, tidak ikut: ${s.title}`}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ExportStep({ doc, snapshot, reportId, saveState, name, onName, onSave }: {
  doc: PresentationDocument;
  snapshot: Snapshot | null;
  reportId: number | null;
  saveState: string;
  name: string;
  onName: (v: string) => void;
  onSave: () => Promise<void>;
}) {
  const slides = useMemo(() => exportableSlides(doc), [doc]);
  const skipped = visibleSlides(doc).length - slides.length;
  const ctx = useMemo(() => renderContext(doc, snapshot), [doc, snapshot]);
  const [fileName, setFileName] = useState(() => defaultFileName(doc.config.brandName, doc.config.period.curEnd, doc.config.lang));
  const [phase, setPhase] = useState<'idle' | 'rendering' | 'done'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  // The hidden host is mounted only for the export; effect runs once it exists.
  useEffect(() => {
    if (phase !== 'rendering' || !hostRef.current) return;
    let alive = true;
    const target = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    exportDeckToPdf(hostRef.current, target, (done, total) => alive && setProgress({ done, total }))
      .then(() => { if (alive) setPhase('done'); })
      .catch((err) => { if (alive) { setError((err as Error).message); setPhase('idle'); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div className="prb-export">
      <section className="prb-card">
        <h3>Export PDF 16:9</h3>
        <label className="prb-field">Nama file
          <input value={fileName} onChange={(e) => setFileName(e.target.value)} />
        </label>
        <p className="prb-hint">{slides.length} slide, satu slide per halaman (1440×810 pt). Dirender di browser ini; biarkan tab tetap terbuka sampai selesai.</p>
        {skipped > 0 && <p className="prb-status warn"><AlertTriangle size={14} aria-hidden /> {skipped} slide kosong tidak ikut. Isi di Edit Content agar ikut.</p>}
        <button type="button" className="btn btn-primary" disabled={phase === 'rendering' || !slides.length} onClick={() => { setError(null); setProgress({ done: 0, total: slides.length }); setPhase('rendering'); }}>
          {phase === 'rendering' ? <><Loader2 size={15} className="rg-spin" aria-hidden /> Menyiapkan {progress.done}/{progress.total}</> : <><Download size={15} aria-hidden /> Export PDF</>}
        </button>
        {phase === 'rendering' && <progress className="prb-progress" max={progress.total || 1} value={progress.done} />}
        {phase === 'done' && <p className="prb-status ok" role="status"><CheckCircle2 size={14} aria-hidden /> PDF selesai diunduh.</p>}
        {error && <p className="prb-error-text" role="alert">{error}</p>}
      </section>
      <section className="prb-card">
        <h3>Draft</h3>
        <label className="prb-field">Nama draft
          <input value={name} onChange={(e) => onName(e.target.value)} />
        </label>
        <button type="button" className="btn btn-ghost" disabled={saveState === 'saving' || saveState === 'readonly' || !reportId} onClick={() => void onSave()}>Simpan sekarang</button>
        <p className="prb-hint">Draft juga tersimpan otomatis setiap ada perubahan, dan bisa dibuka lagi dari daftar presentasi.</p>
      </section>
      {phase === 'rendering' && (
        <div className="prb-export-host" ref={hostRef} aria-hidden="true" style={{ width: STAGE_W, minHeight: STAGE_H }}>
          {slides.map((s, i) => <SlideView key={s.id} slide={s} doc={doc} snapshot={snapshot} reportId={reportId} number={i + 1} deck={slides} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}
