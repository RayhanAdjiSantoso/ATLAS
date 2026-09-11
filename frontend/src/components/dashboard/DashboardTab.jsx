import { useState, Children, Fragment } from 'react';
import { Download, Building2, Inbox, RotateCcw } from 'lucide-react';
import KpiCard from './KpiCard.jsx';
import LineChart from './LineChart.jsx';
import DonutChart from './DonutChart.jsx';
import FunnelChart from './FunnelChart.jsx';
import CalendarHeatmap from './CalendarHeatmap.jsx';
import ProductTransitionTable from './ProductTransitionTable.jsx';
import ParetoChart from './ParetoChart.jsx';
import RootCauseTree from './RootCauseTree.jsx';
import GrainWarning from './GrainWarning.jsx';
import { formatPercent } from '../../utils/format.js';

function HorizontalBarChart({ data = [], nameKey = 'name', valueKey = 'value', title = 'Top 10' }) {
  const maxVal = Math.max(...data.map(d => Number(d[valueKey] || 0)), 1);
  const formatValue = (val) => (
    title.includes('Rupiah') || title.includes('Sales') || title.includes('Penjualan') || valueKey === 'sales'
      ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)
      : new Intl.NumberFormat('id-ID').format(val)
  );
  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1.25rem', color: 'var(--text)' }}>{title}</h3>
      {data.length === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
          Belum ada data untuk ditampilkan
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {data.map((item, idx) => {
          const val = Number(item[valueKey] || 0);
          const percent = (val / maxVal) * 100;
          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div
                style={{
                  width: '150px',
                  flexShrink: 0,
                  fontSize: '0.8rem',
                  lineHeight: '1.3',
                  color: 'var(--text-muted)',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}
                title={item[nameKey]}
              >
                {item[nameKey]}
              </div>
              <div style={{ flex: 1, height: '24px', background: 'var(--bg-elevated)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${percent}%`, height: '100%', background: 'linear-gradient(90deg, var(--primary) 0%, #8b5cf6 100%)', borderRadius: '4px' }}></div>
              </div>
              <div style={{ flexShrink: 0, whiteSpace: 'nowrap', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text)' }}>
                {formatValue(val)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IndonesiaMapChart({ data = [] }) {
  const regions = [
    {
      name: 'Sumatera',
      x: 70, y: 70,
      provinces: ['ACEH', 'SUMATERA UTARA', 'SUMATERA BARAT', 'RIAU', 'KEPULAUAN RIAU', 'JAMBI', 'BENGKULU', 'SUMATERA SELATAN', 'KEPULAUAN BANGKA BELITUNG', 'LAMPUNG']
    },
    {
      name: 'Jawa',
      x: 160, y: 145,
      provinces: ['DKI JAKARTA', 'JAWA BARAT', 'JAWA TENGAH', 'DI YOGYAKARTA', 'JAWA TIMUR', 'BANTEN']
    },
    {
      name: 'Kalimantan',
      x: 180, y: 70,
      provinces: ['KALIMANTAN BARAT', 'KALIMANTAN TENGAH', 'KALIMANTAN SELATAN', 'KALIMANTAN TIMUR', 'KALIMANTAN UTARA']
    },
    {
      name: 'Sulawesi',
      x: 250, y: 85,
      provinces: ['SULAWESI UTARA', 'GORONTALO', 'SULAWESI TENGAH', 'SULAWESI BARAT', 'SULAWESI SELATAN', 'SULAWESI TENGGARA']
    },
    {
      name: 'Bali & Nusa Tenggara',
      x: 200, y: 155,
      provinces: ['BALI', 'NUSA TENGGARA BARAT', 'NUSA TENGGARA TIMUR']
    },
    {
      name: 'Papua & Maluku',
      x: 360, y: 95,
      provinces: ['MALUKU', 'MALUKU UTARA', 'PAPUA', 'PAPUA BARAT', 'PAPUA TENGAH', 'PAPUA PEGUNUNGAN', 'PAPUA SELATAN', 'PAPUA BARAT DAYA']
    }
  ];

  const regionSales = regions.map(reg => {
    const matched = data.filter(p => reg.provinces.includes(p.province.toUpperCase().trim()));
    const totalSales = matched.reduce((acc, curr) => acc + Number(curr.sales || 0), 0);
    const topProvs = [...matched].sort((a,b) => b.sales - a.sales).slice(0, 3);
    return {
      ...reg,
      sales: totalSales,
      topProvs
    };
  });

  const maxSales = Math.max(...regionSales.map(r => r.sales), 1);
  const [hoveredRegion, setHoveredRegion] = useState(null);

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
  };

  return (
    <div className="card" style={{ padding: '1.25rem', position: 'relative' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1.25rem', color: 'var(--text)' }}>Geographic Sales Map (Sebaran Penjualan Pulau)</h3>
      <div style={{ position: 'relative', width: '100%', height: '260px', background: 'var(--bg-elevated)', borderRadius: '8px', padding: '1rem', overflow: 'hidden' }}>

        <svg viewBox="0 0 500 200" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ filter: 'drop-shadow(0px 4px 10px rgba(15, 23, 42, 0.12))' }}>
          {/* Sumatera */}
          <path d="M30,50 L60,35 L110,75 L90,120 L50,100 Z" fill="rgba(15, 23, 42, 0.05)" stroke="var(--border)" strokeWidth="1" />
          {/* Jawa */}
          <path d="M110,140 L220,145 L215,155 L110,150 Z" fill="rgba(15, 23, 42, 0.05)" stroke="var(--border)" strokeWidth="1" />
          {/* Kalimantan */}
          <path d="M150,55 L200,45 L215,95 L160,105 Z" fill="rgba(15, 23, 42, 0.05)" stroke="var(--border)" strokeWidth="1" />
          {/* Sulawesi */}
          <path d="M230,65 L250,65 L250,90 L270,90 L270,100 L250,100 L250,120 L235,120 Z" fill="rgba(15, 23, 42, 0.05)" stroke="var(--border)" strokeWidth="1" />
          {/* Bali Nusa Tenggara */}
          <path d="M225,150 L275,155 L275,160 L225,155 Z" fill="rgba(15, 23, 42, 0.05)" stroke="var(--border)" strokeWidth="1" />
          {/* Papua & Maluku */}
          <path d="M315,90 L330,95 L360,85 L395,95 L390,115 L350,120 L320,110 Z" fill="rgba(15, 23, 42, 0.05)" stroke="var(--border)" strokeWidth="1" />

          {regionSales.map((reg, idx) => {
            if (reg.sales === 0) return null;
            const ratio = reg.sales / maxSales;
            const radius = 6 + ratio * 15;
            const opacity = 0.5 + ratio * 0.5;

            return (
              <g key={idx} style={{ cursor: 'pointer' }}
                 onMouseEnter={() => setHoveredRegion(reg)}
                 onMouseLeave={() => setHoveredRegion(null)}>
                
                <circle
                  cx={reg.x}
                  cy={reg.y}
                  r={radius + 6}
                  fill="var(--primary)"
                  opacity={0.15}
                  style={{ transformOrigin: `${reg.x}px ${reg.y}px` }}
                >
                  <animate attributeName="r" values={`${radius}px;${radius+12}px;${radius}px`} dur="2.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0;0.3" dur="2.5s" repeatCount="indefinite" />
                </circle>

                <circle
                  cx={reg.x}
                  cy={reg.y}
                  r={radius}
                  fill="var(--primary)"
                  opacity={opacity}
                  stroke="white"
                  strokeWidth="1.5"
                />
              </g>
            );
          })}
        </svg>

        {hoveredRegion && (
          <div style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '0.75rem',
            boxShadow: 'var(--shadow)',
            fontSize: '0.75rem',
            maxWidth: '220px',
            zIndex: 10,
            color: 'var(--text)'
          }}>
            <strong style={{ fontSize: '0.85rem', color: 'var(--primary)' }}>{hoveredRegion.name}</strong>
            <div style={{ margin: '4px 0 8px 0', fontSize: '0.8rem', fontWeight: '700' }}>
              Sales: {formatCurrency(hoveredRegion.sales)}
            </div>
            {hoveredRegion.topProvs.length > 0 && (
              <>
                <div style={{ color: 'var(--text-muted)', marginBottom: '4px', fontSize: '0.7rem' }}>Top 3 Provinsi:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {hoveredRegion.topProvs.map((p, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.province}</span>
                      <span style={{ fontWeight: '600' }}>{formatCurrency(p.sales)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function PeriodHeader({ title, range }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.6rem 1rem', background: 'var(--bg-elevated)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    }}>
      <span style={{ fontWeight: 700, color: 'var(--text)' }}>{title}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{range}</span>
    </div>
  );
}

// One metric's best/worst performing day, formatted for display. Reuses
// computeMetricExtremes (same logic as the Business Growth tab) so "best day"
// means the same thing everywhere in the dashboard: the day with the
// highest/lowest actual value for that specific metric, ties included.
function BestWorstDayCard({ label, trends, metric, formatValue }) {
  const { bestDates, worstDates } = computeMetricExtremes(trends, metric);

  const describe = (dateSet) => {
    const entries = trends.filter((t) => dateSet.has(t.date));
    if (entries.length === 0) return null;
    return entries.map((t) => `${formatDateLabel(t.date)} (${formatValue(t[metric])})`).join(', ');
  };

  const bestText = describe(bestDates);
  const worstText = describe(worstDates);

  return (
    <div className="con-tile" style={{ padding: '1rem' }}>
      <div style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text)', marginBottom: '0.5rem' }}>{label}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--success)', marginBottom: '0.3rem' }}>
        <strong>Terbaik:</strong> {bestText || '-'}
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>
        <strong>Terburuk:</strong> {worstText || '-'}
      </div>
    </div>
  );
}

// TAB 1: EXECUTIVE SNAPSHOT
function renderExecutiveSnapshot(data, { onNavigateTab, stripOwnsKpis = false } = {}) {
    const {
      kpis = {},
      health = { details: {} },
      buyerComposition = {},
      topProduct = null,
      bottomProduct = null,
      trends = [],
      productGrainWarning = null,
    } = data || {};

    const formatNumber = (val) => new Intl.NumberFormat('id-ID').format(val || 0);
    const formatCurrency = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0);

    // Reuses the same daily trend data Business Growth's "Tren GMV" chart is
    // built from -- no separate query -- just condensed into a sparkline
    // instead of duplicating the full chart here.
    const gmvSparkline = trends.map((t) => Number(t.gmv || 0));

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* KPI Grid.

            The console's KPI strip is this exact row, pinned above the panel
            and visible whichever domain is focused, so printing it again here
            showed the same eight figures twice in one viewport. `stripOwnsKpis`
            is set only when the strip is actually carrying them — in comparison
            mode the strip shows the main period alone, so both columns keep
            their own grid and no comparison figure goes missing. */}
        {!stripOwnsKpis && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <KpiCard title="GMV (Penjualan)" value={kpis.gmv?.value} type="currency" growth={kpis.gmv?.growth} sparkline={gmvSparkline} note="Tren harian GMV lengkap ada di tab Business Growth." />
            <KpiCard title="Transaksi" value={kpis.transactions?.value} type="number" growth={kpis.transactions?.growth} />
            <KpiCard title="Produk Terjual (Unit)" value={kpis.unitsSold?.value} type="number" growth={kpis.unitsSold?.growth} />
            <KpiCard title="AOV (Rata-rata Order)" value={kpis.aov?.value} type="currency" growth={kpis.aov?.growth} />
            <KpiCard title="Pelanggan Unik" value={kpis.uniqueCustomers?.value} type="number" growth={kpis.uniqueCustomers?.growth} />
            <KpiCard title="Tingkat Konversi (CVR Pesanan)" value={kpis.cvr?.value} type="percentage" growth={kpis.cvr?.growth} note="Rata-rata harian 'Tingkat Konversi Pesanan' yang dilaporkan Shopee langsung (Pesanan Dibayar / Pengunjung). Berbeda basis hitung dari 'CVR Funnel' di tab Traffic & Funnel." />
            <KpiCard title="Tingkat Pembatalan" value={kpis.cancellationRate?.value} type="percentage" growth={kpis.cancellationRate?.growth} invert note="Kenaikan tingkat pembatalan adalah sinyal negatif, sehingga ditandai merah meskipun nilainya naik." />
            <KpiCard title="Total Diskon Diberikan" value={kpis.totalDiscount?.value} type="currency" growth={kpis.totalDiscount?.growth} />
          </div>
        )}

        {/* Best/Worst Performing Day per metric */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>Hari Performa Terbaik &amp; Terburuk</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <BestWorstDayCard label="GMV" trends={trends} metric="gmv" formatValue={formatCurrency} />
            <BestWorstDayCard label="Transaksi" trends={trends} metric="transactions" formatValue={formatNumber} />
            <BestWorstDayCard label="AOV" trends={trends} metric="aov" formatValue={formatCurrency} />
          </div>
        </div>

        {/* Funnel CTA -- full corong (Impression -> Siap Dikirim) now lives
            solely in Traffic & Funnel; CVR akhir tetap ada di KPI Grid di atas. */}
        <div className="card" style={{ padding: '1.1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1rem', color: 'var(--text)', marginBottom: '0.25rem' }}>Corong Konversi</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Analisis lengkap tiap tahap (Impression → Pesanan Siap Dikirim) beserta rasio konversinya ada di tab Traffic &amp; Funnel.</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab?.('Traffic & Funnel')}
            className="btn btn-secondary"
            style={{ fontWeight: '600', whiteSpace: 'nowrap' }}
          >
            Lihat analisis funnel →
          </button>
        </div>

        {/* Buyer composition / Top &amp; bottom product highlight */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', alignItems: 'stretch' }}>
          <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--text)' }}>Komposisi Pembeli</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="con-tile" style={{ padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--primary)' }}>{formatNumber(buyerComposition.newBuyers)}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pembeli Baru</div>
              </div>
              <div className="con-tile" style={{ padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#0d9488' }}>{formatNumber(buyerComposition.existingBuyers)}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pembeli Lama</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--text)' }}>Produk Terlaris (Revenue)</h3>
            {topProduct ? (
              <>
                <div style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text)' }} title={topProduct.name}>{topProduct.name}</div>
                <div style={{ display: 'flex', gap: '1.5rem' }}>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--primary)' }}>{formatCurrency(topProduct.revenue)}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Revenue</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text)' }}>{formatNumber(topProduct.quantity)}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Unit Terjual</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Belum ada data produk pada periode ini.</div>
            )}
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Ranking lengkap ada di tab Product Performance.</div>
          </div>

          <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--text)' }}>Produk Tidak Terlaris (Revenue)</h3>
            {bottomProduct ? (
              <>
                <div style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text)' }} title={bottomProduct.name}>{bottomProduct.name}</div>
                <div style={{ display: 'flex', gap: '1.5rem' }}>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text)' }}>{formatCurrency(bottomProduct.revenue)}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Total Revenue</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text)' }}>{formatNumber(bottomProduct.quantity)}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Unit Terjual</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Belum ada data produk pada periode ini.</div>
            )}
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Ranking lengkap ada di tab Product Performance.</div>
          </div>
        </div>

        <GrainWarning warning={productGrainWarning} />

        {/* Business Health Analysis */}
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>
              Kesehatan Toko:{' '}
              <span className={`con-band${(health.score || 0) >= 65 ? '' : ' is-watch'}`}>{health.label || '-'}</span>
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Skor analisis didasarkan pada metrik konversi (CVR) dan pertumbuhan penjualan.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--text)' }}>{health.score || 0}/100</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Skor Kesehatan</div>
            </div>

            <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '2rem' }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total Klik Produk: <strong>{new Intl.NumberFormat('id-ID').format(health.details?.productsClicked || 0)}</strong></div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Total Pengunjung Toko: <strong>{new Intl.NumberFormat('id-ID').format(health.details?.visitors || 0)}</strong></div>
            </div>
          </div>
        </div>

      </div>
    );
}

