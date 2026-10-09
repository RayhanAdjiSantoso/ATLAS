import { ChevronDown } from 'lucide-react';
import useSessionState from '../../hooks/useSessionState.js';
import { coverage, isWeekend, todayIso } from '../../dailyTracking/lib/daily.js';

// Every channel against every day of the month, so an empty Tuesday is found
// by looking, not by scrolling a 31-row table per channel. A cell opens that
// channel's sheet at that day; a channel nobody uses this month is listed
// apart rather than painted as a row of red. Folded by default: the header
// alone says how complete the month is, and the full map is one click away.

const dayNum = (iso) => Number(iso.slice(8));

function Ring({ ratio }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const pct = ratio == null ? null : Math.round(ratio * 100);
  return (
    <span className={`bt-ring${pct === 100 ? ' is-full' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} className="bt-ring-track" />
        {ratio != null && (
          <circle cx="22" cy="22" r={r} className="bt-ring-fill" strokeDasharray={`${c * ratio} ${c}`} />
        )}
      </svg>
      <b>{pct == null ? '—' : `${pct}%`}</b>
    </span>
  );
}

export default function CoverageMap({ grid, channels, onJump }) {
  const days = grid.days || [];
  const today = todayIso();
  const n = days.length || 1;
  const [open, setOpen] = useSessionState('daily-tracking:map-open', false);
  const cov = coverage(grid, channels, days, today);
  const used = cov.rows.filter((r) => r.used);
  const unused = cov.rows.filter((r) => !r.used);
  const groups = [
    { kind: 'sales', title: 'Revenue', rows: used.filter((r) => r.kind === 'sales') },
    { kind: 'spend', title: 'Spending', rows: used.filter((r) => r.kind === 'spend') },
  ].filter((g) => g.rows.length);

  return (
    <section className={`soft-card bt-coverage${open ? ' is-open' : ''}`} aria-label="Kelengkapan data">
      <button type="button" className="bt-cover-toggle" aria-expanded={open} aria-controls="bt-cover-body" onClick={() => setOpen((o) => !o)}>
        <Ring ratio={cov.ratio} />
        <span className="bt-cover-title">
          <strong>Kelengkapan data</strong>
          <small>
            {cov.expected
              ? <>{cov.done} dari {cov.expected} hari-channel terisi{cov.gaps ? <> · <b>{cov.gaps} masih kosong</b></> : ' · lengkap'}</>
              : cov.due ? 'Belum ada channel yang diisi bulan ini.' : 'Bulan ini belum berjalan.'}
          </small>
        </span>
        <span className="bt-cover-cta">{open ? 'Ciutkan' : 'Lihat peta'}<ChevronDown size={16} aria-hidden="true" /></span>
      </button>
      <div className="bt-cover-body" id="bt-cover-body">
        <div className="bt-cover">
          <div className="bt-cover-head">
            <p>Setiap channel × setiap hari. Hanya channel yang dipakai bulan ini yang dihitung; hari ini belum. Klik sel untuk membuka hari itu di tabel.</p>
            <div className="bt-cover-key" aria-hidden="true">
              <span><i className="is-filled" /> Terisi</span>
              <span><i className="is-missing" /> Kosong</span>
              <span><i className="is-future" /> Belum lewat</span>
            </div>
          </div>

          {groups.length > 0 && (
            <div className="bt-map" style={{ '--n': n }} role="grid" aria-label="Peta kelengkapan per channel dan hari">
              {groups.map((g) => (
                <div className={`bt-map-group is-${g.kind}`} key={g.kind} role="rowgroup">
                  <div className="bt-map-row is-head" role="row">
                    <span className="bt-map-label" role="columnheader">{g.title}</span>
                    {days.map((d) => (
                      <span key={d} className={`bt-map-day${isWeekend(d) ? ' is-weekend' : ''}${d === today ? ' is-today' : ''}`} role="columnheader">{dayNum(d)}</span>
                    ))}
                  </div>
                  {g.rows.map((r) => (
                    <div className="bt-map-row" key={r.key} role="row">
                      <span className="bt-map-label" role="rowheader" title={r.label}>
                        {r.label}
                        <small>{r.filledDue}/{cov.due}</small>
                      </span>
                      {r.cells.map((state, i) => (
                        <button
                          key={days[i]}
                          type="button"
                          role="gridcell"
                          className={`bt-map-cell is-${state}`}
                          title={`${r.label} · ${dayNum(days[i])} — ${state === 'filled' ? 'terisi' : state === 'missing' ? 'kosong' : state === 'today' ? 'hari ini' : 'belum lewat'}`}
                          aria-label={`${r.label} tanggal ${dayNum(days[i])}: ${state === 'filled' ? 'terisi' : 'kosong'}`}
                          onClick={() => onJump(r.kind, r.key, days[i])}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {unused.length > 0 && (
            <p className="bt-cover-unused">
              <span>Tidak dipakai bulan ini</span>
              {unused.map((r) => (
                <button key={`${r.kind}:${r.key}`} type="button" onClick={() => onJump(r.kind, r.key, null)}>{r.label}</button>
              ))}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
