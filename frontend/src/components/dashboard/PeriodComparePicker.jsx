import { getLayoutRect, getLayoutViewport } from '../../utils/uiScale.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { PRESETS } from './DateRangePicker.jsx';
import SelectMenu from '../common/SelectMenu.jsx';
import './periodComparePicker.css';

const WEEKDAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const sameDay = (a, b) => !!a && !!b && a.getTime() === b.getTime();
const inside = (d, r) => !!r?.start && !!r?.end && d >= r.start && d <= r.end;
// A range as people say it: "1–30 Juni 2026", "1 Mei – 30 Juni 2026",
// "15 Desember 2025 – 14 Januari 2026"; one day is just "1 Juni 2026".
function fmtRange(a, b) {
  if (!a || !b) return '—';
  const y = a.getFullYear() === b.getFullYear();
  const m = y && a.getMonth() === b.getMonth();
  if (m && a.getDate() === b.getDate()) return fmtLong(a);
  if (m) return `${a.getDate()}–${fmtLong(b)}`;
  if (y) return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${fmtLong(b)}`;
  return `${fmtLong(a)} – ${fmtLong(b)}`;
}
const fmtLong = (d) => (d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : 'dd/mm/yyyy');

function matchPreset(range, today) {
  if (!range.start || !range.end) return 'custom';
  const hit = PRESETS.find((p) => {
    const [a, b] = p.range(today);
    return sameDay(startOfDay(a), range.start) && sameDay(startOfDay(b), range.end);
  });
  return hit ? hit.label : 'custom';
}

function monthCells(view) {
  const lead = new Date(view.getFullYear(), view.getMonth(), 1).getDay();
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(new Date(view.getFullYear(), view.getMonth(), d));
  return cells;
}

// One month: the period's days in blue, the comparison's in grey, the days
// both cover in the dark "tumpang tindih" tone; each range's ends solid.
function Month({ view, onView, primary, compare, years, today, onPick, onHover, prev, next }) {
  return (
    <div className="pcp-month">
      <div className="pcp-month-head">
        {prev ? <button type="button" className="pcp-nav" onClick={() => onView(addMonths(view, -1))} aria-label="Bulan sebelumnya"><ChevronLeft size={18} /></button> : <span className="pcp-nav-gap" />}
        <SelectMenu
          className="pcp-select"
          label="Bulan"
          value={view.getMonth()}
          onChange={(m) => onView(new Date(view.getFullYear(), m, 1))}
          options={MONTHS_SHORT.map((m, i) => ({ value: i, label: m }))}
        />
        <SelectMenu
          className="pcp-select"
          label="Tahun"
          value={view.getFullYear()}
          onChange={(y) => onView(new Date(y, view.getMonth(), 1))}
          options={years.map((y) => ({ value: y, label: String(y) }))}
        />
        {next ? <button type="button" className="pcp-nav" onClick={() => onView(addMonths(view, 1))} aria-label="Bulan berikutnya"><ChevronRight size={18} /></button> : <span className="pcp-nav-gap" />}
      </div>
      <div className="pcp-grid" role="grid">
        {WEEKDAYS.map((w) => <div key={w} className="pcp-weekday">{w}</div>)}
        {monthCells(view).map((date, i) => {
          if (!date) return <div key={`x${i}`} />;
          const inP = inside(date, primary);
          const inC = inside(date, compare);
          const edgeP = sameDay(date, primary?.start) || sameDay(date, primary?.end);
          const edgeC = sameDay(date, compare?.start) || sameDay(date, compare?.end);
          const cls = ['pcp-day'];
          if (inP && inC) cls.push('is-both');
          else if (inP) cls.push('is-pri');
          else if (inC) cls.push('is-cmp');
          if (edgeP) cls.push('is-edge-pri');
          else if (edgeC) cls.push('is-edge-cmp');
          if (sameDay(date, today)) cls.push('is-today');
          return (
            <button
              key={i}
              type="button"
              className={cls.join(' ')}
              aria-label={fmtLong(date)}
              aria-pressed={inP || inC}
              onClick={() => onPick(date)}
              onMouseEnter={() => onHover(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Brand Overview's period control, laid out like an ads manager's: ATLAS's
// presets and modes on the left, two months, then "Bandingkan" with one row
// per range (colour key, basis menu, start – end). Edits stay a draft until
// "Perbarui"; "Batal", Escape or a click outside drop them.
export default function PeriodComparePicker({ startDate, endDate, compare, compareStartDate, compareEndDate, compareType, computeCompare, compareTypes, onApply }) {
  const today = startOfDay(new Date());
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('range');
  const [primary, setPrimary] = useState({ start: null, end: null });
  const [cmp, setCmp] = useState({ start: null, end: null });
  const [cmpOn, setCmpOn] = useState(false);
  const [cmpType, setCmpType] = useState('previous_period');
  const [target, setTarget] = useState('primary');
  const [picking, setPicking] = useState(false);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState(() => addMonths(today, -1));
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };

  const openPanel = () => {
    if (open) { close(); return; }
    const p = { start: parseISO(startDate), end: parseISO(endDate) };
    setPrimary(p);
    setCmp({ start: parseISO(compareStartDate), end: parseISO(compareEndDate) });
    setCmpOn(Boolean(compare));
    setCmpType(compareType || 'previous_period');
    setTarget('primary');
    setPicking(false);
    setHover(null);
    setMode('range');
    const anchor = p.end || today;
    setView(addMonths(anchor, -1));
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const anchor = triggerRef.current ? getLayoutRect(triggerRef.current) : null;
      const viewport = getLayoutViewport();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const left = Math.max(8, Math.min(anchor.right - width, viewport.width - width - 8));
      const below = anchor.bottom + 8;
      const top = below + height <= viewport.height - 8 ? below : Math.max(8, viewport.height - height - 8);
      setPosition({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    observer.observe(panelRef.current);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    // A dropdown inside the panel portals its menu to <body>: that is still
    // the panel, so picking from it (or Escape closing it) keeps it open.
    const inMenu = (el) => el instanceof Element && el.closest('.atlas-menu');
    const outside = (e) => !triggerRef.current?.contains(e.target) && !panelRef.current?.contains(e.target) && !inMenu(e.target);
    const onPointer = (e) => { if (outside(e)) setOpen(false); };
    const onFocus = (e) => { if (outside(e)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape' && !inMenu(e.target) && !document.querySelector('.atlas-menu')) { e.preventDefault(); close(); } };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector('input, button')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The period moved: a comparison that follows a rule follows it too.
  const setPeriod = (next) => {
    setPrimary(next);
    if (next.start && next.end && cmpType !== 'custom') {
      const r = computeCompare(cmpType, toISO(next.start), toISO(next.end));
      setCmp({ start: parseISO(r.compareStartDate), end: parseISO(r.compareEndDate) });
    }
  };
  const setRange = (which, next) => {
    if (which === 'primary') setPeriod(next);
    else { setCmp(next); setCmpType('custom'); }
  };

  const pickPreset = (preset) => {
    const [a, b] = preset.range(today);
    setMode('range');
    setTarget('primary');
    setPicking(false);
    setPeriod({ start: startOfDay(a), end: startOfDay(b) });
    setView(addMonths(b, -1));
  };

  const pickMonth = (year, month) => {
    setRange(target, { start: new Date(year, month, 1), end: new Date(year, month + 1, 0) });
  };

  const pickDay = (date) => {
    if (mode === 'week') {
      setRange(target, { start: date, end: addDays(date, 6) });
      setPicking(false);
      return;
    }
    const current = target === 'primary' ? primary : cmp;
    if (!picking) {
      setRange(target, { start: date, end: null });
      setPicking(true);
      return;
    }
    const [a, b] = date < current.start ? [date, current.start] : [current.start, date];
    setRange(target, { start: a, end: b });
    setPicking(false);
    setHover(null);
  };

  const toggleCompare = (on) => {
    setCmpOn(on);
    if (!on) { if (target === 'compare') setTarget('primary'); return; }
    const type = cmpType === 'custom' && !cmp.start ? 'previous_period' : cmpType;
    setCmpType(type);
    if (type !== 'custom' && primary.start && primary.end) {
      const r = computeCompare(type, toISO(primary.start), toISO(primary.end));
      setCmp({ start: parseISO(r.compareStartDate), end: parseISO(r.compareEndDate) });
    }
  };

  const pickCompareType = (type) => {
    setCmpType(type);
    if (type === 'custom') { setTarget('compare'); return; }
    if (primary.start && primary.end) {
      const r = computeCompare(type, toISO(primary.start), toISO(primary.end));
      setCmp({ start: parseISO(r.compareStartDate), end: parseISO(r.compareEndDate) });
    }
  };

  const focusRow = (which) => {
    setTarget(which);
    setPicking(false);
    const r = which === 'primary' ? primary : cmp;
    if (r.end) setView(addMonths(r.end, -1));
  };

  // While the second day is being chosen, the hovered day previews the end.
  const preview = (r, which) => (picking && target === which && r.start && hover
    ? (hover < r.start ? { start: hover, end: r.start } : { start: r.start, end: hover })
    : r);
  const shownPrimary = preview(primary, 'primary');
  const shownCompare = cmpOn ? preview(cmp, 'compare') : null;

  const finish = (r) => (r.start ? { start: r.start, end: r.end ?? r.start } : r);
  const ready = primary.start && (!cmpOn || cmp.start);
  const apply = () => {
    const p = finish(primary);
    const c = finish(cmp);
    onApply({
      startDate: toISO(p.start),
      endDate: toISO(p.end),
      compare: cmpOn,
      compareType: cmpType,
      compareStartDate: cmpOn ? toISO(c.start) : '',
      compareEndDate: cmpOn ? toISO(c.end) : '',
    });
    close();
  };

  const activePreset = matchPreset(primary, today);
  const yearOf = (target === 'compare' ? cmp.start : primary.start) || today;
  const years = Array.from(new Set([...Array.from({ length: 8 }, (_, i) => today.getFullYear() - 6 + i), view.getFullYear(), addMonths(view, 1).getFullYear(), yearOf.getFullYear()])).sort((a, b) => a - b);

  const s = parseISO(startDate);
  const e = parseISO(endDate);
  const cs = parseISO(compareStartDate);
  const ce = parseISO(compareEndDate);

  const row = (which, range, select) => (
    <div className={`pcp-row${target === which ? ' is-target' : ''}${which === 'compare' ? ' is-compare' : ''}`}>
      <span className="pcp-key" aria-hidden="true" />
      {select}
      <button type="button" className="pcp-date" onClick={() => focusRow(which)} aria-label={`${which === 'primary' ? 'Periode' : 'Pembanding'}: tanggal mulai`}>
        {range.start ? fmtLong(range.start) : <span className="pcp-placeholder">dd/mm/yyyy</span>}
      </button>
      <span className="pcp-dash" aria-hidden="true">–</span>
      <button type="button" className="pcp-date" onClick={() => focusRow(which)} aria-label={`${which === 'primary' ? 'Periode' : 'Pembanding'}: tanggal akhir`}>
        {range.end ? fmtLong(range.end) : <span className="pcp-placeholder">dd/mm/yyyy</span>}
      </button>
    </div>
  );

  return (
    <>
      <button type="button" ref={triggerRef} className="pcp-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={openPanel}>
        <Calendar size={16} aria-hidden="true" />
        <span className="pcp-trigger-text">
          <span>{fmtRange(s, e)}</span>
          {compare && <small>vs {fmtRange(cs, ce)}</small>}
        </span>
        <ChevronDown size={15} className="pcp-trigger-chev" aria-hidden="true" />
      </button>

      {open && createPortal(
        <div ref={panelRef} className="pcp-popover" role="dialog" aria-label="Pilih periode" style={position}>
          <div className="pcp-side" role="radiogroup" aria-label="Rentang cepat">
            {PRESETS.map((p) => (
              <label key={p.label} className="pcp-option">
                <input type="radio" name="pcp-preset" checked={mode === 'range' && activePreset === p.label} onChange={() => pickPreset(p)} />
                <span className="pcp-radio" aria-hidden="true" />
                {p.label}
              </label>
            ))}
            <hr />
            {[['range', 'Custom'], ['week', 'Per minggu'], ['month', 'Per bulan']].map(([value, label]) => (
              <label key={value} className="pcp-option">
                <input type="radio" name="pcp-mode" checked={mode === value && (value !== 'range' || activePreset === 'custom')} onChange={() => { setMode(value); setPicking(false); }} />
                <span className="pcp-radio" aria-hidden="true" />
                {label}
              </label>
            ))}
          </div>

          <div className="pcp-main">
            {mode === 'month' ? (
              <MonthMode range={target === 'compare' ? cmp : primary} years={years} today={today} onPick={pickMonth} target={target} />
            ) : (
              <div className="pcp-months" onMouseLeave={() => setHover(null)}>
                <Month view={view} onView={setView} primary={shownPrimary} compare={shownCompare} years={years} today={today} onPick={pickDay} onHover={setHover} prev />
                <Month view={addMonths(view, 1)} onView={(d) => setView(addMonths(d, -1))} primary={shownPrimary} compare={shownCompare} years={years} today={today} onPick={pickDay} onHover={setHover} next />
              </div>
            )}

            <div className="pcp-compare">
              <label className="pcp-check">
                <input type="checkbox" checked={cmpOn} onChange={(ev) => toggleCompare(ev.target.checked)} />
                <span className="pcp-box" aria-hidden="true" />
                Bandingkan
              </label>
              {row('primary', primary, (
                <div className="pcp-menu">
                  <SelectMenu
                    label="Rentang periode"
                    value={activePreset}
                    onChange={(value) => { const p = PRESETS.find((x) => x.label === value); if (p) pickPreset(p); }}
                    options={[...PRESETS.map((p) => ({ value: p.label, label: p.label })), { value: 'custom', label: 'Kustom' }]}
                  />
                </div>
              ))}
              {cmpOn && row('compare', cmp, (
                <div className="pcp-menu">
                  <SelectMenu label="Bandingkan dengan" value={cmpType} onChange={pickCompareType} options={compareTypes} />
                </div>
              ))}
              {cmpOn && (
                <div className="pcp-legend"><span className="pcp-key is-both" aria-hidden="true" /> Tanggal tumpang tindih</div>
              )}
            </div>

            <div className="pcp-foot">
              <span>Tanggal ditampilkan dalam Waktu Jakarta (GMT+7)</span>
              <div className="pcp-actions">
                <button type="button" className="pcp-btn" onClick={close}>Batal</button>
                <button type="button" className="pcp-btn is-primary" onClick={apply} disabled={!ready}>Perbarui</button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// "Per bulan": a month and a year replace the calendars, for whichever row is
// being edited.
function MonthMode({ range, years, today, onPick, target }) {
  const base = range.start || today;
  const year = base.getFullYear();
  const month = base.getMonth();
  return (
    <div className="pcp-monthmode">
      <p>Pilih bulan untuk {target === 'compare' ? 'periode pembanding' : 'periode'}.</p>
      <div className="pcp-menu">
        <span>Tahun</span>
        <SelectMenu label="Tahun" value={year} onChange={(y) => onPick(y, month)} options={years.map((y) => ({ value: y, label: String(y) }))} />
      </div>
      <div className="pcp-menu">
        <span>Bulan</span>
        <SelectMenu label="Bulan" value={month} onChange={(m) => onPick(year, m)} options={MONTHS.map((m, i) => ({ value: i, label: m }))} />
      </div>
    </div>
  );
}
