import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

// Type-to-filter brand picker, meniru "pilih klien" di Report Generator
// (src/reportGenerator/features/reports/ClientPicker.tsx): tombol pemicu
// yang menampilkan pilihan sekarang, lalu panel dropdown berisi kolom
// pencarian + daftar ter-filter yang bisa di-scroll. Dipakai di
// BrandsSection (allowCustom — boleh mengetik nama brand baru) dan
// SubscriptionsSection (hanya boleh memilih brand yang sudah ada).
export default function BrandCombo({
  options,
  value,
  onChange,
  placeholder = '— pilih brand —',
  allowCustom = false,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const trimmedQuery = query.trim();
  const showCustomRow = allowCustom
    && trimmedQuery
    && !options.some((o) => o.toLowerCase() === trimmedQuery.toLowerCase());

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

  const pick = (v) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          textAlign: 'left',
          padding: '0.625rem 0.875rem',
          background: disabled ? 'var(--bg-elevated)' : '#ffffff',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          color: value ? 'var(--text)' : 'var(--text-placeholder)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || placeholder}
        </span>
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
            <input
              ref={inputRef}
              value={query}
              placeholder="Cari brand…"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (filtered.length > 0) pick(filtered[0]);
                  else if (showCustomRow) pick(trimmedQuery);
                }
              }}
              style={{
                width: '100%',
                padding: '0.5rem 0.625rem',
                fontSize: '0.85rem',
                border: '1px solid var(--border)',
                borderRadius: '8px',
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 && !showCustomRow && (
              <div style={{ padding: '0.5rem 0.7rem', fontSize: '0.8rem', color: 'var(--text-placeholder)' }}>
                Tidak ada brand yang cocok.
              </div>
            )}
            {filtered.map((o) => (
              <div
                key={o}
                onClick={() => pick(o)}
                style={{
                  padding: '0.5rem 0.7rem',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  background: o === value ? 'var(--primary-light)' : 'transparent',
                  color: o === value ? 'var(--primary)' : 'var(--text)',
                  fontWeight: o === value ? 700 : 400,
                }}
              >
                {o}
              </div>
            ))}
            {showCustomRow && (
              <div
                onClick={() => pick(trimmedQuery)}
                style={{
                  padding: '0.5rem 0.7rem',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  borderTop: filtered.length > 0 ? '1px solid var(--border)' : 'none',
                  color: 'var(--primary)',
                  fontWeight: 600,
                }}
              >
                + Pakai “{trimmedQuery}” sebagai brand baru
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
