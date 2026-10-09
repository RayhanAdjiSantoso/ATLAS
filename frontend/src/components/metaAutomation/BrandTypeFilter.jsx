import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import SearchField from '../common/SearchField.jsx';

// Filter brand untuk daftar Langganan: satu dropdown bertingkat. Brand yang
// punya lebih dari satu ad account (MAIN + CPAS) tampil sekali dan bisa
// dibuka untuk memilih tipenya; brand dengan satu ad account langsung
// terpilih. Tampilan panelnya sama dengan BrandCombo.
//
// value/onChange: { brand, type } — brand '' = semua brand, type '' = semua
// tipe milik brand itu.
const rowStyle = (selected, indent = false) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '0.35rem',
  padding: indent ? '0.45rem 0.7rem 0.45rem 2rem' : '0.5rem 0.7rem',
  fontSize: '0.85rem',
  cursor: 'pointer',
  background: selected ? 'var(--primary-light)' : 'transparent',
  color: selected ? 'var(--primary)' : 'var(--text)',
  fontWeight: selected ? 700 : 400,
});

export default function BrandTypeFilter({ brands, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(null);
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const groups = useMemo(() => {
    const byName = new Map();
    for (const b of brands) {
      const types = byName.get(b.client) || new Set();
      types.add(b.type || 'MAIN');
      byName.set(b.client, types);
    }
    return Array.from(byName, ([name, types]) => ({ name, types: Array.from(types).sort() }))
      .sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
  }, [brands]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
  }, [groups, query]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setExpanded(value.type ? value.brand : null);
    } else {
      setQuery('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (brand, type = '') => {
    onChange({ brand, type });
    setOpen(false);
  };

  const pickGroup = (g) => {
    if (g.types.length > 1) setExpanded((cur) => (cur === g.name ? null : g.name));
    else pick(g.name);
  };

  const label = value.brand ? (value.type ? `${value.brand} · ${value.type}` : value.brand) : 'Semua brand';

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          textAlign: 'left',
          padding: '0.625rem 0.875rem',
          background: '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          color: value.brand ? 'var(--text)' : 'var(--text-placeholder)',
          cursor: 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <ChevronDown size={16} style={{ flexShrink: 0, color: 'var(--text-placeholder)' }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            marginTop: 5,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-md)',
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '0.5rem' }}>
            <SearchField
              ref={inputRef}
              value={query}
              placeholder="Cari brand…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (filtered.length > 0) pickGroup(filtered[0]);
                }
              }}
              aria-label="Cari brand"
            />
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {!query.trim() && (
              <div onClick={() => pick('')} style={{ ...rowStyle(!value.brand), borderBottom: '1px solid var(--border)' }}>
                Semua brand
              </div>
            )}
            {filtered.length === 0 && (
              <div style={{ padding: '0.5rem 0.7rem', fontSize: '0.8rem', color: 'var(--text-placeholder)' }}>
                Tidak ada brand yang cocok.
              </div>
            )}
            {filtered.map((g) => {
              const nested = g.types.length > 1;
              const isOpen = expanded === g.name;
              return (
                <div key={g.name}>
                  <div
                    onClick={() => pickGroup(g)}
                    style={rowStyle(!nested && value.brand === g.name)}
                    aria-expanded={nested ? isOpen : undefined}
                  >
                    <span style={{ flex: 1 }}>{g.name}</span>
                    {nested && (isOpen
                      ? <ChevronDown size={14} style={{ color: 'var(--text-placeholder)' }} />
                      : <ChevronRight size={14} style={{ color: 'var(--text-placeholder)' }} />)}
                  </div>
                  {nested && isOpen && (
                    <>
                      <div onClick={() => pick(g.name)} style={rowStyle(value.brand === g.name && !value.type, true)}>
                        Semua tipe
                      </div>
                      {g.types.map((t) => (
                        <div key={t} onClick={() => pick(g.name, t)} style={rowStyle(value.brand === g.name && value.type === t, true)}>
                          {t}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
