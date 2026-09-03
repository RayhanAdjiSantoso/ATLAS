const short = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}M`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}jt`;
  return `${Math.round(v)}`;
};

// Portfolio sales bridge: prior total → +growth → −decline → +new → −churn
// → current total. Floating bars; totals anchored to the baseline.
export default function WaterfallChart({ w }) {
  if (!w) return null;
  const steps = [
    { label: `Total ${w.prior_period}`, value: w.prior_total, kind: 'total' },
    { label: `Tumbuh (${w.counts.growth})`, value: w.growth, kind: 'up' },
    { label: `Turun (${w.counts.decline})`, value: w.decline, kind: 'down' },
    { label: `Client baru (${w.counts.new})`, value: w.new_clients, kind: 'up' },
    { label: `Churn (${w.counts.churn})`, value: w.churn, kind: 'down' },
    { label: `Total ${w.period ?? 'sekarang'}`, value: w.current_total, kind: 'total' },
  ];

  const W = 900;
  const H = 340;
  const pad = { l: 10, r: 10, t: 20, b: 64 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;
  const maxTop = Math.max(w.prior_total, w.current_total,
    w.prior_total + w.growth,
    w.prior_total + w.growth + w.new_clients);
  const y = (v) => pad.t + ch - (v / maxTop) * ch;

  const n = steps.length;
  const slot = cw / n;
  const barW = slot * 0.6;

  let running = 0;
  const bars = steps.map((s, i) => {
    let top;
    let bottom;
    if (s.kind === 'total') { top = s.value; bottom = 0; running = s.value; }
    else if (s.value >= 0) { bottom = running; top = running + s.value; running = top; }
    else { top = running; bottom = running + s.value; running = bottom; }
    return {
      ...s,
      x: pad.l + slot * i + (slot - barW) / 2,
      y: y(Math.max(top, bottom)),
      h: Math.abs(y(top) - y(bottom)),
      cx: pad.l + slot * i + slot / 2,
    };
  });

  const color = { total: 'var(--primary)', up: '#10b981', down: '#ef4444' };

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Waterfall Perubahan Sales Portfolio</h3>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
        {w.reconciles ? 'Jembatan cocok' : '⚠ jembatan tidak cocok'} · {w.prior_period} → {w.period ?? 'sekarang'}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 620 }}>
          <line x1={pad.l} y1={pad.t + ch} x2={W - pad.r} y2={pad.t + ch} stroke="var(--border)" />
          {bars.map((b, i) => (
            <g key={b.label}>
              {i > 0 && (
                <line x1={bars[i - 1].cx + barW / 2} y1={b.kind === 'total' ? y(b.value) : (b.value >= 0 ? b.y + b.h : b.y)}
                  x2={b.x} y2={b.kind === 'total' ? y(b.value) : (b.value >= 0 ? b.y + b.h : b.y)}
                  stroke="var(--border)" strokeDasharray="3,3" />
              )}
              <rect x={b.x} y={b.y} width={barW} height={Math.max(b.h, 1)} fill={color[b.kind]} rx="2" />
              <text x={b.cx} y={b.y - 6} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
                {b.kind !== 'total' && b.value >= 0 ? '+' : ''}{short(b.value)}
              </text>
              <text x={b.cx} y={H - pad.b + 16} textAnchor="middle" fontSize="9" fill="var(--text-muted)"
                transform={`rotate(20 ${b.cx} ${H - pad.b + 16})`}>{b.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
