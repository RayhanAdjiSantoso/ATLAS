import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

// Port of 21st.dev's carousel-squeeze to this codebase: same strip logic,
// Tailwind utilities moved into `.sq-*` rules in landing.css, and the page's
// own Inter instead of the Geist the original injects.
//
// One panel gets the room, three columns share what is left, and a tail of
// slats runs off the right edge. Opening a slat widens it and slides the row
// along; the copy and the button underneath cross-fade to match.

const size = (value) => (typeof value === 'number' ? `${value}px` : value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Four columns share whatever is left once the open card, the slats and the
// gaps are paid for. The open card starts from a 16:9 block and gives a little
// back — hence the negative first share. Column −1 and anything past column 3
// is a slat.
const SHARES = [-0.06, 0.61, 0.3, 0.15];
// The hovered column takes more room…
const STRETCHED = [0, 0.71, 0.4, 0.25];
// …and its neighbours give a little up to pay for it.
const SQUEEZED = [-0.12, 0.59, 0.28, 0.13];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduced(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);
  return reduced;
}

/**
 * @param {{
 *   slides: { id?: string|number, title: string, description?: string, image?: string, imageAlt?: string,
 *             background?: string, overlay?: import('react').ReactNode, action?: string, href?: string,
 *             target?: string, onAction?: () => void }[],
 *   defaultIndex?: number, onIndexChange?: (i: number) => void, height?: number|string,
 *   slatWidth?: number|string, slatGap?: number|string, gap?: number|string, radius?: number|string,
 *   duration?: number, hoverGrow?: boolean, autoplay?: boolean, interval?: number, controls?: boolean,
 *   label?: string, head?: import('react').ReactNode, className?: string, style?: object,
 * }} props
 */
