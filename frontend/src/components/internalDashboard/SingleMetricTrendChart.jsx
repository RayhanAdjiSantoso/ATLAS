import { useState } from 'react';

const shortMoney = (v) => {
  if (v == null) return '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}M`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}jt`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}rb`;
  return `${Math.round(v)}`;
};
const money = (v) => (v == null ? 'N/A' : `Rp${new Intl.NumberFormat('id-ID').format(Math.round(v))}`);

// One metric, ONE Y axis. Deliberately single-series — the mockup's chart
// engine forbids dual-axis ("Semua chart satu sumbu Y"), so Sales and Ad
// Spend each get their own chart instead of sharing one with two scales.
// `kind` = 'bar' | 'line'. Months with no data render as a gap, never 0.
export default function SingleMetricTrendChart({
  trend = [], metricKey, title, color = 'var(--primary)', kind = 'bar', valueFormatter = money,
}) {
  const [hover, setHover] = useState(null);

  const W = 900;
  const H = 300;
  const pad = { l: 64, r: 20, t: 20, b: 46 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const rows = trend.map((t) => ({ period: t.period, value: t[metricKey] }));
  const vals = rows.map((r) => r.value).filter((v) => v != null);
  const max = Math.max(1, ...vals);

  const n = rows.length || 1;
  const slot = cw / n;
  const barW = slot * 0.55;
  const x = (i) => pad.l + slot * i + slot / 2;
  const y = (v) => pad.t + ch - (v / max) * ch;

  const linePts = rows
    .map((r, i) => (r.value != null ? { i, x: x(i), y: y(r.value) } : null))
    .filter(Boolean);
  const linePath = linePts.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '');

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{title}</h3>
      {vals.length === 0 ? (
        <div className="empty-state">Belum ada data untuk rentang ini.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520 }}>
            {[0, 0.25, 0.5, 0.75, 1].map((r) => {
              const yy = pad.t + ch * (1 - r);
              return (
                <g key={r}>
                  <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke="var(--border)" strokeDasharray="4,4" />
                  <text x={pad.l - 8} y={yy + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{shortMoney(max * r)}</text>
                </g>
              );
            })}

            {rows.map((r, i) => (
              <g key={r.period} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {kind === 'bar' && r.value != null && (
                  <rect x={x(i) - barW / 2} y={y(r.value)} width={barW} height={pad.t + ch - y(r.value)}
                    fill={color} opacity={hover == null || hover === i ? 1 : 0.4} />
                )}
                <text x={x(i)} y={H - pad.b + 16} textAnchor="middle" fontSize="9" fill="var(--text-muted)"
                  transform={`rotate(35 ${x(i)} ${H - pad.b + 16})`}>{r.period.slice(2)}</text>
              </g>
            ))}

            {kind === 'line' && linePath && <path d={linePath} fill="none" stroke={color} strokeWidth="2" />}
            {kind === 'line' && linePts.map((p) => <circle key={p.i} cx={p.x} cy={p.y} r="3" fill={color} />)}

            {hover != null && rows[hover].value != null && (
              <text x={pad.l} y={pad.t - 6} fontSize="11" fill="var(--text-muted)">
                {rows[hover].period}: {valueFormatter(rows[hover].value)}
              </text>
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
