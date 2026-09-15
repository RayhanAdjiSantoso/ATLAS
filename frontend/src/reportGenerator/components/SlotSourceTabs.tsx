import type { ReactNode } from 'react';
import { CalendarCheck, CalendarRange, ChevronRight, X } from 'lucide-react';
import '../features/reports/librarySource.css';

// Small toggle shown above an upload slot: keep uploading a fresh file, or
// reuse a period this client already uploaded before (picked via
// SavedPeriodPicker). Default stays 'upload' everywhere, so a tab that
// never touches the "saved" side behaves exactly as before.
export type SlotSource = 'upload' | 'saved';

interface SlotSourceTabsProps {
  value: SlotSource;
  onChange: (value: SlotSource) => void;
  // Non-null => the "saved" option is disabled and this is the tooltip
  // explaining why (e.g. no client selected yet).
  disabledSavedReason?: string | null;
  className?: string;
  // Shopee and TikTok lead with the library (their default source) and keep
  // manual upload as the second choice. Meta omits this and is unchanged.
  savedFirst?: boolean;
}

export function SlotSourceTabs({ value, onChange, disabledSavedReason, className, savedFirst = false }: SlotSourceTabsProps) {
  const uploadTab = (
      <button key="upload"
        type="button"
        role="tab"
        aria-selected={value === 'upload'}
        className={`slot-src-tab${value === 'upload' ? ' active' : ''}`}
        onClick={() => onChange('upload')}
      >
        Upload file baru
      </button>
  );
  const savedTab = (
      <button key="saved"
        type="button"
        role="tab"
        aria-selected={value === 'saved'}
        className={`slot-src-tab${value === 'saved' ? ' active' : ''}`}
        disabled={Boolean(disabledSavedReason)}
        title={disabledSavedReason ?? undefined}
        onClick={() => onChange('saved')}
      >
        Pilih dari data tersimpan
      </button>
  );
  return (
    <div className={`slot-src-tabs${className ? ' ' + className : ''}`} role="tablist">
      {savedFirst ? [savedTab, uploadTab] : [uploadTab, savedTab]}
    </div>
  );
}

interface SavedSlotCardProps {
  // null => nothing picked yet (renders the "choose…" affordance).
  // metaLine overrides the default `dari "…" · disimpan …` footer (used by
  // the Meta tab, where the card title already is the comparison).
  picked: { title: string; sourceComparison: string; savedAt: string; summary: string; metaLine?: string } | null;
  onOpen: () => void;
  onClear: () => void;
  hint?: ReactNode;
}

// Replaces the <Dropzone> visually while a slot is in "saved" mode. Same
// props and the same three actions (open picker / change / clear) as before —
// only the drawing changed: the LibraryFileSlot trigger card (icon tile,
// title + detail, chevron) instead of a dashed box with an emoji, so the
// "saved" and per-channel library slots on the page read as one family.
export function SavedSlotCard({ picked, onOpen, onClear, hint }: SavedSlotCardProps) {
  if (!picked) {
    return (
      <button type="button" className="saved-src-card is-empty" onClick={onOpen}>
        <span className="saved-src-icon" aria-hidden="true"><CalendarRange size={19} /></span>
        <span className="saved-src-copy">
          <strong>Pilih periode tersimpan</strong>
          <small>{hint ?? 'Buka daftar periode — semua channel yang tersedia terisi sekaligus'}</small>
        </span>
        <ChevronRight size={17} className="saved-src-go" aria-hidden="true" />
      </button>
    );
  }
  // Meta passes metaLine: '' on purpose (its title already is the
  // comparison); an empty override means "no footer", not an empty row.
  const meta = picked.metaLine !== undefined
    ? picked.metaLine
    : picked.sourceComparison || picked.savedAt
      ? `dari “${picked.sourceComparison}” · disimpan ${picked.savedAt}`
      : '';
  return (
    <div className="saved-src-card is-filled">
      <span className="saved-src-icon" aria-hidden="true"><CalendarCheck size={19} /></span>
      <span className="saved-src-copy">
        <strong>{picked.title}</strong>
        {picked.summary && <small className="saved-src-summary">{picked.summary}</small>}
        {meta && <small className="saved-src-meta">{meta}</small>}
      </span>
      <span className="saved-src-actions">
        <button type="button" className="saved-src-change" onClick={onOpen}>Ganti</button>
        <button type="button" className="saved-src-clear" title="Hapus pilihan" aria-label="Hapus pilihan" onClick={onClear}>
          <X size={15} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}
