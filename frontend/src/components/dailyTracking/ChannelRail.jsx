import { Plus } from 'lucide-react';
import { channelTotal, costPerRevenue, fmtNum, fmtRp, fmtRpShort, fmtPct, totalForKind } from '../../dailyTracking/lib/summary.js';

// The channels of one section, boxed like the sheet beside it: a header bar
// the height of the sheet's, one quiet line per channel (fill-state dot, name,
// month total), and the section total as a footer row level with the sheet's
// own total. Everything else about a channel is in the sheet once picked.
export default function ChannelRail({ kind, grid, channels, coverage, activeKey, onSelect, onAdd }) {
  const list = channels[kind] || [];
  const field = kind === 'sales' ? 'revenue' : 'amount';
  const total = totalForKind(grid, channels, kind, field);
  const rows = new Map(coverage.rows.filter((r) => r.kind === kind).map((r) => [r.key, r]));

  const state = (cov) => {
    if (!cov?.used) return { tone: 'idle', label: 'Belum dipakai bulan ini' };
    if (!coverage.due || cov.filledDue >= coverage.due) return { tone: 'full', label: 'Terisi sampai kemarin' };
    return { tone: 'gap', label: `${coverage.due - cov.filledDue} hari belum diisi` };
  };

  return (
    <aside className={`bt-rail is-${kind}`} aria-label={kind === 'sales' ? 'Channel penjualan' : 'Channel iklan'}>
      <header className="bt-rail-head">
        <span>{kind === 'sales' ? 'Channel penjualan' : 'Channel iklan'}</span>
        <b>{list.length}</b>
      </header>
      <ul className="bt-rail-list" role="tablist" aria-orientation="vertical">
        {list.map((c) => {
          const v = channelTotal(grid, kind, c.key, field);
          const st = state(rows.get(c.key));
          const on = c.key === activeKey;
          return (
            <li key={c.key}>
              <button
                type="button"
                role="tab"
                aria-selected={on}
                className={`bt-rail-item is-${st.tone}${on ? ' is-on' : ''}`}
                onClick={() => onSelect(c.key)}
                title={st.label}
              >
                <i className="bt-rail-dot" aria-hidden="true" />
                <span className="bt-rail-name">{c.label}</span>
                <span className="bt-rail-val">{v == null ? '—' : fmtRpShort(v)}</span>
              </button>
            </li>
          );
        })}
        {onAdd && (
          <li>
            <button type="button" className="bt-rail-add" onClick={onAdd}>
              <Plus size={14} aria-hidden="true" /> Tambah channel
            </button>
          </li>
        )}
      </ul>
      <footer className="bt-rail-total">
        <span>Total</span>
        <strong>{fmtRp(total)}</strong>
        <small>
          {kind === 'sales'
            ? <>{fmtNum(totalForKind(grid, channels, 'sales', 'transaksi'))} trx · {fmtNum(totalForKind(grid, channels, 'sales', 'qtySold'))} qty</>
            : <>Cost per revenue {fmtPct(costPerRevenue(grid, channels))}</>}
        </small>
        <span className="bt-rail-legend" aria-hidden="true">
          <span><i className="is-full" /> lengkap</span>
          <span><i className="is-gap" /> ada kosong</span>
          <span><i className="is-idle" /> belum dipakai</span>
        </span>
      </footer>
    </aside>
  );
}
