import { useState, type DragEvent } from 'react';
import { Check, CircleAlert, Upload, X } from 'lucide-react';
import './librarySource.css';

// The "Upload file baru" slot for Shopee and TikTok: files picked from the
// user's device, read in the browser, and never sent to the brand library.
// It borrows LibraryFileSlot's geometry (same grid, same trigger card) so the
// two sources sit in the same place on the page, and differs only where the
// difference matters — a dashed card and an explicit "tidak disimpan" badge —
// so a manual file can never be mistaken for a library pick.
interface ManualFileSlotProps {
  tag: string;
  accept: string;
  loaded?: boolean;
  fileName?: string;
  infoText?: string;
  warning?: string | null;
  onFiles: (files: File[]) => Promise<void>;
  onClear?: () => void;
}

export function ManualFileSlot({ tag, accept, loaded, fileName, infoText, warning, onFiles, onClear }: ManualFileSlotProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  async function take(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (!files.length || busy) return;
    setBusy(true);
    setError('');
    try {
      await onFiles(files);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'File tidak dapat dibaca.');
    } finally {
      setBusy(false);
    }
  }

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    take(event.dataTransfer.files);
  };

  return (
    <section className={`library-slot manual-slot${loaded ? ' is-loaded' : ''}${dragging ? ' is-dragging' : ''}`} aria-label={`${tag} — upload manual`}>
      <div className="library-slot-head">
        <strong>{tag}</strong>
        <span className="manual-slot-badge">Rentang khusus · tidak disimpan</span>
      </div>
      <label
        className="library-source-trigger manual-slot-drop"
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept={accept}
          multiple
          disabled={busy}
          aria-label={`Pilih file ${tag}`}
          onChange={(event) => { take(event.target.files); event.target.value = ''; }}
        />
        <span className="library-source-icon" aria-hidden="true">{loaded ? <Check size={19} /> : <Upload size={19} />}</span>
        <span className="library-source-copy">
          <strong>{busy ? 'Membaca file…' : loaded ? 'File manual siap digunakan' : 'Pilih atau tarik file ke sini'}</strong>
          <small>{loaded ? fileName : 'Boleh beberapa file sekaligus, mis. 1–7 dan 8–12 — dijumlahkan otomatis'}</small>
        </span>
      </label>
      {loaded && (
        <p className="library-source-info">
          {infoText}
          {onClear && (
            <button type="button" className="manual-slot-clear" onClick={onClear}>
              <X size={12} aria-hidden="true" /> Hapus
            </button>
          )}
        </p>
      )}
      {warning && (
        <p className="manual-slot-warning" role="status">
          <CircleAlert size={13} aria-hidden="true" /> <span>{warning}</span>
        </p>
      )}
      {error && <p className="library-error" role="alert">{error}</p>}
    </section>
  );
}
