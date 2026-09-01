import { useEffect, useState } from 'react';
import { Info, Check } from 'lucide-react';
import api from '../../api/client.js';
import { formatPercent } from '../../utils/format.js';
import KpiCard from '../dashboard/KpiCard.jsx';
import DonutChart from '../dashboard/DonutChart.jsx';
import OverviewFilterBar from './OverviewFilterBar.jsx';
import MultiLineTrend from './MultiLineTrend.jsx';
import { SALES_CHANNELS, AD_PLATFORMS } from './constants.js';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const DEFAULTS = { period: thisMonth(), compare: 'mom', status: 'active', category: 'all' };
const money = (v) => (v == null ? '-' : `Rp${new Intl.NumberFormat('id-ID').format(Math.round(v))}`);
const pct = (v) => (v == null ? '-' : formatPercent(v * 100, 1));
const chanLabel = (v) => SALES_CHANNELS.find((c) => c.value === v)?.label || v;
const platLabel = (v) => AD_PLATFORMS.find((p) => p.value === v)?.label || v;

// S6 — Channel & Platform.
export default function ChannelPlatformTab() {
  const [filters, setFilters] = useState(DEFAULTS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/channels', { params: filters })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data channel'))
      .finally(() => setLoading(false));
  }, [filters]);

  const coveragePct = data && data.portfolio_sales
    ? data.total_channel_sales / data.portfolio_sales : null;

  const channelDonut = (data?.sales_channels || [])
    .filter((c) => c.sales != null)
    .map((c) => ({ name: chanLabel(c.channel), value: c.sales }));
  const spendDonut = (data?.ad_platforms || [])
    .filter((p) => p.spend != null)
    .map((p) => ({ name: platLabel(p.platform), value: p.spend }));

  const activePlatforms = (data?.ad_platforms || []).filter((p) => p.spend != null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <OverviewFilterBar value={filters} onChange={setFilters} hide={['basis']} compareOptions={['mom', 'yoy']} />
      {error && <div className="alert alert-error">{error}</div>}
      {loading && !data && <div className="empty-state">Memuat...</div>}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <KpiCard title="Total Sales per Channel" value={data.total_channel_sales} type="currency"
              note={coveragePct != null ? `${pct(coveragePct)} dari portfolio sales (${money(data.portfolio_sales)})` : null} />
            <KpiCard title="Total Ad Spend" value={data.total_platform_spend} type="currency" invert />
            <KpiCard title="Channel Terpakai" value={data.sales_channels.filter((c) => c.sales != null).length} type="number"
              note={`dari ${data.sales_channels.length} channel`} />
            <KpiCard title="Platform Terpakai" value={activePlatforms.length} type="number"
              note={`dari ${data.ad_platforms.length} platform`} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
            <DonutChart data={channelDonut} title="Sales per Channel" centerLabel="Total" valueFormatter={money} />
            <DonutChart data={spendDonut} title="Alokasi Spend per Platform" centerLabel="Total" valueFormatter={money} />
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem 0' }}>
              <h3 style={{ fontSize: '1rem' }}>Efisiensi per Platform</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>
                Semua rasio dihitung ulang dari raw (spend / impressions / clicks / purchase).
                <strong> Attr. ROAS = purchase_value / spend</strong> — angka atribusi platform, bukan ROAS bisnis (revenue/spend ada di Executive Overview).
              </p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ marginTop: '1rem' }}>
                <thead>
                  <tr>
                    <th>Platform</th><th>Spend</th><th>Share</th><th>Δ Spend</th>
                    <th>Purchase</th><th>Attr. ROAS</th><th>Cost/Purchase</th>
                    <th>CPM</th><th>CTR</th><th>CPC</th><th>Cost/PV</th><th>N</th>
                  </tr>
                </thead>
                <tbody>
                  {activePlatforms.map((p) => (
                    <tr key={p.platform}>
                      <td>{platLabel(p.platform)}</td>
                      <td>{money(p.spend)}</td>
                      <td>{pct(p.spend_share_pct)}</td>
                      <td>{pct(p.delta_spend_pct)}</td>
                      <td>{p.purchases ?? '-'}</td>
                      <td>{p.platform_attributed_roas?.toFixed(2) ?? '-'}</td>
                      <td>{money(p.cost_per_purchase)}</td>
                      <td>{money(p.cpm)}</td>
                      <td>{p.ctr != null ? formatPercent(p.ctr * 100, 2) : '-'}</td>
                      <td>{money(p.cpc)}</td>
                      <td>
                        {money(p.cost_per_profile_visit_proxy)}
                        {p.cost_per_profile_visit_is_proxy && (
                          <span className="badge badge-warning" style={{ marginLeft: 4, fontSize: '0.6rem' }}>PROXY</span>
                        )}
                      </td>
                      <td>{p.client_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <MultiLineTrend data={data.channel_trend} series={SALES_CHANNELS.map((c) => c.value)} title="Tren Sales per Channel — 13 bulan" />
          <MultiLineTrend data={data.spend_trend} series={AD_PLATFORMS.map((p) => p.value)} title="Tren Spend per Platform — 13 bulan" />

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.5rem 0' }}>
              <h3 style={{ fontSize: '1rem' }}>Cakupan Channel per Client</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.3rem 0 0', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                <Info size={13} style={{ marginTop: 2, flexShrink: 0 }} />
                &ldquo;Punya&rdquo; = ada ≥1 bulan data dalam 13 bulan terakhir. <code>client_sales_channels</code> (§2.2) belum ada,
                jadi sel kosong belum bisa dibedakan antara &ldquo;tidak dipakai&rdquo; dan &ldquo;belum diinput&rdquo;.
              </p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ marginTop: '1rem' }}>
                <thead>
                  <tr>
                    <th>Client</th>
                    {SALES_CHANNELS.map((c) => <th key={c.value} style={{ fontSize: '0.7rem' }}>{c.label}</th>)}
                    {AD_PLATFORMS.map((p) => <th key={p.value} style={{ fontSize: '0.7rem' }}>{p.label.replace('Meta — ', 'M:')}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.client_coverage.map((row) => (
                    <tr key={row.brand_id}>
                      <td>{row.brand_name}</td>
                      {SALES_CHANNELS.map((c) => (
                        <td key={c.value} style={{ textAlign: 'center' }}>{row.channels[c.value] ? <Check size={14} /> : '·'}</td>
                      ))}
                      {AD_PLATFORMS.map((p) => (
                        <td key={p.value} style={{ textAlign: 'center' }}>{row.platforms[p.value] ? <Check size={14} /> : '·'}</td>
                      ))}
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
