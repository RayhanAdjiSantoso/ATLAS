import { AlertTriangle } from 'lucide-react';
import { formatPercent } from '../../utils/format.js';

// §2.8 — clients whose revenue growth is well below their sub-industry peer
// average. Threshold is provisional until real cross-client data lands.
export default function PerluPerhatianPanel({ rows = [], threshold }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.5rem 0' }}>
        <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <AlertTriangle size={16} /> Perlu Perhatian
        </h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
          Growth ≥ {formatPercent((threshold?.perlu_perhatian_growth_gap ?? 0) * 100, 0)} di bawah rata-rata sub-industry-nya.
          {threshold?.provisional && ' Ambang masih sementara — akan dikalibrasi setelah data lintas-client cukup.'}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">Tidak ada client yang jauh di bawah peer-nya.</div>
      ) : (
        <table style={{ marginTop: '1rem' }}>
          <thead>
            <tr><th>Client</th><th>Sub-industry</th><th>Growth</th><th>Rata-rata peer</th><th>Selisih</th><th>N peer</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.brand_id}>
                <td>{r.brand_name}</td>
                <td>{r.sub_industry}</td>
                <td style={{ color: 'var(--danger)' }}>{formatPercent(r.growth * 100, 1)}</td>
                <td>{formatPercent(r.sub_industry_avg_growth * 100, 1)}</td>
                <td style={{ color: 'var(--danger)', fontWeight: 600 }}>{formatPercent(r.gap * 100, 1)}</td>
                <td>{r.peer_n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