// Best/worst day for a single metric, independently: highest value = best,
// lowest value = worst, within the selected period. Each visualization on
// the Business Growth tab (Tren GMV, Tren Transaksi, Tren AOV, and the
// heatmap) judges its own metric on its own terms rather than sharing one
// cross-metric composite — so e.g. the GMV chart's best day is whichever day
// actually had the highest GMV, not a day that merely scored well overall.
function computeMetricExtremes(trends, metric) {
  const empty = { bestDates: new Set(), worstDates: new Set() };
  if (!trends || trends.length < 2) return empty;

  const vals = trends.map((t) => Number(t[metric] || 0));
  const max = Math.max(...vals);
  const min = Math.min(...vals);

  // No variation across the period — nothing is meaningfully "best"/"worst".
  if (max === min) return empty;

  return {
    bestDates: new Set(trends.filter((t) => Number(t[metric] || 0) === max).map((t) => t.date)),
    worstDates: new Set(trends.filter((t) => Number(t[metric] || 0) === min).map((t) => t.date)),
  };
}

// Linear-interpolation percentile (the standard method, same one spreadsheet
// PERCENTILE.INC uses) over an already-sorted ascending array.
function percentile(sortedVals, p) {
  const idx = p * (sortedVals.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedVals[lo];
  return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * (idx - lo);
}

// "Poor performing" day-marking for Business Growth's chart highlights --
// deliberately separate from computeMetricExtremes() above (which only ever
// flags the single best/worst day). Flags every day in the bottom quartile
// (below Q1) of the period's OWN distribution, recomputed fresh from
// whichever date range is currently selected -- never a fixed currency/count
// threshold, so it behaves sensibly whether the period is 7 days or 90 and
// regardless of a brand's typical GMV scale.
//
// Chose quartile-based over mean-minus-stddev deliberately: verified against
// real seeded data (see implementation notes) that a single promo-day spike
// inflates stddev enough to make "mean - 1 stddev" fall below every day in
// the period, i.e. it silently flags nothing on exactly the kind of
// spike-y data retail GMV actually has. Quartiles aren't dragged around by
// one outlier day the way mean/stddev are, so the rule stays consistently
// meaningful (flags close to the bottom ~25% of days either way).
function computePoorPerformingDates(trends, metric) {
  if (!trends || trends.length < 4) return new Set();

  const vals = trends.map((t) => Number(t[metric] || 0));
  const sorted = [...vals].sort((a, b) => a - b);

  // No spread across the period (flat or all-zero) -- nothing is
  // meaningfully "poor", same convention as computeMetricExtremes.
  if (sorted[0] === sorted[sorted.length - 1]) return new Set();

  const q1 = percentile(sorted, 0.25);
  return new Set(
    trends.filter((t) => Number(t[metric] || 0) < q1).map((t) => t.date)
  );
}

// Bright yellow for the "poor performing" (below-average) tier -- kept
// distinct from the design system's --warning token (a muted amber meant for
// text-on-light-background readability, e.g. .badge-warning) since this
// needs to read as a clearly bright yellow marker on a chart. Same value is
// duplicated in LineChart.jsx and CalendarHeatmap.jsx, which render their
// own poor-day markers independently.
const POOR_PERFORMING_COLOR = '#eab308';

function BestWorstLegend({ showPoor = false }) {
  return (
    <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
        Nilai tertinggi
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--danger)', display: 'inline-block' }} />
        Nilai terendah
      </span>
      {showPoor && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', border: `2px solid ${POOR_PERFORMING_COLOR}`, display: 'inline-block' }} />
          Di bawah rata-rata periode ini
        </span>
      )}
    </div>
  );
}

// Business Growth's single-sentence answer to "how did the business do
// compared to last period" -- entirely derived from data.summary (computed
// backend-side via the same calculateGrowth() helper Executive Snapshot's
// KPI badges use). Returns null when there's no comparison period selected,
// since there's nothing to compare yet. "Didorong oleh" / "dipengaruhi"
// attribution is only added when the component metric (transaksi or AOV)
// actually moves the same direction as GMV and is itself above the
// stable-noise floor -- otherwise the sentence stops at the GMV figure
// alone rather than implying a cause the data doesn't support.
const STABLE_GROWTH_THRESHOLD_PCT = 1;

function buildGrowthHeadline(summary) {
  const gmvGrowth = summary?.gmv?.growth;
  if (gmvGrowth == null) return null;

  const txGrowth = summary?.transactions?.growth ?? null;
  const aovGrowth = summary?.aov?.growth ?? null;
  const isStable = Math.abs(gmvGrowth) < STABLE_GROWTH_THRESHOLD_PCT;
  const tone = isStable ? 'stable' : gmvGrowth > 0 ? 'up' : 'down';
  const label = tone === 'up' ? 'Performa bisnis meningkat'
    : tone === 'down' ? 'Performa bisnis menurun'
    : 'Performa bisnis relatif stabil';

  if (isStable) {
    return { tone, label, detail: `GMV hanya berubah ${formatPercent(Math.abs(gmvGrowth))} dibandingkan periode sebelumnya.` };
  }

  const gmvVerb = gmvGrowth > 0 ? 'naik' : 'turun';
  let detail = `GMV ${gmvVerb} ${formatPercent(Math.abs(gmvGrowth))} dibandingkan periode sebelumnya`;

  const txSupports = txGrowth != null && Math.sign(txGrowth) === Math.sign(gmvGrowth) && Math.abs(txGrowth) >= STABLE_GROWTH_THRESHOLD_PCT;
  const aovSupports = aovGrowth != null && Math.sign(aovGrowth) === Math.sign(gmvGrowth) && Math.abs(aovGrowth) >= STABLE_GROWTH_THRESHOLD_PCT;
  const verbPhrase = tone === 'up' ? 'didorong oleh peningkatan' : 'terutama dipengaruhi penurunan';

  if (txSupports && (!aovSupports || Math.abs(txGrowth) >= Math.abs(aovGrowth))) {
    detail += `, ${verbPhrase} transaksi sebesar ${formatPercent(Math.abs(txGrowth))}.`;
  } else if (aovSupports) {
    detail += `, ${verbPhrase} AOV sebesar ${formatPercent(Math.abs(aovGrowth))}.`;
  } else {
    detail += '.';
  }

  return { tone, label, detail };
}

