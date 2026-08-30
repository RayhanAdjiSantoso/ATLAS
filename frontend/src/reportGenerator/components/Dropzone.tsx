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
      <div className="dz-icon">{icon || '📂'}</div>
      <div className="dz-tag">{tag}</div>
      {loaded && fileName && (
        <div>
          <div className="dz-file">{fileName}</div>
          {infoText && <div className="dz-rows">{infoText}</div>}
        </div>
      )}
    </div>
  );
}
