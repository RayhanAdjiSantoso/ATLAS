import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleAlert, Database, Layers, Loader2, RefreshCw } from 'lucide-react';
import api from '../../api/client';
import { Delta, Figure } from './figures.jsx';
import DonutChart from './DonutChart.jsx';

// Executive Snapshot — the cross-channel reading that opens Business
// Overview. Shape follows the monthly report's Sales Performance table:
// metric rows, one column per period, growth beside each comparison, and the
// daily revenue curve of the two compared periods.
//
// Every number comes from Daily Tracking (see backend executiveSummaryService)
// — the only source that carries marketplace, offline, B2B and ad spend on one
// daily grain. A metric with no data stays "—", never Rp0.
//
// It renders as a .con-focus panel rather than a card of its own: this is the
// same kind of object as the focused domain below it, and drawing it as a
// bespoke surface is what made it read as a bolted-on section.

const idr = (v) => (v == null ? null : `Rp${Math.round(v).toLocaleString('id-ID')}`);
const num = (v) => (v == null ? null : Math.round(v).toLocaleString('id-ID'));
const fmt = (value, kind) => (kind === 'currency' ? idr(value) : num(value));
const dateLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

// Axis labels only. A full "Rp1.284.930.000" at 9px is a smear, and the table
// below already prints every rupiah.
const idrAxis = (v) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  const short = (d, suffix) => `Rp${(n / d).toLocaleString('id-ID', { maximumFractionDigits: 1 })} ${suffix}`;
  if (abs >= 1e9) return short(1e9, 'M');
  if (abs >= 1e6) return short(1e6, 'jt');
  if (abs >= 1e3) return short(1e3, 'rb');
  return `Rp${Math.round(n).toLocaleString('id-ID')}`;
};

// Seven metrics in one flat run read as a wall. These four groups are the
// order an analyst actually reads them: what we spent, what came back, how
// much moved, and what each unit was worth.
const METRIC_GROUPS = [
  { label: 'Belanja iklan', keys: ['amountSpent'] },
  { label: 'Penjualan', keys: ['revenue', 'revenueAll'] },
  { label: 'Volume', keys: ['qty', 'trx'] },
  { label: 'Rata-rata per pesanan', keys: ['aov', 'aur'] },
];