function GrowthHeadlineCard({ headline, hasCompare }) {
  if (!headline) {
    return (
      <div className="card" style={{ padding: '1.1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          {hasCompare
            ? 'Belum cukup data pada periode pembanding untuk menghitung perubahan performa.'
            : "Aktifkan “Bandingkan Periode” pada filter untuk melihat insight perubahan performa dibanding periode sebelumnya."}
        </span>
      </div>
    );
  }

  const toneColor = headline.tone === 'up' ? 'var(--success)' : headline.tone === 'down' ? 'var(--danger)' : 'var(--text-muted)';
  const toneBg = headline.tone === 'up' ? 'var(--success-bg)' : headline.tone === 'down' ? 'var(--danger-bg)' : 'var(--bg-elevated)';

  return (
    <div className="con-insight is-lead" style={{ background: toneBg }}>
      <span className="con-insight-dot" style={{ background: toneColor }} aria-hidden />
      <div>
        <div className="con-insight-label" style={{ color: toneColor }}>{headline.label}</div>
        <div className="con-insight-detail">{headline.detail}</div>
      </div>
    </div>
  );
}

// TAB 2: BUSINESS GROWTH
function renderBusinessGrowth(data, { startDate, endDate } = {}) {
    const { trends = [], summary = null, compareRange = null, compareTrends = null } = data || {};
    const gmvExtremes = computeMetricExtremes(trends, 'gmv');
    const txExtremes = computeMetricExtremes(trends, 'transactions');
    const aovExtremes = computeMetricExtremes(trends, 'aov');

    // Separate "poor performing" rule (relative to this period's own mean)
    // on top of the single best/worst day already computed above.
    const gmvPoorDates = computePoorPerformingDates(trends, 'gmv');
    const txPoorDates = computePoorPerformingDates(trends, 'transactions');
    const aovPoorDates = computePoorPerformingDates(trends, 'aov');

    // Comparison period gets its own best/worst (same shared function, its
    // own data) so its chart isn't just a flat unannotated line -- but no
    // "poor day" tier here, to keep the reference period visually secondary
    // to the period actually being analyzed. computeMetricExtremes() already
    // no-ops safely on a short/empty array, so no extra guard needed here.
    const cmpTrends = compareTrends || [];
    const cmpGmvExtremes = computeMetricExtremes(cmpTrends, 'gmv');
    const cmpTxExtremes = computeMetricExtremes(cmpTrends, 'transactions');
    const cmpAovExtremes = computeMetricExtremes(cmpTrends, 'aov');

    const formatNumber = (val) => new Intl.NumberFormat('id-ID').format(val || 0);
    const formatCurrency = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0);

    const headline = buildGrowthHeadline(summary);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* 1. Insight -- the direct answer to "how is the business doing" */}
        <GrowthHeadlineCard headline={headline} hasCompare={!!compareRange} />

        {/* 2. Overall performance + comparison vs previous period -- laid
            out as shared grid rows (main | compare), same two-column
            pattern every other tab already uses for compare mode, instead
            of stacking the comparison period's cards underneath. */}
        {compareRange ? (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '1rem' }}>
              <PeriodHeader title="Periode Utama" range={`${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`} />
              <PeriodHeader title="Periode Pembanding" range={`${formatDateLabel(compareRange.startDate)} - ${formatDateLabel(compareRange.endDate)}`} />

              <KpiCard title="GMV (Penjualan)" value={summary?.gmv?.value} type="currency" growth={summary?.gmv?.growth ?? null} />
              <KpiCard title="GMV (Penjualan)" value={summary?.gmv?.previousValue} type="currency" />

              <KpiCard title="Transaksi" value={summary?.transactions?.value} type="number" growth={summary?.transactions?.growth ?? null} />
              <KpiCard title="Transaksi" value={summary?.transactions?.previousValue} type="number" />

              <KpiCard
                title="AOV (Average Order Value)"
                value={summary?.aov?.value}
                type="currency"
                growth={summary?.aov?.growth ?? null}
                note="AOV = GMV bersih ÷ jumlah transaksi bersih, basis harian tahap Pesanan Dibayar. Beda basis perhitungan dari 'ATV' di tab Basket Analysis (rata-rata total_payment per pesanan berstatus Selesai) -- kedua angka ini tidak dapat dibandingkan 1:1."
              />
              <KpiCard title="AOV (Average Order Value)" value={summary?.aov?.previousValue} type="currency" />
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
              <strong style={{ color: 'var(--text)' }}>Periode Utama:</strong> {formatDateLabel(startDate)} - {formatDateLabel(endDate)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
              <KpiCard title="GMV (Penjualan)" value={summary?.gmv?.value} type="currency" />
              <KpiCard title="Transaksi" value={summary?.transactions?.value} type="number" />
              <KpiCard
                title="AOV (Average Order Value)"
                value={summary?.aov?.value}
                type="currency"
                note="AOV = GMV bersih ÷ jumlah transaksi bersih, basis harian tahap Pesanan Dibayar. Beda basis perhitungan dari 'ATV' di tab Basket Analysis (rata-rata total_payment per pesanan berstatus Selesai) -- kedua angka ini tidak dapat dibandingkan 1:1."
              />
            </div>
          </div>
        )}

        {/* 3. Trend -- same main | compare pairing as the cards above. */}
        <div>
          <BestWorstLegend showPoor />
          {compareRange ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '1rem', marginTop: '0.75rem' }}>
              <LineChart data={trends} metric="gmv" title="Tren GMV (Penjualan)" bestDates={gmvExtremes.bestDates} worstDates={gmvExtremes.worstDates} poorDates={gmvPoorDates} />
              <LineChart data={cmpTrends} metric="gmv" title="Tren GMV (Penjualan)" bestDates={cmpGmvExtremes.bestDates} worstDates={cmpGmvExtremes.worstDates} />

              <LineChart data={trends} metric="transactions" title="Tren Transaksi" bestDates={txExtremes.bestDates} worstDates={txExtremes.worstDates} poorDates={txPoorDates} />
              <LineChart data={cmpTrends} metric="transactions" title="Tren Transaksi" bestDates={cmpTxExtremes.bestDates} worstDates={cmpTxExtremes.worstDates} />

              <LineChart
                data={trends}
                metric="aov"
                title="Tren AOV (Average Order Value)"
                bestDates={aovExtremes.bestDates}
                worstDates={aovExtremes.worstDates}
                poorDates={aovPoorDates}
                note="AOV = GMV bersih ÷ jumlah transaksi bersih, basis harian tahap Pesanan Dibayar. Beda basis perhitungan dari 'ATV' di tab Basket Analysis (rata-rata total_payment per pesanan berstatus Selesai) -- kedua angka ini tidak dapat dibandingkan 1:1."
              />
              <LineChart data={cmpTrends} metric="aov" title="Tren AOV (Average Order Value)" bestDates={cmpAovExtremes.bestDates} worstDates={cmpAovExtremes.worstDates} />
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginTop: '0.75rem' }}>
              <LineChart data={trends} metric="gmv" title="Tren GMV (Penjualan)" bestDates={gmvExtremes.bestDates} worstDates={gmvExtremes.worstDates} poorDates={gmvPoorDates} />
              <LineChart data={trends} metric="transactions" title="Tren Transaksi" bestDates={txExtremes.bestDates} worstDates={txExtremes.worstDates} poorDates={txPoorDates} />
              <LineChart
                data={trends}
                metric="aov"
                title="Tren AOV (Average Order Value)"
                bestDates={aovExtremes.bestDates}
                worstDates={aovExtremes.worstDates}
                poorDates={aovPoorDates}
                note="AOV = GMV bersih ÷ jumlah transaksi bersih, basis harian tahap Pesanan Dibayar. Beda basis perhitungan dari 'ATV' di tab Basket Analysis (rata-rata total_payment per pesanan berstatus Selesai) -- kedua angka ini tidak dapat dibandingkan 1:1."
              />
            </div>
          )}
        </div>

        {/* 4. Best/Worst performance -- same computeMetricExtremes() used by
            the colored dots above (via BestWorstDayCard, which calls it
            internally). Same card also appears on Executive Snapshot; both
            read off this one shared function so the dates/values can never
            diverge. Paired main | compare like the sections above. */}
        {compareRange ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '1rem' }}>
            <div className="card" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>Hari Performa Terbaik &amp; Terburuk</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <BestWorstDayCard label="GMV" trends={trends} metric="gmv" formatValue={formatCurrency} />
                <BestWorstDayCard label="Transaksi" trends={trends} metric="transactions" formatValue={formatNumber} />
                <BestWorstDayCard label="AOV" trends={trends} metric="aov" formatValue={formatCurrency} />
              </div>
            </div>
            <div className="card" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>Hari Performa Terbaik &amp; Terburuk</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <BestWorstDayCard label="GMV" trends={cmpTrends} metric="gmv" formatValue={formatCurrency} />
                <BestWorstDayCard label="Transaksi" trends={cmpTrends} metric="transactions" formatValue={formatNumber} />
                <BestWorstDayCard label="AOV" trends={cmpTrends} metric="aov" formatValue={formatCurrency} />
              </div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>Hari Performa Terbaik &amp; Terburuk</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              <BestWorstDayCard label="GMV" trends={trends} metric="gmv" formatValue={formatCurrency} />
              <BestWorstDayCard label="Transaksi" trends={trends} metric="transactions" formatValue={formatNumber} />
              <BestWorstDayCard label="AOV" trends={trends} metric="aov" formatValue={formatCurrency} />
            </div>
          </div>
        )}

        {/* 5. Detailed daily pattern -- paired main | compare heatmap. The
            compare-period calendar doesn't get rangeStart/rangeEnd since its
            own compareRange dates already bound exactly what getGrowthMetrics()
            fetched for it (no extra out-of-range calendar padding to mark). */}
        {compareRange ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '1rem' }}>
            <CalendarHeatmap
              data={trends}
              title="Kalender Intensitas Penjualan (GMV)"
              bestDates={gmvExtremes.bestDates}
              worstDates={gmvExtremes.worstDates}
              poorDates={gmvPoorDates}
              rangeStart={startDate}
              rangeEnd={endDate}
            />
            <CalendarHeatmap
              data={cmpTrends}
              title="Kalender Intensitas Penjualan (GMV)"
              bestDates={cmpGmvExtremes.bestDates}
              worstDates={cmpGmvExtremes.worstDates}
              rangeStart={compareRange.startDate}
              rangeEnd={compareRange.endDate}
            />
          </div>
        ) : (
          <CalendarHeatmap
            data={trends}
            title="Kalender Intensitas Penjualan (GMV)"
            bestDates={gmvExtremes.bestDates}
            worstDates={gmvExtremes.worstDates}
            poorDates={gmvPoorDates}
            rangeStart={startDate}
            rangeEnd={endDate}
          />
        )}

      </div>
    );
}