export function SqueezeCarousel({
  slides,
  defaultIndex = 0,
  onIndexChange,
  height = 'clamp(180px, 32cqi, 340px)',
  slatWidth = 8,
  slatGap = 8,
  gap = 16,
  radius = 6,
  duration = 1000,
  hoverGrow = true,
  autoplay = false,
  interval = 6000,
  controls = true,
  label = 'Featured',
  head = null,
  className,
  style,
}) {
  const count = slides.length;
  const wrap = (i) => ((i % count) + count) % count;

  // Four columns plus a tail of slats. Fewer slides, shorter tail.
  const slats = clamp(count - 4, 1, 3);
  const visible = 4 + slats;

  const reduced = useReducedMotion();
  const ms = reduced ? 0 : duration;

  const ids = useId();
  const seed = useRef(0);

  const window0 = () =>
    Array.from({ length: visible }, (_, p) => ({ key: seed.current++, slide: wrap(defaultIndex + p) }));

  const [cards, setCards] = useState(window0);
  // Which column each card sits in: its place in the strip plus this. Stepping
  // on pushes it down, so the card that was column 0 becomes column −1.
  const [column, setColumn] = useState(0);
  const columnRef = useRef(0);
  const forward = useRef(true);
  // How far the strip is slid, counted in slats. Parts company with `column`
  // for the one frame after a trim or before a step back.
  const [slid, setSlid] = useState(0);
  const [still, setStill] = useState(false);
  const [hover, setHover] = useState(-1);

  const open = cards[-column]?.slide ?? defaultIndex;
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The slide list can change under us (the manager adds or hides a photo):
  // rebuild the strip from the panel that is open now.
  const countRef = useRef(count);
  useEffect(() => {
    if (countRef.current === count) return;
    countRef.current = count;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const from = Math.min(open, Math.max(0, count - 1));
    setCards(Array.from({ length: visible }, (_, p) => ({ key: seed.current++, slide: ((from + p) % count + count) % count })));
    columnRef.current = 0;
    setColumn(0);
    setSlid(0);
    setStill(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, visible]);

  // Once a step has finished moving, cut the strip back to the cards on show
  // and zero the numbers — the same picture, so nothing animates on the way.
  const settle = useCallback(() => {
    setCards((strip) => (forward.current ? strip.slice(-visible) : strip.slice(0, visible)));
    columnRef.current = 0;
    setColumn(0);
    setSlid(0);
    setStill(true);
  }, [visible]);

  useLayoutEffect(() => {
    if (!still) return undefined;
    const id = requestAnimationFrame(() => setStill(false));
    return () => cancelAnimationFrame(id);
  }, [still]);

  const step = useCallback(
    (by) => {
      if (count < 2 || by === 0) return;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      forward.current = by > 0;

      if (by > 0) {
        // The incoming slat joins the tail before anything moves, so the end
        // of the row is never a slat short.
        setCards((strip) => [
          ...strip,
          ...Array.from({ length: by }, (_, k) => ({ key: seed.current++, slide: wrap(strip[strip.length - 1].slide + 1 + k) })),
        ]);
        columnRef.current -= by;
        setColumn(columnRef.current);
        setSlid((s) => s - by);
      } else {
        // Going back, the strip grows at the front, which shoves everything
        // right. Slide it left by the same amount unseen, then ease home.
        setCards((strip) => [
          ...Array.from({ length: -by }, (_, k) => ({ key: seed.current++, slide: wrap(strip[0].slide - (-by - k)) })),
          ...strip,
        ]);
        setSlid((s) => s + by);
        setStill(true);
        timers.current.push(window.setTimeout(() => setSlid(0), 0));
      }

      timers.current.push(window.setTimeout(settle, ms + 20));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, ms, settle],
  );

  useEffect(() => {
    onIndexChange?.(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* --- autoplay --------------------------------------------------------- */
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!autoplay || paused || reduced || count < 2) return undefined;
    const timer = window.setTimeout(() => step(1), interval);
    return () => clearTimeout(timer);
  }, [autoplay, paused, reduced, count, open, interval, step]);

  const onKeyDown = (event) => {
    const by = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    step(by);
  };

  if (!count) return null;

  const slat = size(slatWidth);
  const shares = hoverGrow && hover >= 0 && hover <= 3 && !reduced ? null : SHARES;
  const shareOf = (col) => (shares ? SHARES[col] : hover === col ? STRETCHED[col] : SQUEEZED[col]);
  const widthOf = (col) => {
    if (col < 0 || col > 3) return slat;
    if (col === 0) return `calc(var(--sq-hero) + var(--sq-room) * ${shareOf(0)})`;
    return `calc(var(--sq-room) * ${shareOf(col)})`;
  };

  const vars = {
    '--sq-h': size(height),
    '--sq-gap': size(gap),
    '--sq-slat-gap': size(slatGap),
    '--sq-radius': size(radius),
    '--sq-ms': `${ms}ms`,
    // A 16:9 block sets both the open card and the size every picture is
    // drawn at, so a picture keeps one scale however narrow its card gets.
    '--sq-hero': 'calc(var(--sq-h) * 16 / 9)',
    '--sq-room': `calc(100cqi - var(--sq-hero) - ${slats} * var(--sq-slat-gap) - 3 * var(--sq-gap) - ${slats} * ${slat})`,
  };

  return (
    <div
      className={['sq', className].filter(Boolean).join(' ')}
      style={{ ...vars, ...style }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        setPaused(false);
        setHover(-1);
      }}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {(head || (controls && count > 1)) && (
        <div className="sq-head">
          {head}
          {controls && count > 1 && (
            <div className="sq-arrows">
              <Arrow back label="Previous photo" onClick={() => step(-1)} />
              <Arrow label="Next photo" onClick={() => step(1)} />
            </div>
          )}
        </div>
      )}

      <div className="sq-viewport">
        <div
          role="tablist"
          aria-label={label}
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
          className="sq-strip"
          style={{
            transform: `translateX(calc(${slid} * (${slat} + var(--sq-gap))))`,
            transition: still ? 'none' : 'transform var(--sq-ms) var(--sq-ease)',
          }}
        >
          {cards.map((card, place) => {
            const col = place + column;
            const slide = slides[card.slide];
            const front = col === 0;
            return (
              <button
                key={card.key}
                type="button"
                role="tab"
                id={`${ids}-tab-${card.key}`}
                aria-selected={front}
                aria-controls={`${ids}-panel`}
                aria-label={slide.title}
                tabIndex={front ? 0 : -1}
                onMouseMove={() => hoverGrow && setHover(col)}
                onClick={() => col > 0 && step(col)}
                className={`sq-card${front ? ' is-front' : ''}`}
                style={{
                  width: widthOf(col),
                  marginLeft: place === 0 ? 0 : col < 4 ? 'var(--sq-gap)' : 'var(--sq-slat-gap)',
                  borderRadius: `min(var(--sq-radius), calc(${widthOf(col)} / 2))`,
                  transitionDuration: still ? '0s' : 'var(--sq-ms)',
                }}
              >
                <Picture slide={slide} />
                {slide.overlay && (
                  <span aria-hidden="true" className="sq-overlay" style={{ opacity: front ? 1 : 0 }}>
                    {slide.overlay}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div id={`${ids}-panel`} role="tabpanel" aria-live="polite" className="sq-copy">
        {slides.map((slide, i) => {
          const shown = i === open;
          return (
            <div
              key={slide.id ?? i}
              aria-hidden={!shown}
              className="sq-copy-item"
              style={{ opacity: shown ? 1 : 0, visibility: shown ? 'visible' : 'hidden', pointerEvents: shown ? 'auto' : 'none' }}
            >
              <p>
                <span className="sq-title">{slide.title}</span>{' '}
                {slide.description && <span className="sq-desc">{slide.description}</span>}
              </p>
              {slide.action && <Action slide={slide} shown={shown} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Drawn at a fixed 16:9 block and centred, never at the width of its card, so
// the picture keeps one scale while the card only changes how much shows.
function Picture({ slide }) {
  if (slide.image) {
    return <img src={slide.image} alt={slide.imageAlt ?? ''} draggable={false} className="sq-picture" />;
  }
  return <span aria-hidden="true" className="sq-picture" style={{ background: slide.background }} />;
}

function Arrow({ back = false, label, onClick }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="sq-arrow">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path
          d={
            back
              ? 'M9.6 2.6 5.1 7.1h9.1v1.8H5.1l4.5 4.5-1.2 1.2-6-6L1.8 8l.6-.6 6-6 1.2 1.2Z'
              : 'M6.4 2.6l4.5 4.5H1.8v1.8h9.1l-4.5 4.5 1.2 1.2 6-6 .6-.6-.6-.6-6-6-1.2 1.2Z'
          }
        />
      </svg>
    </button>
  );
}

function Action({ slide, shown }) {
  const inside = (
    <>
      {slide.action}
      <svg width="6" height="9" viewBox="0 0 6 9" fill="none" aria-hidden="true">
        <path d="M1.2 1 4.7 4.5 1.2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );
  if (slide.href) {
    return (
      <a href={slide.href} target={slide.target} rel={slide.target === '_blank' ? 'noreferrer' : undefined} tabIndex={shown ? 0 : -1} onClick={slide.onAction} className="sq-action">
        {inside}
      </a>
    );
  }
  return (
    <button type="button" tabIndex={shown ? 0 : -1} onClick={slide.onAction} className="sq-action">
      {inside}
    </button>
  );
}
