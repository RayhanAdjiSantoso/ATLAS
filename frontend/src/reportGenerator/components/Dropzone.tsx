import { useState, type ChangeEvent, type DragEvent } from 'react';

interface DropzoneProps {
  tag: string;
  accept: string;
  onFile: (file: File) => void;
  loaded: boolean;
  fileName?: string;
  infoText?: string;
  disabled?: boolean;
  className?: string;
  icon?: string;
}

// Compact single-row drop target: icon · label + hint/filename · status.
// Keeps the full-area invisible <input> so both click and drag-drop still
// work, but takes a fraction of the vertical space the old stacked card did.
export function Dropzone({ tag, accept, onFile, loaded, fileName, infoText, disabled, className, icon }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`dz${className ? ' ' + className : ''}${loaded ? ' loaded' : ''}${dragging ? ' drag' : ''}`}
      style={disabled ? { opacity: 0.35, pointerEvents: 'none' } : undefined}
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <input
        type="file"
        accept={accept}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <span className="dz-icon">{loaded ? '✓' : icon || '📄'}</span>
      <span className="dz-main">
        <span className="dz-tag">{tag}</span>
        {loaded && fileName ? (
          <span className="dz-file" title={fileName}>
            {fileName}
          </span>
        ) : (
          <>
            <span className="dz-hint">Klik atau tarik file ke sini</span>
            <span className="dz-sub">Pilih file dari perangkat Anda</span>
          </>
        )}
      </span>
      {loaded && infoText && <span className="dz-rows">{infoText}</span>}
    </div>
  );
}
