import { useEffect, useId, useRef } from 'react';
import { motion, useMotionTemplate, useReducedMotion, useSpring } from 'framer-motion';

// The mil wordmark as a set of windows. Each letter — the m, the i's stem and
// its dot, the l — clips the same photograph, so the carousel is seen through
// the logo rather than beside it. With no photos yet the letters fill with
// the mark's own blue gradient, i.e. the logo itself.
//
// Shapes are traced from the mil half of assets/atlas-wordmark.png.
const LETTERS = [
  { key: 'm', d: 'M23 62 C23 52 31 47 39 53 L76 86 L117 43 C124 36 134 39 134 48 L134 119 C134 121 132 122 130 122 L34 122 C28 122 23 117 23 111 Z' },
  { key: 'i', d: 'M144 69 a17.5 17.5 0 0 1 35 0 L179 120 a2 2 0 0 1 -2 2 L146 122 a2 2 0 0 1 -2 -2 Z' },
  { key: 'dot', d: 'M146.5 26 a16 16 0 1 0 32 0 a16 16 0 1 0 -32 0 Z' },
  { key: 'l', d: 'M189 22 a16.5 16.5 0 0 1 33 0 L222 95 a27 27 0 0 1 -27 27 L191 122 a2 2 0 0 1 -2 -2 Z' },
];
const VIEW = { x: 20, y: 3, w: 205, h: 121 };
// The photo is drawn a little larger than the frame so the parallax drift
// never shows its edge.
const BLEED = 8;

export function MilWindow({ photos, active, label }) {
  const uid = useId().replace(/:/g, '');
  const reduce = useReducedMotion();
  const ref = useRef(null);
  // Looking through a window: the photo drifts a few units against the
  // pointer, on a spring so it settles rather than snapping.
  const x = useSpring(0, { stiffness: 90, damping: 18, mass: 0.6 });
  const y = useSpring(0, { stiffness: 90, damping: 18, mass: 0.6 });
  const shift = useMotionTemplate`translate(${x}px, ${y}px)`;

  useEffect(() => {
    const el = ref.current;
    if (!el || reduce || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined;
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      x.set(((e.clientX - r.left) / r.width - 0.5) * -BLEED * 1.4);
      y.set(((e.clientY - r.top) / r.height - 0.5) * -BLEED * 1.1);
    };
    const onLeave = () => {
      x.set(0);
      y.set(0);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [reduce, x, y]);

  return (
    <svg
      ref={ref}
      className="lp-window"
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0B8DF6" />
          <stop offset="1" stopColor="#0040DF" />
        </linearGradient>
        <linearGradient id={`${uid}-tint`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0B8DF6" stopOpacity=".28" />
          <stop offset=".55" stopColor="#0040DF" stopOpacity="0" />
          <stop offset="1" stopColor="#0040DF" stopOpacity=".34" />
        </linearGradient>
        {LETTERS.map((l) => (
          <clipPath key={l.key} id={`${uid}-${l.key}`}>
            <path d={l.d} />
          </clipPath>
        ))}
      </defs>

      {LETTERS.map((l, i) => (
        <g key={l.key} className={`lp-letter lp-letter-${l.key}`} style={{ '--i': i }}>
          <g clipPath={`url(#${uid}-${l.key})`}>
            <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} fill={`url(#${uid}-g)`} />
            {photos.length > 0 && (
              <motion.g style={{ transform: shift }}>
                {photos.map((p, n) => (
                  <image
                    key={p.id}
                    className={`lp-ph${n === active ? ' is-on' : ''}`}
                    href={p.url}
                    x={VIEW.x - BLEED}
                    y={VIEW.y - BLEED}
                    width={VIEW.w + BLEED * 2}
                    height={VIEW.h + BLEED * 2}
                    preserveAspectRatio="xMidYMid slice"
                  />
                ))}
              </motion.g>
            )}
            {photos.length > 0 && <rect x={VIEW.x} y={VIEW.y} width={VIEW.w} height={VIEW.h} fill={`url(#${uid}-tint)`} style={{ mixBlendMode: 'multiply' }} />}
          </g>
        </g>
      ))}
    </svg>
  );
}
