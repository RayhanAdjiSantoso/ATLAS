import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import api from '../../api/client.js';
import { formatPercent } from '../../utils/format.js';
import KpiCard from '../dashboard/KpiCard.jsx';
import OverviewFilterBar from './OverviewFilterBar.jsx';
import MultiLineTrend from './MultiLineTrend.jsx';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const DEFAULTS = { period: thisMonth(), compare: 'mom', status: 'active', basis: 'like_for_like' };
const KATS = ['Retail', 'B2B/Service', 'F&B'];
const money = (v) => (v == null ? '-' : `Rp${new Intl.NumberFormat('id-ID').format(Math.round(v))}`);
const pct = (v) => (v == null ? '-' : formatPercent(v * 100, 1));

// S3 — Kategori Besar. Cross-category comparison is MEDIAN-based (§4); the
// aggregate sum/sum figures sit alongside, labelled.
export default function CategoryComparisonTab() {
  const [filters, setFilters] = useState(DEFAULTS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/categories', { params: filters })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data kategori'))
      .finally(() => setLoading(false));
  }, [filters]);

  const cmpLabel = filters.compare === 'target' ? 'vs target' : filters.compare === 'yoy' ? 'YoY' : 'MoM';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <OverviewFilterBar value={filters} onChange={setFilters} hide={['category']} />
      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data && <div className="empty-state">Memuat...</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            {data.categories.map((c) => (
              <KpiCard key={c.kategori_besar} title={c.kategori_besar} value={c.aggregate.sales} type="currency"
                growth={c.aggregate.delta_pct}
                note={`${c.aggregate.client_count} client · ROAS ${c.aggregate.blended_roas?.toFixed(2) ?? '-'}`
                  + `${c.aggregate.spend_coverage.of > 0 && c.aggregate.spend_coverage.value < c.aggregate.spend_coverage.of
                    ? ` (spend ${c.aggregate.spend_coverage.value}/${c.aggregate.spend_coverage.of})` : ''}`
                  + ` · share ${pct(c.composition.share_now)} (${cmpLabel} ${c.composition.share_delta >= 0 ? '+' : ''}${pct(c.composition.share_delta)})`} />
            ))}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem 0' }}>
              <h3 style={{ fontSize: '1rem' }}>Median client vs Agregat portfolio</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
                Kolom <strong>median</strong> tahan terhadap 1 client besar yang menarik angka. Agregat = sum/sum seluruh client di kategori.
              </p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ marginTop: '1rem' }}>
                <thead>
                  <tr>
                    <th>Kategori</th>
                    <th>Sales agregat</th><th>Growth agregat</th><th>ROAS agregat</th>
                    <th>Median sales/client</th><th>Median growth/client</th><th>Median ROAS/client</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((c) => (
                    <tr key={c.kategori_besar}>
                      <td>{c.kategori_besar}</td>
                      <td>{money(c.aggregate.sales)}</td>
                      <td>{pct(c.aggregate.delta_pct)}</td>
                      <td>{c.aggregate.blended_roas?.toFixed(2) ?? '-'}</td>
                      <td>{money(c.median.client_sales)}</td>
                      <td>{pct(c.median.client_growth)}</td>
                      <td>{c.median.client_roas?.toFixed(2) ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <MultiLineTrend data={data.trend} series={KATS} title="Tren Sales per Kategori — 13 bulan" />

          {data.uncategorized.client_count > 0 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
              <Info size={13} style={{ marginTop: 2, flexShrink: 0 }} />
              {data.uncategorized.client_count} client belum punya kategori (industry kosong di master) —
              tidak masuk perbandingan di atas. Data mereka: {money(data.uncategorized.sales)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
