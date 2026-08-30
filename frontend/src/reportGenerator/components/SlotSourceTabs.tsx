import type { ReactNode } from 'react';

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
}

export function SlotSourceTabs({ value, onChange, disabledSavedReason, className }: SlotSourceTabsProps) {
  return (
    <div className={`slot-src-tabs${className ? ' ' + className : ''}`} role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={value === 'upload'}
        className={`slot-src-tab${value === 'upload' ? ' active' : ''}`}
        onClick={() => onChange('upload')}
      >
        Upload file baru
      </button>
      <button
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

// Replaces the <Dropzone> visually while a slot is in "saved" mode.
export function SavedSlotCard({ picked, onOpen, onClear, hint }: SavedSlotCardProps) {
  if (!picked) {
    return (
      <button type="button" className="saved-slot-card empty" onClick={onOpen}>
        <span className="saved-slot-icon" aria-hidden="true">
          🗂️
        </span>
        <span className="saved-slot-choose">Pilih periode tersimpan…</span>
        {hint && <span className="saved-slot-hint">{hint}</span>}
      </button>
    );
  }
  return (
    <div className="saved-slot-card filled">
      <div className="saved-slot-main">
        <div className="saved-slot-title">{picked.title}</div>
        {picked.summary && <div className="saved-slot-summary">{picked.summary}</div>}
        <div className="saved-slot-meta">{picked.metaLine ?? `dari “${picked.sourceComparison}” · disimpan ${picked.savedAt}`}</div>
      </div>
      <div className="saved-slot-actions">
        <button type="button" className="btn btn-ghost saved-slot-change" onClick={onOpen}>
          Ganti
        </button>
        <button type="button" className="saved-slot-clear" title="Hapus pilihan" aria-label="Hapus pilihan" onClick={onClear}>
          ✕
        </button>
      </div>
    </div>
  );
}
