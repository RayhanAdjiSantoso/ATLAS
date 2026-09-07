import { useState } from 'react';
import { formatPercent } from '../../utils/format.js';

// Same order as MultiLineTrend so a kategori keeps its colour across charts.
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b'];

// Stacked 100% area — each month normalised so the SHIFT in composition
// reads, not the totals. `data` = [{ period, <seriesA>: n|null, ... }].
// A month with no data for any series is skipped (gap), never drawn as 0.
export default function StackedShareArea({ data = [], series = [], title, subtitle }) {
  const [hover, setHover] = useState(null);

  const W = 900;
  const H = 300;
  const pad = { l: 44, r: 16, t: 16, b: 40 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  // months where at least one series has a value
  const months = data
    .map((row, i) => ({ row, i, total: series.reduce((a, s) => a + (row[s] ?? 0), 0) }))
    .filter((m) => m.total > 0);

  const n = data.length || 1;
  const x = (i) => pad.l + (n === 1 ? cw / 2 : (i / (n - 1)) * cw);
  const y = (frac) => pad.t + ch - frac * ch;

  // cumulative share bands per month
  const bands = series.map((s, si) => {
    const pts = months.map((m) => {
      const below = series.slice(0, si).reduce((a, k) => a + (m.row[k] ?? 0), 0);
      const val = m.row[s] ?? 0;
      return {
        x: x(m.i),
        yTop: y((below + val) / m.total),
        yBot: y(below / m.total),
      };
    });
    return { s, si, pts };
  });

  const areaPath = (pts) => {
    if (!pts.length) return '';
    const top = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yTop}`).join(' ');
    const bot = [...pts].reverse().map((p) => `L ${p.x} ${p.yBot}`).join(' ');
    return `${top} ${bot} Z`;
  };

  const hasData = months.length > 0;

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      {title && <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{title}</h3>}
      {subtitle && <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>{subtitle}</p>}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
        {series.map((s, i) => (
          <span key={s}><span style={{ display: 'inline-block', width: 10, height: 10, background: COLORS[i % COLORS.length], borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />{s}</span>
        ))}
      </div>
      {!hasData ? (
        <div className="empty-state">Belum ada data.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520 }}>
            {[0, 0.25, 0.5, 0.75, 1].map((r) => (
              <g key={r}>
                <line x1={pad.l} y1={y(r)} x2={W - pad.r} y2={y(r)} stroke="var(--border)" strokeDasharray="4,4" />
                <text x={pad.l - 6} y={y(r) + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{r * 100}%</text>
              </g>
            ))}
            {bands.map((b) => (
              <path key={b.s} d={areaPath(b.pts)} fill={COLORS[b.si % COLORS.length]} fillOpacity={hover == null || hover === b.si ? 0.85 : 0.35}
                stroke="var(--bg)" strokeWidth="1"
                onMouseEnter={() => setHover(b.si)} onMouseLeave={() => setHover(null)} />
            ))}
            {months.map((m) => (
              (m.i % 2 === 0 || months.length <= 7) && (
                <text key={m.i} x={x(m.i)} y={H - pad.b + 16} textAnchor="middle" fontSize="9" fill="var(--text-muted)"
                  transform={`rotate(35 ${x(m.i)} ${H - pad.b + 16})`}>{m.row.period.slice(2)}</text>
              )
            ))}
            {hover != null && months.length > 0 && (() => {
              const last = months[months.length - 1];
              const s = series[hover];
              return (
                <text x={pad.l} y={pad.t - 4} fontSize="11" fill="var(--text-muted)">
                  {s} · {last.row.period}: {formatPercent(((last.row[s] ?? 0) / last.total) * 100, 1)}
                </text>
              );
            })()}
          </svg>
        </div>
      )}
    </div>
  );
}
