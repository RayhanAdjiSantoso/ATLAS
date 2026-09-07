import { useState, useMemo } from 'react';
import { formatPercent } from '../../utils/format.js';

// Categorical palette, drawn from the design system's own hues rather than
// the generic blue/green/amber/red run. Two things drive the order:
//
//   1. Red is not in it. On this page red means "worse" — every delta pill,
//      every "Terburuk" line — so spending it on a traffic source called
//      "Lainnya" made a neutral slice read as an alert.
//   2. The accent leads, and the muted slate sits last, which is where the
//      residual "Lainnya" / "Chat" style categories usually land. The biggest
//      share gets the strongest colour by construction.
const COLORS = [
  '#1e3eb8', // accent blue
  '#00a3c2', // cyan
  '#0d9488', // teal
  '#7c3aed', // violet
  '#f5a623', // gold
  '#5a6a90', // slate — the quiet tail
  '#b8c5f5', // pale accent
];

function polarToCartesian(cx, cy, r, angleDeg) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

// Arc path from startAngle to endAngle (degrees, clockwise from 12 o'clock).
// Using an explicit path arc (instead of stroke-dasharray tricks) guarantees
// segments tile the full 360° with no rounding/coverage gaps.
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

export default function DonutChart({ data = [], title = 'Sumber Traffic', onSelectSegment, centerLabel = 'Total Klik', valueFormatter = (v) => new Intl.NumberFormat('id-ID').format(v) }) {
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const radius = 70;
  const strokeWidth = 24;
  const center = 100;

  const { segments, total } = useMemo(() => {
    // Drop only categories with no data at all (null/undefined) -- a
    // category whose value is genuinely 0 is still a valid category (e.g.
    // an Ads sub-source with zero clicks this period) and must still show
    // up in the legend at 0%, not disappear as if it never existed.
    const valid = data.filter((item) => item.value != null);
    const totalVal = valid.reduce((sum, item) => sum + Number(item.value), 0);

    let cumulativeAngle = 0;
    const mappedSegments = valid.map((item, idx) => {
      const val = Number(item.value);
      const percent = totalVal > 0 ? val / totalVal : 0;
      const startAngle = cumulativeAngle;
      const endAngle = cumulativeAngle + percent * 360;
      cumulativeAngle = endAngle;

      return {
        ...item,
        percent,
        startAngle,
        endAngle,
        color: COLORS[idx % COLORS.length]
      };
    });

    return { segments: mappedSegments, total: totalVal };
  }, [data]);

  // A ring is degenerate whenever ONE category holds the entire total, not
  // only when it is the only category listed. Traffic Source [Video] arrives
  // as four categories at 100/0/0/0, so the old `segments.length === 1` guard
  // missed it: the 0deg-to-360deg arc collapsed to a single point and the
  // round line cap drew it as a floating dot beside a legend of zeroes.
  const soleIndex = useMemo(() => {
    const nonZero = segments.filter((sg) => sg.percent > 0);
    if (total > 0 && nonZero.length === 1) return segments.indexOf(nonZero[0]);
    return -1;
  }, [segments, total]);

  const handleSegmentClick = (name) => {
    if (onSelectSegment) {
      onSelectSegment(name);
    }
  };

  if (segments.length === 0) {
    return (
      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '220px', color: 'var(--text-muted)' }}>
        Tidak ada data traffic source
      </div>
    );
  }

  return (
    <div className="card donut-card" style={{ padding: '1.25rem' }}>
      {title && <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>{title}</h3>}

      <div className="donut-layout" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        
        {/* SVG Donut */}
        <div style={{ position: 'relative', width: '200px', height: '200px' }}>
          <svg viewBox="0 0 200 200" width="100%" height="100%">
            {soleIndex >= 0 ? (
              // One category holds the whole total: draw the closed ring.
              <circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={segments[soleIndex].color}
                strokeWidth={hoveredIndex === soleIndex ? strokeWidth + 4 : strokeWidth}
                style={{ cursor: 'pointer', transition: 'stroke-width 0.2s' }}
                onMouseEnter={() => setHoveredIndex(soleIndex)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => handleSegmentClick(segments[soleIndex].name)}
              />
            ) : (
              segments.map((seg, idx) => (
                <path
                  key={idx}
                  d={describeArc(center, center, radius, seg.startAngle, seg.endAngle)}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={hoveredIndex === idx ? strokeWidth + 4 : strokeWidth}
                  strokeLinecap="round"
                  style={{
                    cursor: 'pointer',
                    transition: 'stroke-width 0.2s',
                  }}
                  onMouseEnter={() => setHoveredIndex(idx)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onClick={() => handleSegmentClick(seg.name)}
                />
              ))
            )}
          </svg>

          {/* Center text -- shows the grand total by default; swaps to the
              hovered segment's name + actual value so hovering the chart
              reveals the real number behind the percentage, not just the %. */}
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
            pointerEvents: 'none',
            padding: '0 1.5rem',
          }}>
            {hoveredIndex != null && segments[hoveredIndex] ? (
              <>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={segments[hoveredIndex].name}>
                  {segments[hoveredIndex].name}
                </div>
                <div style={{ fontSize: '1.15rem', fontWeight: '700', color: segments[hoveredIndex].color }}>
                  {valueFormatter(segments[hoveredIndex].value)}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {formatPercent(segments[hoveredIndex].percent * 100)}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{centerLabel}</div>
                <div style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text)' }}>
                  {valueFormatter(total)}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Legend */}
        <div style={{ flex: 1, minWidth: '150px' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {segments.map((seg, idx) => (
              <li 
                key={idx}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  padding: '0.2rem',
                  borderRadius: '4px',
                  background: hoveredIndex === idx ? 'var(--primary-light)' : 'transparent',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => handleSegmentClick(seg.name)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                  <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '3px', background: seg.color, flexShrink: 0 }}></span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: hoveredIndex === idx ? '600' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seg.name}</span>
                </div>
                <strong style={{ color: 'var(--text)', flexShrink: 0, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {hoveredIndex === idx
                    ? `${valueFormatter(seg.value)} · ${formatPercent(seg.percent * 100)}`
                    : formatPercent(seg.percent * 100)}
                </strong>
              </li>
            ))}
          </ul>
        </div>

      </div>
    </div>
  );
}
