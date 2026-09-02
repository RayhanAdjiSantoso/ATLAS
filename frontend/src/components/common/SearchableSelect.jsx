import { useEffect, useMemo, useRef, useState } from 'react';

// Single-select combobox with a type-to-filter search box. Drop-in
// replacement for a plain <select> where the option list is long enough
// that scrolling it is painful (e.g. the ~140-brand pickers).
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Pilih...',
  id,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value)) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery('');
  }, [open]);

  const pick = (val) => {
    onChange(val);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '0.625rem 0.875rem',
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          color: selected ? 'var(--text)' : 'var(--text-placeholder)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : placeholder}
        </span>
        <span style={{ color: 'var(--text-placeholder)', fontSize: '0.7rem' }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            background: '#ffffff',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-md)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '0.5rem' }}>
            <input
              ref={inputRef}
              type="search"
              placeholder="Cari…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && filtered.length > 0) {
                  e.preventDefault();
                  pick(filtered[0].value);
                }
              }}
              style={{
                width: '100%',
                padding: '0.4rem 0.6rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
              }}
            />
          </div>
          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {filtered.length === 0 && (
              <div style={{ padding: '0.6rem 0.75rem', color: 'var(--text-placeholder)', fontSize: '0.85rem' }}>
                Tidak ada hasil.
              </div>
            )}
            {filtered.map((o) => {
              const isSelected = String(o.value) === String(value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick(o.value)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 0.75rem',
                    border: 'none',
                    borderTop: '1px solid var(--border)',
                    background: isSelected ? 'var(--primary-light)' : 'transparent',
                    color: 'var(--text)',
                    fontWeight: isSelected ? 700 : 400,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
