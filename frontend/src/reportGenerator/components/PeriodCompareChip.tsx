import type { CSSProperties } from 'react';

interface PeriodCompareChipProps {
  old: string;
  cur: string;
  accent?: string;
  onBrand?: boolean;
  className?: string;
}

// The signature "Comparison Rail" motif's second application: old period →
// current period, wherever the report used to show p1/p2 as plain text.
// `onBrand` is for use directly on a colored banner (e.g. .report-top).
export function PeriodCompareChip({ old, cur, accent, onBrand, className }: PeriodCompareChipProps) {
  const style = accent ? ({ '--chip-accent': accent } as CSSProperties) : undefined;
  return (
    <span className={`compare-chip${onBrand ? ' on-brand' : ''}${className ? ' ' + className : ''}`} style={style}>
      <span className="cc-old num">{old}</span>
      <span className="cc-arrow">→</span>
      <span className="cc-cur num">{cur}</span>
    </span>
  );
}
