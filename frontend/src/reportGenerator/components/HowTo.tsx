import { useId, useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';

export function HowTo({ children }: { children: ReactNode }) {
  // Collapsed by default — the step rail + colored upload cards carry the
  // flow now; this is reference material the user opens only when stuck.
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <div className={`howto${open ? ' open' : ''}`}>
      <button type="button" className="howto-header" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
        <span className="howto-title">
          <BookOpen size={15} aria-hidden="true" /> Cara penggunaan
        </span>
        <span className="howto-hint">{open ? 'Tutup panduan' : 'Kolom export, format file & alur'}</span>
        <ChevronDown size={16} className={`howto-chevron${open ? ' open' : ''}`} aria-hidden="true" />
      </button>
      <div id={bodyId} className={`howto-body${open ? ' open' : ''}`}>
        <div className="howto-steps">{children}</div>
      </div>
    </div>
  );
}

interface HowToStepProps {
  num: number;
  numClassName?: string;
  title: string;
  children: ReactNode;
}

export function HowToStep({ num, numClassName, title, children }: HowToStepProps) {
  return (
    <div className="howto-step">
      <div className={`howto-step-num${numClassName ? ' ' + numClassName : ''}`}>{num}</div>
      <div className="howto-step-content">
        <div className="howto-step-title">{title}</div>
        <div className="howto-step-desc">{children}</div>
      </div>
    </div>
  );
}
