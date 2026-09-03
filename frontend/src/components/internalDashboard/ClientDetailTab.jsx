import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import api from '../../api/client.js';
import { formatPercent } from '../../utils/format.js';
import KpiCard from '../dashboard/KpiCard.jsx';
import DonutChart from '../dashboard/DonutChart.jsx';
import ClientPicker from './ClientPicker.jsx';
import OverviewTrendChart from './OverviewTrendChart.jsx';
import PeerDistributionRow from './PeerDistributionRow.jsx';
import { AD_PLATFORMS } from './constants.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const money = (v) => (v == null ? '-' : `Rp${new Intl.NumberFormat('id-ID').format(Math.round(v))}`);
const pct = (v) => (v == null ? '-' : formatPercent(v * 100, 1));
const platLabel = (v) => AD_PLATFORMS.find((p) => p.value === v)?.label || v;
const num = (v) => (v == null ? '-' : new Intl.NumberFormat('id-ID').format(v));

function DetailView() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [period, setPeriod] = useState(thisMonth());
  const [compare, setCompare] = useState('mom');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/internal-dashboard/clients').then((r) => setClients(r.data.clients || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId) { setData(null); return; }
    setLoading(true);
    setError('');
    api.get(`/internal-dashboard/clients/${clientId}`, { params: { period, compare } })
      .then((r) => setData(r.data))
      .catch((err) => { setData(null); setError(err.response?.data?.message || 'Gagal memuat detail client'); })
      .finally(() => setLoading(false));
  }, [clientId, period, compare]);

  const p = data?.profile;
  const h = data?.headline;
  const donut = (data?.spend_allocation || []).map((s) => ({ name: platLabel(s.platform), value: s.spend }));

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
            <label>Pembanding</label>
            <select value={compare} onChange={(e) => setCompare(e.target.value)}>
              <option value="mom">MoM</option>
              <option value="yoy">YoY</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!clientId && <div className="empty-state">Pilih client untuk melihat detailnya.</div>}
      {loading && !data && <div className="empty-state">Memuat...</div>}

      {data && (
        <>
          <div className="card">
            <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{p.brand_name}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Status</span><br />{p.status || '—'}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Kategori</span><br />{p.kategori_besar || '—'}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Industry</span><br />{p.industry || '—'}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Sub-industry</span><br />{p.sub_industry || '—'}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>BM ID</span><br />{p.bm_id || '—'}</div>
              <div><span style={{ color: 'var(--text-muted)' }}>PIC</span><br />{p.pic || '—'}</div>
              <div><span style={{ color: 'var(--text-muted)' }}># Ad Account</span><br />{p.ad_account_count}</div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Mulai kerja sama</span><br />
                <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>TBD</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}> (join_date belum ada)</span>
              </div>
            </div>
            {p.data_review_note && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.6rem' }}>
                <Info size={12} /> Catatan data master: {p.data_review_note}
              </p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <KpiCard title="Revenue" value={h.revenue} type="currency" growth={h.revenue_delta_pct} />
            <KpiCard title="Ad Spend" value={h.spend} type="currency" invert />
            <KpiCard title="Blended ROAS" value={h.blended_roas} type="number" note="revenue ÷ spend" />
            <KpiCard title="vs Target" value={h.vs_target_pct} type="percentage"
              note={h.vs_target_pct == null ? 'target bulan ini belum diisi' : null} />
          </div>

          <OverviewTrendChart trend={(data.trend || []).map((t) => ({ period: t.period, sales: t.revenue, spend: t.spend, roas: t.roas }))} />

          <div className="card">
            <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Scorecard vs Peer</h3>
            {data.scorecard.sub_industry ? (
              <>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Peer group: {data.scorecard.sub_industry} · {data.scorecard.peer_n_total} client ({data.scorecard.peer_n_with_data} ada data) ·
                  composite index {data.scorecard.composite != null ? Math.round(data.scorecard.composite) : '-'} (100 = median peer).
                  Blended ROAS = revenue ÷ spend.
                </p>
                {data.scorecard.distribution.map((d) => <PeerDistributionRow key={d.metric} d={d} />)}
              </>
            ) : (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{data.scorecard.note}</p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
            <div className="card">
              <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Funnel</h3>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>{data.funnel_note}</p>
              {data.funnel ? data.funnel.map((f) => (
                <div key={f.key} style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <span>{f.label}</span>
                    <span>{num(f.value)}{f.conv_from_prev != null ? ` · ${pct(f.conv_from_prev)}` : ''}</span>
                  </div>
                  <div style={{ height: 10, background: 'var(--border)', borderRadius: 3, marginTop: 2 }}>
                    <div style={{
                      width: `${data.funnel[0].value > 0 && f.value != null ? (f.value / data.funnel[0].value) * 100 : 0}%`,
                      height: '100%', background: 'var(--primary)', borderRadius: 3,
                    }} />
                  </div>
                </div>
              )) : <div className="empty-state">Belum ada data iklan bulan ini.</div>}
            </div>

            <DonutChart data={donut} title="Alokasi Spend per Platform" centerLabel="Total" valueFormatter={money} />
          </div>
        </>
      )}
    </div>
  );
}

