import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

// The three figure signatures of the console, in one place.
//
// They used to live inside DashboardPage, which meant every other surface that
// needed them — Executive Snapshot first — reimplemented them slightly wrong:
// a bare em dash at full figure weight (so "absent" looked like a value), and
// flat coloured text where the delta pill belongs. Both are product rules, not
// styling preferences, so they get one implementation.

// Absent and zero must never look alike: a missing figure is an em dash in the
// quiet tier that says why on hover, a real zero prints like any other number.
export function Figure({ text, absentReason }) {
  if (text == null) {
    return (
      <span className="con-null" title={absentReason || 'Data belum tersedia untuk periode ini'}>
        &mdash;
      </span>
    );
  }
  return <>{text}</>;
}

// Colour carries meaning here and nowhere else on the page. The arrow always
// follows the raw sign; the colour follows the business reading, so a rising
// cancellation rate is red even though the number went up.
//
// `neutral` is the third reading: a metric where movement has no direction to
// judge — ad spend rising is neither good nor bad on its own — so it keeps the
// arrow and drops the verdict.
export function Delta({ value, invert = false, neutral = false }) {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const flat = Math.abs(n) < 0.05;
  const rising = n > 0;
  const good = invert ? !rising : rising;
  const cls = neutral || flat ? 'is-flat' : good ? 'is-up' : 'is-down';
  const Icon = flat ? Minus : rising ? ArrowUp : ArrowDown;

  return (
    <span className={`con-delta ${cls}`}>
      <Icon size={11} strokeWidth={2.6} />
      {`${n > 0 ? '+' : ''}${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(n)}%`}
    </span>
  );
}

// Bare trend line for the GMV cell. No axes, no tooltip and no library: the
// full daily chart is one click away in Business Growth, and this only has to
// say which way the month went.
export function Spark({ values = [] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = span > 0 ? 20 - ((v - min) / span) * 20 : 10;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <svg className="con-spark" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden focusable="false">
      <polyline points={points} fill="none" stroke="var(--acc-300)" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// "Where does this number come from" — the ? beside a metric. Rendered in a
// portal with fixed positioning because the strips and cards it sits in clip
// their overflow, and a native title= tooltip takes a second to appear and
// can't hold more than one line. `text` may use \n for separate lines.
const TIP_WIDTH = 300;
export function InfoTip({ text, className = 'con-kpi-note' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  if (!text) return null;

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const vw = window.innerWidth;
    const left = Math.min(Math.max(r.left + r.width / 2 - TIP_WIDTH / 2, 8), vw - TIP_WIDTH - 8);
    const below = r.bottom + 8;
    // Flip above when the trigger sits in the bottom third of the viewport.
    const above = r.top > window.innerHeight * 0.66;
    setPos({ left, top: above ? r.top - 8 : below, above });
  };
  const hide = () => setPos(null);

  return (
    <>
      <button
        type="button"
        ref={ref}
        className={className}
        aria-label={text}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => { e.stopPropagation(); if (pos) hide(); else show(); }}
      >
        ?
      </button>
      {pos && createPortal(
        <div
          className={`con-tip${pos.above ? ' is-above' : ''}`}
          role="tooltip"
          style={{ left: pos.left, top: pos.top, width: TIP_WIDTH }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