const formatTrafficNumber = (val) => new Intl.NumberFormat('id-ID').format(val || 0);

// Compact single-visual "kontribusi traffic": Total + a 2-segment proportion
// bar (Organic vs Ads) + the two figures with their % share, in one card
// instead of a separate chart per number -- reuses the same colored-segment
// bar visual language as e.g. RFM's segment distribution bars.
function TrafficOverviewCard({ overview, title = 'Total Traffic' }) {
  const total = overview?.total?.value ?? 0;
  const organic = overview?.organic ?? { value: 0, pct: 0 };
  const ads = overview?.ads ?? { value: 0, pct: 0 };
  const organicPct = total > 0 ? organic.pct : 0;
  const adsPct = total > 0 ? ads.pct : 0;

  const growthBadge = (growth) => {
    if (growth == null) return null;
    const positive = growth >= 0;
    return (
      <span style={{ fontSize: '0.72rem', fontWeight: '700', color: positive ? 'var(--success)' : 'var(--danger)' }}>
        {positive ? '+' : ''}{growth}%
      </span>
    );
  };

  return (
    <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{title}</div>
          <div style={{ fontSize: '1.5rem', fontWeight: '700', color: 'var(--text)' }}>{formatTrafficNumber(total)}</div>
        </div>
        {growthBadge(overview?.total?.growth)}
      </div>

      {/* Organic vs Ads proportion bar */}
      <div style={{ height: '10px', borderRadius: '999px', overflow: 'hidden', display: 'flex', background: 'var(--bg-elevated)' }}>
        <div style={{ width: `${organicPct}%`, background: 'var(--primary)' }} title={`Organic: ${formatPercent(organicPct)}`} />
        <div style={{ width: `${adsPct}%`, background: '#8b5cf6' }} title={`Ads: ${formatPercent(adsPct)}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: 'var(--primary)', display: 'inline-block' }} />
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Organic</span>
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text)' }}>{formatTrafficNumber(organic.value)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatPercent(organicPct)}</span>
            {growthBadge(organic.growth)}
          </div>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: '#8b5cf6', display: 'inline-block' }} />
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Ads</span>
          </div>
          <div style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text)' }}>{formatTrafficNumber(ads.value)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatPercent(adsPct)}</span>
            {growthBadge(ads.growth)}
          </div>
        </div>
      </div>
    </div>
  );
}

function FunnelRateCard({ funnelRates = {} }) {
  // Four rows, not a 2x2 grid. These labels are long — "CVR Funnel (Siap Kirim
  // ÷ Product Visitor)" — and in the narrow column beside the funnel a 2x2
  // wrapped each cell to a different height, so four peer metrics stopped
  // reading as peers. Rows let the label run and keep the numbers in one
  // right-aligned tabular column you can compare down.
  const rows = [
    { key: 'atcRate', label: 'ATC Rate', sub: 'Keranjang / Visitor' },
    { key: 'poRate', label: 'PO Rate', sub: 'Checkout / ATC' },
    { key: 'coRate', label: 'CO Rate', sub: 'Siap Kirim / Checkout' },
    {
      key: 'cvr',
      label: 'CVR Funnel',
      sub: 'Siap Kirim / Product Visitor',
      note: "CVR Funnel = Pesanan Siap Dikirim ÷ Product Visitor, dihitung dari tahapan funnel di tab ini. Berbeda dari 'CVR Pesanan' di tab Executive Snapshot, yang merupakan rata-rata harian 'Tingkat Konversi Pesanan' yang dilaporkan Shopee langsung -- kedua angka ini tidak dapat dibandingkan 1:1.",
    },
  ];

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
      <h3 style={{ fontSize: '1rem', color: 'var(--text)' }}>Metrik Rasio Funnel</h3>
      <div className="con-ratelist">
        {rows.map((r) => (
          <div className="con-rate" key={r.key} title={r.note} style={r.note ? { cursor: 'help' } : undefined}>
            <div className="con-rate-name">
              {r.label}
              <span>{r.sub}</span>
            </div>
            <div className="con-rate-val">{formatPercent((funnelRates[r.key] || 0) * 100, 2)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Growth driver / bottleneck insight card -- same colored-callout visual
// language as Business Growth's headline card, reimplemented locally since
// Business Growth's own component/logic must stay untouched in this phase.
function InsightCard({ tone, label, detail }) {
  const toneColor = tone === 'up' ? 'var(--success)' : tone === 'down' ? 'var(--danger)' : 'var(--text-muted)';
  const toneBg = tone === 'up' ? 'var(--success-bg)' : tone === 'down' ? 'var(--danger-bg)' : 'var(--bg-elevated)';
  return (
    <div className="con-insight" style={{ background: toneBg }}>
      <span className="con-insight-dot" style={{ background: toneColor }} aria-hidden />
      <div>
        <div className="con-insight-label" style={{ color: toneColor }}>{label}</div>
        <div className="con-insight-detail">{detail}</div>
      </div>
    </div>
  );
}

// TAB 3: TRAFFIC & FUNNEL
function renderTrafficFunnel(data, { startDate, endDate } = {}) {
    const {
      kpis = {}, trafficOverview = {}, trafficSources = {}, funnel = [], funnelRates = {},
      comparePeriod = null, insights = {}, funnelGrainWarning = null,
    } = data || {};

    const growthDriver = insights.trafficGrowthDriver;
    const bottleneck = insights.funnelBottleneck;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Supporting context -- Impression (Ads-only, from getFunnelSnapshot's
            impression query) and Product Visitor (Shopee's own "Total
            Pengunjung" figure). Both use a different counting basis than the
            "Total Traffic" (product clicks) breakdown below -- noted via
            tooltip so the three aren't assumed to be the same number. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          <KpiCard
            title="Impression (Iklan)"
            value={kpis.impressions?.value}
            type="number"
            growth={kpis.impressions?.growth ?? null}
            note="Jumlah tayang produk pada channel Iklan Shopee (Ads) saja. Basis hitung berbeda dari 'Total Traffic' (klik produk seluruh channel) di bawah."
          />
          <KpiCard
            title="Product Visitor"
            value={kpis.visitors?.value}
            type="number"
            growth={kpis.visitors?.growth ?? null}
            note="Total Pengunjung yang dilaporkan Shopee (daily_order_performance). Basis hitung berbeda dari 'Total Traffic' (klik produk per channel) di bawah, dan dari 'Kunjungan Produk' pada funnel."
          />
        </div>

        {/* Traffic Overview + Organic vs Ads -- one compact visual, paired
            main | compare when a comparison period is active (same pattern
            as Business Growth). */}
        {comparePeriod ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '1rem' }}>
            <PeriodHeader title="Periode Utama" range={`${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`} />
            <PeriodHeader title="Periode Pembanding" range={`${formatDateLabel(comparePeriod.range.startDate)} - ${formatDateLabel(comparePeriod.range.endDate)}`} />
            <TrafficOverviewCard overview={trafficOverview} />
            <TrafficOverviewCard overview={comparePeriod.trafficOverview} />
          </div>
        ) : (
          <TrafficOverviewCard overview={trafficOverview} />
        )}

        {/* Funnel -- total-traffic level only. product_performance_summary
            (its source) has no channel/sub-source breakdown, so Organic vs
            Ads cannot be attributed per stage without fabricating a number
            the data doesn't support -- labeled explicitly instead. */}
        <div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Funnel di bawah merepresentasikan <strong>total seluruh traffic</strong> (Organic + Ads gabungan) — data pada tahap Kunjungan Produk/Tambah Keranjang/Pesanan tidak tersedia terpecah per sumber traffic. Angka funnel bersumber dari laporan Product Performance <strong>bulanan</strong>.
          </div>
          <GrainWarning warning={funnelGrainWarning} />
          {comparePeriod ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '1rem' }}>
              <FunnelChart data={funnel} title="Analisis Corong Konversi (Funnel)" />
              <FunnelChart data={comparePeriod.funnel} title="Analisis Corong Konversi (Funnel)" />
              <FunnelRateCard funnelRates={funnelRates} />
              <FunnelRateCard funnelRates={comparePeriod.funnelRates} />
            </div>
          ) : (
            /* The funnel takes the larger share: it is the only chart here
               whose bars need room to be read, while the ratio card is four
               numbers that fit anything. An even split squeezed the funnel's
               bar track down to a few dozen pixels. */
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1.55fr) minmax(230px, 1fr)', gap: '1rem' }}>
              <FunnelChart data={funnel} title="Analisis Corong Konversi (Funnel)" />
              <FunnelRateCard funnelRates={funnelRates} />
            </div>
          )}
        </div>

        {/* Growth Driver + Bottleneck insight */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
          {growthDriver ? (
            <InsightCard tone={growthDriver.tone} label={growthDriver.label} detail={growthDriver.detail} />
          ) : (
            <InsightCard tone="stable" label="Traffic Growth Driver" detail={'Aktifkan "Bandingkan Periode" pada filter untuk melihat sumber traffic mana yang mendorong perubahan.'} />
          )}
          {bottleneck && (
            <InsightCard tone={bottleneck.tone} label={bottleneck.label} detail={bottleneck.detail} />
          )}
        </div>

        {/* Detail: sub-source breakdown per channel -- supporting detail
            beneath the Organic/Ads headline above, paired main | compare
            when a comparison period is active (same pattern as Traffic
            Overview above). */}
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text)', marginBottom: '0.75rem' }}>Detail Sumber Traffic per Channel</div>
          {comparePeriod ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Periode Utama ({formatDateLabel(startDate)} - {formatDateLabel(endDate)})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                  <DonutChart data={trafficSources.universal || []} title="Traffic Source [Universal]" />
                  <DonutChart data={trafficSources.shopping || []} title="Traffic Source [Shopping]" />
                  <DonutChart data={trafficSources.live || []} title="Traffic Source [Live]" />
                  <DonutChart data={trafficSources.video || []} title="Traffic Source [Video]" />
                  <DonutChart data={trafficSources.affiliate || []} title="Traffic Source [Affiliate]" />
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Periode Pembanding ({formatDateLabel(comparePeriod.range.startDate)} - {formatDateLabel(comparePeriod.range.endDate)})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
                  <DonutChart data={comparePeriod.trafficSources?.universal || []} title="Traffic Source [Universal]" />
                  <DonutChart data={comparePeriod.trafficSources?.shopping || []} title="Traffic Source [Shopping]" />
                  <DonutChart data={comparePeriod.trafficSources?.live || []} title="Traffic Source [Live]" />
                  <DonutChart data={comparePeriod.trafficSources?.video || []} title="Traffic Source [Video]" />
                  <DonutChart data={comparePeriod.trafficSources?.affiliate || []} title="Traffic Source [Affiliate]" />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem' }}>
              <DonutChart data={trafficSources.universal || []} title="Traffic Source [Universal]" />
              <DonutChart data={trafficSources.shopping || []} title="Traffic Source [Shopping]" />
              <DonutChart data={trafficSources.live || []} title="Traffic Source [Live]" />
              <DonutChart data={trafficSources.video || []} title="Traffic Source [Video]" />
              <DonutChart data={trafficSources.affiliate || []} title="Traffic Source [Affiliate]" />
            </div>
          )}
        </div>

      </div>
    );
}

// Matrix Heatmap dimension options: which two RFM scores are cross-tabulated,
// which score renders on which axis, and where to read each cell's count
// from in `matrices` (already computed server-side from the same RFM rows —
// no recomputation needed on the client).
const RFM_MATRIX_OPTIONS = [
  { value: 'rf', label: 'Recency × Frequency', yMetric: 'R', xMetric: 'F', yKey: 'rScore', xKey: 'fScore' },
  { value: 'rm', label: 'Recency × Monetary', yMetric: 'R', xMetric: 'M', yKey: 'rScore', xKey: 'mScore' },
  { value: 'fm', label: 'Frequency × Monetary', yMetric: 'F', xMetric: 'M', yKey: 'fScore', xKey: 'mScore' },
];

function rfmAxisTick(metric, score) {
  if (score === 1) return `${metric}1 (Low)`;
  if (score === 5) return `${metric}5 (High)`;
  return `${metric}${score}`;
}

// Client-side CSV export — no backend endpoint needed since the segment's
// user id list is already part of the RFM API response.
function downloadSegmentUserIds(segmentName, userIds = [], periodLabel = '') {
  const csv = ['user_id', ...userIds.map((id) => `"${String(id).replace(/"/g, '""')}"`)].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const suffix = periodLabel ? `-${periodLabel.toLowerCase().replace(/\s+/g, '-')}` : '';
  a.download = `segmen-${segmentName.toLowerCase().replace(/\s+/g, '-')}${suffix}-user-id.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// TAB 4: RFM ANALYSIS
const RFM_RISK_SEGMENTS = new Set(['At Risk', 'Hibernating', 'Lost', "Can't Lose Them", 'Need Attention']);
const RFM_GROWTH_SEGMENTS = new Set(['Champions', 'Loyal Customers', 'Potential Loyalist']);

function segmentToneColor(segmentName) {
  if (RFM_RISK_SEGMENTS.has(segmentName)) return 'var(--danger)';
  if (RFM_GROWTH_SEGMENTS.has(segmentName)) return 'var(--success)';
  return 'var(--primary)';
}

// Count-based % change badge -- displays `changePercent` (relative change of
// segment customer count), matching the "% Perubahan" table column.
function ChangeBadge({ value }) {
  if (value == null) return <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>—</span>;
  if (Math.abs(value) < 0.05) return <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{formatPercent(0)}</span>;
  const positive = value > 0;
  return (
    <span style={{ color: positive ? 'var(--success)' : 'var(--danger)', fontSize: '0.78rem', fontWeight: '700' }}>
      {positive ? '▲' : '▼'} {formatPercent(Math.abs(value))}
    </span>
  );
}

// Turns one period's raw matrix rows (from `matrices[dim]`) into the
// {yScore-xScore: count} lookup + max value the heatmap grid needs.
function buildRfmMatrixLookup(matricesObj, rfmMatrixDim, matrixOption) {
  const activeMatrix = (matricesObj || {})[rfmMatrixDim] || [];
  const map = {};
  activeMatrix.forEach((m) => { map[`${m[matrixOption.yKey]}-${m[matrixOption.xKey]}`] = m.count; });
  const maxVal = Math.max(...activeMatrix.map((m) => m.count), 1);
  return { map, maxVal };
}

// The 5x5 heatmap grid itself, extracted so it can be rendered twice
// (main | compare period) off the same dropdown-selected dimension without
// duplicating the markup.
function RfmMatrixGrid({ matrixOption, matrixMap, maxMatrixVal, large = false }) {
  // `large`: used only when a single heatmap has the whole section to
  // itself (comparison mode off) -- scales cell height/label column/font up
  // so it fills the section instead of sitting at the same compact size two
  // side-by-side heatmaps need in comparison mode.
  const labelColWidth = large ? '70px' : '50px';
  const cellHeight = large ? '56px' : '32px';
  const labelFontSize = large ? '0.85rem' : '0.75rem';
  const cellFontSize = large ? '0.95rem' : '0.75rem';
  const gridTemplateColumns = `${labelColWidth} repeat(5, 1fr)`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: large ? '0.4rem' : '0.25rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns, textAlign: 'center', fontSize: labelFontSize, fontWeight: '600', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        <div>{matrixOption.yMetric} \ {matrixOption.xMetric}</div>
        {[1, 2, 3, 4, 5].map(x => (
          <div key={x}>{rfmAxisTick(matrixOption.xMetric, x)}</div>
        ))}
      </div>
      {[5, 4, 3, 2, 1].map(y => {
        const rowCells = [1, 2, 3, 4, 5].map(x => ({ y, x, count: matrixMap[`${y}-${x}`] || 0 }));
        return (
          <div key={y} style={{ display: 'grid', gridTemplateColumns, gap: large ? '6px' : '4px', alignItems: 'center' }}>
            <div style={{ fontSize: labelFontSize, fontWeight: '600', color: 'var(--text-muted)', textAlign: 'right', paddingRight: '8px' }}>
              {rfmAxisTick(matrixOption.yMetric, y)}
            </div>
            {rowCells.map(c => {
              const ratio = c.count / maxMatrixVal;
              const opacity = c.count > 0 ? 0.1 + ratio * 0.9 : 0.02;
              return (
                <div
                  key={c.x}
                  style={{
                    height: cellHeight,
                    borderRadius: large ? '6px' : '4px',
                    background: c.count > 0 ? `rgba(37, 99, 235, ${opacity})` : 'var(--bg-elevated)',
                    color: ratio > 0.6 ? 'white' : 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: cellFontSize,
                    fontWeight: '600',
                    border: '1px solid var(--border)'
                  }}
                  title={`${matrixOption.yMetric} ${c.y}, ${matrixOption.xMetric} ${c.x}: ${c.count} Pelanggan`}
                >
                  {c.count}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// Rincian Statistik Segmen table, extracted so it can be rendered twice
// (main | compare period) without duplicating markup. periodLabel makes the
// two periods' CSV downloads distinguishable by filename.
function RfmDetailTable({ title, segments, customersBySegment, periodLabel, formatNumber, formatCurrency }) {
  return (
    <div className="card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>{title}</h3>
      <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
            <th style={{ padding: '0.5rem' }}>Segmen</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Jumlah Pelanggan</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Rerata Recency (Hari)</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Rerata Frequency (Order)</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Rerata Monetary (IDR)</th>
            <th style={{ padding: '0.5rem', textAlign: 'center' }}>User ID</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((seg, idx) => {
            const userIds = customersBySegment[seg.segment] || [];
            return (
              <tr key={idx} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                <td style={{ padding: '0.5rem', fontWeight: '600' }}>{seg.segment}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatNumber(seg.count)}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{seg.avgRecency != null ? `${seg.avgRecency} Hari` : '-'}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{seg.avgFrequency != null ? `${seg.avgFrequency}x` : '-'}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{seg.avgMonetary != null ? formatCurrency(seg.avgMonetary) : '-'}</td>
                <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => downloadSegmentUserIds(seg.segment, userIds, periodLabel)}
                    disabled={userIds.length === 0}
                    title={`Unduh ${userIds.length} User ID pada segmen ${seg.segment}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.35rem 0.6rem',
                      fontSize: '0.75rem',
                      fontWeight: '600',
                      color: userIds.length === 0 ? 'var(--text-muted)' : 'var(--primary)',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      cursor: userIds.length === 0 ? 'default' : 'pointer',
                    }}
                  >
                    <Download size={13} />
                    CSV
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Same-product-repurchase vs different-product-switch gap comparison table
// (1st -> 2nd order). Extracted so main|compare periods can reuse the same
// markup instead of duplicating it inline.
function RepeatCycleComparisonTable({ comparison = [] }) {
  return (
    <div className="card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>Perbandingan Siklus: Beli Produk Sama vs Pindah Produk</h3>
      <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
            <th style={{ padding: '0.5rem' }}>Tipe</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Jumlah Pelanggan</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Median (Hari)</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Rata-rata (Hari)</th>
          </tr>
        </thead>
        <tbody>
          {comparison.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ padding: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                Belum ada pelanggan repeat pada periode ini.
              </td>
            </tr>
          ) : comparison.map((c, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
              <td style={{ padding: '0.5rem', fontWeight: '600' }}>{c.type}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{new Intl.NumberFormat('id-ID').format(c.customerCount)}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{c.medianDays} hari</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{c.avgDays} hari</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 1st -> 2nd purchase gap summary cards. Extracted so main|compare periods
// can reuse the same markup instead of duplicating it inline.
function RepeatCycleStatsGrid({ stats = {} }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
      <KpiCard title="Pelanggan Repeat (1x → 2x)" value={stats.customerCount} type="number" />
      <KpiCard title="Rata-rata Jarak Beli (Hari)" value={stats.avgDays} type="number" />
      <KpiCard title="Median Jarak Beli (Hari)" value={stats.medianDays} type="number" />
      <KpiCard title="Jarak Beli Tercepat (Hari)" value={stats.minDays} type="number" />
      <KpiCard title="Jarak Beli Terlama (Hari)" value={stats.maxDays} type="number" />
    </div>
  );
}

function renderRfm(data, { rfmMatrixDim = 'rf', setRfmMatrixDim, startDate, endDate } = {}) {
    const {
      totalCustomers = 0, segments = [], matrices = {}, customersBySegment = {},
      historicalRetention = {}, comparePeriod = null, retention = { available: false, rate: null, retainedCount: null, cohortCount: null },
      repeatCustomerRate = { totalCustomers: 0, customersSingle: 0, customersRetained: 0, retentionRatePct: 0 },
      repeatCycle = { stats: {}, distribution: [], comparison: [] },
      insights = {},
    } = data || {};

    const matrixOption = RFM_MATRIX_OPTIONS.find(o => o.value === rfmMatrixDim) || RFM_MATRIX_OPTIONS[0];
    const maxSegmentCount = Math.max(...segments.map(s => s.count), 1);
    const mainMatrixLookup = buildRfmMatrixLookup(matrices, rfmMatrixDim, matrixOption);
    const compareMatrixLookup = comparePeriod ? buildRfmMatrixLookup(comparePeriod.matrices, rfmMatrixDim, matrixOption) : null;

    const formatCurrency = (val) => {
      return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
    };
    const formatNumber = (val) => new Intl.NumberFormat('id-ID').format(val);
    const segmentChange = insights.segmentChange;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* 1. Customer Health -- at-a-glance: total customers, retention (if
            a comparison period is active), and the dynamic segment-change
            headline. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', alignItems: 'stretch' }}>
          <KpiCard title="Total Pelanggan (Ter-RFM)" value={totalCustomers} type="number" />
          <KpiCard
            title="Pelanggan Kembali"
            value={historicalRetention.currentCount ? historicalRetention.retainedCount : null}
            type="number"
            note={`Pelanggan periode ini yang sudah pernah menyelesaikan pesanan sebelum tanggal awal periode, dari seluruh riwayat brand yang tersedia. ${formatNumber(historicalRetention.newCount ?? 0)} pelanggan baru; pembelian setelah periode ini tidak dihitung.`}
          />
          <KpiCard
            title="Porsi Pelanggan Kembali"
            value={historicalRetention.returningShare == null ? null : historicalRetention.returningShare / 100}
            type="percentage"
            note="Pelanggan kembali ÷ seluruh pelanggan unik periode ini. Berbeda dari retention kohort: denominator hanya pelanggan yang bertransaksi pada periode terpilih."
          />
          <KpiCard
            title="Retention Seluruh Riwayat"
            value={historicalRetention.rate == null ? null : historicalRetention.rate / 100}
            type="percentage"
            note={`Dari ${formatNumber(historicalRetention.cohortCount ?? 0)} pelanggan sebelum periode ini, ${formatNumber(historicalRetention.retainedCount ?? 0)} kembali pada periode terpilih. Berdasarkan pesanan Selesai dan tanggal selesai; pelanggan tanpa identitas dikecualikan. Jika belum ada riwayat sebelumnya, angka belum tersedia.`}
          />
          <KpiCard
            title="Retention Kohort Pembanding"
            value={retention.available ? retention.rate / 100 : null}
            type="percentage"
            note={retention.available
              ? `Retention kohort: dari ${formatNumber(retention.cohortCount)} pelanggan pada periode pembanding, ${formatNumber(retention.retainedCount)} kembali bertransaksi pada periode utama. Berbeda dari 'Repeat Customer Rate' di bawah (repeat-order rate dalam satu periode, bukan cohort antar-periode).`
              : (retention.reason || 'Aktifkan Bandingkan Periode untuk melihat retention kohort pembanding.')}
          />
          {segmentChange ? (
            <InsightCard tone={segmentChange.tone} label={segmentChange.label} detail={segmentChange.detail} />
          ) : (
            <InsightCard tone="stable" label="Perubahan Komposisi Segmen" detail={'Aktifkan "Bandingkan Periode" pada filter untuk melihat segmen mana yang paling berubah.'} />
          )}
        </div>

        {/* 2. Segment Distribution + Change + Recommended Action, in one
            table so Data -> Insight -> Action stays visually connected for
            every segment instead of split across separate isolated
            sections. Every possible segment appears even at 0 customers
            (valid data, not hidden) -- see RFM_SEGMENTS. */}
        <div className="card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '0.25rem', color: 'var(--text)' }}>Segmen Pelanggan &amp; Deskripsi</h3>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Persentase dihitung dari {formatNumber(totalCustomers)} pelanggan pada periode ini.
            {comparePeriod && ` Perubahan dibandingkan ${formatNumber(comparePeriod.totalCustomers)} pelanggan pada periode pembanding (${formatDateLabel(comparePeriod.range.startDate)} - ${formatDateLabel(comparePeriod.range.endDate)}).`}
          </p>
          <table className="table" style={{ width: '100%', minWidth: '760px', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.5rem' }}>Segmen</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>Jumlah Periode Utama</th>
                {comparePeriod && <th style={{ padding: '0.5rem', textAlign: 'right' }}>Jumlah Periode Pembanding</th>}
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>% Kontribusi</th>
                <th
                  style={{ padding: '0.5rem', textAlign: 'right', cursor: 'help' }}
                  title="Persentase perubahan jumlah customer dari Jumlah Periode Pembanding ke Jumlah Periode Utama, misal 134 → 191 customer = +42,5%. Bukan perubahan % Kontribusi."
                >
                  % Perubahan ⓘ
                </th>
                <th style={{ padding: '0.5rem' }}>Deskripsi</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg, idx) => {
                const barPct = maxSegmentCount > 0 ? (seg.count / maxSegmentCount) * 100 : 0;
                const toneColor = segmentToneColor(seg.segment);
                return (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                    <td style={{ padding: '0.6rem 0.5rem', fontWeight: '600', minWidth: '150px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: toneColor, flexShrink: 0 }} />
                        {seg.segment}
                      </div>
                      <div style={{ height: '4px', borderRadius: '2px', background: 'var(--bg-elevated)', marginTop: '0.35rem', overflow: 'hidden' }}>
                        <div style={{ width: `${barPct}%`, height: '100%', background: toneColor }} />
                      </div>
                    </td>
                    <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>{formatNumber(seg.count)}</td>
                    {comparePeriod && (
                      <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                        {seg.previousCount != null ? formatNumber(seg.previousCount) : '-'}
                      </td>
                    )}
                    <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>{formatPercent(seg.pct)}</td>
                    <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>
                      <ChangeBadge value={seg.changePercent} />
                    </td>
                    <td
                      style={{ padding: '0.6rem 0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)', minWidth: '260px' }}
                    >
                      {seg.action?.description || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 3. Matrix Heatmap -- cross-tab relationship between two RFM
            dimensions (e.g. do high-Frequency customers also score high on
            Monetary), a different question from the linear table above, not
            a duplicate of it. One dropdown controls both periods' grids so
            the same dimension pair is always being compared. */}
        <div className="card" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: '1rem', color: 'var(--text)' }}>Matrix Heatmap ({matrixOption.label})</h3>
            <select
              value={rfmMatrixDim}
              onChange={(e) => setRfmMatrixDim?.(e.target.value)}
              style={{
                padding: '0.35rem 0.6rem',
                fontSize: '0.8rem',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
                color: 'var(--text)',
                cursor: 'pointer'
              }}
            >
              {RFM_MATRIX_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {comparePeriod ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Periode Utama ({formatDateLabel(startDate)} - {formatDateLabel(endDate)})
                </div>
                <RfmMatrixGrid matrixOption={matrixOption} matrixMap={mainMatrixLookup.map} maxMatrixVal={mainMatrixLookup.maxVal} />
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Periode Pembanding ({formatDateLabel(comparePeriod.range.startDate)} - {formatDateLabel(comparePeriod.range.endDate)})
                </div>
                <RfmMatrixGrid matrixOption={matrixOption} matrixMap={compareMatrixLookup.map} maxMatrixVal={compareMatrixLookup.maxVal} />
              </div>
            </div>
          ) : (
            <div>
              <RfmMatrixGrid matrixOption={matrixOption} matrixMap={mainMatrixLookup.map} maxMatrixVal={mainMatrixLookup.maxVal} large />
            </div>
          )}
        </div>

        {/* 4. Detail / exploration -- R/F/M averages per segment + CSV
            export of user IDs, unchanged functionality, just repositioned
            after the actionable summary above and paired main | compare. */}
        {comparePeriod ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '1rem' }}>
            <RfmDetailTable
              title={`Rincian Statistik Segmen — Periode Utama (${formatDateLabel(startDate)} - ${formatDateLabel(endDate)})`}
              segments={segments}
              customersBySegment={customersBySegment}
              periodLabel="periode-utama"
              formatNumber={formatNumber}
              formatCurrency={formatCurrency}
            />
            <RfmDetailTable
              title={`Rincian Statistik Segmen — Periode Pembanding (${formatDateLabel(comparePeriod.range.startDate)} - ${formatDateLabel(comparePeriod.range.endDate)})`}
              segments={comparePeriod.segments}
              customersBySegment={comparePeriod.customersBySegment}
              periodLabel="periode-pembanding"
              formatNumber={formatNumber}
              formatCurrency={formatCurrency}
            />
          </div>
        ) : (
          <RfmDetailTable
            title="Rincian Statistik Segmen"
            segments={segments}
            customersBySegment={customersBySegment}
            periodLabel=""
            formatNumber={formatNumber}
            formatCurrency={formatCurrency}
          />
        )}

        {/* 5. Repeat Customer Rate & Siklus Pembelian -- within-period
            repeat-order rate and 1st->2nd purchase gap (moved here from
            Basket Analysis so all customer-loyalty metrics live in one
            place). Distinct from the cross-period cohort "Customer
            Retention" KPI above -- see its note for the difference. */}
        <div>
          <h3 style={{ fontSize: '1rem', color: 'var(--text)', marginBottom: '1rem' }}>Repeat Customer Rate &amp; Siklus Pembelian</h3>
          {comparePeriod ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '0.75rem' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    Periode Utama ({formatDateLabel(startDate)} - {formatDateLabel(endDate)})
                  </div>
                  <DonutChart
                    data={[
                      { name: '1x Transaksi', value: repeatCustomerRate.customersSingle },
                      { name: '>1x Transaksi (Repeat)', value: repeatCustomerRate.customersRetained },
                    ]}
                    title={`Repeat Customer Rate (${repeatCustomerRate.retentionRatePct}% Repeat)`}
                    centerLabel="Total Pelanggan"
                  />
                </div>
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    Periode Pembanding ({formatDateLabel(comparePeriod.range.startDate)} - {formatDateLabel(comparePeriod.range.endDate)})
                  </div>
                  <DonutChart
                    data={[
                      { name: '1x Transaksi', value: comparePeriod.repeatCustomerRate.customersSingle },
                      { name: '>1x Transaksi (Repeat)', value: comparePeriod.repeatCustomerRate.customersRetained },
                    ]}
                    title={`Repeat Customer Rate (${comparePeriod.repeatCustomerRate.retentionRatePct}% Repeat)`}
                    centerLabel="Total Pelanggan"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '0.75rem' }}>
                <RepeatCycleComparisonTable comparison={repeatCycle.comparison} />
                <RepeatCycleComparisonTable comparison={comparePeriod.repeatCycle.comparison} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '0.75rem' }}>
                <RepeatCycleStatsGrid stats={repeatCycle.stats} />
                <RepeatCycleStatsGrid stats={comparePeriod.repeatCycle.stats} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '0.75rem' }}>
                <HorizontalBarChart data={repeatCycle.distribution} nameKey="range" valueKey="customerCount" title="Jumlah Pelanggan per Rentang Jarak (Pembelian 1 → 2)" />
                <HorizontalBarChart data={comparePeriod.repeatCycle.distribution} nameKey="range" valueKey="customerCount" title="Jumlah Pelanggan per Rentang Jarak (Pembelian 1 → 2)" />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
                <DonutChart
                  data={[
                    { name: '1x Transaksi', value: repeatCustomerRate.customersSingle },
                    { name: '>1x Transaksi (Repeat)', value: repeatCustomerRate.customersRetained },
                  ]}
                  title={`Repeat Customer Rate (${repeatCustomerRate.retentionRatePct}% Repeat)`}
                  centerLabel="Total Pelanggan"
                />
                <RepeatCycleComparisonTable comparison={repeatCycle.comparison} />
              </div>
              <RepeatCycleStatsGrid stats={repeatCycle.stats} />
              <HorizontalBarChart data={repeatCycle.distribution} nameKey="range" valueKey="customerCount" title="Jumlah Pelanggan per Rentang Jarak (Pembelian 1 → 2)" />
            </div>
          )}
        </div>
      </div>
    );
  }

