import { useMemo, useState } from 'react';

// Searchable + status-filterable client list for the Input Data picker.
// "freeze" is bucketed with "off" (and so is any null/other status); only
// an explicit 'active' counts as active.
const STATUS_FILTERS = [
  { key: 'all', label: 'Semua' },
  { key: 'active', label: 'Aktif' },
  { key: 'off', label: 'Off' },
];

const bucketOf = (c) => (c.status === 'active' ? 'active' : 'off');

export default function ClientPicker({ clients, value, onChange }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const counts = useMemo(() => {
    const c = { all: clients.length, active: 0, off: 0 };
    for (const cl of clients) c[bucketOf(cl)] += 1;
    return c;
  }, [clients]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter((c) => {
      if (statusFilter !== 'all' && bucketOf(c) !== statusFilter) return false;
      if (q && !c.brand_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [clients, query, statusFilter]);

  const selected = clients.find((c) => String(c.brand_id) === String(value));

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label>Client{selected ? ` — ${selected.brand_name}` : ''}</label>

      <input
        type="search"
        placeholder="Cari nama brand / client…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div style={{ display: 'flex', gap: '0.4rem', margin: '0.5rem 0' }}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`btn ${statusFilter === f.key ? 'btn-primary' : 'btn-secondary'}`}
            style={{
              fontSize: '0.8rem',
              padding: '0.3rem 0.75rem',
              border: statusFilter === f.key ? 'none' : '1px solid var(--border)',
            }}
            onClick={() => setStatusFilter(f.key)}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
      </div>

      <div
        style={{
          maxHeight: '260px',
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      >
        {filtered.length === 0 && (
          <div style={{ padding: '0.75rem', color: 'var(--text-placeholder)', fontSize: '0.85rem' }}>
            Tidak ada client yang cocok.
          </div>
        )}
        {filtered.map((c) => {
          const isSelected = String(c.brand_id) === String(value);
          return (
            <button
              key={c.brand_id}
              type="button"
              onClick={() => onChange(String(c.brand_id))}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                textAlign: 'left',
                padding: '0.5rem 0.75rem',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                background: isSelected ? 'var(--primary-light)' : 'transparent',
                color: 'var(--text)',
                fontWeight: isSelected ? 700 : 400,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              <span>{c.brand_name}</span>
              {c.status !== 'active' && (
                <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>
                  {c.status || 'tanpa status'}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
