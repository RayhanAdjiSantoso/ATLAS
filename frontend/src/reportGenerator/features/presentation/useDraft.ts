import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import { createDraft, getDraft, updateDraft } from './api';
import { mergeDocuments } from './merge';
import type { PresentationDocument, Snapshot } from './types';

export type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error' | 'conflict' | 'readonly';

const AUTOSAVE_MS = 1200;
const RETRY_MS = 5000;

export interface DraftState {
  doc: PresentationDocument | null;
  snapshot: Snapshot | null;
  name: string;
  reportId: number | null;
  saveState: SaveState;
  saveError: string | null;
  // Slides two people changed in the same field; saving waits on a choice.
  conflictSlides: string[];
  reloadLatest: () => Promise<void>;
  // Any edit to the document; saved after a pause in typing.
  update: (fn: (doc: PresentationDocument) => PresentationDocument) => void;
  setName: (name: string) => void;
  setSnapshot: (snapshot: Snapshot) => void;
  open: (input: { doc: PresentationDocument; snapshot: Snapshot | null; name: string; reportId: number | null; revision: number; isNew?: boolean }) => void;
  close: () => void;
  saveNow: () => Promise<void>;
}

// One draft open at a time. Saves never overlap: an edit made during a save
// schedules the next one. Each save names the revision it builds on; when a
// teammate has saved in between, their work and this person's are combined
// (merge.ts) and saved again, instead of one overwriting the other.
export function useDraft(clientId: number | null): DraftState {
  const { isViewOnly } = useAuth();
  const [doc, setDoc] = useState<PresentationDocument | null>(null);
  const [snapshot, setSnapshotState] = useState<Snapshot | null>(null);
  const [name, setNameState] = useState('');
  const [reportId, setReportId] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictSlides, setConflictSlides] = useState<string[]>([]);

  // The latest values for a save that fires later, plus what state cannot hold.
  const live = useRef({ doc, snapshot, name, reportId, revision: 0, snapshotDirty: false, dirty: false, saving: false, conflict: false, base: null as PresentationDocument | null, baseName: '' });
  live.current.doc = doc;
  live.current.snapshot = snapshot;
  live.current.name = name;
  live.current.reportId = reportId;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const arm = (ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushRef.current(); }, ms);
  };

  flushRef.current = async () => {
    const s = live.current;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!s.doc || !clientId || !s.dirty || s.saving || s.conflict) return;
    if (isViewOnly) {
      setSaveState('readonly');
      return;
    }
    s.saving = true;
    s.dirty = false;
    setSaveState('saving');
    setSaveError(null);
    const sending = s.doc;
    const sendingName = s.name;
    try {
      const fallback = s.name.trim() || s.doc.config.brandName;
      if (s.reportId === null) {
        const res = await createDraft(clientId, fallback, s.doc, s.snapshot);
        s.reportId = res.id;
        s.revision = res.revision;
        s.snapshotDirty = false;
        setReportId(res.id);
      } else {
        const sendSnapshot = s.snapshotDirty && s.snapshot ? s.snapshot : undefined;
        const res = await updateDraft(s.reportId, fallback, s.doc, s.revision, sendSnapshot);
        s.revision = res.revision;
        if (sendSnapshot) s.snapshotDirty = false;
      }
      s.base = sending;
      s.baseName = sendingName;
      setSaveState(s.dirty ? 'unsaved' : 'saved');
      if (s.dirty) arm(AUTOSAVE_MS);
    } catch (err) {
      s.dirty = true;
      if ((err as { status?: number }).status === 409 && s.reportId !== null && s.base) {
        await absorbTeammate(s.reportId);
      } else {
        setSaveState('error');
        setSaveError((err as Error).message);
        arm(RETRY_MS);
      }
    } finally {
      s.saving = false;
    }
  };

  // A teammate saved first: take in what they did, keep what this person did.
  async function absorbTeammate(id: number) {
    const s = live.current;
    try {
      const latest = await getDraft(id);
      const { doc: merged, conflicts } = mergeDocuments(s.base as PresentationDocument, s.doc as PresentationDocument, latest.document);
      if (conflicts.length) {
        s.conflict = true;
        setConflictSlides(conflicts);
        setSaveState('conflict');
        return;
      }
      s.base = latest.document;
      s.revision = latest.revision;
      if (s.name === s.baseName) {
        s.name = latest.name;
        setNameState(latest.name);
      }
      s.baseName = latest.name;
      if (!s.snapshotDirty) {
        s.snapshot = latest.snapshot;
        setSnapshotState(latest.snapshot);
      }
      s.doc = merged;
      setDoc(merged);
      setSaveState('unsaved');
      arm(50);
    } catch (err) {
      setSaveState('error');
      setSaveError((err as Error).message);
      arm(RETRY_MS);
    }
  }

  const schedule = useCallback(() => {
    live.current.dirty = true;
    if (live.current.conflict) return;
    setSaveState(isViewOnly ? 'readonly' : 'unsaved');
    arm(AUTOSAVE_MS);
  }, [isViewOnly]);

  const update = useCallback((fn: (d: PresentationDocument) => PresentationDocument) => {
    setDoc((prev) => (prev ? fn(prev) : prev));
    schedule();
  }, [schedule]);

  const setName = useCallback((value: string) => {
    setNameState(value);
    schedule();
  }, [schedule]);

  const setSnapshot = useCallback((value: Snapshot) => {
    setSnapshotState(value);
    live.current.snapshotDirty = true;
    schedule();
  }, [schedule]);

  const open: DraftState['open'] = useCallback(({ doc: d, snapshot: snap, name: n, reportId: id, revision, isNew }) => {
    Object.assign(live.current, { doc: d, snapshot: snap, name: n, reportId: id, revision, snapshotDirty: false, dirty: false, conflict: false, base: d, baseName: n });
    setConflictSlides([]);
    setDoc(d);
    setSnapshotState(snap);
    setNameState(n);
    setReportId(id);
    setSaveError(null);
    setSaveState(isViewOnly ? 'readonly' : id ? 'saved' : 'idle');
    if (isNew) {
      live.current.dirty = true;
      void flushRef.current();
    }
  }, [isViewOnly]);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    Object.assign(live.current, { dirty: false, conflict: false, base: null });
    setConflictSlides([]);
    setDoc(null);
    setSnapshotState(null);
    setReportId(null);
    setSaveState('idle');
    setSaveError(null);
  }, []);

  const saveNow = useCallback(() => flushRef.current(), []);

  // The way out of a conflict: the team's latest version, dropping this person's
  // unsaved changes. Their text stays on screen until they press this.
  const reloadLatest = useCallback(async () => {
    const id = live.current.reportId;
    if (id === null) return;
    const latest = await getDraft(id);
    open({ doc: latest.document, snapshot: latest.snapshot, name: latest.name, reportId: latest.id, revision: latest.revision });
  }, [open]);

  // Unsaved typing should not vanish with the tab.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (live.current.dirty && !isViewOnly) {
        void flushRef.current();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isViewOnly]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { doc, snapshot, name, reportId, saveState, saveError, conflictSlides, reloadLatest, update, setName, setSnapshot, open, close, saveNow };
}
