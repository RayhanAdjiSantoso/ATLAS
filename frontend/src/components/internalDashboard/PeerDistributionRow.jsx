import { formatPercent } from '../../utils/format.js';

const num = (v, d = 2) => (v == null ? '-' : new Intl.NumberFormat('id-ID', { maximumFractionDigits: d }).format(v));
const pct = (v, d = 1) => (v == null ? '-' : formatPercent(v * 100, d));

// One benchmark metric's P25–median–P75 range with the client's marker.
// Shared by S5 (Benchmarking) and S7 (Client Detail scorecard).
export default function PeerDistributionRow({ d }) {
  const lo = Math.min(d.p25 ?? d.client_value ?? 0, d.client_value ?? d.p25 ?? 0);
  const hi = Math.max(d.p75 ?? d.client_value ?? 0, d.client_value ?? d.p75 ?? 0);
  const span = (hi - lo) || Math.abs(hi) || 1;
  const posOf = (v) => (v == null ? null : ((v - (lo - span * 0.15)) / (span * 1.3)) * 100);
  const isPctMetric = d.metric === 'ctr' || d.metric === 'ad_cost_ratio';
  const fmt = (v) => (v == null ? '-' : isPctMetric ? pct(v, 2) : num(v, ['cpp', 'cpm', 'cpc'].includes(d.metric) ? 0 : 2));

  return (
    <div style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.35rem', gap: '0.5rem' }}>
        <strong>{d.label}</strong>
        <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
          {d.lower_better ? 'makin rendah makin baik' : 'makin tinggi makin baik'} · N={d.n}
          {d.client_percentile != null ? ` · persentil ${Math.round(d.client_percentile * 100)}` : ''}
          {d.efficiency_index != null ? ` · index ${Math.round(d.efficiency_index)}` : ''}
        </span>
      </div>
      <div style={{ position: 'relative', height: 26, background: 'var(--border)', borderRadius: 4 }}>
        {d.p25 != null && d.p75 != null && (
          <div style={{ position: 'absolute', left: `${posOf(d.p25)}%`, width: `${posOf(d.p75) - posOf(d.p25)}%`, top: 0, bottom: 0, background: 'rgba(100,116,139,0.35)', borderRadius: 4 }} />
        )}
        {d.median != null && (
          <div style={{ position: 'absolute', left: `${posOf(d.median)}%`, top: -3, bottom: -3, width: 2, background: '#64748b' }} title={`median ${fmt(d.median)}`} />
        )}
        {d.client_value != null && (
          <div style={{ position: 'absolute', left: `${posOf(d.client_value)}%`, top: -5, bottom: -5, width: 3, background: 'var(--primary)' }} title={`client ${fmt(d.client_value)}`} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
        <span>P25 {fmt(d.p25)}</span>
        <span>median {fmt(d.median)}</span>
        <span>P75 {fmt(d.p75)}</span>
        <span style={{ color: 'var(--primary)', fontWeight: 600 }}>client {fmt(d.client_value)}</span>
      </div>
    </div>
  );
}
