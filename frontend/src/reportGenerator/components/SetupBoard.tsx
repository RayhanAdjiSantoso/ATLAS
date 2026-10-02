import type { ReactNode } from 'react';

// The setup board every platform tab shares: one surface per group of
// inputs, laid out as a grid — the two comparison periods across, the inputs
// down — so a row reads "this input, last period vs this period" and no slot
// sits alone on a full-width line. Visual only; the cells hold the tab's own
// controls unchanged.

const PERIODS = ['Periode Lalu', 'Periode Ini'] as const;

export function SetupBoard({ title, note, className, children }: { title: string; note?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`setup-board${className ? ' ' + className : ''}`} aria-label={title}>
      <header className="setup-board-head">
        <h3>{title}</h3>
        {note && <p>{note}</p>}
      </header>
      {children}
    </section>
  );
}

export function SetupGrid({ children }: { children: ReactNode }) {
  return (
    <div className="setup-grid">
      <div className="setup-corner" aria-hidden="true" />
      {PERIODS.map((p) => (
        <div key={p} className="setup-col-head">
          {p}
        </div>
      ))}
      {children}
    </div>
  );
}

// One input across both periods, or — with `both` — one input that serves
// the whole comparison (a reference file, a date preset).
export function SetupRow({
  label,
  sub,
  req = false,
  old,
  cur,
  both,
}: {
  label: string;
  sub?: ReactNode;
  req?: boolean;
  old?: ReactNode;
  cur?: ReactNode;
  both?: ReactNode;
}) {
  return (
    <>
      <div className="setup-row-head">
        <strong>{label}</strong>
        {sub && <small>{sub}</small>}
        {req && <small className="is-req">wajib</small>}
      </div>
      {both !== undefined ? (
        <div className="setup-cell is-span">{both}</div>
      ) : (
        <>
          <div className="setup-cell" data-label={PERIODS[0]}>
            {old}
          </div>
          <div className="setup-cell" data-label={PERIODS[1]}>
            {cur}
          </div>
        </>
      )}
    </>
  );
}

// The period label a report prints in its column headers.
export function SetupTextInput({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return <input className="setup-input" type="text" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
}
