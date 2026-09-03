import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import api from '../../api/client.js';
import KpiCard from '../dashboard/KpiCard.jsx';
import DonutChart from '../dashboard/DonutChart.jsx';
import ParetoChart from '../dashboard/ParetoChart.jsx';
import OverviewFilterBar from './OverviewFilterBar.jsx';
import OverviewTrendChart from './OverviewTrendChart.jsx';
import GrowthDistribution from './GrowthDistribution.jsx';
import PerluPerhatianPanel from './PerluPerhatianPanel.jsx';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const DEFAULTS = { period: thisMonth(), compare: 'mom', category: 'all', status: 'active', basis: 'like_for_like' };

const money = (v) => new Intl.NumberFormat('id-ID').format(Math.round(v || 0));

// S1 — Executive Overview. First view section of the Internal Dashboard.
export default function ExecutiveOverviewTab() {
  const [filters, setFilters] = useState(DEFAULTS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/overview', { params: filters })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat overview'))
      .finally(() => setLoading(false));
  }, [filters]);

  const kpi = data?.kpi;
  const compareLabel = filters.compare === 'target' ? 'vs target'
    : filters.compare === 'yoy' ? 'vs tahun lalu' : 'vs bulan lalu';

  const categoryData = (data?.category_composition || []).map((c) => ({ name: c.kategori_besar, value: c.sales }));
  const paretoData = (data?.client_contribution || []).slice(0, 12).map((c) => ({
    name: c.brand_name,
    revenue: c.sales,
    cumulativePct: (c.cumulative_pct ?? 0) * 100,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <OverviewFilterBar value={filters} onChange={setFilters} />

      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data && <div className="empty-state">Memuat...</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <KpiCard title="Total Portfolio Sales" value={kpi.total_sales.value} type="currency" growth={kpi.total_sales.delta_pct}
              note={`${compareLabel}: Rp${money(kpi.total_sales.compare)}`} />
            <KpiCard title="Total Ad Spend" value={kpi.total_spend.value} type="currency" growth={kpi.total_spend.delta_pct} invert
              note={kpi.total_spend.compare != null ? `${compareLabel}: Rp${money(kpi.total_spend.compare)}` : null} />
            <KpiCard title="Blended ROAS" value={kpi.blended_roas.value} type="number" growth={kpi.blended_roas.delta_pct}
              note={`Revenue ÷ ad spend. Data spend: ${kpi.spend_coverage.value} dari ${kpi.spend_coverage.of} client${
                kpi.spend_coverage.of > 0 && kpi.spend_coverage.value < kpi.spend_coverage.of ? ' — angka belum representatif' : ''}`} />
            <KpiCard title="Client Aktif" value={kpi.active_clients.value} type="number"
              note="Snapshot saat ini — belum ada histori join/churn sampai join_date terkumpul." />
            <KpiCard title="Client Ada Data" value={kpi.clients_with_data.value} type="number"
              note={`dari ${kpi.clients_with_data.of} client dalam filter ini`} />
          </div>

          <OverviewTrendChart trend={data.trend} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
            <DonutChart data={categoryData} title="Komposisi Sales per Kategori" centerLabel="Total Sales"
              valueFormatter={(v) => `Rp${money(v)}`} />
            <GrowthDistribution data={data.growth_distribution} />
          </div>

          {paretoData.length > 0 && (
            <ParetoChart data={paretoData} title="Kontribusi Client (Top 12) — Pareto" />
          )}

          <PerluPerhatianPanel rows={data.perlu_perhatian} threshold={data.thresholds} />

          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
            <Info size={13} style={{ marginTop: 2, flexShrink: 0 }} />
            Angka masih perlu divalidasi terhadap data riil. Logika waterfall/like-for-like (S2) dan ambang
            &ldquo;Perlu Perhatian&rdquo; dikalibrasi ulang begitu 2+ bulan data client masuk.
          </p>
        </>
      )}
    </div>
  );
}
