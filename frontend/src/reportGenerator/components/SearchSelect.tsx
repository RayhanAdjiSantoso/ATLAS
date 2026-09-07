import { useEffect, useMemo, useRef, useState } from 'react';

export interface SearchOption {
  id: string | number;
  name: string;
}

// A custom single-select — a white glassy popup with a keyboard-navigable
// list, replacing the native <select> whose dropdown can't be styled. Closes
// on outside-click / Escape / pick. The filter box (`searchable`, on by
// default) is meant for longer lists like the client picker; a short fixed
// list (industry, objective, …) reads cleaner with it turned off.
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = '— pilih —',
  searchPlaceholder = 'Cari…',
  emptyLabel = 'Tidak ada hasil',
  searchable = true,
}: {
  options: SearchOption[];
  value: string | number | null;
  onChange: (id: string | number) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value) ?? null;
  const filtered = useMemo(() => {
    if (!searchable) return options;
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.name.toLowerCase().includes(s)) : options;
  }, [options, q, searchable]);

  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, filtered.findIndex((o) => o.id === value)));
    // Focus the search input if there is one; otherwise the popup itself, so
    // arrow-key navigation works right away.
    const t = window.setTimeout(() => (searchable ? inputRef.current : listRef.current)?.focus(), 20);
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (hi < 0) return;
    const el = listRef.current?.children[hi] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  function pick(id: string | number) {
    onChange(id);
    setOpen(false);
    setQ('');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const o = filtered[hi];
      if (o) pick(o.id);
    }
  }

  return (
    <div className={`ssel${open ? ' open' : ''}`} ref={rootRef}>
      <button type="button" className="ssel-trigger" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <span className={selected ? 'ssel-value' : 'ssel-placeholder'}>{selected ? selected.name : placeholder}</span>
        <span className="ssel-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="ssel-pop" role="listbox">
          {searchable && (
            <div className="ssel-search">
              <span className="ssel-search-icon" aria-hidden>
                ⌕
              </span>
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setHi(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
              />
            </div>
          )}
          <div className="ssel-list" ref={listRef} tabIndex={searchable ? undefined : -1} onKeyDown={searchable ? undefined : onKeyDown}>
            {filtered.length === 0 ? (
              <div className="ssel-empty">{emptyLabel}</div>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  className={`ssel-opt${o.id === value ? ' selected' : ''}${i === hi ? ' hi' : ''}`}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(o.id)}
                >
                  <span className="ssel-opt-name">{o.name}</span>
                  {o.id === value && <span className="ssel-opt-check" aria-hidden>✓</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
