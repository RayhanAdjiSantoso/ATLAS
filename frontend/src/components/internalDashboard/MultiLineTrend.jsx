const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
const short = (v) => {
  if (v == null) return '';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}M`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}jt`;
  return `${Math.round(v)}`;
};

// Small multi-series line chart. `data` = [{ period, <seriesA>: n|null, ... }].
// Gaps (null) break the line — never drawn as 0.
export default function MultiLineTrend({ data = [], series = [], title }) {
  const W = 900;
  const H = 300;
  const pad = { l: 60, r: 16, t: 16, b: 40 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const allVals = data.flatMap((d) => series.map((s) => d[s]).filter((v) => v != null));
  const max = Math.max(1, ...allVals);
  const n = data.length || 1;
  const x = (i) => pad.l + (n === 1 ? cw / 2 : (i / (n - 1)) * cw);
  const y = (v) => pad.t + ch - (v / max) * ch;

  const pathFor = (s) => {
    let d = '';
    let pen = false;
    data.forEach((row, i) => {
      const v = row[s];
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'} ${x(i)} ${y(v)} `;
      pen = true;
    });
    return d.trim();
  };

  const hasData = allVals.length > 0;

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      {title && <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{title}</h3>}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
        {series.map((s, i) => (
          <span key={s}><span style={{ display: 'inline-block', width: 10, height: 2, background: COLORS[i % COLORS.length], verticalAlign: 'middle', marginRight: 4 }} />{s}</span>
        ))}
      </div>
      {!hasData ? (
        <div className="empty-state">Belum ada data.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 560 }}>
            {[0, 0.25, 0.5, 0.75, 1].map((r) => {
              const yy = pad.t + ch * (1 - r);
              return (
                <g key={r}>
                  <line x1={pad.l} y1={yy} x2={W - pad.r} y2={yy} stroke="var(--border)" strokeDasharray="4,4" />
                  <text x={pad.l - 8} y={yy + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{short(max * r)}</text>
                </g>
              );
            })}
            {data.map((row, i) => (
              <text key={row.period} x={x(i)} y={H - pad.b + 16} textAnchor="middle" fontSize="9" fill="var(--text-muted)"
                transform={`rotate(35 ${x(i)} ${H - pad.b + 16})`}>{row.period.slice(2)}</text>
            ))}
            {series.map((s, i) => (
              <path key={s} d={pathFor(s)} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="2" />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
