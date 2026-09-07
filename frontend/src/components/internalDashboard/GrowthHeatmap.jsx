import { formatPercent } from '../../utils/format.js';

// Diverging red<->green by growth. `t` = clamp(v / cap, -1, 1); alpha scales
// with |t| so a near-flat month stays pale. Matches IndustryTab.growthColor.
function cellColor(v, cap) {
  if (v == null) return 'var(--border)';
  const t = Math.max(-1, Math.min(1, v / cap));
  const a = 0.12 + Math.abs(t) * 0.68;
  return t < 0 ? `rgba(239, 68, 68, ${a})` : `rgba(16, 185, 129, ${a})`;
}
function cellInk(v, cap) {
  if (v == null) return 'var(--text-muted)';
  return Math.abs(v / cap) > 0.5 ? '#fff' : 'var(--text)';
}

// S4 growth heatmap — rows = sub-industry (or industry), cols = last N
// months, each cell = MoM aggregate growth. Seasonality reads as a column
// (Ramadan/Lebaran spike), not a per-client problem. "–" = too few clients.
export default function GrowthHeatmap({ data, title, subtitle }) {
  if (!data || !data.rows?.length) return null;
  const { months, rows, cap, min_clients: minClients } = data;
  const label = (p) => p.slice(2); // "2026-03" -> "26-03"

  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      {title && <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>{title}</h3>}
      {subtitle && <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>{subtitle}</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 2, fontSize: '0.72rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0 8px 4px 0', color: 'var(--text-muted)', fontWeight: 600 }} />
              {months.map((m) => (
                <th key={m} style={{ padding: '0 0 4px', color: 'var(--text-muted)', fontWeight: 600, minWidth: 46 }}>{label(m)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: '0 8px 0 0', whiteSpace: 'nowrap', fontWeight: 500 }}>{r.key}</td>
                {r.cells.map((c, i) => (
                  <td key={months[i]}
                    title={c.growth == null
                      ? `${r.key} · ${label(months[i])}: hanya ${c.n} client (min ${minClients})`
                      : `${r.key} · ${label(months[i])}: ${formatPercent(c.growth * 100, 1)} (${c.n} client)`}
                    style={{
                      background: cellColor(c.growth, cap), color: cellInk(c.growth, cap),
                      textAlign: 'center', padding: '6px 4px', borderRadius: 3,
                      fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                    }}>
                    {c.growth == null ? '–' : formatPercent(c.growth * 100, 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.6rem' }}>
        {[['turun dalam', 'rgba(239,68,68,0.75)'], ['turun tipis', 'rgba(239,68,68,0.25)'],
          ['datar', 'var(--border)'], ['naik tipis', 'rgba(16,185,129,0.25)'], ['naik kuat', 'rgba(16,185,129,0.75)']].map(([l, bg]) => (
            <span key={l}><span style={{ display: 'inline-block', width: 10, height: 10, background: bg, borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />{l}</span>
        ))}
        <span>"–" = client &lt; {minClients} di dua bulan berurutan</span>
      </div>
    </div>
  );
}
