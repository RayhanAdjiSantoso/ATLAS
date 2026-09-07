import { AlertTriangle } from 'lucide-react';
import { formatPercent } from '../../utils/format.js';

const pct = (frac, d = 1) => (frac == null ? '-' : formatPercent(frac * 100, d));
const roas = (v) => (v == null ? '-' : `${v.toFixed(2)}x`);

// §2.8 — "Perlu Perhatian". FOUR independent signals (mockup parity, user
// decision "Opsi 1"): peer-relative growth gap, overspend anomaly, absolute
// ROAS floor, plus an info line for clients excluded from benchmarking.
// Every threshold is provisional until real cross-client data lands.
export default function PerluPerhatianPanel({ data }) {
  if (!data) return null;
  const { peer_relative = [], overspend = [], low_roas = [], benchmark_excluded, thresholds = {} } = data;
  const nothing = peer_relative.length === 0 && overspend.length === 0 && low_roas.length === 0;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '1rem 1.5rem 0' }}>
        <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <AlertTriangle size={16} /> Perlu Perhatian
        </h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
          Tiga sinyal terpisah — client bisa muncul di salah satunya.
          {thresholds.provisional && ' Semua ambang masih sementara, dikalibrasi ulang setelah data lintas-client cukup.'}
        </p>
      </div>

      {nothing && (
        <div className="empty-state">Tidak ada client yang memicu ketiga sinyal periode ini.</div>
      )}

      {/* (a) peer-relative growth gap */}
      {peer_relative.length > 0 && (
        <div style={{ padding: '1rem 1.5rem 0' }}>
          <h4 style={{ fontSize: '0.85rem', margin: '0 0 0.25rem' }}>
            Growth jauh di bawah peer sub-industry
          </h4>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
            Growth ≥ {pct(thresholds.growth_gap, 0)} di bawah rata-rata sub-industry-nya.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>Client</th><th>Sub-industry</th><th>Growth</th><th>Rata-rata peer</th><th>Selisih</th><th>N peer</th></tr>
              </thead>
              <tbody>
                {peer_relative.map((r) => (
                  <tr key={r.brand_id}>
                    <td>{r.brand_name}</td>
                    <td>{r.sub_industry}</td>
                    <td style={{ color: 'var(--danger)' }}>{pct(r.growth)}</td>
                    <td>{pct(r.sub_industry_avg_growth)}</td>
                    <td style={{ color: 'var(--danger)', fontWeight: 600 }}>{pct(r.gap)}</td>
                    <td>{r.peer_n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* (b) overspend anomaly */}
      {overspend.length > 0 && (
        <div style={{ padding: '1rem 1.5rem 0' }}>
          <h4 style={{ fontSize: '0.85rem', margin: '0 0 0.25rem' }}>Belanja naik, penjualan turun</h4>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
            Spend growth &gt; {pct(thresholds.overspend_spend_growth, 0)} sementara sales growth negatif.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Client</th><th>Sub-industry</th><th>Δ Spend</th><th>Δ Sales</th></tr></thead>
              <tbody>
                {overspend.map((r) => (
                  <tr key={r.brand_id}>
                    <td>{r.brand_name}</td>
                    <td>{r.sub_industry || '—'}</td>
                    <td style={{ color: 'var(--danger)' }}>{pct(r.spend_growth)}</td>
                    <td style={{ color: 'var(--danger)' }}>{pct(r.sales_growth)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* (c) absolute ROAS floor */}
      {low_roas.length > 0 && (
        <div style={{ padding: '1rem 1.5rem 0' }}>
          <h4 style={{ fontSize: '0.85rem', margin: '0 0 0.25rem' }}>Blended ROAS di bawah ambang</h4>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
            Revenue ÷ ad spend &lt; {roas(thresholds.roas_floor)} (ambang absolut — angka demo mockup, wajib
            dikalibrasi per industri untuk data riil).
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Client</th><th>Sub-industry</th><th>Blended ROAS</th></tr></thead>
              <tbody>
                {low_roas.map((r) => (
                  <tr key={r.brand_id}>
                    <td>{r.brand_name}</td>
                    <td>{r.sub_industry || '—'}</td>
                    <td style={{ color: 'var(--danger)', fontWeight: 600 }}>{roas(r.blended_roas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* (d) info: benchmark exclusions */}
      <div style={{ padding: '1rem 1.5rem 1.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        {benchmark_excluded?.count > 0 ? (
          <>
            <strong>{benchmark_excluded.count} client</strong> dikecualikan dari benchmark bulan ini
            (data bulan parsial — lihat S5/S8): {benchmark_excluded.clients.map((c) => c.brand_name).join(', ')}.
          </>
        ) : (
          'Tidak ada client yang dikecualikan dari benchmark bulan ini (tidak ada data bulan parsial).'
        )}
      </div>
    </div>
  );
}
