import type { CSSProperties } from 'react';

export type StepStatus = 'done' | 'current' | 'todo';

export interface Step {
  label: string;
  sub?: string;
  status: StepStatus;
}

interface StepIndicatorProps {
  steps: Step[];
  accent?: string;
}

// The page's signature element: a vertical rail that makes "what's next"
// visible at a glance instead of a flat form. Purely a rendering of state
// the caller already tracks (which files are loaded, whether a report was
// generated) — it introduces no new business state.
export function StepIndicator({ steps, accent }: StepIndicatorProps) {
  const style = accent ? ({ '--rail-accent': accent } as CSSProperties) : undefined;
  return (
    <div className="step-rail" style={style}>
      <div className="step-rail-track">
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div className={`step-rail-node ${s.status}`}>{s.status === 'done' ? '✓' : i + 1}</div>
            {i < steps.length - 1 && <div className={`step-rail-line${s.status === 'done' ? ' done' : ''}`} />}
          </div>
        ))}
      </div>
      <div className="step-rail-steps">
        {steps.map((s, i) => (
          <div className="step-rail-item" key={i}>
            <div className={`step-rail-label${s.status === 'todo' ? ' todo' : ''}`}>{s.label}</div>
            {s.sub && <div className="step-rail-sub">{s.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
