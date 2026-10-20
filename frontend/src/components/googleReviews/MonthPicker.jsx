import { useCallback, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import usePopover from '../common/usePopover.js';
import '../common/fieldControls.css';

// A month-and-year picker: the year on top with ◀ ▶, the twelve months in a
// 4 × 3 grid below. Same trigger and portalled panel as ATLAS's dropdowns
// (usePopover: placement, outside click and Escape close it). Months outside
// [min, max] are disabled and the arrows stop at the years that have any.
// Values are 'YYYY-MM' ('' = no month chosen).

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const key = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const nowKey = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);

export default function MonthPicker({ value, onChange, min, max, label, placeholder = 'Semua', clearLabel = 'Semua bulan' }) {
  const [open, setOpen] = useState(false);
  const minYear = min ? Number(min.slice(0, 4)) : 1970;
  const maxYear = max ? Number(max.slice(0, 4)) : 2100;
  const startYear = () => Number((value || max || nowKey()).slice(0, 4));
  const [year, setYear] = useState(startYear);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const titleId = useId();

  const close = useCallback(({ restoreFocus } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  const position = usePopover({ open, onClose: close, triggerRef, panelRef });

  const display = value ? `${LONG[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}` : placeholder;
  const today = nowKey();
  const pick = (k) => { onChange(k); close({ restoreFocus: true }); };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`atlas-field-trigger gr-filter-select${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label ? `${label}: ${display}` : display}
        onClick={() => { if (!open) setYear(startYear()); setOpen((o) => !o); }}
      >
        <CalendarDays size={15} className="atlas-field-icon" aria-hidden="true" />
        <span className={`atlas-field-value${value ? '' : ' is-placeholder'}`}>{display}</span>
        <ChevronDown size={15} className="atlas-field-chev" aria-hidden="true" />
      </button>

      {open && createPortal(
        <div ref={panelRef} className="atlas-menu gr-mp" style={position} role="dialog" aria-labelledby={titleId}>
          <div className="gr-mp-head">
            <button type="button" className="gr-mp-nav" onClick={() => setYear((y) => y - 1)} disabled={year <= minYear} aria-label="Tahun sebelumnya">
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <strong id={titleId}>{year}</strong>
            <button type="button" className="gr-mp-nav" onClick={() => setYear((y) => y + 1)} disabled={year >= maxYear} aria-label="Tahun berikutnya">
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="gr-mp-grid">
            {SHORT.map((name, i) => {
              const k = key(year, i + 1);
              const disabled = (min && k < min) || (max && k > max);
              const selected = value === k;
              return (
                <button
                  key={k}
                  type="button"
                  className={`gr-mp-month${selected ? ' is-on' : ''}${k === today ? ' is-today' : ''}`}
                  disabled={Boolean(disabled)}
                  aria-pressed={selected}
                  aria-label={`${LONG[i]} ${year}`}
                  onClick={() => pick(k)}
                >
                  {name}
                </button>
              );
            })}
          </div>
          {value && (
            <div className="gr-mp-foot">
              <button type="button" onClick={() => pick('')}>{clearLabel}</button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
