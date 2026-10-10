import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, Check, Compass, X } from 'lucide-react';
import './coachmark.css';

// Coachmark — a guided tour over a live page. Each step names an element (a
// CSS selector); the page dims around it, a ring marks it, and a card beside
// it explains what it is for. Steps whose element is not on the page right
// now (a view that is closed, a role that cannot see it) are skipped, so one
// tour fits every state of the page.
//
// A tour never opens by itself: it plays when its TourButton (Panduan, top
// right of the page) is pressed.
// Esc or "Lewati" ends it; → / Enter and ← move through it.

const START_EVENT = 'atlas:tour-start';
const PAD = 8;
const GAP = 14;
const CARD_W = 344;

export function startTour(id) {
  window.dispatchEvent(new CustomEvent(START_EVENT, { detail: { id } }));
}

// The top-right button that plays the tour.
export function TourButton({ tourId, className = 'band-action', label = 'Panduan' }) {
  return (
    <button type="button" className={`${className} tour-launch`} onClick={() => startTour(tourId)} data-tour-launch title="Putar panduan halaman ini">
      <Compass size={15} aria-hidden="true" /> {label}
    </button>
  );
}

const visibleRect = (el) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r : null;
};
const find = (selector) => {
  if (!selector) return null;
  for (const el of document.querySelectorAll(selector)) if (visibleRect(el)) return el;
  return null;
};

// Where the card goes: below, above, right, left of the target — the first
// that fits — else pinned to the lower right of the screen.
function placeCard(hole, card) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = card.width || CARD_W;
  const h = card.height || 220;
  const clampX = (x) => Math.min(Math.max(x, 16), vw - w - 16);
  const clampY = (y) => Math.min(Math.max(y, 16), vh - h - 16);
  if (!hole) return { left: (vw - w) / 2, top: (vh - h) / 2, side: 'none' };
  const cx = hole.left + hole.width / 2;
  const cy = hole.top + hole.height / 2;
  if (hole.top + hole.height + GAP + h <= vh - 12) return { left: clampX(cx - w / 2), top: hole.top + hole.height + GAP, side: 'bottom', arrow: cx };
  if (hole.top - GAP - h >= 12) return { left: clampX(cx - w / 2), top: hole.top - GAP - h, side: 'top', arrow: cx };
  if (hole.left + hole.width + GAP + w <= vw - 12) return { left: hole.left + hole.width + GAP, top: clampY(cy - h / 2), side: 'right', arrow: cy };
  if (hole.left - GAP - w >= 12) return { left: hole.left - GAP - w, top: clampY(cy - h / 2), side: 'left', arrow: cy };
  return { left: vw - w - 24, top: vh - h - 24, side: 'none' };
}