// TAB 5: TRANSACTION BEHAVIOR
function renderTransactionBehavior(data) {
    const {
      cities = [],
      provinces = [],
      discounts = {},
      durations = [],
      payments = [],
      shippings = [],
      cancellations = []
    } = data || {};

    const paymentData = payments.map(p => ({ name: p.name, value: p.sales }));
    const shippingData = shippings.map(s => ({ name: s.name, value: s.sales }));
    const durationData = durations.map(d => ({ name: d.label, value: d.count }));
    const formatCurrency = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Discount KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <KpiCard title="Diskon Dari Penjual" value={discounts.sellerDiscount} type="currency" />
          <KpiCard title="Voucher Ditanggung Shopee" value={discounts.shopeeVoucher} type="currency" />
          <KpiCard title="Voucher Ditanggung Penjual" value={discounts.sellerVoucher} type="currency" />
          <KpiCard title="Diskon Dari Shopee" value={discounts.shopeeDiscount} type="currency" />
          <KpiCard title="Diskon Kartu Kredit" value={discounts.creditCardDiscount} type="currency" />
          <KpiCard title="Paket Diskon (Diskon dari Shopee)" value={discounts.bundleDiscountShopee} type="currency" />
          <KpiCard title="Paket Diskon (Diskon dari Penjual)" value={discounts.bundleDiscountSeller} type="currency" />
        </div>

        {/* Map Chart & Top Cities */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          <IndonesiaMapChart data={provinces} />
          <HorizontalBarChart data={cities} nameKey="city" valueKey="sales" title="Top 10 Kota (Penjualan)" />
        </div>

        {/* Payments, Shippings & Durations */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '1.25rem', color: 'var(--text)' }}>Metode Pembayaran (Sales Share)</h3>
            <DonutChart data={paymentData} title="" centerLabel="Total Penjualan" valueFormatter={formatCurrency} />
          </div>
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '1.25rem', color: 'var(--text)' }}>Opsi Pengiriman (Sales Share)</h3>
            <DonutChart data={shippingData} title="" centerLabel="Total Penjualan" valueFormatter={formatCurrency} />
          </div>
        </div>

        {/* Duration distribution */}
        <div>
          <HorizontalBarChart data={durationData} nameKey="name" valueKey="value" title="Distribusi Durasi Penyelesaian Pesanan (Jumlah Order)" />
        </div>

        {/* Cancellation Reason Table */}
        <div className="card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>Analisis Pembatalan (Dibatalkan Oleh x Alasan)</h3>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.5rem' }}>Dibatalkan Oleh</th>
                <th style={{ padding: '0.5rem' }}>Alasan Pembatalan</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>Jumlah Pesanan</th>
              </tr>
            </thead>
            <tbody>
              {cancellations.length === 0 ? (
                <tr>
                  <td colSpan="3" style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)' }}>Tidak ada data pembatalan pada periode ini.</td>
                </tr>
              ) : (
                cancellations.map((c, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                    <td style={{ padding: '0.5rem', fontWeight: '600' }}>{c.cancelledBy}</td>
                    <td style={{ padding: '0.5rem' }}>{c.reason}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{new Intl.NumberFormat('id-ID').format(c.count)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>
    );
}

// Ranked table: Peringkat / Nama Produk / Jumlah Pelanggan
function RankedCustomerCountTable({ title, rows = [] }) {
  return (
    <div className="card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>{title}</h3>
      <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
            <th style={{ padding: '0.5rem', width: '70px' }}>Peringkat</th>
            <th style={{ padding: '0.5rem' }}>Nama Produk</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Jumlah Pelanggan</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ padding: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                Belum ada data
              </td>
            </tr>
          ) : rows.map((r, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
              <td style={{ padding: '0.5rem', fontWeight: '600' }}>{idx + 1}</td>
              <td style={{ padding: '0.5rem' }} title={r.productName}>{r.productName}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{new Intl.NumberFormat('id-ID').format(r.customerCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// TAB 6: BASKET ANALYSIS
function renderBasketAnalysis(data) {
    const {
      stats = {}, sizes = [], pairs = [], topFirstProducts = [], topSecondProducts = [], productTransitions = [],
    } = data || {};

    const formatCurrency = (val) => {
      return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Stats cards -- "Total Pelanggan Unik" sudah ada di tab Executive
            Snapshot (query & filter identik: status 'Selesai', COUNT DISTINCT
            customer_id), jadi tidak dihitung ulang & ditampilkan di sini. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
          <KpiCard title="Total Transaksi (Pesanan)" value={stats.totalTransactions} type="number" />
          <KpiCard title="Total Produk Terjual (Unit)" value={stats.totalItems} type="number" />
          <KpiCard title="Rerata Unit / Transaksi" value={stats.avgItemsPerTransaction} type="number" />
          <KpiCard
            title="ATV (Rata-rata Keranjang)"
            value={stats.atv}
            type="currency"
            note="ATV = rata-rata total_payment per pesanan berstatus 'Selesai'. Beda basis perhitungan dari 'AOV' di tab Business Growth/Executive Snapshot (GMV bersih ÷ jumlah transaksi bersih, basis harian tahap Pesanan Dibayar) -- kedua angka ini tidak dapat dibandingkan 1:1."
          />
        </div>

        {/* Basket Size distribution table */}
        <div className="card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>Analisis Ukuran Keranjang (Basket Size)</h3>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.5rem' }}>Ukuran Basket</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>Jumlah Pesanan</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>Rerata ATV (IDR)</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>Total Penjualan</th>
              </tr>
            </thead>
            <tbody>
              {sizes.map((s, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                  <td style={{ padding: '0.5rem', fontWeight: '600' }}>{s.segment}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>{new Intl.NumberFormat('id-ID').format(s.orders)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatCurrency(s.avgTransactionValue)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatCurrency(s.totalRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Product Association rules table — full width so long product names have room to wrap instead of truncating */}
        <div className="card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>Frequently Bought Together (Top 10 Pasangan Produk)</h3>
          <table className="table" style={{ width: '100%', minWidth: '720px', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '0.5rem', width: '27%' }}>Produk A</th>
                <th style={{ padding: '0.5rem', width: '27%' }}>Produk B</th>
                <th style={{ padding: '0.5rem', width: '11.5%', textAlign: 'right' }}>Transaksi</th>
                <th style={{ padding: '0.5rem', width: '11.5%', textAlign: 'right' }}>Support</th>
                <th style={{ padding: '0.5rem', width: '11.5%', textAlign: 'right' }}>Conf (A→B)</th>
                <th style={{ padding: '0.5rem', width: '11.5%', textAlign: 'right' }}>Lift</th>
              </tr>
            </thead>
            <tbody>
              {pairs.slice(0, 10).map((p, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                  <td style={{ padding: '0.5rem', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.35' }} title={p.productA}>{p.productA}</td>
                  <td style={{ padding: '0.5rem', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.35' }} title={p.productB}>{p.productB}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', verticalAlign: 'top' }}>{p.togetherCount}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', verticalAlign: 'top' }}>{formatPercent(p.support * 100, 2)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', verticalAlign: 'top' }}>{formatPercent(p.confidenceAToB * 100)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', verticalAlign: 'top', fontWeight: '700', color: p.lift > 1 ? 'var(--success)' : 'var(--danger)' }}>{p.lift.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* First & Second Purchase Product */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          <RankedCustomerCountTable title="Top 10 Produk Pembelian Pertama" rows={topFirstProducts} />
          <RankedCustomerCountTable title="Top 10 Produk Pembelian Kedua (Repeat Purchase)" rows={topSecondProducts} />
        </div>

        <ProductTransitionTable data={productTransitions} />

      </div>
    );
}

const PRODUCT_LEVEL_OPTIONS = [
  { value: 'category', label: 'Kategori Produk (Category Level)' },
  { value: 'variant', label: 'Variasi Produk (Variant Level)' },
];

const formatProductCurrency = (val) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0);

// Every product's contribution to revenue (uncapped — unlike the Pareto
// chart, which only shows the top 10 for readability). Scrollable since the
// full product list can be long.
function ContributionTable({ rows = [], levelNoun }) {
  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>Kontribusi Setiap {levelNoun} terhadap Revenue</h3>
      <div style={{ maxHeight: '420px', overflow: 'auto' }}>
        <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
              <th style={{ padding: '0.5rem', width: '60px' }}>Peringkat</th>
              <th style={{ padding: '0.5rem' }}>Produk</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Revenue</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Kontribusi</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Kumulatif</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>Belum ada data produk pada periode ini.</td></tr>
            ) : rows.map((r, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                <td style={{ padding: '0.5rem', fontWeight: '600' }}>{idx + 1}</td>
                <td style={{ padding: '0.5rem' }} title={r.label}>{r.label}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatProductCurrency(r.revenue)}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatPercent(r.contributionPct, 2)}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatPercent(r.cumulativePct, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Growth driver / declining-contribution products — same Theil-Sen trend
// classification the (removed) PLC chart used to visualize, just filtered to
// the two stages that answer "which products are driving growth" and "which
// are losing ground", ranked by revenue so the ones that matter most to the
// business surface first.
function ProductTrendTable({ title, rows = [], accentColor, emptyMessage }) {
  return (
    <div className="card" style={{ padding: '1.25rem', overflowX: 'auto' }}>
      <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: 'var(--text)' }}>{title}</h3>
      <table className="table" style={{ width: '100%', minWidth: '520px', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-muted)' }}>
            <th style={{ padding: '0.5rem' }}>Produk</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Revenue</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Unit Terjual</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Tren (Proyeksi)</th>
            <th style={{ padding: '0.5rem', textAlign: 'right' }}>Kontribusi Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} style={{ padding: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>{emptyMessage}</td></tr>
          ) : rows.map((r, idx) => (
            <tr key={idx} style={{ borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
              <td style={{ padding: '0.5rem' }} title={r.label}>{r.label}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatProductCurrency(r.revenue)}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{new Intl.NumberFormat('id-ID').format(r.quantity)}</td>
              <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: '700', color: accentColor }}>
                {r.growthPct != null ? `${r.growthPct > 0 ? '+' : ''}${formatPercent(r.growthPct)}` : '-'}
              </td>
              <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatPercent(r.contributionPct, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ROOT CAUSE ANALYSIS — GMV decomposition tree (Data Mapping v2).
//
// Not a Data Mapping v1 domain and not part of the side-by-side compare
// render — it drives its own per-node period delta, so DashboardTab routes it
// past the split branch and hands it `compareData` directly.
function renderRootCause(data, { startDate, endDate, compareStartDate, compareEndDate, compareData = null } = {}) {
  const tree = data?.tree || null;
  const compareTree = compareData?.tree || null;
  const hasCompare = Boolean(compareTree);

  if (!tree) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div className="card" style={{ padding: '1.5rem', color: 'var(--text-muted)' }}>
          Data GMV belum tersedia untuk periode ini. Unggah data Shopee melalui Pengaturan Brand.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <RootCauseTree
        tree={tree}
        compareTree={compareTree}
        hasCompare={hasCompare}
        mainRange={`${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`}
        compareRange={hasCompare ? `${formatDateLabel(compareStartDate)} - ${formatDateLabel(compareEndDate)}` : null}
        meta={data?.meta}
      />
    </div>
  );
}

// TAB 7: PRODUCT PERFORMANCE
function renderProductPerformance(data, { productPerformanceLevel = 'category', setProductPerformanceLevel } = {}) {
    const {
      topByQuantity = [], topByRevenue = [], pareto = { total: 0, items: [] },
      contributions = [], growthDrivers = [], declining = [], grainWarning = null,
    } = data || {};

    const levelNoun = productPerformanceLevel === 'variant' ? 'Variasi Produk' : 'Produk';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Global level dropdown -- drives every visualization on this tab */}
        <div className="card" style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'help' }} title="Seluruh angka pada tab ini bersumber dari laporan produk bulanan (monthly report), sama seperti file Product Performance dari Shopee.">
            ⓘ Angka bersumber dari laporan produk <strong>bulanan</strong> (cocok dengan file Product Performance Shopee).
          </div>
          <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600' }}>Tingkat Analisis Produk</label>
          <select
            value={productPerformanceLevel}
            onChange={(e) => setProductPerformanceLevel?.(e.target.value)}
            style={{
              padding: '0.45rem 0.75rem',
              fontSize: '0.85rem',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              cursor: 'pointer'
            }}
          >
            {PRODUCT_LEVEL_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <GrainWarning warning={grainWarning} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>
          <HorizontalBarChart
            data={topByQuantity}
            nameKey="label"
            valueKey="quantity"
            title={`Top 10 ${levelNoun} — Jumlah Terjual`}
          />
          <HorizontalBarChart
            data={topByRevenue}
            nameKey="label"
            valueKey="revenue"
            title={`Top 10 ${levelNoun} — Penjualan (Revenue)`}
          />
        </div>

        <ParetoChart
          data={pareto.items}
          title={`Pareto Chart — Top 10 Kontribusi Penjualan ${levelNoun} terhadap Total Penjualan`}
        />

        <ContributionTable rows={contributions} levelNoun={levelNoun} />

        {/* Growth driver vs declining-contribution products */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>
          <ProductTrendTable
            title={`Growth Driver — ${levelNoun} Pendorong Pertumbuhan`}
            rows={growthDrivers}
            accentColor="var(--success)"
            emptyMessage="Tidak ada produk dengan tren pertumbuhan signifikan pada periode ini."
          />
          <ProductTrendTable
            title={`Penurunan Kontribusi — ${levelNoun} yang Melemah`}
            rows={declining}
            accentColor="var(--danger)"
            emptyMessage="Tidak ada produk dengan tren penurunan signifikan pada periode ini."
          />
        </div>

      </div>
    );
}

// Which renderer draws each domain. The domain list itself — labels, icons,
// endpoints, and the question each one answers — lives in domains.js, because
// the rail, the module summaries and the fetcher all read the same list; three
// parallel copies of it is how "Upload Data" once ended up a peer of
// "Retention Analysis" in one object and absent from the others.
const TAB_RENDERERS = {
  'Executive Snapshot': renderExecutiveSnapshot,
  'Business Growth': renderBusinessGrowth,
  'Traffic & Funnel': renderTrafficFunnel,
  'Retention Analysis': renderRfm,
  'Transaction Behavior': renderTransactionBehavior,
  'Basket Analysis': renderBasketAnalysis,
  'Product Performance': renderProductPerformance,
  'Root Cause Analysis': renderRootCause,
};

// Tabs that render their own period comparison internally (per-node delta)
// instead of the generic main | compare split render below.
const SELF_COMPARE_TABS = new Set(['Root Cause Analysis']);

// Loading shows the shape of what is coming rather than the word "Memuat".
// The console keeps the rail, the strip and every summary on screen while
// this runs, so the page never blanks — only this panel settles.
function DomainSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }} aria-busy="true" aria-live="polite">
      <span className="sr-only">Memuat analisis domain ini...</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '.85rem' }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card" style={{ padding: '1rem' }}>
            <span className="con-skel is-narrow" style={{ height: '.6rem' }} />
            <span className="con-skel is-wide" style={{ height: '1.3rem', marginTop: '.7rem' }} />
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: '1rem', height: 260 }}>
        <span className="con-skel is-narrow" style={{ height: '.7rem' }} />
        <span className="con-skel" style={{ height: '200px', marginTop: '1rem', borderRadius: 10 }} />
      </div>
    </div>
  );
}

// Renders one analytic domain. Fetching moved out to useConsoleData: the
// console holds every domain at once, so no single panel is allowed to own
// the request that fills it.
export default function DashboardTab({
  activeTab,
  filters,
  data,
  status = 'ready',
  error = '',
  onRetry,
  productPerformanceLevel = 'category',
  setProductPerformanceLevel,
  onNavigateTab,
}) {
  // Purely presentational, and only Retention reads it — unlike the product
  // level, which changes what gets fetched and so is owned by the console.
  const [rfmMatrixDim, setRfmMatrixDim] = useState('rf');

  if (!filters.brandId) {
    return (
      <div className="con-state">
        <Building2 className="con-state-ico" size={28} strokeWidth={1.5} />
        <strong>Pilih brand terlebih dahulu</strong>
        <p>Analisis dimuat per brand dan per periode. Pilih brand pada bar di atas untuk memulai.</p>
      </div>
    );
  }

  if (status === 'loading' || status === 'idle') return <DomainSkeleton />;

  if (status === 'error') {
    return (
      <div className="con-err" role="alert">
        <div style={{ fontWeight: 700, marginBottom: '.25rem' }}>Data domain ini gagal dimuat</div>
        <div>{error}</div>
        {onRetry && (
          <button type="button" className="btn btn-secondary" style={{ marginTop: '.85rem' }} onClick={onRetry}>
            <RotateCcw size={14} /> Coba lagi
          </button>
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="con-state">
        <Inbox className="con-state-ico" size={28} strokeWidth={1.5} />
        <strong>Belum ada data untuk periode ini</strong>
        <p>
          Unggah data Shopee untuk brand dan periode terpilih melalui Pengaturan Brand,
          lalu buka kembali halaman ini.
        </p>
      </div>
    );
  }

  const renderer = TAB_RENDERERS[activeTab];
  if (!renderer) return null;

  const rendererExtra = {
    rfmMatrixDim, setRfmMatrixDim, productPerformanceLevel, setProductPerformanceLevel, onNavigateTab,
    // Only consumed by Business Growth (period labels + calendar heatmap's
    // in-range/out-of-range cell distinction) -- every other renderer
    // ignores these two extra fields.
    startDate: filters.startDate, endDate: filters.endDate,
    compareStartDate: filters.compareStartDate, compareEndDate: filters.compareEndDate,
  };
  const showCompare = filters.compare && data.compare;

  // Root Cause Analysis owns its comparison rendering (per-node delta down the
  // tree) — hand it both periods and skip the split render entirely.
  if (SELF_COMPARE_TABS.has(activeTab)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {renderer(data, { ...rendererExtra, compareData: showCompare ? data.compare : null })}
      </div>
    );
  }

  if (!showCompare) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {renderer(data, { ...rendererExtra, stripOwnsKpis: true })}
      </div>
    );
  }

  // Comparison mode: pair up each renderer's top-level sections into shared
  // grid rows (main | compare) instead of stacking each side independently,
  // so a taller section on one side can never push the next section on the
  // other side out of alignment. Both calls use the same renderer, so their
  // top-level section counts always match -- only the data differs.
  const mainSections = Children.toArray(renderer(data, rendererExtra).props.children);
  const compareSections = Children.toArray(renderer(data.compare, rendererExtra).props.children);
  const rowCount = Math.max(mainSections.length, compareSections.length);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: '1.5rem', rowGap: '1.5rem', alignItems: 'stretch' }}>
      <PeriodHeader title="Periode Utama" range={`${formatDateLabel(filters.startDate)} - ${formatDateLabel(filters.endDate)}`} />
      <PeriodHeader title="Periode Pembanding" range={`${formatDateLabel(filters.compareStartDate)} - ${formatDateLabel(filters.compareEndDate)}`} />

      {Array.from({ length: rowCount }, (_, i) => (
        <Fragment key={i}>
          <div style={{ minWidth: 0 }}>{mainSections[i] || null}</div>
          <div style={{ minWidth: 0 }}>{compareSections[i] || null}</div>
        </Fragment>
      ))}
    </div>
  );
}
