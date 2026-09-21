import SectionToggle from './SectionToggle.jsx';
import { channelTotal, totalForKind, costPerRevenue, fmtRp, fmtNum, fmtPct } from '../../dailyTracking/lib/summary.js';

// Visual pattern from Report Generator's Business Overview tab, simplified to
// one column of totals for the selected month (no old/cur period compare) —
// a plain local <table>, not the scoped TS KpiTable component.
export default function ChannelSummaryTable({ kind, grid, channels, open = true, onToggle }) {
  const salesChannels = channels.sales || [];
  const spendChannels = channels.spend || [];

  const totalRevenue = totalForKind(grid, channels, 'sales', 'revenue');
  const totalTransaksi = totalForKind(grid, channels, 'sales', 'transaksi');
  const totalQty = totalForKind(grid, channels, 'sales', 'qtySold');
  const totalSpend = totalForKind(grid, channels, 'spend', 'amount');

  return (
    <div className="dt-summary-wrap">
      <SectionToggle
        as="h3" title="Ringkasan per Channel" bodyId={`dt-body-summary-${kind}`}
        open={open} onToggle={onToggle}
      />
      {open && <div id={`dt-body-summary-${kind}`} className="dt-summary-body">

      {kind === 'sales' && <>
      <h4 className="dt-summary-subtitle">Revenue Channel</h4>
      <div className="dt-table-wrap">
        <table className="dt-table dt-summary-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Revenue</th>
              <th>Transaksi</th>
              <th>Qty Terjual</th>
            </tr>
          </thead>
          <tbody>
            {salesChannels.map((c) => (
              <tr key={c.key}>
                <td>{c.label}</td>
                <td>{fmtRp(channelTotal(grid, 'sales', c.key, 'revenue'))}</td>
                <td>{fmtNum(channelTotal(grid, 'sales', c.key, 'transaksi'))}</td>
                <td>{fmtNum(channelTotal(grid, 'sales', c.key, 'qtySold'))}</td>
              </tr>
            ))}
            <tr className="dt-summary-total-row">
              <td>Total</td>
              <td>{fmtRp(totalRevenue)}</td>
              <td>{fmtNum(totalTransaksi)}</td>
              <td>{fmtNum(totalQty)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      </>}

      {kind === 'spend' && <>
      <h4 className="dt-summary-subtitle">Ads Channel</h4>
      <div className="dt-table-wrap">
        <table className="dt-table dt-summary-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Ad Spend</th>
            </tr>
          </thead>
          <tbody>
            {spendChannels.map((c) => (
              <tr key={c.key}>
                <td>{c.label}</td>
                <td>{fmtRp(channelTotal(grid, 'spend', c.key, 'amount'))}</td>
              </tr>
            ))}
            <tr className="dt-summary-total-row">
              <td>Total</td>
              <td>{fmtRp(totalSpend)}</td>
            </tr>
            <tr className="dt-summary-calc-row">
              <td>Cost per Revenue</td>
              <td>{fmtPct(costPerRevenue(grid, channels))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      </>}
      </div>}
    </div>
  );
}