function ChannelBreakdown({ title, rows, emptyText, tone }) {
  const total = rows.reduce((sum, r) => sum + (Number(r.value) || 0), 0);
  return (
    <div className="xs-break">
      <h3>{title}</h3>
      {!rows.length && <p className="xs-muted">{emptyText}</p>}
      {rows.length > 0 && (
        <ul>
          {rows.map((row) => {
            const value = Number(row.value) || 0;
            const share = total > 0 ? (value / total) * 100 : 0;
            return (
              <li key={row.key}>
                <span className="xs-break-name">{row.label}</span>
                <span className="xs-break-meter" aria-hidden="true">
                  <i className={`is-${tone}`} style={{ width: `${Math.max(share, 1.5)}%` }} />
                </span>
                <b><Figure text={idr(row.value)} absentReason={`${row.label} belum terisi pada periode ini.`} /></b>
                <small>{total > 0 ? `${share.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '—'}</small>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Contiguous stretches of recorded days. A gap in entry has to break the line
// rather than be drawn through as zero, and the area fill has to close on the
// baseline at each end of a run instead of spanning the gap.
function runsOf(points) {
  const out = [];
  let run = [];
  for (const p of points) {
    if (p.revenue == null) { if (run.length) out.push(run); run = []; } else run.push(p);
  }
  if (run.length) out.push(run);
  return out;
}

function DailyRevenueChart({ current, compare }) {
  const [hoverDay, setHoverDay] = useState(null);

  const series = [
    { key: 'current', label: 'Periode ini', color: 'var(--acc)', dash: null, points: current?.daily ?? [] },
    { key: 'compare', label: 'Pembanding', color: '#9aa8c8', dash: '5 4', points: compare?.daily ?? [] },
  ].filter((s) => s.points.some((p) => p.revenue != null));
  if (!series.length) return null;

  const width = 620;
  const height = 250;
  const pad = { top: 16, right: 14, bottom: 30, left: 72 };
  const baseY = height - pad.bottom;
  const maxDay = Math.max(...series.flatMap((s) => s.points.map((p) => p.dayIndex)));
  const maxRevenue = Math.max(...series.flatMap((s) => s.points.map((p) => p.revenue ?? 0)));
  const x = (day) => pad.left + ((day - 1) / Math.max(1, maxDay - 1)) * (width - pad.left - pad.right);
  const y = (value) => baseY - (value / (maxRevenue || 1)) * (height - pad.top - pad.bottom);

  const linePath = (points) => runsOf(points)
    .map((run) => `M${run.map((p) => `${x(p.dayIndex).toFixed(1)},${y(p.revenue).toFixed(1)}`).join('L')}`)
    .join(' ');
  const areaPath = (points) => runsOf(points).filter((run) => run.length > 1)
    .map((run) => `M${x(run[0].dayIndex).toFixed(1)},${baseY}L${run.map((p) => `${x(p.dayIndex).toFixed(1)},${y(p.revenue).toFixed(1)}`).join('L')}L${x(run[run.length - 1].dayIndex).toFixed(1)},${baseY}Z`)
    .join(' ');

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxRevenue);
  const dayTicks = [...new Set([1, Math.round(maxDay / 4), Math.round(maxDay / 2), Math.round((maxDay * 3) / 4), maxDay])]
    .filter((d) => d >= 1 && d <= maxDay);

  // One row per calendar day, so hovering reads every series at that day at
  // once — the comparison is the point of this chart.
  const byDay = new Map();
  for (const s of series) {
    for (const p of s.points) {
      if (!byDay.has(p.dayIndex)) byDay.set(p.dayIndex, { day: p.dayIndex });
      byDay.get(p.dayIndex)[s.key] = p.revenue;
    }
  }
  const days = [...byDay.values()].sort((a, b) => a.day - b.day);
  const slot = (width - pad.left - pad.right) / Math.max(1, maxDay - 1);
  const active = hoverDay == null ? null : byDay.get(hoverDay);
  // The fill and the peak marker belong to the period being read, never to the
  // comparison — otherwise a brand with data only in the compare range gets an
  // accent-coloured area drawn under the grey dashed line.
  const main = series.find((s) => s.key === 'current') ?? null;
  const peak = main
    ? main.points.reduce((best, p) => (p.revenue != null && (!best || p.revenue > best.revenue) ? p : best), null)
    : null;

  return (
    <figure className="xs-chart">
      <figcaption>Revenue harian</figcaption>
      <div className="xs-chart-plot">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik revenue harian periode ini dibanding pembanding">
          <defs>
            <linearGradient id="xs-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--acc)" stopOpacity=".22" />
              <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="xs-chart-grid" />
              <text x={pad.left - 8} y={y(t) + 3} textAnchor="end" className="xs-chart-tick">{idrAxis(t)}</text>
            </g>
          ))}

          {main && <path d={areaPath(main.points)} fill="url(#xs-area)" />}

          {[...series].reverse().map((s) => (
            <path key={s.key} d={linePath(s.points)} fill="none" stroke={s.color} strokeWidth="2.2"
              strokeDasharray={s.dash ?? undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {peak && hoverDay == null && (
            <circle cx={x(peak.dayIndex)} cy={y(peak.revenue)} r="4.5" className="xs-chart-peak" />
          )}

          {active && (
            <g>
              <line x1={x(active.day)} x2={x(active.day)} y1={pad.top} y2={baseY} className="xs-chart-cross" />
              {series.map((s) => (active[s.key] == null ? null : (
                <circle key={s.key} cx={x(active.day)} cy={y(active[s.key])} r="4.5"
                  fill="var(--bg-card)" stroke={s.color} strokeWidth="2.4" />
              )))}
            </g>
          )}

          {dayTicks.map((d) => (
            <text key={d} x={x(d)} y={height - 10}
              textAnchor={d === 1 ? 'start' : d === maxDay ? 'end' : 'middle'}
              className="xs-chart-tick">Hari {d}</text>
          ))}

          {days.map((d) => (
            <rect key={d.day} x={x(d.day) - slot / 2} y={pad.top} width={Math.max(slot, 2)} height={baseY - pad.top}
              fill="transparent" onMouseEnter={() => setHoverDay(d.day)} onMouseLeave={() => setHoverDay(null)} />
          ))}
        </svg>

        {active && (
          <div className="xs-tip" style={{ left: `${(x(active.day) / width) * 100}%`, top: `${(pad.top / height) * 100}%` }}>
            <strong>Hari {active.day}</strong>
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />{s.label}
                <b>{active[s.key] == null ? '—' : idr(active[s.key])}</b>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="xs-chart-legend">
        {series.map((s) => (
          <span key={s.key}>
            <b style={{ background: s.color, opacity: s.dash ? .8 : 1 }} />
            {s.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

// Every state of this panel wears the same shell, so the page does not change
// shape between loading, empty and ready.
function Shell({ children, state }) {
  return (
    <section className="con-focus xs" aria-labelledby="xs-title">
      <div className="con-focus-head xs-head">
        <div className="xs-head-copy">
          <h2 id="xs-title">Executive Snapshot</h2>
          <p>Seluruh channel dalam satu pembacaan — marketplace, offline, B2B, dan belanja iklan — bersumber dari Daily Tracking.</p>
        </div>
        <Link to="/daily-tracking" className="mom-head-link">Isi Daily Tracking <ArrowUpRight size={13} /></Link>
      </div>
      <div className={`con-focus-body xs-body${state ? ' is-state' : ''}`}>{children}</div>
    </section>
  );
}

export default function ExecutiveSummary({ filters }) {
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!filters.brandId) { setState({ status: 'idle', data: null, error: '' }); return undefined; }
    let alive = true;
    setState((s) => ({ status: 'loading', data: s.data, error: '' }));
    api.get('/dashboard/executive-summary', {
      params: {
        brandId: filters.brandId,
        startDate: filters.startDate,
        endDate: filters.endDate,
        compareStartDate: filters.compare ? filters.compareStartDate : undefined,
        compareEndDate: filters.compare ? filters.compareEndDate : undefined,
      },
    })
      .then(({ data }) => { if (alive) setState({ status: 'ready', data, error: '' }); })
      .catch((err) => {
        if (alive) setState({ status: 'error', data: null, error: err?.response?.data?.message || err?.response?.data?.error || 'Ringkasan gagal dimuat.' });
      });
    return () => { alive = false; };
  }, [filters.brandId, filters.startDate, filters.endDate, filters.compare, filters.compareStartDate, filters.compareEndDate, reload]);

  const columns = useMemo(() => {
    if (!state.data) return [];
    const { current, compare, lastYear } = state.data;
    return [
      compare && { key: 'compare', label: `${dateLabel(compare.range.start)} – ${dateLabel(compare.range.end)}`, sub: 'Pembanding' },
      { key: 'current', label: `${dateLabel(current.range.start)} – ${dateLabel(current.range.end)}`, sub: 'Periode ini', primary: true },
      { key: 'lastYear', label: `${dateLabel(lastYear.range.start)} – ${dateLabel(lastYear.range.end)}`, sub: 'Tahun lalu' },
    ].filter(Boolean);
  }, [state.data]);

  if (!filters.brandId) {
    return <Shell state><div className="xs-state"><Layers size={20} /><span>Pilih brand untuk melihat ringkasan lintas channel.</span></div></Shell>;
  }
  if (state.status === 'loading' && !state.data) {
    return <Shell state><div className="xs-state"><Loader2 size={19} className="brand-spin" /><span>Memuat ringkasan lintas channel…</span></div></Shell>;
  }
  if (state.status === 'error') {
    return (
      <Shell state>
        <div className="xs-state is-error">
          <CircleAlert size={19} /><span>{state.error}</span>
          <button type="button" onClick={() => setReload((r) => r + 1)}><RefreshCw size={13} /> Coba lagi</button>
        </div>
      </Shell>
    );
  }
  if (!state.data) return null;

  const { metrics, current, compare, hasAnyData } = state.data;
  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
  const span = 1 + columns.length + (compare ? 1 : 0) + 1;

  // Grouping is a reading order, never a filter: a metric the backend adds
  // that no group claims still has to reach the screen, so the leftovers get
  // their own group rather than falling through the map.
  // DonutChart drops null-valued rows itself, but a channel that exists with
  // no figure must not be counted into the ring's total either.
  const donutData = current.salesChannels
    .filter((c) => c.value != null)
    .map((c) => ({ name: c.label, value: Number(c.value) }));

  const claimed = new Set(METRIC_GROUPS.flatMap((g) => g.keys));
  const groups = [
    ...METRIC_GROUPS.map((g) => ({ label: g.label, rows: g.keys.map((k) => byKey[k]).filter(Boolean) })),
    { label: 'Metrik lain', rows: metrics.filter((m) => !claimed.has(m.key)) },
  ].filter((g) => g.rows.length);

  if (!hasAnyData) {
    return (
      <Shell state>
        <div className="xs-state is-empty">
          <Database size={22} />
          <span>
            <strong>Belum ada data Daily Tracking untuk brand ini</strong>
            Seluruh angka pada ringkasan ini muncul setelah revenue dan belanja iklan harian diisi.
          </span>
          <Link to="/daily-tracking" className="mom-head-link">Isi Daily Tracking <ArrowUpRight size={13} /></Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="xs-table-wrap">
        <table className="xs-table">
          <thead>
            <tr>
              <th scope="col">Metrik</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={c.primary ? 'is-primary' : ''}>
                  <span>{c.sub}</span>
                  <small>{c.label}</small>
                </th>
              ))}
              {compare && <th scope="col">Perubahan</th>}
              <th scope="col">vs Tahun lalu</th>
            </tr>
          </thead>
          {groups.map((group) => {
            return (
              <tbody key={group.label}>
                <tr className="xs-group">
                  <th scope="colgroup" colSpan={span}>{group.label}</th>
                </tr>
                {group.rows.map((m) => (
                  <tr key={m.key}>
                    <th scope="row">{m.label}</th>
                    {columns.map((c) => (
                      <td key={c.key} className={c.primary ? 'is-primary' : ''}>
                        <Figure text={fmt(m[c.key], m.kind)} absentReason={`${m.label} belum terisi untuk rentang ini.`} />
                      </td>
                    ))}
                    {compare && (
                      <td className="xs-delta-cell">
                        <Delta value={m.growthCompare} neutral={m.sentiment === 'neutral'} />
                        {m.growthCompare == null && <Figure text={null} absentReason="Perlu dua periode berisi data untuk dibandingkan." />}
                      </td>
                    )}
                    <td className="xs-delta-cell">
                      <Delta value={m.growthLastYear} neutral={m.sentiment === 'neutral'} />
                      {m.growthLastYear == null && <Figure text={null} absentReason="Belum ada data pada rentang yang sama tahun lalu." />}
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>

      <div className="xs-split">
        <DailyRevenueChart current={current} compare={compare} />
        {/* Proportion is read as a ring, the same way Traffic & Funnel reads
            its traffic sources — same component, same palette, so the two
            pages do not invent two vocabularies for one idea. */}
        <div className="xs-donut">
          <h3>Proporsi revenue per channel</h3>
          {donutData.length ? (
            <DonutChart
              data={donutData}
              title=""
              centerLabel="Total Revenue"
              valueFormatter={(v) => idr(v) ?? '—'}
            />
          ) : (
            <p className="xs-muted">Belum ada revenue tercatat pada periode ini.</p>
          )}
        </div>
      </div>

      <ChannelBreakdown
        title="Spend per channel" tone="spend" rows={current.spendChannels}
        emptyText="Belum ada belanja iklan tercatat pada periode ini."
      />

      <p className="xs-note">
        Revenue inti mencakup Shopee, TikTok, Tokopedia, Offline Store, dan Chat. Website dan channel kustom dihitung terpisah pada baris <strong>Revenue +B2B &amp; Website</strong>. AOV dan AUR memakai Revenue inti.
      </p>
    </Shell>
  );
}
