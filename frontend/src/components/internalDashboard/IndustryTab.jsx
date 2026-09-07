import { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import api from '../../api/client.js';
import { formatPercent } from '../../utils/format.js';
import OverviewFilterBar from './OverviewFilterBar.jsx';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const DEFAULTS = { period: thisMonth(), compare: 'mom', status: 'active', basis: 'like_for_like', level: 'sub_industry' };
const money = (v) => (v == null ? '-' : `Rp${new Intl.NumberFormat('id-ID').format(Math.round(v))}`);
const pct = (v) => (v == null ? '-' : formatPercent(v * 100, 1));

// growth -> background colour (red = shrinking, green = growing, grey = no data)
function growthColor(g) {
  if (g == null) return 'var(--border)';
  const clamped = Math.max(-0.3, Math.min(0.3, g));
  return clamped < 0
    ? `rgba(239, 68, 68, ${0.15 + (Math.abs(clamped) / 0.3) * 0.6})`
    : `rgba(16, 185, 129, ${0.15 + (clamped / 0.3) * 0.6})`;
}

// S4 — Industry / Sub-industry. Size/growth "treemap" is rendered as
// growth-coloured bars sized by sales (no chart lib). N shown transparently,
// no minimum-n gate (§4).
export default function IndustryTab() {
  const [filters, setFilters] = useState(DEFAULTS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/industries', { params: filters })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data industry'))
      .finally(() => setLoading(false));
  }, [filters]);

  const maxSales = useMemo(
    () => Math.max(1, ...(data?.groups || []).map((g) => g.sales || 0)),
    [data],
  );

  const levelSelect = (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label>Level</label>
      <select value={filters.level} onChange={(e) => setFilters((f) => ({ ...f, level: e.target.value }))}>
        <option value="sub_industry">Sub-industry</option>
        <option value="industry">Industry</option>
      </select>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <OverviewFilterBar value={filters} onChange={setFilters} hide={['category']} extra={levelSelect} />
      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data && <div className="empty-state">Memuat...</div>}

      {data && (
        <>
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem' }}>Ukuran &amp; Pertumbuhan per {data.filters.level === 'industry' ? 'Industry' : 'Sub-industry'}</h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>Lebar = sales periode ini · warna = growth agregat ({data.filters.compare.toUpperCase()}).</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {data.groups.filter((g) => g.sales > 0).map((g) => (
                <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ width: 150, fontSize: '0.8rem', textAlign: 'right', color: 'var(--text-muted)' }}>{g.key}</span>
                  <div style={{ flex: 1, background: 'var(--border)', borderRadius: 4, height: 24 }}>
                    <div style={{
                      width: `${(g.sales / maxSales) * 100}%`, height: '100%', borderRadius: 4,
                      background: growthColor(g.aggregate_growth), display: 'flex', alignItems: 'center',
                      paddingLeft: 8, fontSize: '0.72rem', whiteSpace: 'nowrap',
                    }}>
                      {money(g.sales)} · {pct(g.aggregate_growth)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <h3 style={{ fontSize: '1rem', padding: '1rem 1.5rem 0' }}>Tabel Benchmark</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ marginTop: '1rem' }}>
                <thead>
                  <tr>
                    <th>{data.filters.level === 'industry' ? 'Industry' : 'Sub-industry'}</th>
                    <th>Kategori</th><th>N</th><th>Ada data</th><th>Ada spend</th>
                    <th>Sales</th><th>Median sales/client</th>
                    <th>Growth agregat</th><th>Median growth/client</th><th>Median ROAS/client</th>
                    <th>Median CPM/client</th><th>Median CTR/client</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => (
                    <tr key={g.key}>
                      <td>
                        {g.key}
                        {g.n_clients < 3 && (
                          <span className="badge badge-warning" style={{ marginLeft: 6, fontSize: '0.58rem' }}
                            title="N < 3 — ditampilkan tapi kurang bermakna secara statistik, bukan dasar benchmark">n&lt;3</span>
                        )}
                      </td>
                      <td>{g.kategori_besar || '-'}</td>
                      <td>{g.n_clients}</td>
                      <td>{g.n_with_data}</td>
                      <td>{g.n_with_spend}</td>
                      <td>{money(g.sales)}</td>
                      <td>{money(g.median_client_sales)}</td>
                      <td>{pct(g.aggregate_growth)}</td>
                      <td>{pct(g.median_client_growth)}</td>
                      <td>{g.median_client_roas?.toFixed(2) ?? '-'}</td>
                      <td>{g.median_client_cpm != null ? money(g.median_client_cpm) : '-'}</td>
                      <td>{g.median_client_ctr != null ? formatPercent(g.median_client_ctr * 100, 2) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
            <Info size={13} style={{ marginTop: 2, flexShrink: 0 }} />
            N ditampilkan apa adanya — tidak ada ambang minimum (§4). Grup dengan N kecil secara statistik kurang bermakna, tapi tetap ditampilkan.
            {data.ungrouped.client_count > 0 && ` ${data.ungrouped.client_count} client tanpa ${data.filters.level === 'industry' ? 'industry' : 'sub-industry'} tidak masuk tabel.`}
          </p>
        </>
      )}
    </div>
  );
}
