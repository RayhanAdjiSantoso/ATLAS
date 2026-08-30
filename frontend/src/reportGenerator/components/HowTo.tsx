import { useState, type ReactNode } from 'react';

export function HowTo({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="howto">
      <div className="howto-header" onClick={() => setOpen((o) => !o)}>
        <div className="howto-title">Cara penggunaan</div>
        <div className={`howto-chevron${open ? ' open' : ''}`}>▼</div>
      </div>
      <div className={`howto-body${open ? ' open' : ''}`}>
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
