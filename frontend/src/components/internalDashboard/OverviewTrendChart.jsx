import { useState } from 'react';

const money = (v) => (v == null ? 'N/A' : `Rp${new Intl.NumberFormat('id-ID').format(Math.round(v))}`);
const shortMoney = (v) => {
  if (v == null) return '';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}M`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}jt`;
  return `${Math.round(v)}`;
};

// Sales (bars) + Ad Spend (line) over the trailing 13 months. Months with no
// input render as a gap, never as 0 (matches the "N/A ≠ 0" convention).
export default function OverviewTrendChart({ trend = [] }) {
  const [hover, setHover] = useState(null);

  const W = 900;
  const H = 320;
  const pad = { l: 70, r: 20, t: 20, b: 46 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const salesVals = trend.map((t) => t.sales).filter((v) => v != null);
  const spendVals = trend.map((t) => t.spend).filter((v) => v != null);
  const maxSales = Math.max(1, ...salesVals);
  const maxSpend = Math.max(1, ...spendVals);

  const n = trend.length || 1;
  const slot = cw / n;
  const barW = slot * 0.55;

  const x = (i) => pad.l + slot * i + slot / 2;
  const ySales = (v) => pad.t + ch - (v / maxSales) * ch;
  const ySpend = (v) => pad.t + ch - (v / maxSpend) * ch;

  const spendPts = trend
    .map((t, i) => (t.spend != null ? { i, x: x(i), y: ySpend(t.spend) } : null))
    .filter(Boolean);
  const spendPath = spendPts.reduce((acc, p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`), '');

  const hasData = salesVals.length > 0 || spendVals.length > 0;

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Tren Sales &amp; Ad Spend — 13 bulan</h3>
      <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--primary)', borderRadius: 2, marginRight: 4 }} />Sales</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#ef4444', verticalAlign: 'middle', marginRight: 4 }} />Ad Spend</span>
      </div>

      {!hasData ? (
        <div className="empty-state">Belum ada data untuk rentang ini.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 560 }}>
            {[0, 0.25, 0.5, 0.75, 1].map((r) => {
              const yy = pad.t + ch * (1 - r);
              return (
                <g key={r}>
                  <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke="var(--border)" strokeDasharray="4,4" />
                  <text x={pad.l - 8} y={yy + 4} textAnchor="end" fontSize="10" fill="var(--primary)">{shortMoney(maxSales * r)}</text>
                  <text x={W - pad.r + 4} y={yy + 4} textAnchor="start" fontSize="10" fill="#ef4444">{shortMoney(maxSpend * r)}</text>
                </g>
              );
            })}

            {trend.map((t, i) => (
              <g key={t.period} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {t.sales != null && (
                  <rect x={x(i) - barW / 2} y={ySales(t.sales)} width={barW} height={pad.t + ch - ySales(t.sales)}
                    fill="var(--primary)" opacity={hover == null || hover === i ? 1 : 0.4} />
                )}
                <text x={x(i)} y={H - pad.b + 16} textAnchor="middle" fontSize="9" fill="var(--text-muted)"
                  transform={`rotate(35 ${x(i)} ${H - pad.b + 16})`}>{t.period.slice(2)}</text>
              </g>
            ))}

            {spendPath && <path d={spendPath} fill="none" stroke="#ef4444" strokeWidth="2" />}
            {spendPts.map((p) => <circle key={p.i} cx={p.x} cy={p.y} r="3" fill="#ef4444" />)}

            {hover != null && (
              <text x={pad.l} y={pad.t - 6} fontSize="11" fill="var(--text-muted)">
                {trend[hover].period}: Sales {money(trend[hover].sales)} · Spend {money(trend[hover].spend)}
                {trend[hover].roas != null ? ` · ROAS ${trend[hover].roas.toFixed(2)}x` : ''}
              </text>
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
