import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function MultiSelectDropdown({ options, selected, onChange, placeholder = 'Semua' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const toggleValue = (value) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const filteredOptions = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const summary = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label || placeholder
      : `${selected.length} dipilih`;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          width: '100%',
          padding: '0.625rem 0.875rem',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          color: selected.length ? 'var(--text)' : 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '0.9rem',
          textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <ChevronDown size={16} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            width: 'max-content',
            minWidth: '240px',
            maxWidth: '360px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {options.length > 6 && (
            <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              <input
                autoFocus
                placeholder="Cari..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.6rem',
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  color: 'var(--text)',
                  fontSize: '0.85rem',
                }}
              />
            </div>
          )}

          <div style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: '220px', padding: '0.35rem 0' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '0.6rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Tidak ada hasil.</div>
            ) : (
              filteredOptions.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    minHeight: '38px',
                    padding: '0 1rem',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    color: 'var(--text)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--primary-light)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(opt.value)}
                    onChange={() => toggleValue(opt.value)}
                    style={{ flexShrink: 0, width: '14px', height: '14px', margin: 0 }}
                  />
                  <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{opt.label}</span>
                </label>
              ))
            )}
          </div>

          {selected.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '0.4rem 0.75rem' }}>
              <button
                type="button"
                onClick={() => onChange([])}
                style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
              >
                Hapus semua ({selected.length})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
