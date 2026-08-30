import { useMemo, useState } from 'react';
import { formatPercent } from '../../utils/format.js';

const currencyFmt = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function truncateLabel(name, max = 18) {
  if (!name) return '';
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

// Pareto chart: bars = per-product revenue (left axis), line = cumulative
// contribution % (right axis), dashed reference at 80% — same layout as the
// notebook's plot_pareto_kontribusi() (matplotlib twin-axis bar + line).
export default function ParetoChart({ data = [], title = 'Pareto Chart — Top 10 Kontribusi Penjualan Produk' }) {
  const [hovered, setHovered] = useState(null);

  const width = 900;
  const height = 440;
  const paddingLeft = 80;
  const paddingRight = 60;
  const paddingTop = 30;
  const paddingBottom = 110;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const { bars, linePoints, maxRevenue } = useMemo(() => {
    if (data.length === 0) return { bars: [], linePoints: [], maxRevenue: 0 };
    const maxRevenue = Math.max(...data.map(d => d.revenue), 1);
    const n = data.length;
    const slot = chartWidth / n;
    const barWidth = slot * 0.6;

    const bars = data.map((d, i) => {
      const cx = paddingLeft + slot * i + slot / 2;
      const barHeight = (d.revenue / maxRevenue) * chartHeight;
      return {
        ...d,
        x: cx - barWidth / 2,
        y: paddingTop + chartHeight - barHeight,
        width: barWidth,
        height: barHeight,
        cx
      };
    });

    const linePoints = data.map((d, i) => {
      const cx = paddingLeft + slot * i + slot / 2;
      const ratio = Math.min(d.cumulativePct, 110) / 110;
      const cy = paddingTop + chartHeight * (1 - ratio);
      return { ...d, x: cx, y: cy };
    });

    return { bars, linePoints, maxRevenue };
  }, [data]);

  const linePathD = useMemo(() => {
    if (linePoints.length === 0) return '';
    return linePoints.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '');
  }, [linePoints]);

  const ref80Y = paddingTop + chartHeight * (1 - 80 / 110);

  const formatRevenueAxis = (val) => {
    if (val >= 1000000000) return `Rp${(val / 1000000000).toFixed(1)}M`;
    if (val >= 1000000) return `Rp${(val / 1000000).toFixed(1)}jt`;
    if (val >= 1000) return `Rp${(val / 1000).toFixed(0)}rb`;
    return `Rp${val}`;
  };

  if (data.length === 0) {
    return (
      <div className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--text-muted)' }}>
        Belum ada data penjualan produk untuk periode ini
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: '1.25rem', position: 'relative' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem', color: 'var(--text)' }}>{title}</h3>
      <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#C44E52', marginRight: '4px', borderRadius: '2px' }} />Penjualan Produk (IDR)</span>
        <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#4C72B0', marginRight: '4px', borderRadius: '50%' }} />Persentase Kumulatif</span>
        <span><span style={{ display: 'inline-block', width: '10px', height: '2px', background: '#9CA3AF', marginRight: '4px', verticalAlign: 'middle' }} />Garis Referensi 80%</span>
      </div>

      <div style={{ position: 'relative', width: '100%', height: `${height}px` }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
          {/* Left axis (revenue) grid + labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = paddingTop + chartHeight * (1 - ratio);
            return (
              <g key={i}>
                <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="4,4" />
                <text x={paddingLeft - 10} y={y + 4} textAnchor="end" fill="#C44E52" fontSize="0.7rem">
                  {formatRevenueAxis(maxRevenue * ratio)}
                </text>
              </g>
            );
          })}

          {/* Right axis (cumulative %) labels */}
          {[0, 20, 40, 60, 80, 100].map((pct, i) => {
            const y = paddingTop + chartHeight * (1 - pct / 110);
            return (
              <text key={i} x={width - paddingRight + 10} y={y + 4} textAnchor="start" fill="#4C72B0" fontSize="0.7rem">
                {pct}%
              </text>
            );
          })}

          {/* 80% reference line */}
          <line x1={paddingLeft} y1={ref80Y} x2={width - paddingRight} y2={ref80Y} stroke="#9CA3AF" strokeWidth="1.5" strokeDasharray="6,4" />

          {/* Bars */}
          {bars.map((b, i) => (
            <rect
              key={i}
              x={b.x}
              y={b.y}
              width={b.width}
              height={Math.max(b.height, 0)}
              fill="#C44E52"
              opacity={hovered === i ? 1 : 0.85}
              rx="2"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
            />
          ))}

          {/* Cumulative % line */}
          <path d={linePathD} fill="none" stroke="#4C72B0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {linePoints.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={hovered === i ? 6 : 4}
              fill="#4C72B0"
              stroke="white"
              strokeWidth="1.5"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
            />
          ))}

          {/* X axis labels */}
          {bars.map((b, i) => (
            <text
              key={i}
              x={b.cx}
              y={paddingTop + chartHeight + 16}
              textAnchor="end"
              fill="var(--text-muted)"
              fontSize="0.7rem"
              transform={`rotate(-30 ${b.cx} ${paddingTop + chartHeight + 16})`}
            >
              <title>{b.label}</title>
              {truncateLabel(b.label)}
            </text>
          ))}
        </svg>

        {(hovered !== null && (bars[hovered] || linePoints[hovered])) && (
          <div
            style={{
              position: 'absolute',
              left: `${((bars[hovered]?.cx ?? 0) / width) * 100}%`,
              top: `${((bars[hovered]?.y ?? linePoints[hovered]?.y ?? 0) / height) * 100}%`,
              transform: 'translate(-50%, -110%)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.4rem 0.75rem',
              pointerEvents: 'none',
              boxShadow: 'var(--shadow)',
              fontSize: '0.75rem',
              zIndex: 10,
              whiteSpace: 'nowrap',
              color: 'var(--text)'
            }}
          >
            <strong>{data[hovered].label}</strong>
            <br />
            Penjualan: {currencyFmt.format(data[hovered].revenue)}
            <br />
            Kontribusi: {formatPercent(data[hovered].contributionPct, 2)}
            <br />
            Kumulatif: {formatPercent(data[hovered].cumulativePct)}
          </div>
        )}
      </div>
    </div>
  );
}
