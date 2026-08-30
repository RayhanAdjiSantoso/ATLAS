import type { ReactNode } from 'react';

interface DeltaPillProps {
  cls: string;
  size?: 'sm' | 'md';
  children: ReactNode;
}

// Reads the +/- that computeDelta/formatDeltaID already put at the front of
// the formatted string to decide which arrow to show — purely a rendering
// choice on top of the existing text, never a second source of truth for
// direction. Strings with no sign ("0%", "New", "N/A", "—") get no arrow.
function directionOf(text: ReactNode): 'up' | 'down' | null {
  const s = typeof text === 'string' || typeof text === 'number' ? String(text).trim() : '';
  if (s.startsWith('+')) return 'up';
  if (s.startsWith('-') || s.startsWith('−')) return 'down';
  return null;
}

// Scannable delta chip: composes with the exact `cls` (delta-good/delta-bad/
// delta-neutral) the data already carries — this only decides how that
// classification is *drawn* (pill + direction arrow), never which class a
// value gets.
export function DeltaPill({ cls, size = 'md', children }: DeltaPillProps) {
  const dir = directionOf(children);
  return (
    <span className={`delta-pill${size === 'sm' ? ' delta-pill-sm' : ''} ${cls}`}>
      {dir && (
        <span className="delta-arrow" aria-hidden="true">
          {dir === 'up' ? '▲' : '▼'}
        </span>
      )}
      <span className="num">{children}</span>
    </span>
  );
}