export default function Coachmark({ id, steps: allSteps }) {
  const [index, setIndex] = useState(-1);
  // The steps whose element is on the page when the tour starts, so the
  // count reads true ("Langkah 3/6", not a jump from 6 to 8).
  const [steps, setSteps] = useState(allSteps);
  const [hole, setHole] = useState(null);
  const [card, setCard] = useState({ width: CARD_W, height: 220 });
  const dir = useRef(1);
  const cardRef = useRef(null);
  const primaryRef = useRef(null);
  const open = index >= 0;
  const step = open ? steps[index] : null;

  const finish = useCallback(() => {
    setIndex(-1);
    setHole(null);
  }, []);

  const begin = useCallback(() => {
    const present = allSteps.filter((s) => find(s.target));
    setSteps(present.length ? present : allSteps);
    dir.current = 1;
    setIndex(0);
  }, [allSteps]);

  useEffect(() => {
    const onStart = (e) => { if (e.detail?.id === id) begin(); };
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, [id, begin]);

  const go = useCallback((delta) => {
    dir.current = delta;
    setIndex((i) => {
      const next = i + delta;
      if (next >= steps.length) { setHole(null); return -1; }
      return Math.max(next, 0);
    });
  }, [steps.length]);

  // Bring the step's element into view; skip the step when it is not there.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    let tries = 0;
    const locate = () => {
      if (cancelled) return;
      const el = find(step.target);
      if (!el) {
        if (tries++ < 3) { setTimeout(locate, 150); return; }
        // Nothing to point at: move on in the same direction.
        setIndex((i) => {
          const next = i + dir.current;
          if (next < 0) return steps.findIndex((s) => find(s.target));
          if (next >= steps.length) { setHole(null); return -1; }
          return next;
        });
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.top < 90 || r.bottom > window.innerHeight - 40) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: r.height > window.innerHeight * 0.55 ? 'start' : 'center' });
      }
    };
    locate();
    return () => { cancelled = true; };
  }, [open, index, step, steps]);

  // Follow the element while it moves (scroll, resize, late layout).
  useEffect(() => {
    if (!open) return undefined;
    let raf = 0;
    let last = '';
    const tick = () => {
      const el = find(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        const pad = step.padding ?? PAD;
        const top = Math.max(r.top - pad, 8);
        const bottom = Math.min(r.bottom + pad, window.innerHeight - 8);
        const next = { left: r.left - pad, top, width: r.width + pad * 2, height: Math.max(bottom - top, 24), radius: step.radius ?? 14 };
        const sig = `${Math.round(next.left)}|${Math.round(next.top)}|${Math.round(next.width)}|${Math.round(next.height)}`;
        if (sig !== last) { last = sig; setHole(next); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, step]);

  useLayoutEffect(() => {
    if (!cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    if (Math.abs(r.height - card.height) > 1 || Math.abs(r.width - card.width) > 1) setCard({ width: r.width, height: r.height });
  });

  useEffect(() => {
    if (!open) return undefined;
    primaryRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, index, go, finish]);

  if (!open || !step) return null;
  const pos = placeCard(hole, card);
  const last = index === steps.length - 1;
  const arrowStyle = pos.side === 'top' || pos.side === 'bottom'
    ? { left: Math.min(Math.max(pos.arrow - pos.left, 22), card.width - 22) }
    : pos.side === 'left' || pos.side === 'right'
      ? { top: Math.min(Math.max(pos.arrow - pos.top, 22), card.height - 22) }
      : null;

  return createPortal(
    <div className="cm-root" role="presentation">
      <div className="cm-block" onClick={(e) => e.stopPropagation()} />
      {hole && (
        <div className="cm-hole" style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height, borderRadius: hole.radius }}>
          <span className="cm-ring" style={{ borderRadius: hole.radius + 2 }} />
        </div>
      )}
      <div
        ref={cardRef}
        className={`cm-card is-${pos.side}`}
        style={{ left: pos.left, top: pos.top }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cm-title"
        aria-describedby="cm-body"
      >
        {arrowStyle && <span className="cm-arrow" style={arrowStyle} aria-hidden="true" />}
        <div className="cm-top">
          <span className="cm-step">Langkah {index + 1}<em>/{steps.length}</em></span>
          <button type="button" className="cm-skip" onClick={finish} aria-label="Lewati panduan">
            Lewati <X size={13} aria-hidden="true" />
          </button>
        </div>
        <div className="cm-progress" aria-hidden="true">
          {steps.map((_, i) => <i key={i} className={i < index ? 'is-done' : i === index ? 'is-now' : ''} />)}
        </div>
        {step.kicker && <span className="cm-kicker">{step.kicker}</span>}
        <h3 id="cm-title">{step.title}</h3>
        <p id="cm-body">{step.body}</p>
        <div className="cm-actions">
          {index > 0 ? (
            <button type="button" className="cm-btn" onClick={() => go(-1)}><ArrowLeft size={14} aria-hidden="true" /> Kembali</button>
          ) : <span className="cm-hint">Tekan → untuk lanjut</span>}
          <button ref={primaryRef} type="button" className="cm-btn is-primary" onClick={() => go(1)}>
            {last ? <><Check size={14} aria-hidden="true" /> Selesai</> : <>Lanjut <ArrowRight size={14} aria-hidden="true" /></>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
