import { useState } from 'react';
import { fmtRp, fmtRpShort } from '../../dailyTracking/lib/summary.js';
import { channelMix, cumulative, daySeries, monthShort, weekdayAverages } from '../../dailyTracking/lib/daily.js';

// Performance Overview's reading panels, below the daily chart: is the month
// on pace, which days of the week carry it, and which channels it comes from.
// Revenue is not filled in for every brand (many only have spend synced), so
// the first two open on whichever measure the month actually has. A rise in
// revenue is good news and is coloured so; a rise in spend is only a fact,
// and stays neutral.

const METRICS = {
  sales: { label: 'Revenue', field: 'revenue' },
  spend: { label: 'Ads spend', field: 'amount' },
};

const pct = (v, digits = 0) => `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: digits })}%`;

function MetricSwitch({ value, onChange }) {
  return (
    <div className="bt-mini-seg" role="tablist" aria-label="Ukuran">
      {Object.entries(METRICS).map(([k, m]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'is-on' : ''} onClick={() => onChange(k)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function defaultMetric(grid, channels) {
  return daySeries(grid, channels, grid.days || [], 'sales', 'revenue').some((v) => v != null) ? 'sales' : 'spend';
}

// ── Pace: running total against last month, with a month-end projection ──
export function PaceChart({ grid, prevGrid, channels, month, prevMonth, running, initialMetric }) {
  const [metric, setMetric] = useState(initialMetric);
  const { field, label } = METRICS[metric];
  const days = grid.days || [];
  const cur = cumulative(daySeries(grid, channels, days, metric, field));
  const prev = cumulative(daySeries(prevGrid, channels, prevGrid.days || [], metric, field));
  const N = Math.max(days.length, prev.length, 2);
  const last = cur.reduce((a, v, i) => (v != null ? i : a), -1);
  const now = last >= 0 ? cur[last] : null;
  const prevAtSame = last >= 0 && last < prev.length ? prev[last] : null;
  const prevTotal = prev.filter((v) => v != null).at(-1) ?? null;
  // Run-rate projection, only while the month is still running and has a
  // few days behind it — two days of data project nothing worth reading.
  const projection = running && last >= 2 && last < days.length - 1 ? (now / (last + 1)) * days.length : null;
  const max = Math.max(1, ...cur.filter((v) => v != null), ...prev.filter((v) => v != null), projection ?? 0);
  const x = (i) => (i / (N - 1)) * 100;
  const y = (v) => 100 - (v / max) * 92;
  const path = (arr) => arr.map((v, i) => (v == null ? null : `${x(i).toFixed(2)},${y(v).toFixed(2)}`)).filter(Boolean).join(' ');
  const pace = prevAtSame ? (now - prevAtSame) / prevAtSame : null;

  return (
    <section className="soft-card bt-panel" aria-label="Laju kumulatif">
      <header className="bt-panel-head">
        <div>
          <h2>Laju kumulatif</h2>
          <p>Total berjalan {label.toLowerCase()} dibanding {monthShort(prevMonth)} pada tanggal yang sama.</p>
        </div>
        <MetricSwitch value={metric} onChange={setMetric} />
      </header>
      {last < 0 && prevTotal == null ? (
        <p className="bt-empty">Belum ada {label.toLowerCase()} di bulan ini maupun {monthShort(prevMonth)}.</p>
      ) : (
        <>
          <div className="bt-pace">
            <div className="bt-pace-y" aria-hidden="true">
              <span>{fmtRpShort(max)}</span><span>{fmtRpShort(max / 2)}</span><span>0</span>
            </div>
            <div className="bt-pace-plot">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <line x1="0" x2="100" y1={y(max)} y2={y(max)} className="bt-pace-grid" vectorEffect="non-scaling-stroke" />
                <line x1="0" x2="100" y1={y(max / 2)} y2={y(max / 2)} className="bt-pace-grid" vectorEffect="non-scaling-stroke" />
                {prev.some((v) => v != null) && <polyline points={path(prev)} className="bt-pace-prev" vectorEffect="non-scaling-stroke" />}
                {last >= 0 && (
                  <>
                    <polygon points={`0,100 ${path(cur)} ${x(last).toFixed(2)},100`} className={`bt-pace-area is-${metric}`} />
                    <polyline points={path(cur)} className={`bt-pace-cur is-${metric}`} vectorEffect="non-scaling-stroke" />
                  </>
                )}
                {projection != null && (
                  <line x1={x(last)} y1={y(now)} x2={x(days.length - 1)} y2={y(projection)} className={`bt-pace-proj is-${metric}`} vectorEffect="non-scaling-stroke" />
                )}
              </svg>
              {last >= 0 && <span className={`bt-pace-dot is-${metric}`} style={{ left: `${x(last)}%`, top: `${y(now)}%` }} aria-hidden="true" />}
              <div className="bt-pace-x" aria-hidden="true"><span>1</span><span>10</span><span>20</span><span>{N}</span></div>
            </div>
          </div>
          <dl className="bt-pace-facts">
            <div>
              <dt><i className={`is-${metric}`} /> Bulan ini{last >= 0 ? ` · s.d. tgl ${last + 1}` : ''}</dt>
              <dd>{fmtRp(now)}</dd>
              {pace != null && (
                <small className={metric === 'sales' ? (pace >= 0 ? 'is-good' : 'is-bad') : ''}>
                  {pace >= 0 ? '▲' : '▼'} {pct(Math.abs(pace), 1)} vs {monthShort(prevMonth)} di tanggal yang sama
                </small>
              )}
            </div>
            <div>
              <dt><i className="is-prev" /> {monthShort(prevMonth)} (penuh)</dt>
              <dd>{fmtRp(prevTotal)}</dd>
              {prevAtSame != null && <small>Tgl {last + 1}: {fmtRpShort(prevAtSame)}</small>}
            </div>
            {projection != null && (
              <div>
                <dt><i className={`is-proj is-${metric}`} /> Proyeksi akhir bulan</dt>
                <dd>≈ {fmtRpShort(projection)}</dd>
                {prevTotal ? <small>{pct(projection / prevTotal)} dari total {monthShort(prevMonth)}</small> : <small>Laju rata-rata harian × {days.length} hari</small>}
              </div>
            )}
          </dl>
        </>
      )}
    </section>
  );
}

// ── Weekday pattern ──────────────────────────────────────────────────────
export function WeekdayChart({ grid, channels, initialMetric }) {
  const [metric, setMetric] = useState(initialMetric);
  const { field, label } = METRICS[metric];
  const days = grid.days || [];
  const avg = weekdayAverages(days, daySeries(grid, channels, days, metric, field));
  const known = avg.filter((a) => a.avg != null);
  const top = Math.max(0, ...known.map((a) => a.avg));
  const best = known.length ? known.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
  const worst = known.length > 1 ? known.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;

  return (
    <section className="soft-card bt-panel" aria-label="Pola mingguan">
      <header className="bt-panel-head">
        <div>
          <h2>Pola mingguan</h2>
          <p>Rata-rata {label.toLowerCase()} per hari dalam seminggu, bulan ini.</p>
        </div>
        <MetricSwitch value={metric} onChange={setMetric} />
      </header>
      {!known.length ? (
        <p className="bt-empty">Belum ada {label.toLowerCase()} bulan ini.</p>
      ) : (
        <>
          <div className="bt-week">
            {avg.map((a) => (
              <div key={a.day} className={`bt-week-col${a === best ? ' is-best' : ''}`}>
                <span className="bt-week-val">{a.avg == null ? '—' : fmtRpShort(a.avg)}</span>
                <span className="bt-week-track">
                  <i className={`is-${metric}`} style={{ transform: `scaleY(${top && a.avg ? a.avg / top : 0})` }} />
                </span>
                <span className="bt-week-day">{a.day}</span>
              </div>
            ))}
          </div>
          {best && (
            <p className="bt-panel-note">
              Terkuat <b>{best.day}</b> ({fmtRpShort(best.avg)})
              {worst && worst !== best && <> · terlemah <b>{worst.day}</b> ({fmtRpShort(worst.avg)}), {pct(worst.avg / best.avg)} dari hari terkuat</>}
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ── Channel mix ──────────────────────────────────────────────────────────
const PALETTE = {
  sales: ['#1f45b5', '#3c66d4', '#6a8fe4', '#97b3ef', '#bfd0f6', '#5a6c97', '#8794b3', '#b7c0d4'],
  spend: ['#0a7f95', '#0e98b0', '#3cb4c8', '#78cdda', '#a8dfe7', '#4f7f88', '#86a7ad', '#b9cdd1'],
};

function MixBlock({ kind, mix, prevMix, prevMonth }) {
  const title = kind === 'sales' ? 'Revenue per channel' : 'Ads spend per channel';
  const prevBy = new Map(prevMix.rows.map((r) => [r.key, r.value]));
  return (
    <div className="bt-mix-block">
      <div className="bt-mix-head">
        <h3>{title}</h3>
        <strong>{fmtRp(mix.total || null)}</strong>
      </div>
      {!mix.rows.length ? (
        <p className="bt-empty">Belum ada data bulan ini.</p>
      ) : (
        <>
          <div className="bt-mix-bar" aria-hidden="true">
            {mix.rows.map((r, i) => (
              <i key={r.key} style={{ flexGrow: r.share, background: PALETTE[kind][i % 8] }} title={`${r.label} ${pct(r.share, 1)}`} />
            ))}
          </div>
          <ul className="bt-mix-list">
            {mix.rows.map((r, i) => {
              const before = prevBy.get(r.key);
              const ch = before ? (r.value - before) / before : null;
              return (
                <li key={r.key}>
                  <i style={{ background: PALETTE[kind][i % 8] }} aria-hidden="true" />
                  <span className="bt-mix-name">{r.label}</span>
                  <span className="bt-mix-share">{pct(r.share, 1)}</span>
                  <span className="bt-mix-val">{fmtRpShort(r.value)}</span>
                  <span className={`bt-mix-ch${ch == null || kind !== 'sales' ? '' : ch >= 0 ? ' is-good' : ' is-bad'}`}>
                    {ch == null ? (before === undefined ? 'baru' : '—') : `${ch >= 0 ? '▲' : '▼'} ${pct(Math.abs(ch))}`}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="bt-panel-note">Perubahan dibanding {monthShort(prevMonth)} pada rentang tanggal yang sama.</p>
        </>
      )}
    </div>
  );
}

export function ChannelMix({ grid, prevSame, channels, prevMonth }) {
  return (
    <section className="soft-card bt-panel bt-mix" aria-label="Komposisi channel">
      <header className="bt-panel-head">
        <div>
          <h2>Komposisi channel</h2>
          <p>Dari mana revenue datang dan ke mana belanja iklan pergi bulan ini.</p>
        </div>
      </header>
      <div className="bt-mix-grid">
        <MixBlock kind="sales" mix={channelMix(grid, channels, 'sales')} prevMix={channelMix(prevSame, channels, 'sales')} prevMonth={prevMonth} />
        <MixBlock kind="spend" mix={channelMix(grid, channels, 'spend')} prevMix={channelMix(prevSame, channels, 'spend')} prevMonth={prevMonth} />
      </div>
    </section>
  );
}
