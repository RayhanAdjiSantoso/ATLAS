import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

const WEEKDAY_LABELS = ['M', 'S', 'S', 'R', 'K', 'J', 'S'];
const MONTH_LABELS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const pad = (n) => String(n).padStart(2, '0');
const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISODate = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const isSameDay = (a, b) => !!a && !!b
  && a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const addMonths = (d, n) => { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; };

const PRESETS = [
  { label: 'Hari Ini', range: (today) => [today, today] },
  { label: 'Kemarin', range: (today) => { const y = addDays(today, -1); return [y, y]; } },
  { label: '1 Minggu Terakhir', range: (today) => [addDays(today, -6), today] },
  { label: '1 Bulan Terakhir', range: (today) => [addMonths(today, -1), today] },
  { label: '3 bulan terakhir', range: (today) => [addMonths(today, -3), today] },
];

function getMonthCells(year, month) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

function MonthCalendar({ viewDate, onNavigate, start, end, hoverEnd, onPickDay, onHoverDay, today }) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const cells = getMonthCells(year, month);
  const effectiveEnd = end || hoverEnd;

  return (
    <div style={{ flex: 1, minWidth: '260px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', marginBottom: '0.75rem' }}>
        <NavBtn onClick={() => onNavigate(addMonths(viewDate, -12))}><ChevronsLeft size={16} /></NavBtn>
        <NavBtn onClick={() => onNavigate(addMonths(viewDate, -1))}><ChevronLeft size={16} /></NavBtn>
        <div style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: '0.95rem', color: 'var(--text)' }}>
          {MONTH_LABELS[month]} {year}
        </div>
        <NavBtn onClick={() => onNavigate(addMonths(viewDate, 1))}><ChevronRight size={16} /></NavBtn>
        <NavBtn onClick={() => onNavigate(addMonths(viewDate, 12))}><ChevronsRight size={16} /></NavBtn>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '0.25rem' }}>
        {WEEKDAY_LABELS.map((w, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', padding: '0.35rem 0' }}>
            {w}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {cells.map((date, idx) => {
          if (!date) return <div key={idx} />;

          const inRange = start && effectiveEnd && date > start && date < effectiveEnd;
          const isStart = isSameDay(date, start);
          const isEnd = isSameDay(date, effectiveEnd);
          const isEdge = isStart || isEnd;
          const isToday = isSameDay(date, today);

          return (
            <button
              key={idx}
              type="button"
              onClick={() => onPickDay(date)}
              onMouseEnter={() => onHoverDay(date)}
              style={{
                border: 'none',
                background: isEdge ? 'var(--primary)' : inRange ? 'var(--primary-light)' : 'transparent',
                color: isEdge ? '#fff' : isToday ? 'var(--primary)' : 'var(--text)',
                fontWeight: isEdge || isToday ? 700 : 400,
                borderRadius: isEdge ? '999px' : '4px',
                padding: '0.45rem 0',
                fontSize: '0.85rem',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavBtn({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: 'none',
        background: 'transparent',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        padding: '0.2rem',
        display: 'flex',
        alignItems: 'center',
        borderRadius: '4px',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}

const selectStyle = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  fontSize: '0.85rem',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  cursor: 'pointer',
};

export default function DateRangePicker({ startDate, endDate, onChange }) {
  const [open, setOpen] = useState(false);
  // 'range' = default two-step start/end calendar picker (unchanged
  // behavior). 'week' = single click selects that date's 7-day window.
  // 'month' = Year + Month selects replace the calendar entirely.
  const [mode, setMode] = useState('range');
  const [pendingStart, setPendingStart] = useState(() => parseISODate(startDate));
  const [pendingEnd, setPendingEnd] = useState(() => parseISODate(endDate));
  const [hoverDate, setHoverDate] = useState(null);
  const [leftView, setLeftView] = useState(() => {
    const d = parseISODate(startDate) || new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const today = startOfDay(new Date());
  const [monthModeDate, setMonthModeDate] = useState(() => {
    const d = parseISODate(startDate) || today;
    return { year: d.getFullYear(), month: d.getMonth() };
  });
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

  const openPanel = () => {
    setPendingStart(parseISODate(startDate));
    setPendingEnd(parseISODate(endDate));
    setHoverDate(null);
    const d = parseISODate(startDate) || new Date();
    setLeftView(new Date(d.getFullYear(), d.getMonth(), 1));
    setOpen((o) => !o);
  };

  const applyRange = (start, end) => {
    onChange({
      startDate: toISODate(start),
      endDate: toISODate(end),
    });
    setOpen(false);
  };

  const handlePickDay = (date) => {
    if (!pendingStart || pendingEnd) {
      setPendingStart(date);
      setPendingEnd(null);
      setHoverDate(null);
      return;
    }
    const start = date < pendingStart ? date : pendingStart;
    const end = date < pendingStart ? pendingStart : date;
    setPendingStart(start);
    setPendingEnd(end);
    applyRange(start, end);
  };

  // "Per minggu": one click picks the 7-day window starting at that date
  // (clicked date -> clicked date + 6 days), not a fixed Mon-Sun/Sun-Sat grid
  // week — e.g. clicking 1 Jan gives 1-7 Jan, clicking 15 Jan gives 15-21 Jan.
  const handleWeekPick = (date) => {
    const start = date;
    const end = addDays(date, 6);
    setPendingStart(start);
    setPendingEnd(end);
    applyRange(start, end);
  };

  const handlePreset = (preset) => {
    const [start, end] = preset.range(today);
    setPendingStart(start);
    setPendingEnd(end);
    applyRange(start, end);
  };

  // "Custom": the original two-step start/end calendar picker, exposed as an
  // explicit option now that "Per minggu"/"Per bulan" exist as alternatives.
  const handleSelectRangeMode = () => {
    setPendingStart(parseISODate(startDate));
    setPendingEnd(parseISODate(endDate));
    setHoverDate(null);
    setMode('range');
  };

  const handleSelectWeekMode = () => {
    setMode('week');
  };

  // "Per bulan": Year + Month selects replace the calendar; the full
  // calendar month (actual day count, incl. leap Februaries) is applied
  // immediately whenever either select changes.
  const applyMonthRange = (year, month) => {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    onChange({ startDate: toISODate(start), endDate: toISODate(end) });
  };

  const handleSelectMonthMode = () => {
    const d = parseISODate(startDate) || today;
    const year = d.getFullYear();
    const month = d.getMonth();
    setMonthModeDate({ year, month });
    setMode('month');
    applyMonthRange(year, month);
  };

  const handleYearChange = (e) => {
    const year = Number(e.target.value);
    setMonthModeDate((prev) => {
      applyMonthRange(year, prev.month);
      return { ...prev, year };
    });
  };

  const handleMonthChange = (e) => {
    const month = Number(e.target.value);
    setMonthModeDate((prev) => {
      applyMonthRange(prev.year, month);
      return { ...prev, month };
    });
  };

  const rightView = addMonths(leftView, 1);

  const formatShort = (d) => d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '--/--/----';
  const start = parseISODate(startDate);
  const end = parseISODate(endDate);

  const currentYear = today.getFullYear();
  const yearOptions = Array.from(
    new Set([
      ...Array.from({ length: 8 }, (_, i) => currentYear - 6 + i),
      monthModeDate.year,
    ]),
  ).sort((a, b) => a - b);

  const modeButtonStyle = (active) => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    background: active ? 'var(--primary-light)' : 'transparent',
    border: 'none',
    padding: '0.65rem 1.25rem',
    fontSize: '0.85rem',
    fontWeight: active ? 700 : 400,
    color: active ? 'var(--primary)' : 'var(--text-muted)',
    cursor: 'pointer',
  });

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'block', width: '100%' }}>
      <button
        type="button"
        onClick={openPanel}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          width: '100%',
          padding: '0.625rem 1rem',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          color: 'var(--text)',
          cursor: 'pointer',
          fontSize: '0.9rem',
          whiteSpace: 'nowrap',
        }}
      >
        <Calendar size={16} />
        <span>{formatShort(start)} - {formatShort(end)} (GMT+7)</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 50,
            background: 'var(--bg-card)',
            borderRadius: '12px',
            boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18)',
            display: 'flex',
            overflow: 'hidden',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ width: '170px', borderRight: '1px solid var(--border)', padding: '0.75rem 0' }}>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => handlePreset(preset)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  padding: '0.65rem 1.25rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--primary-light)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {preset.label}
              </button>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', margin: '0.5rem 0' }} />
            <button
              type="button"
              onClick={handleSelectRangeMode}
              style={modeButtonStyle(mode === 'range')}
              onMouseEnter={(e) => { if (mode !== 'range') e.currentTarget.style.background = 'var(--primary-light)'; }}
              onMouseLeave={(e) => { if (mode !== 'range') e.currentTarget.style.background = 'transparent'; }}
            >
              Custom
            </button>
            <button
              type="button"
              onClick={handleSelectWeekMode}
              style={modeButtonStyle(mode === 'week')}
              onMouseEnter={(e) => { if (mode !== 'week') e.currentTarget.style.background = 'var(--primary-light)'; }}
              onMouseLeave={(e) => { if (mode !== 'week') e.currentTarget.style.background = 'transparent'; }}
            >
              Per minggu
            </button>
            <button
              type="button"
              onClick={handleSelectMonthMode}
              style={modeButtonStyle(mode === 'month')}
              onMouseEnter={(e) => { if (mode !== 'month') e.currentTarget.style.background = 'var(--primary-light)'; }}
              onMouseLeave={(e) => { if (mode !== 'month') e.currentTarget.style.background = 'transparent'; }}
            >
              Per bulan
            </button>
          </div>

          {mode === 'month' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem', minWidth: '260px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>Tahun</label>
                <select value={monthModeDate.year} onChange={handleYearChange} style={selectStyle}>
                  {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>Bulan</label>
                <select value={monthModeDate.month} onChange={handleMonthChange} style={selectStyle}>
                  {MONTH_LABELS.map((m, idx) => <option key={m} value={idx}>{m}</option>)}
                </select>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {formatShort(new Date(monthModeDate.year, monthModeDate.month, 1))} - {formatShort(new Date(monthModeDate.year, monthModeDate.month + 1, 0))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '1.5rem', padding: '1rem 1.5rem', minWidth: '580px' }}
                 onMouseLeave={() => setHoverDate(null)}>
              <MonthCalendar
                viewDate={leftView}
                onNavigate={setLeftView}
                start={pendingStart}
                end={pendingEnd}
                hoverEnd={hoverDate}
                onPickDay={mode === 'week' ? handleWeekPick : handlePickDay}
                onHoverDay={setHoverDate}
                today={today}
              />
              <MonthCalendar
                viewDate={rightView}
                onNavigate={(d) => setLeftView(addMonths(d, -1))}
                start={pendingStart}
                end={pendingEnd}
                hoverEnd={hoverDate}
                onPickDay={mode === 'week' ? handleWeekPick : handlePickDay}
                onHoverDay={setHoverDate}
                today={today}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
