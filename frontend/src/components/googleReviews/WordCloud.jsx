import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SENTIMENT } from './charts.jsx';

// Google Reviews › the words customers use, sized by how many reviews use
// them. Laid out here rather than by a library: each word, largest first,
// walks out along a spiral from the centre until its box touches nothing
// already placed. Size is proportional to √count so the biggest word does not
// swallow the rest; a word that cannot find room is left out (and counted).
//
// In the overall cloud a word's colour says which way the reviews using it
// lean; in the positive and negative clouds every word is that sentiment.

const FONT = "'Inter', system-ui, sans-serif";
const PAD = 3;

let measureCtx = null;
function measure(text, size, weight) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  return measureCtx.measureText(text).width;
}

function lean(w) {
  const total = w.positive + w.neutral + w.negative;
  if (!total) return '#1e3eb8';
  if (w.positive / total >= 0.6) return SENTIMENT.positive.color;
  if (w.negative / total >= 0.4) return SENTIMENT.negative.color;
  return '#1e3eb8';
}

function layout(words, width, height, mode) {
  if (!words.length || width < 50) return { placed: [], dropped: 0 };
  const counts = words.map((w) => w.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const small = width < 520;
  const minSize = small ? 11 : 13;
  const maxSize = Math.min(small ? 30 : 46, Math.max(minSize + 6, width / 9));
  const placed = [];
  let dropped = 0;
  const cx = width / 2;
  const cy = height / 2;
  const hit = (a, b) => !(a.x + a.w + PAD < b.x || b.x + b.w + PAD < a.x || a.y + a.h + PAD < b.y || b.y + b.h + PAD < a.y);

  for (const w of words) {
    const t = max === min ? 0.5 : Math.sqrt((w.count - min) / (max - min));
    const size = Math.round(minSize + t * (maxSize - minSize));
    const weight = t > 0.5 ? 800 : t > 0.2 ? 700 : 600;
    const bw = measure(w.term, size, weight);
    const bh = size * 1.05;
    if (bw > width - 8) { dropped += 1; continue; }
    let spot = null;
    // Elliptical spiral: the box is wider than tall, so is the walk.
    for (let i = 0; i < 1600 && !spot; i += 1) {
      const a = i * 0.32;
      const r = 1.6 * a;
      const x = cx + r * Math.cos(a) * (width / height) * 0.9 - bw / 2;
      const y = cy + r * Math.sin(a) - bh / 2;
      if (x < 2 || y < 2 || x + bw > width - 2 || y + bh > height - 2) continue;
      const box = { x, y, w: bw, h: bh };
      if (!placed.some((p) => hit(box, p))) spot = box;
    }
    if (!spot) { dropped += 1; continue; }
    placed.push({ ...spot, word: w, size, weight, color: mode === 'overall' ? lean(w) : SENTIMENT[mode].color });
  }
  return { placed, dropped };
}

export default function WordCloud({ words, mode, onPick, activeTerm }) {
  const boxRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);
  const height = width && width < 520 ? 300 : 360;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Inter may still be loading on first paint; measure again once it is in.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFontsReady(true));
    return () => { live = false; };
  }, []);

  const { placed, dropped } = useMemo(() => layout(words, width, height, mode), [words, width, height, mode, fontsReady]);

  return (
    <div className="gr-cloud" ref={boxRef} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="list" aria-label="Word cloud">
          {placed.map((p) => {
            const active = activeTerm === p.word.term;
            return (
              <text
                key={p.word.term}
                role="listitem"
                tabIndex={0}
                x={p.x}
                y={p.y + p.h * 0.8}
                fill={p.color}
                opacity={activeTerm && !active ? 0.35 : 1}
                style={{ font: `${p.weight} ${p.size}px ${FONT}`, cursor: 'pointer', outline: 'none' }}
                textDecoration={active ? 'underline' : undefined}
                aria-label={`${p.word.term}: ${p.word.count} ulasan. Tekan untuk melihat ulasannya.`}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(p)}
                onBlur={() => setHover(null)}
                onClick={() => onPick?.(p.word.term)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(p.word.term); } }}
              >
                {p.word.term}
              </text>
            );
          })}
        </svg>
      )}
      {hover && (
        <div
          className="gr-cloud-tip"
          style={{ left: Math.min(Math.max(hover.x + hover.w / 2, 90), width - 90), top: Math.max(hover.y - 8, 0) }}
          role="tooltip"
        >
          <strong>{hover.word.term}</strong>
          <span>{hover.word.count.toLocaleString('id-ID')} ulasan menyebut ini</span>
          <span className="gr-cloud-tip-split">
            <i style={{ background: SENTIMENT.positive.color }} />{hover.word.positive}
            <i style={{ background: SENTIMENT.neutral.color }} />{hover.word.neutral}
            <i style={{ background: SENTIMENT.negative.color }} />{hover.word.negative}
          </span>
        </div>
      )}
      {dropped > 0 && <p className="gr-cloud-note">{dropped} kata/frasa lain tidak muat di area ini.</p>}
    </div>
  );
}
