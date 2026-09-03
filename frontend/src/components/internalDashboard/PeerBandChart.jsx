const short = (v) => {
  if (v == null) return '';
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}jt`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}rb`;
  return v.toFixed(1);
};

// Client series (line) against a peer P25–P75 band + median line, per month.
// data: [{ period, client_cpm, peer_p25, peer_median, peer_p75, peer_n }]
export default function PeerBandChart({ data = [], title, clientName }) {
  const W = 900;
  const H = 300;
  const pad = { l: 60, r: 16, t: 16, b: 40 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;

  const all = data.flatMap((d) => [d.client_cpm, d.peer_p25, d.peer_median, d.peer_p75].filter((v) => v != null));
  if (all.length === 0) {
    return (
      <div className="card" style={{ padding: '1.25rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{title}</h3>
        <div className="empty-state">Belum ada data CPM.</div>
      </div>
    );
  }
  const max = Math.max(...all) * 1.1;
  const n = data.length;
  const x = (i) => pad.l + (n === 1 ? cw / 2 : (i / (n - 1)) * cw);
  const y = (v) => pad.t + ch - (v / max) * ch;

  // band polygon (p75 across, then p25 back) — only over contiguous points that have both
  const bandPts = data.map((d, i) => ((d.peer_p25 != null && d.peer_p75 != null) ? { i, x: x(i), yTop: y(d.peer_p75), yBot: y(d.peer_p25) } : null)).filter(Boolean);
  const bandPath = bandPts.length >= 2
    ? `M ${bandPts.map((p) => `${p.x} ${p.yTop}`).join(' L ')} L ${[...bandPts].reverse().map((p) => `${p.x} ${p.yBot}`).join(' L ')} Z`
    : '';

  const linePath = (key) => {
    let d = '';
    let pen = false;
    data.forEach((row, i) => {
      const v = row[key];
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'} ${x(i)} ${y(v)} `;
      pen = true;
    });
    return d.trim();
  };

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{title}</h3>
      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--primary)', verticalAlign: 'middle', marginRight: 4 }} />{clientName}</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 2, background: '#64748b', verticalAlign: 'middle', marginRight: 4 }} />Median peer</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'rgba(100,116,139,0.18)', verticalAlign: 'middle', marginRight: 4 }} />P25–P75 peer</span>
      </div>
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
          {bandPath && <path d={bandPath} fill="rgba(100,116,139,0.18)" stroke="none" />}
          {data.map((row, i) => (
            <text key={row.period} x={x(i)} y={H - pad.b + 16} textAnchor="middle" fontSize="9" fill="var(--text-muted)"
              transform={`rotate(35 ${x(i)} ${H - pad.b + 16})`}>{row.period.slice(2)}</text>
          ))}
          <path d={linePath('peer_median')} fill="none" stroke="#64748b" strokeWidth="1.5" strokeDasharray="4,3" />
          <path d={linePath('client_cpm')} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
        </svg>
      </div>
    </div>
  );
}
