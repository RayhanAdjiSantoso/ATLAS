import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, CheckCircle2, ChevronDown, CircleAlert, Database, Layers, Loader2, Plus, RefreshCw } from 'lucide-react';
import api from '../../api/client';
import useSessionState, { sessionKey } from '../../hooks/useSessionState.js';
import { Delta, Figure } from './figures.jsx';

// Executive Snapshot — the cross-channel reading that opens Business
// Overview. Shape follows the monthly report's Sales Performance table:
// metric rows, one column per period, growth beside each comparison, the
// daily revenue and ad spend curves, their running totals, and spend against
// revenue per channel.
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
const ratioX = (v) => (v == null ? null : `${v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`);
const fmt = (value, kind) => (kind === 'currency' ? idr(value) : kind === 'ratio' ? ratioX(value) : num(value));
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

const HERO_KEY = 'revenue';
const TILE_ORDER = ['amountSpent', 'roas', 'trx', 'qty', 'aov', 'aur'];

// Current against its comparison as two lengths scaled to the larger of the
// two. The pair answers "did it move, and by how much" before the eye reaches
// the percentage, and it degrades honestly — no comparison, no bars.
function CompareBars({ metric }) {
  if (metric.current == null || metric.compare == null) return null;
  const cur = Number(metric.current);
  const prev = Number(metric.compare);
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const max = Math.max(cur, prev);
  if (!(max > 0)) return null;
  return (
    <div className="xs-bars" aria-hidden="true">
      <span className="xs-bar is-cur"><i style={{ width: `${(Math.max(0, cur) / max) * 100}%` }} /></span>
      <span className="xs-bar is-prev"><i style={{ width: `${(Math.max(0, prev) / max) * 100}%` }} /></span>
    </div>
  );
}

// ROAS per channel: each channel's sales over the spend that buys them
// (backend ROAS_GROUPS), beside the blended figure for scale. A row with
// spend but no sales, or sales but no spend, says so instead of a number.
function ChannelRoas({ rows, compare, blended }) {
  if (!rows?.length) return null;
  const prev = new Map((compare ?? []).map((r) => [r.key, r.roas]));
  const max = Math.max(blended?.current ?? 0, ...rows.map((r) => r.roas ?? 0));
  return (
    <section className="xs-roas" aria-label="ROAS per channel">
      <header>
        <h3>ROAS per channel</h3>
        <p>Penjualan tiap channel dibagi belanja iklan yang mengarah ke channel itu.</p>
      </header>
      <div className="xs-roas-grid">
        {blended && (
          <article className="xs-roas-card is-blended">
            <span>Blended</span>
            <strong>{ratioX(blended.current) ?? '—'}</strong>
            <small>Semua revenue ÷ semua spend</small>
            <i style={{ transform: `scaleX(${max && blended.current ? blended.current / max : 0})` }} aria-hidden="true" />
          </article>
        )}
        {rows.map((r) => {
          const before = prev.get(r.key);
          const ch = r.roas != null && before ? (r.roas - before) / before : null;
          return (
            <article className="xs-roas-card" key={r.key}>
              <span>{r.label}</span>
              <strong>{r.roas != null ? ratioX(r.roas) : '—'}</strong>
              <small>
                {r.roas == null
                  ? (r.spend ? 'Belum ada revenue' : 'Belum ada spend')
                  : <>{idrAxis(r.revenue)} ÷ {idrAxis(r.spend)}</>}
                {ch != null && <b className={ch >= 0 ? 'is-up' : 'is-down'}> {ch >= 0 ? '▲' : '▼'} {Math.abs(ch * 100).toFixed(0)}%</b>}
              </small>
              <i style={{ transform: `scaleX(${max && r.roas ? r.roas / max : 0})` }} aria-hidden="true" />
            </article>
          );
        })}
      </div>
    </section>
  );
}

// Revenue in the brand's blue, spend in orange: two hues that stay apart for
// every colour-vision type. The comparison period is a dashed grey line, a
// reference rather than a third series, and is always named in the legend and
// the tooltip, never told apart by colour alone.
const C_REV = 'var(--acc)';
const C_SPEND = '#eb6834';
const C_PREV = '#9aa8c8';

