import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import api from '../../api/client.js';
import { formatPercent } from '../../utils/format.js';
import OverviewFilterBar from './OverviewFilterBar.jsx';
import WaterfallChart from './WaterfallChart.jsx';
import ScatterChart from './ScatterChart.jsx';
import MultiLineTrend from './MultiLineTrend.jsx';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const DEFAULTS = { period: thisMonth(), compare: 'mom', category: 'all' };
const money = (v) => (v == null ? '-' : `Rp${new Intl.NumberFormat('id-ID').format(Math.round(v))}`);
const pct = (v) => (v == null ? '-' : formatPercent(v * 100, 1));
const TYPE_LABEL = { growth: 'Tumbuh', decline: 'Turun', new: 'Baru', churn: 'Churn' };

// S2 — Business Checkup.
export default function BusinessCheckupTab() {
  const [filters, setFilters] = useState(DEFAULTS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/business-checkup', { params: filters })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat business checkup'))
      .finally(() => setLoading(false));
  }, [filters]);

  const movePoints = (data?.movement_matrix || [])
    .filter((m) => m.growth != null)
    .map((m) => ({
      x: m.growth, y: m.sales, size: m.ad_spend,
      color: m.direction === 'up' ? '#10b981' : '#ef4444',
      label: m.brand_name,
    }));

  const svsPoints = (data?.spend_vs_sales || []).map((s) => ({
    x: s.spend_delta_pct, y: s.sales_delta_pct,
    color: s.sales_delta_pct >= 0 ? '#10b981' : '#ef4444',
    label: s.brand_name,
  }));

  const indexData = (data?.portfolio_index?.series || []).map((r) => ({
    period: r.period, 'Sales (index)': r.sales_index, 'Ad Spend (index)': r.spend_index,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <OverviewFilterBar value={filters} onChange={setFilters} hide={['status', 'basis']} compareOptions={['mom', 'yoy']} />
      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data && <div className="empty-state">Memuat...</div>}

      {data && (
        <>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.4rem', alignItems: 'flex-start', margin: 0 }}>
            <Info size={13} style={{ marginTop: 2, flexShrink: 0 }} />
            {data.note}
          </p>

          <WaterfallChart w={{ ...data.waterfall, period: data.period }} />

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <h3 style={{ fontSize: '1rem', padding: '1rem 1.5rem 0' }}>10 Pergerakan Terbesar</h3>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.3rem 1.5rem 0' }}>
              &ldquo;Kontribusi ke Δ portfolio&rdquo; = kontribusi client ÷ perubahan bersih portfolio. Bisa &gt;100% atau negatif kalau pergerakan kotor lebih besar dari perubahan bersih.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ marginTop: '1rem' }}>
                <thead>
                  <tr><th>Client</th><th>Tipe</th><th>{data.compare_period}</th><th>{data.period}</th><th>Δ</th><th>Δ%</th><th>Kontribusi ke Δ portfolio</th></tr>
                </thead>
                <tbody>
                  {data.top_movers.map((m) => (
                    <tr key={m.brand_id}>
                      <td>{m.brand_name}</td>
                      <td>{TYPE_LABEL[m.type]}</td>
                      <td>{money(m.prior)}</td>
                      <td>{money(m.current)}</td>
                      <td style={{ color: m.delta_abs >= 0 ? '#059669' : 'var(--danger)' }}>{m.delta_abs >= 0 ? '+' : ''}{money(m.delta_abs)}</td>
                      <td>{pct(m.delta_pct)}</td>
                      <td>{m.contribution_pct_of_change != null ? formatPercent(m.contribution_pct_of_change * 100, 0) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
            <ScatterChart points={movePoints} title="Matriks Pergerakan Client"
              xLabel="Growth %" yLabel="Sales" xIsPct quadrants />
            <ScatterChart points={svsPoints} title="Spend vs Sales (Δ%)"
              xLabel="Δ Ad Spend %" yLabel="Δ Sales %" xIsPct yIsPct quadrants />
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '-0.75rem 0 0' }}>
            Scatter hanya untuk client like-for-like (ada data di kedua periode). Bubble = ad spend · hijau tumbuh / merah turun.
          </p>

          <MultiLineTrend data={indexData} series={['Sales (index)', 'Ad Spend (index)']} title="Index Portfolio (base 100)" />
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '-0.75rem 0 0' }}>
            Index mencakup seluruh client aktif per bulan, termasuk yang baru bergabung — bukan cohort tetap.
            Untuk melihat bentuk musiman portfolio, bukan angka pertumbuhan like-for-like.
            <br />{data.portfolio_index.base_note}
          </p>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <h3 style={{ fontSize: '1rem', padding: '1rem 1.5rem 0' }}>Actual vs Target per Kategori</h3>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.3rem 1.5rem 0' }}>
              Hanya client yang punya <code>target_sales</code> untuk {data.period}. Client tanpa target di-exclude (bukan dianggap 0).
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ marginTop: '1rem' }}>
                <thead>
                  <tr><th>Kategori</th><th>Actual</th><th>Target</th><th>Pencapaian</th><th>Client dihitung</th><th>Tanpa target (di-exclude)</th></tr>
                </thead>
                <tbody>
                  {data.actual_vs_target.map((t) => (
                    <tr key={t.kategori_besar}>
                      <td>{t.kategori_besar}</td>
                      <td>{money(t.actual)}</td>
                      <td>{money(t.target)}</td>
                      <td style={{ fontWeight: 600, color: t.attainment_pct == null ? 'inherit' : t.attainment_pct >= 1 ? '#059669' : 'var(--danger)' }}>{pct(t.attainment_pct)}</td>
                      <td>{t.n_included}</td>
                      <td title={t.excluded_no_target.join(', ')}>{t.n_excluded_no_target}{t.n_excluded_no_target ? ` (${t.excluded_no_target.join(', ')})` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
