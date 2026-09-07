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

// Horizontal progress rail: a numbered / checked node beside its label. The
// current step wears an accent-outlined box; as progress advances the box
// smoothly fades between steps (CSS transition on the moving `.stepper-current`
// class). Purely a render of caller-owned state.
export function StepIndicator({ steps, accent }: StepIndicatorProps) {
  const style = accent ? ({ '--rail-accent': accent } as CSSProperties) : undefined;

  return (
    <div className="stepper" style={style}>
      {steps.map((s, i) => (
        <div key={i} className={`stepper-item stepper-${s.status}`}>
          <span className="stepper-node" aria-hidden>
            {s.status === 'done' ? (
              <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 10.5 8.5 15 16 5.5" />
              </svg>
            ) : (
              i + 1
            )}
          </span>
          <span className="stepper-body">
            <span className="stepper-label">{s.label}</span>
            {s.sub && <span className="stepper-sub">{s.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
