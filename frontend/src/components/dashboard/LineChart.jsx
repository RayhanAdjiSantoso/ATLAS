import { useState, useMemo } from 'react';
import { Info } from 'lucide-react';

// Bright yellow for the "poor performing" (below-average) tier -- distinct
// from the design system's --warning token (a muted amber meant for
// text-on-light-background readability). Same value duplicated in
// DashboardTab.jsx and CalendarHeatmap.jsx.
const POOR_PERFORMING_COLOR = '#eab308';
const POOR_PERFORMING_BG = '#fef08a';

// Rounds a number to a "nice" value (1/2/5/10 x 10^n) for clean axis steps,
// d3-style. `round` picks the nearest nice fraction instead of rounding up.
function niceNum(range, round) {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

// Adaptive Y-axis domain: zooms into the data's actual min/max (with
// proportional padding) instead of always starting at 0, so small
// fluctuations in a narrow-range series stay readable.
function computeYDomain(vals) {
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const rawRange = rawMax - rawMin;
  const magnitude = Math.max(Math.abs(rawMax), Math.abs(rawMin));

  // Near-flat series (all values equal/close): use a small range around the
  // value instead of 0 so the line isn't rendered with no visual context.
  const effectiveRange = rawRange > magnitude * 0.001
    ? rawRange
    : (magnitude > 0 ? magnitude * 0.1 : 10);

  const padding = effectiveRange * 0.15;
  let paddedMin = rawMin - padding;
  const paddedMax = rawMax + padding;

  // These series can't go negative unless the data itself does — don't let
  // padding push the floor below 0 for an all-non-negative series.
  if (rawMin >= 0 && paddedMin < 0) paddedMin = 0;

  // Metrics here (currency, counts) are always whole numbers, so never
  // produce a fractional step.
  const step = Math.max(niceNum((paddedMax - paddedMin) / 4, true), 1);
  const min = Math.floor(paddedMin / step) * step;
  const max = Math.ceil(paddedMax / step) * step;

  return { min, max, step };
}

const EMPTY_SET = new Set();

export default function LineChart({ data = [], metric = 'gmv', title = 'Tren', onSelectDate, bestDates = EMPTY_SET, worstDates = EMPTY_SET, poorDates = EMPTY_SET, note = null }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const width = 600;
  const height = 280;
  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 30;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Compute adaptive min/max domain, point coordinates, and Y-axis ticks
  const { points, xCoords, yCoords, domainMin, domainMax, yTicks } = useMemo(() => {
    if (data.length === 0) return { points: [], xCoords: [], yCoords: [], domainMin: 0, domainMax: 1, yTicks: [] };

    const vals = data.map(d => Number(d[metric] || 0));
    const { min: domainMin, max: domainMax, step } = computeYDomain(vals);
    const domainRange = domainMax - domainMin;

    const xCoords = data.map((_, i) => {
      if (data.length <= 1) return paddingLeft + chartWidth / 2;
      return paddingLeft + (i / (data.length - 1)) * chartWidth;
    });

    const yCoords = vals.map(v => {
      const ratio = domainRange > 0 ? (v - domainMin) / domainRange : 0.5;
      return paddingTop + chartHeight * (1 - ratio);
    });

    const points = data.map((d, i) => ({
      x: xCoords[i],
      y: yCoords[i],
      value: vals[i],
      raw: d,
      index: i
    }));

    const tickCount = Math.max(1, Math.round(domainRange / step));
    const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => domainMin + i * step);

    return { points, xCoords, yCoords, domainMin, domainMax, yTicks };
  }, [data, metric]);

  const pathD = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, p, i) => {
      return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');
  }, [points]);

  const areaD = useMemo(() => {
    if (points.length === 0) return '';
    const bottomY = paddingTop + chartHeight;
    const startX = points[0].x;
    const endX = points[points.length - 1].x;
    return `${pathD} L ${endX} ${bottomY} L ${startX} ${bottomY} Z`;
  }, [points, pathD]);

  const formatYAxis = (val) => {
    if (val >= 1000000000) return `${(val / 1000000000).toFixed(1)}M`;
    if (val >= 1000000) return `${(val / 1000000).toFixed(1)}jt`;
    if (val >= 1000) return `${(val / 1000).toFixed(0)}rb`;
    return val;
  };

  const getMetricLabel = (val) => {
    if (metric === 'gmv' || metric === 'aov') {
      return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
    }
    return new Intl.NumberFormat('id-ID').format(val);
  };

  const handlePointClick = (raw) => {
    if (onSelectDate && raw.date) {
      onSelectDate(raw.date);
    }
  };

  // Select up to 5 evenly-spaced labels along X-axis (always including the
  // last data point, e.g. the end of the month) without crowding two labels
  // together at the end.
  const xLabelsIndices = useMemo(() => {
    const n = data.length;
    if (n <= 5) return data.map((_, i) => i);
    const numLabels = 5;
    const step = (n - 1) / (numLabels - 1);
    const indices = Array.from({ length: numLabels }, (_, i) => Math.round(i * step));
    return [...new Set(indices)];
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="card" style={{ height: `${height}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Belum ada data untuk grafik
      </div>
    );
  }

  return (
    <div className="card chart-card" style={{ padding: '1.25rem', position: 'relative' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        {title}
        {note && (
          <span title={note} style={{ display: 'inline-flex', color: 'var(--text-muted)', cursor: 'help' }}>
            <Info size={13} />
          </span>
        )}
      </h3>

      <div style={{ position: 'relative', width: '100%', height: `${height}px` }}>
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%">
          <defs>
            <linearGradient id={`line-grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="1" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="1" />
            </linearGradient>
            <linearGradient id={`area-grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid lines & Y Axis labels */}
          {yTicks.map((gridVal, i) => {
            const domainRange = domainMax - domainMin;
            const ratio = domainRange > 0 ? 1 - (gridVal - domainMin) / domainRange : 0.5;
            const y = paddingTop + chartHeight * ratio;
            return (
              <g key={i}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth="1"
                  strokeDasharray="4,4"
                />
                <text
                  x={paddingLeft - 10}
                  y={y + 4}
                  textAnchor="end"
                  fill="var(--text-muted)"
                  fontSize="0.75rem"
                >
                  {formatYAxis(gridVal)}
                </text>
              </g>
            );
          })}

          {/* Area under the line */}
          <path d={areaD} fill={`url(#area-grad-${metric})`} />

          {/* Line path */}
          <path
            d={pathD}
            fill="none"
            stroke={`url(#line-grad-${metric})`}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* X Axis labels */}
          {xLabelsIndices.map((idx) => {
            const x = xCoords[idx];
            const dateStr = data[idx].date; // e.g. "2026-06-01"
            const label = dateStr ? dateStr.slice(8, 10) + '/' + dateStr.slice(5, 7) : '';
            return (
              <text
                key={idx}
                x={x}
                y={height - 15}
                textAnchor="middle"
                fill="var(--text-muted)"
                fontSize="0.75rem"
              >
                {label}
              </text>
            );
          })}

          {/* Hover highlight line */}
          {hoveredIndex !== null && points[hoveredIndex] && (
            <line
              x1={points[hoveredIndex].x}
              y1={paddingTop}
              x2={points[hoveredIndex].x}
              y2={paddingTop + chartHeight}
              stroke="var(--primary)"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
          )}

          {/* Interactive dots */}
          {points.map((p, i) => {
            const isBest = bestDates.has(p.raw.date);
            const isWorst = worstDates.has(p.raw.date);
            // "Poor performing" (relatively below this period's own average)
            // gets its own bright-yellow tier, distinct from the single
            // worst day's danger (red) -- worst wins if a day is both.
            const isPoor = !isBest && !isWorst && poorDates.has(p.raw.date);
            const dotFill = isBest ? 'var(--success-bg)' : isWorst ? 'var(--danger-bg)' : isPoor ? POOR_PERFORMING_BG : 'var(--bg-card)';
            const dotStroke = isBest ? 'var(--success)' : isWorst ? 'var(--danger)' : isPoor ? POOR_PERFORMING_COLOR : 'var(--primary)';
            const baseRadius = isBest || isWorst ? 6 : isPoor ? 5 : 4.5;
            return (
              <g key={i}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={hoveredIndex === i ? baseRadius + 2.5 : baseRadius}
                  fill={dotFill}
                  stroke={dotStroke}
                  strokeWidth="2.5"
                  style={{ cursor: 'pointer', transition: 'r 0.15s' }}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => handlePointClick(p.raw)}
                />
              </g>
            );
          })}
        </svg>

        {/* Floating Tooltip */}
        {hoveredIndex !== null && points[hoveredIndex] && (
          <div
            style={{
              position: 'absolute',
              left: `${(points[hoveredIndex].x / width) * 100}%`,
              top: `${(points[hoveredIndex].y / height) * 100 - 15}%`,
              transform: 'translate(-50%, -100%)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.4rem 0.75rem',
              pointerEvents: 'none',
              boxShadow: 'var(--shadow)',
              fontSize: '0.8rem',
              zIndex: 10,
              whiteSpace: 'nowrap',
              color: 'var(--text)'
            }}
          >
            <strong>{data[hoveredIndex].date}</strong>
            <br />
            {metric.toUpperCase()}: {getMetricLabel(data[hoveredIndex][metric])}
            {bestDates.has(data[hoveredIndex].date) && (
              <div style={{ color: 'var(--success)', fontWeight: 600, marginTop: '0.2rem' }}>Performa terbaik</div>
            )}
            {worstDates.has(data[hoveredIndex].date) && (
              <div style={{ color: 'var(--danger)', fontWeight: 600, marginTop: '0.2rem' }}>Performa terburuk</div>
            )}
            {!worstDates.has(data[hoveredIndex].date) && !bestDates.has(data[hoveredIndex].date) && poorDates.has(data[hoveredIndex].date) && (
              <div style={{ color: POOR_PERFORMING_COLOR, fontWeight: 600, marginTop: '0.2rem' }}>Di bawah rata-rata periode ini</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
