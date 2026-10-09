import { useState } from 'react';
import { fmtRp, fmtRpShort, fmtPct } from '../../dailyTracking/lib/summary.js';
import { daySeries, isWeekend, todayIso, WEEKDAYS, weekday } from '../../dailyTracking/lib/daily.js';

// The month as it happened, day by day: revenue as bars, ad spend as a line
// on its own scale (spend is usually a fraction of revenue — on one axis it
// would lie flat on the floor). Hovering a day gives its exact numbers.

const dayNum = (iso) => Number(iso.slice(8));

export default function TrackingPulse({ grid, channels, loading }) {
  const [hover, setHover] = useState(null);
  const days = grid.days || [];
  const today = todayIso();
  const rev = daySeries(grid, channels, days, 'sales', 'revenue');
  const spend = daySeries(grid, channels, days, 'spend', 'amount');
  const revMax = Math.max(0, ...rev.filter((v) => v != null));
  const spendMax = Math.max(0, ...spend.filter((v) => v != null));
  const n = days.length || 1;

  // Spend line: one segment per run of filled days, so an unfilled day is a
  // break in the line rather than a dive to zero.
  const segments = [];
  let seg = [];
  spend.forEach((v, i) => {
    if (v == null) { if (seg.length) segments.push(seg); seg = []; return; }
    seg.push([i + 0.5, 100 - (spendMax ? (v / spendMax) * 88 : 0) - 4]);
  });
  if (seg.length) segments.push(seg);

  const h = hover != null ? { date: days[hover], rev: rev[hover], spend: spend[hover] } : null;
  return (
    <section className="soft-card bt-pulse" aria-label="Ritme harian">
      <header className="bt-pulse-head">
        <div>
          <h2>Ritme harian</h2>
          <p>Revenue semua channel per hari, dengan belanja iklan sebagai garis di skala tersendiri.</p>
        </div>
        <div className="bt-legend" aria-hidden="true">
          <span><i className="is-rev" /> Revenue <em>maks. {fmtRpShort(revMax || null)}</em></span>
          <span><i className="is-spend" /> Ads spend <em>maks. {fmtRpShort(spendMax || null)}</em></span>
        </div>
      </header>

      <div className="bt-chart" style={{ '--n': n }} onMouseLeave={() => setHover(null)}>
        <div className="bt-chart-grid" aria-hidden="true"><i /><i /><i /></div>
        <div className="bt-chart-bars">
          {days.map((d, i) => (
            <div
              key={d}
              className={`bt-chart-col${d === today ? ' is-today' : ''}${d > today ? ' is-future' : ''}${hover === i ? ' is-hover' : ''}`}
              onMouseEnter={() => setHover(i)}
            >
              <span
                className={`bt-chart-bar${rev[i] != null && rev[i] < 0 ? ' is-neg' : ''}`}
                style={{ transform: `scaleY(${loading || !revMax || rev[i] == null ? 0 : Math.max(rev[i] / revMax, 0.012)})` }}
              />
            </div>
          ))}
        </div>
        <svg className="bt-chart-line" viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" aria-hidden="true">
          {!loading && segments.map((s, k) => (
            s.length === 1
              ? <circle key={k} cx={s[0][0]} cy={s[0][1]} r="0.18" className="bt-chart-dot" />
              : <polyline key={k} points={s.map((p) => p.join(',')).join(' ')} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {h && (
          <div
            className="bt-tip"
            role="status"
            // Pinned inward at the month's edges so the card never leaves the panel.
            style={{ left: `${((hover + 0.5) / n) * 100}%`, '--tip-x': hover < 4 ? '-12%' : hover > n - 5 ? '-88%' : '-50%' }}
          >
            <strong>{WEEKDAYS[weekday(h.date)]}, {dayNum(h.date)} {new Date(`${h.date}T00:00:00`).toLocaleDateString('id-ID', { month: 'short' })}</strong>
            <span><i className="is-rev" /> Revenue <b>{fmtRp(h.rev)}</b></span>
            <span><i className="is-spend" /> Ads spend <b>{fmtRp(h.spend)}</b></span>
            {h.rev > 0 && h.spend != null && <span className="bt-tip-cpr">Cost per revenue <b>{fmtPct(h.spend / h.rev)}</b></span>}
          </div>
        )}
        <div className="bt-chart-axis" aria-hidden="true">
          {days.map((d, i) => (
            <span key={d} className={`${isWeekend(d) ? 'is-weekend' : ''}${d === today ? ' is-today' : ''}`}>
              {(i % 2 === 0 || d === today) ? dayNum(d) : ''}
            </span>
          ))}
        </div>
      </div>

    </section>
  );
}
