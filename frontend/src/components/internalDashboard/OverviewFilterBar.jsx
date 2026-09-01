const thisMonth = () => new Date().toISOString().slice(0, 7);

const FIELDS = [
  {
    key: 'compare', label: 'Pembanding', options: [
      ['mom', 'Bulan sebelumnya (MoM)'],
      ['yoy', 'Tahun lalu (YoY)'],
      ['target', 'Target'],
    ],
  },
  {
    key: 'category', label: 'Kategori', options: [
      ['all', 'Semua'],
      ['retail', 'Retail'],
      ['b2b_service', 'B2B / Service'],
      ['fnb', 'F&B'],
    ],
  },
  {
    key: 'status', label: 'Status client', options: [
      ['active', 'Aktif saja'],
      ['all', 'Semua status'],
    ],
  },
  {
    key: 'basis', label: 'Basis delta', options: [
      ['like_for_like', 'Like-for-like'],
      ['all_clients', 'Semua client'],
    ],
  },
];

export default function OverviewFilterBar({ value, onChange, hide = [], extra = null, compareOptions = null }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const fields = FIELDS
    .filter((f) => !hide.includes(f.key))
    .map((f) => (f.key === 'compare' && compareOptions
      ? { ...f, options: f.options.filter(([v]) => compareOptions.includes(v)) }
      : f));

  return (
    <div className="card">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Periode</label>
          <input type="month" value={value.period || thisMonth()} onChange={(e) => set('period', e.target.value)} />
        </div>
        {fields.map((f) => (
          <div className="form-group" style={{ marginBottom: 0 }} key={f.key}>
            <label>{f.label}</label>
            <select value={value[f.key]} onChange={(e) => set(f.key, e.target.value)}>
              {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        ))}
        {extra}
      </div>
      {value.basis === 'like_for_like' && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
          Delta KPI dihitung hanya dari client yang punya data di kedua periode. Total absolut tetap mencakup semua client yang ada datanya.
        </p>
      )}
    </div>
  );
}
