import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { getLayoutRect, getLayoutViewport } from '../../../utils/uiScale.js';
import { getPortalContainer } from '../../utils/portalTarget';

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTH_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(ym: string, long = true): string {
  const [y, m] = ym.split('-').map(Number);
  return `${(long ? MONTH_LONG : MONTH_SHORT)[m - 1]} ${y}`;
}

const PANEL_WIDTH = 300;

interface MonthPickerProps {
  value: string; // YYYY-MM
  onChange: (ym: string) => void;
  label: string;
  hint?: string;
}

// A month field: the trigger reads like the generator's date-range field, and
// opens a year header (‹ 2026 ›) over a 4 × 3 grid of months. Months after
// the current one cannot be picked — Daily Tracking has nothing there yet.
export function MonthPicker({ value, onChange, label, hint }: MonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(value.slice(0, 4)));
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const now = currentMonth();
  const nowYear = Number(now.slice(0, 4));

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const t = triggerRef.current;
      if (!t) return;
      const r = getLayoutRect(t);
      const vp = getLayoutViewport();
      const height = popRef.current?.offsetHeight ?? 260;
      const below = r.bottom + 8;
      const top = below + height > vp.height - 12 && r.top - height - 8 > 12 ? r.top - height - 8 : below;
      const left = Math.max(12, Math.min(r.left, vp.width - PANEL_WIDTH - 12));
      setPos({ top, left });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!popRef.current?.contains(n) && !triggerRef.current?.contains(n)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    if (open) return setOpen(false);
    setYear(Number(value.slice(0, 4)));
    setOpen(true);
  }

  function pick(ym: string) {
    onChange(ym);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`rc-trigger is-set${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${monthLabel(value)}`}
        onClick={toggle}
      >
        <span className="rc-trigger-ico" aria-hidden="true">
          <CalendarDays size={19} />
        </span>
        <span className="rc-trigger-copy">
          <strong>{monthLabel(value)}</strong>
          {hint && <small>{hint}</small>}
        </span>
        <ChevronRight size={17} className="rc-trigger-go" aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div ref={popRef} className="mp-pop" role="dialog" aria-label={`Pilih bulan ${label}`} style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0, width: PANEL_WIDTH }}>
            <div className="mp-head">
              <button type="button" className="mp-nav" aria-label="Tahun sebelumnya" onClick={() => setYear((y) => y - 1)}>
                <ChevronLeft size={18} />
              </button>
              <span className="mp-year">{year}</span>
              <button type="button" className="mp-nav" aria-label="Tahun berikutnya" disabled={year >= nowYear} onClick={() => setYear((y) => y + 1)}>
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="mp-grid" role="grid">
              {MONTH_SHORT.map((name, i) => {
                const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
                const selected = ym === value;
                return (
                  <button
                    key={ym}
                    type="button"
                    className={`mp-month${selected ? ' is-selected' : ''}${ym === now ? ' is-now' : ''}`}
                    aria-pressed={selected}
                    disabled={ym > now}
                    onClick={() => pick(ym)}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>,
          getPortalContainer(),
        )}
    </>
  );
}
