import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import api from '../../api/client.js';
import KpiCard from '../dashboard/KpiCard.jsx';
import DonutChart from '../dashboard/DonutChart.jsx';
import ParetoChart from '../dashboard/ParetoChart.jsx';
import OverviewFilterBar from './OverviewFilterBar.jsx';
import SingleMetricTrendChart from './SingleMetricTrendChart.jsx';
import StackedShareArea from './StackedShareArea.jsx';
import GrowthDistribution from './GrowthDistribution.jsx';
import PerluPerhatianPanel from './PerluPerhatianPanel.jsx';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const DEFAULTS = { period: thisMonth(), compare: 'mom', category: 'all', status: 'active', basis: 'like_for_like' };

const money = (v) => new Intl.NumberFormat('id-ID').format(Math.round(v || 0));
// KpiCard expects `growth` already on the 0-100 scale (see main dashboard's
// calculateGrowth); this API returns fractions, so scale here.
const gpct = (frac) => (frac == null ? null : frac * 100);

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
  // ParetoChart expects { label, revenue, contributionPct, cumulativePct },
  // the last two on the 0-100 scale (API returns fractions).
  const paretoData = (data?.client_contribution || []).slice(0, 12).map((c) => ({
    label: c.brand_name,
    revenue: c.sales,
    contributionPct: (c.share_pct ?? 0) * 100,
    cumulativePct: (c.cumulative_pct ?? 0) * 100,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <OverviewFilterBar value={filters} onChange={setFilters} />

      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data && <div className="empty-state">Memuat...</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(238px, 1fr))', gap: '1rem' }}>
            <KpiCard title="Total Portfolio Sales" value={kpi.total_sales.value} type="currency" growth={gpct(kpi.total_sales.delta_pct)}
              note={`${compareLabel}: Rp${money(kpi.total_sales.compare)}`} />
            <KpiCard title="Total Ad Spend" value={kpi.total_spend.value} type="currency" growth={gpct(kpi.total_spend.delta_pct)} invert
              note={kpi.total_spend.compare != null ? `${compareLabel}: Rp${money(kpi.total_spend.compare)}` : null} />
            <KpiCard title="Blended ROAS" value={kpi.blended_roas.value} type="number" growth={gpct(kpi.blended_roas.delta_pct)}
              note={`Revenue ÷ ad spend. Data spend: ${kpi.spend_coverage.value} dari ${kpi.spend_coverage.of} client${
                kpi.spend_coverage.of > 0 && kpi.spend_coverage.value < kpi.spend_coverage.of ? ' — angka belum representatif' : ''}`} />
            <KpiCard title="Ad Cost Ratio" value={kpi.ad_cost_ratio.value} type="percentage" growth={gpct(kpi.ad_cost_ratio.delta_pct)} invert
              note="Total ad spend ÷ total sales (blended). Naik = biaya iklan makin berat terhadap penjualan." />
            <KpiCard title="Rata-rata Sales / Client" value={kpi.avg_sales_per_client.value} type="currency" growth={gpct(kpi.avg_sales_per_client.delta_pct)}
              note={`Total sales ÷ ${kpi.avg_sales_per_client.of} client yang punya data periode ini.`} />
            <KpiCard title="Total Transaksi" value={kpi.total_transaksi.value} type="number" growth={gpct(kpi.total_transaksi.delta_pct)}
              note={kpi.total_transaksi.value == null ? 'Belum ada client yang mengisi kolom transaksi.' : `${compareLabel}: ${money(kpi.total_transaksi.compare)}`} />
            <KpiCard title="Client Tumbuh" value={kpi.clients_growing.pct} type="percentage"
              note={kpi.clients_growing.of == null
                ? 'Tidak tersedia untuk pembanding target.'
                : `${kpi.clients_growing.value} dari ${kpi.clients_growing.of} client like-for-like naik ${filters.compare === 'yoy' ? 'YoY' : 'MoM'}.`} />
            <KpiCard title="Client Aktif" value={kpi.active_clients.value} type="number"
              note="Snapshot saat ini — belum ada histori join/churn sampai join_date terkumpul." />
            <KpiCard title="Client Ada Data" value={kpi.clients_with_data.value} type="number"
              note={`dari ${kpi.clients_with_data.of} client dalam filter ini`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
            <SingleMetricTrendChart trend={data.trend} metricKey="sales" title="Tren Sales Portfolio — 13 bulan" kind="line" color="var(--primary)" />
            <SingleMetricTrendChart trend={data.trend} metricKey="spend" title="Tren Ad Spend Portfolio — 13 bulan" kind="bar" color="#f59e0b" />
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '-0.75rem 0 0' }}>
            Sales dan Ad Spend dipisah jadi dua chart, satu sumbu Y per chart — bukan dual-axis.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
            <DonutChart data={categoryData} title="Komposisi Sales per Kategori" centerLabel="Total Sales"
              valueFormatter={(v) => `Rp${money(v)}`} />
            <GrowthDistribution data={data.growth_distribution} />
          </div>

          <StackedShareArea data={data.category_trend || []} series={['Retail', 'B2B/Service', 'F&B']}
            title="Pergeseran Komposisi Portfolio — 13 bulan"
            subtitle="Share sales per kategori, tiap bulan dinormalkan ke 100% — supaya pergeseran komposisi kelihatan, bukan cuma total." />

          {paretoData.length > 0 && (
            <ParetoChart data={paretoData} title="Kontribusi Client (Top 12) — Pareto" />
          )}

          <PerluPerhatianPanel data={data.perlu_perhatian} />

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
