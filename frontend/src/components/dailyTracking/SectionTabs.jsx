const TABS = [
  { key: 'sales', label: 'Revenue Data' },
  { key: 'spend', label: 'Spending Data' },
];

export default function SectionTabs({ active, onChange }) {
  return (
    <div className="dt-tabs" role="tablist" aria-label="Jenis data">
      {TABS.map((t) => (
        <button
          key={t.key} type="button" role="tab" id={`dt-tab-${t.key}`}
          aria-selected={active === t.key} aria-controls={`dt-panel-${t.key}`}
          className={`dt-tab${active === t.key ? ' is-active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