function RankingView() {
  const [period, setPeriod] = useState(thisMonth());
  const [metric, setMetric] = useState('revenue');
  const [compare, setCompare] = useState('mom');
  const [status, setStatus] = useState('active');
  const [category, setCategory] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/clients/ranking', { params: { period, metric, compare, status, category } })
      .then((r) => setData(r.data))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat ranking'))
      .finally(() => setLoading(false));
  }, [period, metric, compare, status, category]);

  const isPctMetric = data && (data.metric.key === 'growth' || data.metric.key === 'ad_cost_ratio');
  const fmtVal = (v) => {
    if (v == null) return '-';
    if (isPctMetric) return pct(v);
    if (data.metric.key === 'blended_roas') return v.toFixed(2);
    return money(v);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Periode</label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Metrik</label>
            <select value={metric} onChange={(e) => setMetric(e.target.value)}>
              {(data?.available_metrics || [{ key: 'revenue', label: 'Revenue' }]).map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Growth vs</label>
            <select value={compare} onChange={(e) => setCompare(e.target.value)}>
              <option value="mom">MoM</option><option value="yoy">YoY</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Kategori</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">Semua</option><option value="retail">Retail</option>
              <option value="b2b_service">B2B / Service</option><option value="fnb">F&B</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Aktif</option><option value="all">Semua</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data && <div className="empty-state">Memuat...</div>}

      {data && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '1rem 1.5rem 0' }}>
            Diurutkan {data.metric.direction === 'asc' ? 'menaik (makin kecil makin baik)' : 'menurun'} berdasarkan {data.metric.label}.
            {data.no_data.length > 0 && ` ${data.no_data.length} client tanpa data untuk metrik ini tidak masuk ranking.`}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ marginTop: '1rem' }}>
              <thead>
                <tr><th>#</th><th>Client</th><th>Sub-industry</th><th>Kategori</th><th>{data.metric.label}</th><th>Revenue</th><th>Spend</th><th>Blended ROAS</th></tr>
              </thead>
              <tbody>
                {data.ranked.map((r) => (
                  <tr key={r.brand_id}>
                    <td>{r.rank}</td>
                    <td>{r.brand_name}</td>
                    <td>{r.sub_industry || '—'}</td>
                    <td>{r.kategori_besar || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{fmtVal(r.value)}</td>
                    <td>{money(r.revenue)}</td>
                    <td>{money(r.spend)}</td>
                    <td>{r.blended_roas != null ? r.blended_roas.toFixed(2) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// S7 — Client Detail + Ranking.
export default function ClientDetailTab() {
  const [view, setView] = useState('detail');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {[['detail', 'Detail Client'], ['ranking', 'Ranking Semua Client']].map(([k, l]) => (
          <button key={k} type="button" className={`btn ${view === k ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.85rem', padding: '0.4rem 1rem', border: view === k ? 'none' : '1px solid var(--border)' }}
            onClick={() => setView(k)}>{l}</button>
        ))}
      </div>
      {view === 'detail' ? <DetailView /> : <RankingView />}
    </div>
  );
}
