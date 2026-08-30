import { ArrowUp, ArrowDown, Info } from 'lucide-react';
import { formatPercent } from '../../utils/format.js';

// Tiny inline trend line for a KPI card -- purely presentational (no axes,
// no tooltip). Takes a plain array of numbers so callers can pass an
// already-fetched trend series (e.g. Executive Snapshot's daily GMV) instead
// of the card firing its own query.
function Sparkline({ values = [] }) {
  if (values.length < 2) return null;
  const width = 100;
  const height = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = range > 0 ? height - ((v - min) / range) * height : height / 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: 'block', marginTop: '0.6rem' }}>
      <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function KpiCard({ title, value, type = 'number', growth = null, note = null, sparkline = null, invert = false }) {
  const formatValue = (val, t) => {
    if (val == null) return '-';

    switch (t) {
      case 'currency':
        return new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR',
          maximumFractionDigits: 0
        }).format(val);
      case 'percentage':
        return formatPercent(val * 100, 2);
      case 'number':
      default:
        return new Intl.NumberFormat('id-ID').format(val);
    }
  };

  // Arrow always reflects the actual numeric direction of `growth`. Color
  // (good/bad) follows business meaning instead: for `invert` metrics (e.g.
  // Cancellation Rate, where a rise is a bad outcome), tone flips relative
  // to the raw sign.
  const isRising = growth >= 0;
  const isPositiveTone = invert ? !isRising : isRising;

  return (
    <div className="card stat-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div className="label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{title}</span>
          {note && (
            <span title={note} style={{ display: 'inline-flex', color: 'var(--text-muted)', cursor: 'help' }}>
              <Info size={14} />
            </span>
          )}
        </div>
        <div className="value" style={{ marginTop: '0.5rem', wordBreak: 'break-all' }}>
          {formatValue(value, type)}
        </div>
        {sparkline && <Sparkline values={sparkline} />}
      </div>

      {growth !== null && (
        <div 
          className="growth" 
          style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '0.25rem', 
            marginTop: '0.75rem', 
            fontSize: '0.85rem',
            fontWeight: '600',
            color: isPositiveTone ? 'var(--success)' : 'var(--danger)',
            background: isPositiveTone ? 'var(--success-bg)' : 'var(--danger-bg)',
            padding: '0.2rem 0.5rem',
            borderRadius: '999px',
            alignSelf: 'flex-start'
          }}
        >
          {isRising ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          <span>{formatPercent(Math.abs(growth), 1)} vs periode lalu</span>
        </div>
      )}
    </div>
  );
}
