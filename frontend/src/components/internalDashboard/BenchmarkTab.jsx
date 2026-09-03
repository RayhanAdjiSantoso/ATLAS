import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import api from '../../api/client.js';
import { formatPercent } from '../../utils/format.js';
import ClientPicker from './ClientPicker.jsx';
import PeerBandChart from './PeerBandChart.jsx';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const num = (v, d = 2) => (v == null ? '-' : new Intl.NumberFormat('id-ID', { maximumFractionDigits: d }).format(v));
const pct = (v, d = 1) => (v == null ? '-' : formatPercent(v * 100, d));

// One metric's P25–median–P75 range with the client's marker.
function DistributionRow({ d }) {
  const lo = Math.min(d.p25 ?? d.client_value, d.client_value ?? d.p25);
  const hi = Math.max(d.p75 ?? d.client_value, d.client_value ?? d.p75);
  const span = (hi - lo) || Math.abs(hi) || 1;
  const posOf = (v) => (v == null ? null : ((v - (lo - span * 0.15)) / (span * 1.3)) * 100);
  const isPctMetric = d.metric === 'ctr' || d.metric === 'ad_cost_ratio';
  const fmt = (v) => (v == null ? '-' : isPctMetric ? pct(v, 2) : num(v, d.metric === 'cpp' || d.metric === 'cpm' || d.metric === 'cpc' ? 0 : 2));

  return (
    <div style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
        <strong>{d.label}</strong>
        <span style={{ color: 'var(--text-muted)' }}>
          {d.lower_better ? 'makin rendah makin baik' : 'makin tinggi makin baik'} · N={d.n} · client di persentil {d.client_percentile != null ? Math.round(d.client_percentile * 100) : '-'}
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

// S5 — Benchmarking.
export default function BenchmarkTab() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [period, setPeriod] = useState(thisMonth());
  const [compare, setCompare] = useState('mom');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/internal-dashboard/clients').then((res) => setClients(res.data.clients || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId) { setData(null); return; }
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/benchmark', { params: { client_id: clientId, period, compare } })
      .then((res) => setData(res.data))
      .catch((err) => { setData(null); setError(err.response?.data?.message || 'Gagal memuat benchmark'); })
      .finally(() => setLoading(false));
  }, [clientId, period, compare]);

  const mm = data?.market_movement;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '1rem', alignItems: 'start' }}>
          <ClientPicker clients={clients} value={clientId} onChange={setClientId} />
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Periode</label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Pembanding growth</label>
            <select value={compare} onChange={(e) => setCompare(e.target.value)}>
              <option value="mom">Bulan sebelumnya (MoM)</option>
              <option value="yoy">Tahun lalu (YoY)</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!clientId && <div className="empty-state">Pilih client untuk melihat benchmark peer-group-nya.</div>}
      {loading && !data && <div className="empty-state">Memuat...</div>}

      {data && (
        <>
          <div className="card">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>
              {data.client.brand_name} — peer group: {data.peer_group.sub_industry}
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
              {data.peer_group.n_total} client di sub-industry ini · {data.peer_group.n_with_ad_data} punya data iklan bulan {data.period}.
              {' '}Peer: {data.peer_group.peers.map((p) => p.brand_name).join(', ') || '—'}
            </p>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
              <Info size={13} style={{ marginTop: 2, flexShrink: 0 }} />
              Tanpa ambang minimum peer (N ditampilkan apa adanya). Pengaman <em>exclude tenure &lt;2 bulan</em> dan <em>exclude histori &lt;25 hari</em> BELUM aktif —
              butuh join_date dan jumlah-hari-per-bulan yang belum tersedia. Trim P1–P99 dorman untuk cohort kecil.
            </p>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Market Movement Indicator</h3>
            <p style={{ fontSize: '0.95rem', margin: '0 0 0.75rem' }}>{mm.verdict}</p>
            <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span>Median growth peer: <strong style={{ color: 'var(--text)' }}>{pct(mm.peer_median_growth)}</strong></span>
              <span>Peer naik/turun: <strong style={{ color: 'var(--text)' }}>{mm.peers_up}/{mm.peers_down}</strong> dari {mm.peers_measured}</span>
              <span>Growth client: <strong style={{ color: 'var(--text)' }}>{pct(mm.client_growth)}</strong></span>
            </div>
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Posisi pada Sebaran Peer</h3>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Blended ROAS = revenue ÷ ad spend (definisi sama dengan Executive Overview, bukan atribusi platform).
            </p>
            {data.distribution.map((d) => <DistributionRow key={d.metric} d={d} />)}
          </div>

          <div className="card">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Efficiency Index</h3>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>{data.efficiency_index.note}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {data.efficiency_index.per_metric.map((m) => {
                const v = m.index;
                return (
                  <div key={m.metric} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ width: 150, fontSize: '0.8rem', textAlign: 'right', color: 'var(--text-muted)' }}>{m.label}</span>
                    <div style={{ flex: 1, position: 'relative', height: 20, background: 'var(--border)', borderRadius: 4 }}>
                      <div style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 1, background: 'var(--text-muted)' }} />
                      {v != null && (
                        <div style={{
                          position: 'absolute', top: 0, bottom: 0, borderRadius: 4,
                          left: v >= 100 ? '50%' : `${Math.max(0, 50 - (100 - v) / 2)}%`,
                          width: `${Math.min(50, Math.abs(v - 100) / 2)}%`,
                          background: v >= 100 ? '#10b981' : '#ef4444',
                        }} />
                      )}
                    </div>
                    <span style={{ width: 44, fontSize: '0.8rem', fontWeight: 600 }}>{v != null ? Math.round(v) : '-'}</span>
                  </div>
                );
              })}
            </div>
            <p style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
              Composite: <strong>{data.efficiency_index.composite != null ? Math.round(data.efficiency_index.composite) : '-'}</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}> (100 = setara median peer)</span>
            </p>
          </div>

          <PeerBandChart data={data.cpm_trend} title="Tren CPM & Sebaran CPM Peer — 13 bulan" clientName={data.client.brand_name} />
        </>
      )}
    </div>
  );
}
