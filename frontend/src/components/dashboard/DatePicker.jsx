import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown } from 'lucide-react';
import { MonthCalendar } from './DateRangePicker.jsx';
import usePopover from '../common/usePopover.js';
import '../common/fieldControls.css';
import './dateRangePicker.css';

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (value) => {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (date, n) => { const next = new Date(date); next.setDate(next.getDate() + n); return next; };
const monthOf = (value) => { const d = parseISO(value) ?? new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

const PRESETS = [
  { label: 'Hari Ini', date: (today) => today },
  { label: 'Kemarin', date: (today) => addDays(today, -1) },
  { label: '2 hari lalu', date: (today) => addDays(today, -2) },
  { label: '1 minggu lalu', date: (today) => addDays(today, -7) },
];

// Single-date sibling of DateRangePicker: same popover shell, same preset
// column, same month grid (imported, not copied), so choosing a meeting date
// looks and behaves exactly like choosing the dashboard period.
export default function DatePicker({ value, onChange, id, label = 'Pilih tanggal', disabled = false, className = '' }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => monthOf(value));
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const selected = parseISO(value);

  const close = useCallback(({ restoreFocus } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);
  const position = usePopover({ open, onClose: close, triggerRef, panelRef, deps: [view] });

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    (panel?.querySelector('.date-range-calendars button[aria-pressed="true"]') ?? panel?.querySelector('button'))?.focus({ preventScroll: true });
  }, [open]);

  const pick = (date) => {
    onChange(toISO(date));
    close({ restoreFocus: true });
  };

  const text = selected
    ? selected.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'Pilih tanggal';

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`atlas-field-trigger${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${text}`}
        onClick={() => { if (!open) setView(monthOf(value)); setOpen((current) => !current); }}
      >
        <Calendar size={15} className="atlas-field-icon" aria-hidden="true" />
        <span className={`atlas-field-value${selected ? '' : ' is-placeholder'}`}>{text}</span>
        <ChevronDown size={15} className="atlas-field-chev" aria-hidden="true" />
      </button>

      {open && createPortal(
        <div ref={panelRef} className="date-range-popover date-single-popover" role="dialog" aria-label={label} style={position}>
          <div className="date-range-presets">
            {PRESETS.map((preset) => (
              <button key={preset.label} type="button" className="date-single-preset" onClick={() => pick(preset.date(today))}>
                {preset.label}
              </button>
            ))}
          </div>
          <div className="date-range-calendars">
            <MonthCalendar
              viewDate={view}
              onNavigate={setView}
              start={selected}
              end={selected}
              hoverEnd={null}
              onPickDay={pick}
              onHoverDay={() => {}}
              today={today}
            />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