const pctLabel = (v) => (v == null ? '—' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
const div = (a, b) => (a != null && b != null && b > 0 ? a / b : null);

// One value per day for each KPI tile, from the same daily rows the charts
// draw. Ratios are per day (that day's revenue over that day's transactions),
// so a sparkline shows the day-to-day swing, not a running average.
const DAILY = {
  revenue: (d) => d.revenue,
  amountSpent: (d) => d.spend,
  roas: (d) => div(d.revenue, d.spend),
  trx: (d) => d.trx,
  qty: (d) => d.qty,
  aov: (d) => div(d.revenue, d.trx),
  aur: (d) => div(d.revenue, d.qty),
};

// The tile's days as a bare line. An empty day breaks the line rather than
// diving to zero; fewer than two filled days draws nothing.
function TileSpark({ values, tone = 'rev' }) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v != null);
  if (pts.length < 2) return null;
  const n = Math.max(values.length - 1, 1);
  const max = Math.max(...pts.map(([, v]) => v));
  const min = Math.min(...pts.map(([, v]) => v), 0);
  const span = max - min || 1;
  const y = (v) => 22 - ((v - min) / span) * 20;
  const segments = [];
  let seg = [];
  values.forEach((v, i) => {
    if (v == null) { if (seg.length) segments.push(seg); seg = []; return; }
    seg.push(`${((i / n) * 100).toFixed(2)},${y(v).toFixed(2)}`);
  });
  if (seg.length) segments.push(seg);
  return (
    <svg className={`xs-spark is-${tone}`} viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {segments.map((s, k) => (s.length === 1
        ? <circle key={k} cx={s[0].split(',')[0]} cy={s[0].split(',')[1]} r="0.9" />
        : <polyline key={k} points={s.join(' ')} vectorEffect="non-scaling-stroke" />))}
    </svg>
  );
}

// Running total per day; null after the last day that holds a value, so the
// line stops where the data stops instead of running flat to the range's end.
function cumulative(values) {
  let last = -1;
  values.forEach((v, i) => { if (v != null) last = i; });
  let acc = 0;
  return values.map((v, i) => {
    if (i > last) return null;
    acc += v ?? 0;
    return acc;
  });
}

// Contiguous stretches of recorded days. A gap in entry has to break the line
// rather than be drawn through as zero, and the area fill has to close on the
// baseline at each end of a run instead of spanning the gap.
function runsOf(points) {
  const out = [];
  let run = [];
  for (const p of points) {
    if (p.value == null) { if (run.length) out.push(run); run = []; } else run.push(p);
  }
  if (run.length) out.push(run);
  return out;
}

