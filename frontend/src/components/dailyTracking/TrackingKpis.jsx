import { computeKpis, fmtRp, fmtRpShort, fmtNum, fmtPct } from '../../dailyTracking/lib/summary.js';
import { daySeries } from '../../dailyTracking/lib/daily.js';

// The month in six numbers. The four that are sums carry a sparkline of the
// days behind them, so a total that looks fine but was made in one spike (or
// stopped a week ago) shows it at a glance. Revenue is the exact figure, not
// "Rp1,2 M": it is the number the team reconciles against the marketplace
// dashboards, and rounding hides real differences.

function Spark({ values }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return <svg className="bt-spark is-empty" aria-hidden="true" />;
  const n = values.length - 1 || 1;
  const max = Math.max(...pts.map(([, v]) => v), 0);
  const min = Math.min(...pts.map(([, v]) => v), 0);
  const span = max - min || 1;
  const xy = pts.map(([i, v]) => [(i / n) * 100, 30 - ((v - min) / span) * 26 - 2]);
  const line = xy.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L${xy[xy.length - 1][0].toFixed(2)} 32 L${xy[0][0].toFixed(2)} 32 Z`;
  return (
    <svg className="bt-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path className="bt-spark-area" d={area} />
      <path className="bt-spark-line" d={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Change against the comparison period. For Cost per Revenue a rise is bad
// news, so its colours are the other way round.
function Delta({ now, before, inverse, label }) {
  if (now == null || before == null || before === 0) return null;
  const ch = (now - before) / Math.abs(before);
  if (!Number.isFinite(ch)) return null;
  const flat = Math.abs(ch) < 0.005;
  const good = inverse ? ch < 0 : ch > 0;
  return (
    <span className={`bt-delta ${flat ? 'is-flat' : good ? 'is-up' : 'is-down'}`} title={`dibanding ${label}`}>
      {flat ? '±0%' : `${ch > 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toLocaleString('id-ID', { maximumFractionDigits: Math.abs(ch) < 0.1 ? 1 : 0 })}%`}
    </span>
  );
}

export default function TrackingKpis({ grid, channels, loading, prev, compareLabel }) {
  const k = computeKpis(grid, channels);
  const p = prev ? computeKpis(prev, channels) : null;
  const days = grid.days || [];
  const rev = daySeries(grid, channels, days, 'sales', 'revenue');
  const trx = daySeries(grid, channels, days, 'sales', 'transaksi');
  const qty = daySeries(grid, channels, days, 'sales', 'qtySold');
  const spend = daySeries(grid, channels, days, 'spend', 'amount');
  const revDays = rev.filter((v) => v != null).length;
  const spendDays = spend.filter((v) => v != null).length;
  const cpr = k.costPerRevenue;

  const tiles = [
    {
      key: 'rev', kpi: 'totalRevenue', label: 'Total Revenue (GMV)', value: fmtRp(k.totalRevenue), wide: true, spark: rev,
      sub: revDays ? `Rata-rata ${fmtRpShort(k.totalRevenue / revDays)} / hari · ${revDays} hari terisi` : 'Belum ada revenue bulan ini',
    },
    { key: 'trx', kpi: 'totalTransaksi', label: 'Total Transaksi', value: fmtNum(k.totalTransaksi), spark: trx, sub: 'Semua channel penjualan' },
    { key: 'qty', kpi: 'totalQty', label: 'Qty Terjual', value: fmtNum(k.totalQty), spark: qty, sub: k.totalTransaksi ? `${(k.totalQty / k.totalTransaksi).toLocaleString('id-ID', { maximumFractionDigits: 1 })} item / transaksi` : 'Unit produk terjual' },
    { key: 'aov', kpi: 'aov', label: 'AOV', value: fmtRpShort(k.aov), sub: 'Revenue ÷ transaksi' },
    {
      key: 'spend', kpi: 'totalSpend', label: 'Total Ads Spend', value: fmtRpShort(k.totalSpend), spark: spend, tone: 'spend',
      sub: spendDays ? `${spendDays} hari tercatat` : 'Belum ada spend bulan ini',
    },
    {
      key: 'cpr', kpi: 'costPerRevenue', inverse: true, label: 'Cost per Revenue', value: fmtPct(cpr), meter: cpr,
      sub: cpr != null ? `Rp${Math.round(cpr * 100).toLocaleString('id-ID')} iklan per Rp100 revenue` : 'Butuh revenue dan spend',
    },
  ];

  return (
    <section className="bt-kpis" aria-label="Ringkasan bulan ini">
      {tiles.map((t) => (
        <article key={t.key} className={`bt-kpi${t.wide ? ' is-wide' : ''}${t.tone ? ` is-${t.tone}` : ''}`}>
          <span className="bt-kpi-top">
            <span className="bt-kpi-label">{t.label}</span>
            {!loading && p && <Delta now={k[t.kpi]} before={p[t.kpi]} inverse={t.inverse} label={compareLabel} />}
          </span>
          <strong className="bt-kpi-val">{loading ? <span className="dt-skel" /> : t.value}</strong>
          <span className="bt-kpi-sub">{loading ? ' ' : t.sub}</span>
          {t.spark && !loading && <Spark values={t.spark} />}
          {t.meter !== undefined && !loading && (
            <span className="bt-meter" aria-hidden="true">
              <i style={{ transform: `scaleX(${Math.min(Math.max(t.meter ?? 0, 0), 1)})` }} />
            </span>
          )}
        </article>
      ))}
    </section>
  );
}
