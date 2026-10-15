import { useEffect, useState } from 'react';
import { MONTH_SHORT } from './annualModel.js';

// Twelve columns, one per month, on one scale.
//
// Overview (Brand Setting card): the wide pale bar is the month's target, the
// narrow bar inside it what was actually sold — coloured by achievement once
// the month has run.
// Compare (update dialog): the outline is the month's target now, the solid
// bar what it becomes; months that stay as they are (`lockedBefore`) are grey.
//
// `doneBefore` counts the months already over (their achievement is final).
// Heights ease in on mount and between states, so switching option A/B in the
// dialog visibly moves the months that change.

const toneOf = (ratio, done) => (ratio == null ? '' : ratio >= 1 ? 'is-good' : ratio >= 0.9 ? 'is-warn' : done ? 'is-bad' : '');

export default function MonthBars({ values, ghost = null, actual = null, lockedBefore = 0, currentIdx = -1, doneBefore = 0, height = 132, tip }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const max = Math.max(1, ...values, ...(ghost ?? []), ...(actual ?? []).map((v) => v ?? 0));
  const h = (v) => (ready && v ? `${Math.max((v / max) * 100, 1.5)}%` : '0%');

  return (
    <div className="at-mb" style={{ '--mb-h': `${height}px` }}>
      {values.map((v, i) => {
        const locked = i < lockedBefore;
        const done = i < doneBefore;
        const real = actual?.[i] ?? null;
        const tone = actual ? toneOf(v ? (real ?? 0) / v : null, done) : '';
        return (
          <div
            key={MONTH_SHORT[i]}
            className={`at-mb-col${i === currentIdx ? ' is-current' : ''}${locked ? ' is-locked' : ''}${done ? ' is-done' : ''}`}
            tabIndex={tip ? 0 : undefined}
            style={{ '--i': i }}
          >
            <div className="at-mb-track">
              {ghost && <span className="at-mb-ghost" style={{ height: h(ghost[i]) }} />}
              <span className={`at-mb-bar${actual ? ' is-target' : ''}`} style={{ height: h(v) }} />
              {actual && real != null && <span className={`at-mb-real ${tone}`} style={{ height: h(real) }} />}
            </div>
            <span className="at-mb-label">{MONTH_SHORT[i]}</span>
            {tip && <span className="at-mb-tip" role="tooltip">{tip(i)}</span>}
          </div>
        );
      })}
    </div>
  );
}