// Day-indexed lines on one rupiah axis. Revenue and spend share the unit, so
// they share the scale: spend sitting low under revenue is the true proportion,
// not a drawing choice. `series` is [{ key, label, color, dash, area, points:
// [{ dayIndex, value }], endLabel }]; `tooltip(day)` returns the rows to show.
function TrendChart({ caption, series: all, tooltip, ariaLabel }) {
  const [hoverDay, setHoverDay] = useState(null);
  const areaId = useId();
  const series = all.filter((s) => s.points.some((p) => p.value != null));
  if (!series.length) return null;

  const width = 620;
  const height = 250;
  const pad = { top: 16, right: series.some((s) => s.endLabel) ? 64 : 14, bottom: 30, left: 72 };
  const baseY = height - pad.bottom;
  const values = series.flatMap((s) => s.points.map((p) => p.value).filter((v) => v != null));
  const maxDay = Math.max(...series.flatMap((s) => s.points.map((p) => p.dayIndex)));
  const maxV = Math.max(0, ...values);
  const minV = Math.min(0, ...values);
  const spanV = maxV - minV || 1;
  const x = (day) => pad.left + ((day - 1) / Math.max(1, maxDay - 1)) * (width - pad.left - pad.right);
  const y = (value) => baseY - ((value - minV) / spanV) * (height - pad.top - pad.bottom);
  const zeroY = y(0);

  // Horizontal Bézier controls stay between consecutive values: smooth,
  // without inventing peaks or connecting days with missing data.
  const curve = (run) => run.map((p, i) => {
    if (!i) return `M${x(p.dayIndex)},${y(p.value)}`;
    const prev = run[i - 1];
    const mid = (x(prev.dayIndex) + x(p.dayIndex)) / 2;
    return `C${mid},${y(prev.value)} ${mid},${y(p.value)} ${x(p.dayIndex)},${y(p.value)}`;
  }).join(' ');
  const linePath = (points) => runsOf(points).map(curve).join(' ');
  const areaPath = (points) => runsOf(points).filter((run) => run.length > 1)
    .map((run) => `${curve(run)} L${x(run.at(-1).dayIndex)},${zeroY} L${x(run[0].dayIndex)},${zeroY}Z`)
    .join(' ');

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => minV + t * spanV);
  const dayTicks = [...new Set([1, Math.round(maxDay / 4), Math.round(maxDay / 2), Math.round((maxDay * 3) / 4), maxDay])]
    .filter((d) => d >= 1 && d <= maxDay);
  const slot = (width - pad.left - pad.right) / Math.max(1, maxDay - 1);
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);
  const at = (s, day) => s.points.find((p) => p.dayIndex === day)?.value ?? null;
  const areaSeries = series.find((s) => s.area);

  // End-of-line labels, nudged apart when two lines finish close together.
  const ends = series.filter((s) => s.endLabel).map((s) => {
    const last = [...s.points].reverse().find((p) => p.value != null);
    return { key: s.key, x: x(last.dayIndex), y: y(last.value), text: s.endLabel(last.value) };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i += 1) {
    if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  }

  const rows = hoverDay == null ? null : tooltip(hoverDay);
  return (
    <figure className="xs-chart">
      <figcaption>{caption}</figcaption>
      <div className="xs-chart-plot">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
          <defs>
            <linearGradient id={areaId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--acc)" stopOpacity=".18" />
              <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="xs-chart-grid" />
              <text x={pad.left - 8} y={y(t) + 3} textAnchor="end" className="xs-chart-tick">{idrAxis(t)}</text>
            </g>
          ))}

          {areaSeries && <path d={areaPath(areaSeries.points)} fill={`url(#${areaId})`} />}

          {[...series].reverse().map((s) => (
            <path key={s.key} d={linePath(s.points)} fill="none" stroke={s.color} strokeWidth="2"
              strokeDasharray={s.dash ?? undefined} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {hoverDay == null && ends.map((e) => (
            <text key={e.key} x={e.x + 7} y={e.y + 4} className="xs-chart-end">{e.text}</text>
          ))}

          {hoverDay != null && (
            <g>
              <line x1={x(hoverDay)} x2={x(hoverDay)} y1={pad.top} y2={baseY} className="xs-chart-cross" />
              {series.map((s) => (at(s, hoverDay) == null ? null : (
                <circle key={s.key} cx={x(hoverDay)} cy={y(at(s, hoverDay))} r="4.5"
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
            <rect key={d} x={x(d) - slot / 2} y={pad.top} width={Math.max(slot, 2)} height={baseY - pad.top}
              tabIndex={0} role="img"
              aria-label={`Hari ${d}: ${tooltip(d).rows.map((r) => `${r.label} ${r.value}`).join(', ')}`}
              onFocus={() => setHoverDay(d)} onBlur={() => setHoverDay(null)}
              fill="transparent" onMouseEnter={() => setHoverDay(d)} onMouseLeave={() => setHoverDay(null)} />
          ))}
        </svg>

        {rows && (
          <div className="xs-tip" style={{ left: `${Math.max(25, Math.min(75, (x(hoverDay) / width) * 100))}%`, top: `${(pad.top / height) * 100}%` }}>
            <strong>{rows.title}</strong>
            {rows.rows.map((r) => (
              <span key={r.label} className={r.color ? undefined : 'is-derived'}>
                {r.color ? <i style={{ background: r.color }} /> : null}{r.label}
                <b>{r.value}</b>
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

const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : null);
const dayTitle = (daily, day) => {
  const date = daily.find((d) => d.dayIndex === day)?.date;
  return date ? `Hari ${day} · ${shortDate(date)}` : `Hari ${day}`;
};

// The range day by day: revenue against ad spend, plus the comparison's
// revenue when one is switched on. Hover gives the day's cost per revenue.
function DailyChart({ current, compare }) {
  const daily = current?.daily ?? [];
  const prev = compare?.daily ?? [];
  const pts = (rows, field) => rows.map((d) => ({ dayIndex: d.dayIndex, value: d[field] }));
  const peak = daily.reduce((best, d) => (d.revenue != null && (!best || d.revenue > best.revenue) ? d : best), null);
  return (
    <TrendChart
      ariaLabel="Grafik revenue dan ads spend harian"
      caption={<><span>Revenue &amp; ads spend harian</span>{peak && <small>Puncak revenue · Hari {peak.dayIndex} <b>{idr(peak.revenue)}</b></small>}</>}
      series={[
        { key: 'rev', label: 'Revenue', color: C_REV, area: true, points: pts(daily, 'revenue') },
        { key: 'spend', label: 'Ads spend', color: C_SPEND, points: pts(daily, 'spend') },
        { key: 'prev', label: 'Revenue pembanding', color: C_PREV, dash: '5 4', points: pts(prev, 'revenue') },
      ]}
      tooltip={(day) => {
        const d = daily.find((r) => r.dayIndex === day) ?? {};
        const p = prev.find((r) => r.dayIndex === day);
        return {
          title: dayTitle(daily, day),
          rows: [
            { label: 'Revenue', color: C_REV, value: idr(d.revenue) ?? '—' },
            { label: 'Ads spend', color: C_SPEND, value: idr(d.spend) ?? '—' },
            ...(compare ? [{ label: 'Revenue pembanding', color: C_PREV, value: idr(p?.revenue) ?? '—' }] : []),
            { label: 'Cost per revenue', value: pctLabel(div(d.spend, d.revenue)) },
          ],
        };
      }}
    />
  );
}

// Where the range is heading: revenue and spend each as a running total.
// The gap between the two lines is what the money bought; where spend
// climbs while revenue flattens is the stretch to look at.
function PaceChart({ current }) {
  const daily = current?.daily ?? [];
  const rev = cumulative(daily.map((d) => d.revenue));
  const spend = cumulative(daily.map((d) => d.spend));
  const pts = (vals) => daily.map((d, i) => ({ dayIndex: d.dayIndex, value: vals[i] }));
  const lastRev = [...rev].reverse().find((v) => v != null) ?? null;
  const lastSpend = [...spend].reverse().find((v) => v != null) ?? null;
  return (
    <TrendChart
      ariaLabel="Grafik laju kumulatif revenue dan ads spend"
      caption={<><span>Laju kumulatif</span>{lastRev != null && lastSpend != null && <small>Cost per revenue berjalan <b>{pctLabel(div(lastSpend, lastRev))}</b></small>}</>}
      series={[
        { key: 'rev', label: 'Revenue kumulatif', color: C_REV, area: true, points: pts(rev), endLabel: idrAxis },
        { key: 'spend', label: 'Ads spend kumulatif', color: C_SPEND, points: pts(spend), endLabel: idrAxis },
      ]}
      tooltip={(day) => {
        const r = rev[day - 1] ?? null;
        const s = spend[day - 1] ?? null;
        return {
          title: `s/d ${dayTitle(daily, day)}`,
          rows: [
            { label: 'Revenue', color: C_REV, value: idr(r) ?? '—' },
            { label: 'Ads spend', color: C_SPEND, value: idr(s) ?? '—' },
            { label: 'Cost per revenue', value: pctLabel(div(s, r)) },
          ],
        };
      }}
    />
  );
}

// Ads spend against revenue, channel by channel, on one rupiah scale. Paired
// channels (backend ROAS_GROUPS) carry both bars; a sales channel no spend
// buys, or spend no sales channel claims, carries only its own — every rupiah
// of the period is somewhere on this chart. With a comparison period on, each
// figure carries its change, and a channel that only the comparison had still
// gets its row, so a channel that stopped does not silently disappear.
const change = (cur, prev) => (cur == null || prev == null || prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100);

function PairChange({ cur, prev, neutral }) {
  if (cur == null) return <span className="xs-pair-delta" />;
  if (prev == null) return <span className="xs-pair-delta"><small title="Tidak ada pada periode pembanding">baru</small></span>;
  return <span className="xs-pair-delta"><Delta value={change(cur, prev)} neutral={neutral} /></span>;
}

function ChannelPairs({ rows, compare }) {
  const [hover, setHover] = useState(null);
  const prevByKey = new Map((compare ?? []).map((r) => [r.key, r]));
  const all = compare
    ? [...rows, ...compare.filter((r) => !rows.some((c) => c.key === r.key)).map((r) => ({ key: r.key, label: r.label, revenue: null, spend: null }))]
    : rows;
  if (!all?.length) return null;
  const max = Math.max(...all.flatMap((r) => [r.revenue ?? 0, r.spend ?? 0]), 0) || 1;
  const width = (v) => `${(Math.max(0, v ?? 0) / max) * 100}%`;
  const pct = (v) => (v == null ? null : `${v > 0 ? '+' : ''}${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`);
  return (
    <section className={`xs-pairs${compare ? ' is-compare' : ''}`} aria-label="Ads spend vs revenue per channel">
      <header>
        <div>
          <h3>Ads spend vs revenue per channel</h3>
          <p>
            Belanja iklan disandingkan dengan penjualan channel yang dibelinya, pada satu skala rupiah.
            {compare && ' Persentase = perubahan dibanding periode pembanding.'}
          </p>
        </div>
        <div className="xs-chart-legend" aria-hidden="true">
          <span><b style={{ background: C_REV }} />Revenue</span>
          <span><b style={{ background: C_SPEND }} />Ads spend</span>
        </div>
      </header>
      <ul>
        {all.map((r) => {
          const p = compare ? prevByKey.get(r.key) ?? null : null;
          const roas = div(r.revenue, r.spend);
          const prevRoas = div(p?.revenue ?? null, p?.spend ?? null);
          const said = (label, cur, prev) => `${label} ${idr(cur) ?? 'tidak ada'}${compare && change(cur, prev) != null ? ` (${pct(change(cur, prev))})` : ''}`;
          return (
            <li
              key={r.key}
              className={hover === r.key ? 'is-hover' : undefined}
              onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}
              tabIndex={0} onFocus={() => setHover(r.key)} onBlur={() => setHover(null)}
              aria-label={`${r.label}: ${said('revenue', r.revenue, p?.revenue)}, ${said('ads spend', r.spend, p?.spend)}${roas != null ? `, ROAS ${ratioX(roas)}` : ''}`}
            >
              <span className="xs-pair-name">{r.label}</span>
              <div className="xs-pair-bars">
                <span className="xs-pair-bar is-rev">
                  <i style={{ width: width(r.revenue) }} />
                  <b>{r.revenue != null ? idrAxis(r.revenue) : <em>tanpa revenue</em>}</b>
                  {compare && <PairChange cur={r.revenue} prev={p?.revenue ?? null} />}
                </span>
                <span className="xs-pair-bar is-spend">
                  <i style={{ width: width(r.spend) }} />
                  <b>{r.spend != null ? idrAxis(r.spend) : <em>tanpa ads spend</em>}</b>
                  {compare && <PairChange cur={r.spend} prev={p?.spend ?? null} neutral />}
                </span>
              </div>
              {hover === r.key && (
                <div className="xs-tip xs-pair-tip" role="status">
                  <strong>{r.label}</strong>
                  <span><i style={{ background: C_REV }} />Revenue<b>{idr(r.revenue) ?? '—'}</b></span>
                  {compare && <span className="is-prev">Pembanding<b>{idr(p?.revenue ?? null) ?? '—'}</b></span>}
                  <span><i style={{ background: C_SPEND }} />Ads spend<b>{idr(r.spend) ?? '—'}</b></span>
                  {compare && <span className="is-prev">Pembanding<b>{idr(p?.spend ?? null) ?? '—'}</b></span>}
                  <span className="is-derived">ROAS<b>{ratioX(roas) ?? '—'}{compare && prevRoas != null ? ` · dari ${ratioX(prevRoas)}` : ''}</b></span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Which channels the totals count, one row per kind. Every channel counts
// until the reader leaves one out — a sales channel can hold returns (DRC) or
// a one-off B2B deal, and a file import can turn a metric column ("Qty
// Online") into a spend channel. The choice is remembered per brand on this
// browser.
function ChannelPicker({ label, channels, excluded, onToggle, onReset }) {
  if (!channels?.length) return null;
  const counted = channels.filter((c) => !excluded.includes(c.key)).length;
  return (
    <div className="xs-picker" role="group" aria-label={`${label} yang dihitung`}>
      <span className="xs-picker-label">{label}</span>
      <div className="xs-picker-chips">
        {channels.map((c) => {
          const on = !excluded.includes(c.key);
          return (
            <button
              key={c.key} type="button" aria-pressed={on}
              className={`xs-chip${on ? ' is-on' : ''}`}
              disabled={on && counted === 1}
              title={on && counted === 1 ? 'Minimal satu channel dihitung' : on ? `Keluarkan ${c.label} dari total` : `Hitung ${c.label}`}
              onClick={() => onToggle(c.key)}
            >
              {on ? <Check size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}{c.label}
            </button>
          );
        })}
      </div>
      {excluded.length > 0 && <button type="button" className="xs-picker-reset" onClick={onReset}>Hitung semua</button>}
    </div>
  );
}

// The collapsed panel in one line: how many channels count, and whether the
// range is fully filled in.
function ControlsSummary({ channels, coverage }) {
  const count = (kind) => {
    const list = channels?.[kind] ?? [];
    return `${list.filter((c) => c.counted).length}/${list.length}`;
  };
  const daysShort = coverage?.due ? coverage.salesDays < coverage.due || coverage.spendDays < coverage.due : false;
  const channelsShort = coverage?.channelGaps?.length ?? 0;
  const gap = daysShort || channelsShort > 0;
  return (
    <span className="xs-controls-summary">
      <span>Penjualan <b>{count('sales')}</b></span>
      <span>Iklan <b>{count('spend')}</b></span>
      {coverage?.due > 0 && (
        <span className={gap ? 'is-gap' : 'is-full'}>
          {gap ? <CircleAlert size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
          {daysShort ? 'Data belum lengkap' : channelsShort ? `${channelsShort} channel belum lengkap` : 'Data lengkap'}
        </span>
      )}
    </span>
  );
}

// How much of the range is filled in, so a low figure that is only missing
// days does not read as a bad period. Only days before today are due.
function Coverage({ coverage }) {
  if (!coverage) return null;
  const { due, salesDays, spendDays, channelGaps = [] } = coverage;
  if (!due) return <p className="xs-coverage">Belum ada hari yang lewat pada rentang ini — kelengkapan data dihitung mulai besok.</p>;
  const item = (label, n) => (
    <span className={n < due ? 'is-gap' : 'is-full'}>
      {n < due ? <CircleAlert size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
      {label} <b>{n}/{due} hari</b>
    </span>
  );
  return (
    <div className="xs-coverage" aria-label="Kelengkapan data">
      <span className="xs-coverage-label">Kelengkapan data</span>
      {item('Revenue', salesDays)}
      {item('Ads spend', spendDays)}
      {channelGaps.length > 0 && (
        <small>
          Belum lengkap: {channelGaps.map((g) => `${g.label} ${g.filled}/${due}`).join(' · ')}
        </small>
      )}
    </div>
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
          <p>Seluruh channel dalam satu pembacaan — marketplace, offline, B2B, dan belanja iklan — bersumber dari Brand Tracking.</p>
        </div>
        <Link to="/brand-tracking" className="mom-head-link">Isi Brand Tracking <ArrowUpRight size={13} /></Link>
      </div>
      <div className={`con-focus-body xs-body${state ? ' is-state' : ''}`}>{children}</div>
    </section>
  );
}

// The channels left out of the totals, `{ sales: [...], spend: [...] }` per
// brand, kept in this browser across sessions: leaving DRC out is a standing
// decision about that brand's data, not a passing view setting.
const NONE_EXCLUDED = { sales: [], spend: [] };
function useExcludedChannels(brandId) {
  const key = brandId ? sessionKey(`xs-excluded:${brandId}`) : null;
  const read = () => {
    if (!key) return NONE_EXCLUDED;
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      const list = (x) => (Array.isArray(x) ? x : []);
      return { sales: list(v?.sales), spend: list(v?.spend) };
    } catch { return NONE_EXCLUDED; }
  };
  const [state, setState] = useState(() => ({ key, value: read() }));
  // A different brand brings its own list.
  const value = state.key === key ? state.value : read();
  const set = (next) => {
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage may be disabled */ }
    setState({ key, value: next });
  };
  return [value, set];
}

export default function ExecutiveSummary({ filters }) {
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  const [reload, setReload] = useState(0);
  const [excluded, setExcluded] = useExcludedChannels(filters.brandId);
  const [controlsOpen, setControlsOpen] = useSessionState('dashboard:xs-controls-open', true);
  const controlsId = useId();
  const excludeParam = [...excluded.sales].sort().join(',');
  const excludeSpendParam = [...excluded.spend].sort().join(',');

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
        excludeChannels: excludeParam || undefined,
        excludeSpendChannels: excludeSpendParam || undefined,
      },
    })
      .then(({ data }) => { if (alive) setState({ status: 'ready', data, error: '' }); })
      .catch((err) => {
        if (alive) setState({ status: 'error', data: null, error: err?.response?.data?.message || err?.response?.data?.error || 'Ringkasan gagal dimuat.' });
      });
    return () => { alive = false; };
  }, [filters.brandId, filters.startDate, filters.endDate, filters.compare, filters.compareStartDate, filters.compareEndDate, excludeParam, excludeSpendParam, reload]);

  // Last year is usually empty for a brand onboarded this year. Rather than
  // repeat that emptiness on every tile, it is stated once under the grid.
  const hasLastYear = useMemo(() => (state.data ? state.data.metrics.some((m) => m.lastYear != null) : false), [state.data]);

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

  const { metrics, current, compare, hasAnyData, channels } = state.data;
  const byKey = Object.fromEntries(metrics.map((m) => [m.key, m]));
  const toggleChannel = (kind) => (key) => {
    const list = excluded[kind];
    setExcluded({ ...excluded, [kind]: list.includes(key) ? list.filter((k) => k !== key) : [...list, key] });
  };
  const resetChannels = (kind) => () => setExcluded({ ...excluded, [kind]: [] });

  // Revenue is the headline; everything else is a tile. A metric the backend
  // adds that this order does not name still reaches the screen — it lands at
  // the end rather than disappearing.
  const hero = byKey[HERO_KEY] ?? metrics[0];
  const ordered = TILE_ORDER.map((k) => byKey[k]).filter(Boolean);
  const named = new Set([HERO_KEY, ...TILE_ORDER]);
  const rest = [...ordered, ...metrics.filter((m) => !named.has(m.key))];
  const periodLabel = `${dateLabel(current.range.start)} – ${dateLabel(current.range.end)}`;
  const sparkOf = (key) => (DAILY[key] ? current.daily.map(DAILY[key]) : null);
  const leftOut = (kind) => (channels?.[kind] ?? []).filter((c) => !c.counted).map((c) => c.label);

  if (!hasAnyData) {
    return (
      <Shell state>
        <div className="xs-state is-empty">
          <Database size={22} />
          <span>
            <strong>Belum ada data Brand Tracking untuk brand ini</strong>
            Seluruh angka pada ringkasan ini muncul setelah revenue dan belanja iklan harian diisi.
          </span>
          <Link to="/brand-tracking" className="mom-head-link">Isi Brand Tracking <ArrowUpRight size={13} /></Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className={`xs-controls${state.status === 'loading' ? ' is-busy' : ''}${controlsOpen ? ' is-open' : ''}`} aria-label="Channel dihitung dan kelengkapan data">
        <button
          type="button" className="xs-controls-toggle" aria-expanded={controlsOpen} aria-controls={controlsId}
          onClick={() => setControlsOpen(!controlsOpen)}
        >
          <span className="xs-controls-title">Channel &amp; kelengkapan data</span>
          {/* Collapsed, the panel still says what it holds: a left-out
              channel or a missing day changes every figure below. */}
          {!controlsOpen && <ControlsSummary channels={channels} coverage={current.coverage} />}
          <span className="xs-controls-act">
            {controlsOpen ? 'Sembunyikan' : 'Tampilkan'}
            <ChevronDown size={15} aria-hidden="true" />
          </span>
        </button>
        {controlsOpen && (
          <div className="xs-controls-body" id={controlsId}>
            <ChannelPicker label="Channel penjualan" channels={channels?.sales} excluded={excluded.sales} onToggle={toggleChannel('sales')} onReset={resetChannels('sales')} />
            <ChannelPicker label="Channel iklan" channels={channels?.spend} excluded={excluded.spend} onToggle={toggleChannel('spend')} onReset={resetChannels('spend')} />
            <Coverage coverage={current.coverage} />
          </div>
        )}
      </section>

      {/* Not a table. A table asks the eye to cross five columns to answer
          two questions — what is the number, and did it move. One headline
          figure and a grid of tiles answers both at a glance, and the
          comparison is a bar rather than a column of digits to subtract. */}
      <div className="xs-metrics">
        {hero && (
          <article className="xs-hero">
            <header>
              <span className="xs-hero-label">{hero.label}</span>
              <span className="xs-hero-period">{periodLabel}</span>
            </header>
            <div className="xs-hero-figure">
              <strong><Figure text={fmt(hero.current, hero.kind)} absentReason={`${hero.label} belum terisi untuk rentang ini.`} /></strong>
              <Delta value={hero.growthCompare} neutral={hero.sentiment === 'neutral'} />
            </div>
            {sparkOf(hero.key) && <TileSpark values={sparkOf(hero.key)} />}
            <CompareBars metric={hero} />
            <footer>
              {hero.compare != null ? <>Pembanding <b>{fmt(hero.compare, hero.kind)}</b></> : 'Belum ada periode pembanding'}
              {hero.lastYear != null && <> · Tahun lalu <b>{fmt(hero.lastYear, hero.kind)}</b></>}
            </footer>
          </article>
        )}

        <div className="xs-tiles">
          {rest.map((m) => (
            <article className="xs-tile" key={m.key}>
              <span className="xs-tile-label">{m.label}</span>
              <div className="xs-tile-figure">
                <strong><Figure text={fmt(m.current, m.kind)} absentReason={`${m.label} belum terisi untuk rentang ini.`} /></strong>
                <Delta value={m.growthCompare} neutral={m.sentiment === 'neutral'} />
              </div>
              {sparkOf(m.key) && <TileSpark values={sparkOf(m.key)} tone={m.key === 'amountSpent' ? 'spend' : 'rev'} />}
              <CompareBars metric={m} />
              <span className="xs-tile-foot">
                {m.compare != null ? <>dari <b>{fmt(m.compare, m.kind)}</b></> : 'tanpa pembanding'}
              </span>
            </article>
          ))}
        </div>
      </div>

      {!hasLastYear && (
        <p className="xs-lastyear-note">
          Perbandingan <strong>tahun lalu</strong> belum tersedia untuk rentang ini — kolomnya muncul sendiri begitu Brand Tracking punya data pada rentang yang sama
          tahun sebelumnya.
        </p>
      )}

      <div className="xs-split">
        <DailyChart current={current} compare={compare} />
        <PaceChart current={current} />
      </div>

      <ChannelPairs rows={current.channelPairs} compare={compare?.channelPairs} />

      <ChannelRoas rows={current.channelRoas} compare={compare?.channelRoas} blended={byKey.roas} />

      <p className="xs-note">
        Revenue, Trx, Qty, AOV, dan AUR dihitung dari channel penjualan yang dipilih di atas; Amount Spent dari channel iklan yang dipilih; ROAS dari keduanya.
        {leftOut('sales').length > 0 && <> Penjualan tidak dihitung: <strong>{leftOut('sales').join(', ')}</strong>.</>}
        {leftOut('spend').length > 0 && <> Iklan tidak dihitung: <strong>{leftOut('spend').join(', ')}</strong>.</>}
      </p>
    </Shell>
  );
}
