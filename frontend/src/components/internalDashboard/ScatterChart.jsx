import { useState } from 'react';

// Generic bubble scatter. points: [{ x, y, size?, color?, label, meta? }].
// `xIsPct` / `yIsPct` format the axis ticks & tooltip as percentages.
// `quadrants` draws reference lines at x=0 / y=0.
export default function ScatterChart({
  points = [], title, xLabel, yLabel, xIsPct = false, yIsPct = false, quadrants = false,
}) {
  const [hover, setHover] = useState(null);

  const W = 720;
  const H = 420;
  const pad = { l: 64, r: 20, t: 20, b: 52 };
  const cw = W - pad.l - pad.r;
  const chh = H - pad.t - pad.b;

  if (points.length === 0) {
    return (
      <div className="card" style={{ padding: '1.25rem' }}>
        {title && <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{title}</h3>}
        <div className="empty-state">Belum ada data.</div>
      </div>
    );
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad10 = (lo, hi) => { const d = (hi - lo) || Math.abs(hi) || 1; return [lo - d * 0.1, hi + d * 0.1]; };
  const [x0, x1] = pad10(Math.min(...xs, quadrants ? 0 : Infinity), Math.max(...xs, quadrants ? 0 : -Infinity));
  const [y0, y1] = pad10(Math.min(...ys, quadrants ? 0 : Infinity), Math.max(...ys, quadrants ? 0 : -Infinity));

  const sx = (v) => pad.l + ((v - x0) / (x1 - x0)) * cw;
  const sy = (v) => pad.t + chh - ((v - y0) / (y1 - y0)) * chh;

  const sizes = points.map((p) => p.size).filter((s) => s != null && s > 0);
  const maxSize = Math.max(1, ...sizes);
  const r = (s) => (s == null || s <= 0 ? 4 : 4 + Math.sqrt(s / maxSize) * 16);

  const fmt = (v, isPct) => (isPct ? `${(v * 100).toFixed(1)}%` : new Intl.NumberFormat('id-ID').format(Math.round(v)));

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      {title && <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{title}</h3>}
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 480 }}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const gy = pad.t + chh * t;
            const gx = pad.l + cw * t;
            return (
              <g key={t}>
                <line x1={pad.l} y1={gy} x2={W - pad.r} y2={gy} stroke="var(--border)" strokeDasharray="3,3" />
                <text x={pad.l - 8} y={gy + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{fmt(y1 - (y1 - y0) * t, yIsPct)}</text>
                <text x={gx} y={H - pad.b + 16} textAnchor="middle" fontSize="10" fill="var(--text-muted)">{fmt(x0 + (x1 - x0) * t, xIsPct)}</text>
              </g>
            );
          })}
          {quadrants && (
            <>
              {x0 < 0 && x1 > 0 && <line x1={sx(0)} y1={pad.t} x2={sx(0)} y2={pad.t + chh} stroke="var(--text-muted)" strokeWidth="1" />}
              {y0 < 0 && y1 > 0 && <line x1={pad.l} y1={sy(0)} x2={W - pad.r} y2={sy(0)} stroke="var(--text-muted)" strokeWidth="1" />}
            </>
          )}
          {points.map((p, i) => (
            <circle key={p.label + i} cx={sx(p.x)} cy={sy(p.y)} r={r(p.size)}
              fill={p.color || 'var(--primary)'} fillOpacity={hover === i ? 0.9 : 0.55}
              stroke={p.color || 'var(--primary)'} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
          <text x={pad.l} y={H - 6} fontSize="10" fill="var(--text-muted)">{xLabel}</text>
          <text x={12} y={pad.t + 4} fontSize="10" fill="var(--text-muted)" transform={`rotate(-90 12 ${pad.t + 4})`}>{yLabel}</text>
          {hover != null && (
            <text x={pad.l} y={pad.t - 6} fontSize="11" fill="var(--text)">
              {points[hover].label}: {xLabel} {fmt(points[hover].x, xIsPct)} · {yLabel} {fmt(points[hover].y, yIsPct)}
              {points[hover].size != null ? ` · ${fmt(points[hover].size, false)}` : ''}
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
