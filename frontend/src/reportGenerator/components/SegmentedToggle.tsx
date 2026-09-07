// A small pill toggle for chart controls: one row of mutually exclusive
// options with the active one filled. Same shape language as the report tab
// bar, one size down, so a chart's controls read as controls rather than as
// another level of navigation.
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedToggle<T extends string>({
  label,
  options,
  value,
  onChange,
  accent,
}: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  accent?: string;
}) {
  return (
    <div className="seg-toggle" style={accent ? ({ '--seg-accent': accent } as React.CSSProperties) : undefined}>
      <span className="seg-toggle-label">{label}</span>
      <div className="seg-toggle-group" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`seg-toggle-btn${o.value === value ? ' active' : ''}`}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
