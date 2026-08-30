import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
export function MetricPicker({ allCols, activeCols, onChange, labelFn, dense }: MetricPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);

  const label = (col: string) => (labelFn ? labelFn(col) : col);
  const extras = allCols.filter((c) => !activeCols.includes(c));

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 10;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(140, Math.min(320, openUp ? spaceAbove : spaceBelow));
    // Estimated width (CSS: min-width 260px, max-width min(360px, 90vw)) — used
    // to keep the dropdown from overflowing the right edge on narrow viewports.
    const estWidth = Math.min(360, window.innerWidth * 0.9);
    let left = rect.left;
    if (left + estWidth > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - estWidth);
    setPos({
      top: openUp ? undefined : rect.bottom + 5,
      bottom: openUp ? window.innerHeight - rect.top + 5 : undefined,
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

  function selectAll() {
    onChange([...activeCols, ...extras]);
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
                <>
                  <div className="add-metric-opt add-metric-opt-all" onClick={selectAll}>
                    ✓ Pilih Semua Metrik
                  </div>
                  <div className="add-metric-divider" />
                </>
              )}
              {extras.length ? (
                extras.map((col) => (
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
    </div>
  );
}
