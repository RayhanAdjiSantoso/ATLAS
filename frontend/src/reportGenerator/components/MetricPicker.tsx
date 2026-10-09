import { getLayoutRect, getLayoutViewport } from '../../utils/uiScale.js';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getPortalContainer } from '../utils/portalTarget';

interface MetricPickerProps {
  allCols: string[];
  activeCols: string[];
  onChange: (cols: string[]) => void;
  labelFn?: (col: string) => string;
  // Trims the wrapper's own padding down to a small vertical gap — for
  // callers (e.g. KpiTable's default mode) that are already nested inside a
  // padded wrapper and would otherwise double the inset.
  dense?: boolean;
  // A table-level control shown beside "Hapus Semua" (e.g. Meta B2B's result
  // picker), so the table's toolbar stays one row.
  extra?: ReactNode;
}

// The "+ Tambah metrik" add-back control only — rename, reorder, and remove
// all happen directly on the table itself now (row labels / column headers,
// see useInlineMetricEditor), not through a separate pill/list here. This
// component's only remaining job is offering back whatever's currently
// hidden (allCols - activeCols) and clearing everything at once.
//
// Position: the dropdown opens as position:fixed, computed from the
// trigger's getBoundingClientRect(), to escape .sec-block's overflow:hidden
// (needed for its rounded corners) clipping the popup. A React portal into
// document.body achieves that escape; the viewport-edge flip/clamp math
// below keeps it on-screen.
export function MetricPicker({ allCols, activeCols, onChange, labelFn, dense, extra }: MetricPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);

  const label = (col: string) => (labelFn ? labelFn(col) : col);
  // Hidden metrics A–Z, narrowed by the search box.
  const extras = allCols
    .filter((c) => !activeCols.includes(c))
    .sort((a, b) => label(a).localeCompare(label(b), 'id', { sensitivity: 'base' }));
  const q = query.trim().toLowerCase();
  const shown = q ? extras.filter((c) => label(c).toLowerCase().includes(q)) : extras;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      setQuery('');
      return;
    }
    const rect = getLayoutRect(triggerRef.current);
    const viewport = getLayoutViewport();
    const margin = 10;
    const spaceBelow = viewport.height - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(140, Math.min(320, openUp ? spaceAbove : spaceBelow));
    // Estimated width (CSS: min-width 260px, max-width min(360px, 90vw)) — used
    // to keep the dropdown from overflowing the right edge on narrow viewports.
    const estWidth = Math.min(360, viewport.width * 0.9);
    let left = rect.left;
    if (left + estWidth > viewport.width - margin) left = Math.max(margin, viewport.width - margin - estWidth);
    setPos({
      top: openUp ? undefined : rect.bottom + 5,
      bottom: openUp ? viewport.height - rect.top + 5 : undefined,
      left,
      maxHeight,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setOpen(false);
    }
    // Dropdown only closes on a real page scroll, not on scrolling its own
    // option list (whose event target is the dropdown element itself).
    function handleScroll(e: Event) {
      if (e.target === document) setOpen(false);
    }
    function handleResize() {
      setOpen(false);
    }
    document.addEventListener('click', handleOutside);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('click', handleOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [open]);

  function addCol(col: string) {
    onChange([...activeCols, col]);
  }

  // "Pilih Semua" takes what the search currently shows.
  function selectAll() {
    onChange([...activeCols, ...shown]);
    setOpen(false);
  }

  function clearAll() {
    onChange([]);
  }

  return (
    <div className={`metric-picker metric-picker-fixed${dense ? ' metric-picker-dense' : ''}`}>
      <div className="add-metric-wrap">
        <div ref={triggerRef} className="mpill mpill-add" onClick={() => setOpen((o) => !o)}>
          + Tambah metrik
        </div>
        {open &&
          pos &&
          createPortal(
            <div
              ref={dropdownRef}
              className="add-metric-select open"
              style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, maxHeight: pos.maxHeight }}
            >
              {extras.length > 0 && (
                <div className="add-metric-search">
                  <input
                    type="search"
                    autoFocus
                    placeholder="Cari metrik…"
                    aria-label="Cari metrik"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
                  />
                </div>
              )}
              {shown.length > 0 && (
                <>
                  <div className="add-metric-opt add-metric-opt-all" onClick={selectAll}>
                    ✓ {q ? `Pilih Semua (${shown.length})` : 'Pilih Semua Metrik'}
                  </div>
                  <div className="add-metric-divider" />
                </>
              )}
              {extras.length && !shown.length ? (
                <div className="add-metric-opt" style={{ color: 'var(--muted)' }}>
                  Tidak ada metrik yang cocok
                </div>
              ) : extras.length ? (
                shown.map((col) => (
                  <label key={col} className="add-metric-opt add-metric-opt-check">
                    <input type="checkbox" onChange={() => addCol(col)} />
                    {label(col)}
                  </label>
                ))
              ) : (
                <div className="add-metric-opt" style={{ color: 'var(--muted)' }}>
                  Semua metrik sudah ditambahkan
                </div>
              )}
            </div>,
            getPortalContainer(),
          )}
      </div>
      {activeCols.length > 0 && (
        <div className="mpill mpill-clear" onClick={clearAll} title="Hapus semua metrik">
          ✕ Hapus Semua
        </div>
      )}
      {extra && <div className="metric-picker-extra">{extra}</div>}
    </div>
  );
}
