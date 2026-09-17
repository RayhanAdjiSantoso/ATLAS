import { computeKpis, fmtRpShort, fmtNum, fmtPct } from '../../dailyTracking/lib/summary.js';

// Visual pattern copied from Dashboard's KpiStrip/.con-kpis (one bordered
// surface divided by hairlines, not free-floating cards) — but genuinely
// `position: sticky` here (see dailyTracking.css), since this page's table
// can run 30+ rows tall, unlike Dashboard's version which is "sticky" only
// because it never unmounts.
//
// Six cards, not Dashboard's eight: a manual daily sheet has no
// unique-customer/CVR/cancellation data to summarize.
const CARDS = [
  { key: 'totalRevenue', label: 'Total Revenue (GMV)', fmt: fmtRpShort },
  { key: 'totalTransaksi', label: 'Total Transaksi', fmt: fmtNum },
  { key: 'totalQty', label: 'Total Qty Terjual', fmt: fmtNum },
  { key: 'aov', label: 'AOV', fmt: fmtRpShort },
  { key: 'totalSpend', label: 'Total Ads Spend', fmt: fmtRpShort },
  { key: 'costPerRevenue', label: 'Cost per Revenue', fmt: fmtPct },
];

export default function DailyKpiStrip({ grid, channels, loading }) {
  const kpis = computeKpis(grid, channels);

  return (
    <div className="dt-kpis">
      {CARDS.map((c) => (
        <div className="dt-kpi" key={c.key}>
          <div className="dt-kpi-label">{c.label}</div>
          <div className="dt-kpi-val">
            {loading ? <span className="dt-skel" /> : c.fmt(kpis[c.key])}
          </div>
        </div>
      ))}
    </div>
  );
}
