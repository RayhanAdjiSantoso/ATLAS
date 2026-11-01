import { useEffect, useRef } from 'react';
import { Chart } from 'chart.js/auto';

// Atribusi & Kebocoran Channel — the page's Chart.js pictures. Canvas, like
// every other ATLAS chart, so a PNG/PDF export captures them as pixels.
// Charts never re-animate on a filter change (DESIGN.md › Motion).

const INTER = "'Inter', system-ui, sans-serif";
const INK = '#0f1a3a';
const MUTED = '#5a6a90';
const GRID = '#eef1f7';

export const fmtRp = (v) => (v == null ? '—' : `Rp${Math.round(v).toLocaleString('id-ID')}`);
export const fmtJt = (v) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `Rp${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `Rp${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (a >= 1e4) return `Rp${(v / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return `Rp${Math.round(v).toLocaleString('id-ID')}`;
};
export const fmtNum = (v, d = 0) => (v == null ? '—' : v.toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const fmtPct = (v, d = 1) => (v == null ? '—' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d })}%`);
export const fmtX = (v) => (v == null ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}x`);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const monthShort = (ym) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}` : '');
export const dayShort = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function useChart(build, deps) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return undefined;
    const chart = new Chart(ref.current, build());
    return () => chart.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

const baseOptions = (extra = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: reduced() ? false : { duration: 380 },
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', font: { family: INTER, size: 11, weight: 700 }, color: MUTED } },
    tooltip: { backgroundColor: INK, padding: 10, cornerRadius: 8, titleFont: { family: INTER, size: 12, weight: 700 }, bodyFont: { family: INTER, size: 12 } },
  },
  ...extra,
});
const tick = { font: { family: INTER, size: 11 }, color: MUTED };

// Monthly spend per channel (stacked) under the shop's revenue (line).
export function MonthlyTrendChart({ months, channels }) {
  const ref = useChart(() => ({
    type: 'bar',
    data: {
      labels: months.map((m) => monthShort(m.month)),
      datasets: [
        {
          type: 'line',
          label: 'Revenue toko',
          data: months.map((m) => m.store.revenue),
          borderColor: INK,
          backgroundColor: INK,
          borderWidth: 2.2,
          pointRadius: 3,
          tension: 0.25,
          yAxisID: 'yRev',
          order: 0,
        },
        ...channels.map((c) => ({
          type: 'bar',
          label: c.label,
          data: months.map((m) => m.spend[c.key]),
          backgroundColor: c.color,
          borderRadius: 3,
          stack: 'spend',
          yAxisID: 'ySpend',
          maxBarThickness: 44,
          order: 1,
        })),
      ],
    },
    options: baseOptions({
      plugins: {
        ...baseOptions().plugins,
        tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (i) => ` ${i.dataset.label}: ${fmtJt(i.parsed.y)}` } },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: tick },
        ySpend: { stacked: true, position: 'left', beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { ...tick, callback: (v) => fmtJt(v) }, title: { display: true, text: 'Spend', font: { family: INTER, size: 10, weight: 700 }, color: MUTED } },
        yRev: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, border: { display: false }, ticks: { ...tick, callback: (v) => fmtJt(v) }, title: { display: true, text: 'Revenue', font: { family: INTER, size: 10, weight: 700 }, color: MUTED } },
      },
    }),
  }), [months, channels]);
  return <div className="atr-chart" style={{ height: 300 }}><canvas ref={ref} role="img" aria-label="Spend per channel dan revenue toko per bulan" /></div>;
}

// Waterfall: start, each piece, end. Pieces are floating bars [from, to].
export function WaterfallChart({ startLabel, endLabel, start, end, items, format = fmtJt, height = 280 }) {
  const ref = useChart(() => {
    let run = start;
    const bars = [{ label: startLabel, range: [0, start], kind: 'total' }];
    for (const it of items) {
      bars.push({ label: it.label, range: [run, run + it.value], kind: it.value >= 0 ? 'up' : 'down', value: it.value });
      run += it.value;
    }
    bars.push({ label: endLabel, range: [0, end], kind: 'total' });
    const color = (k) => (k === 'total' ? '#b8c5f5' : k === 'up' ? '#15803d' : '#c81e1e');
    // Start the axis just under the lowest running level so the steps —
    // the point of a waterfall — are readable; the totals say they are cut.
    const levels = bars.flatMap((b) => (b.kind === 'total' ? [b.range[1]] : b.range));
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    const raw = lo > 0 ? Math.max(0, lo - (hi - lo) * 0.6) : null;
    const step = raw != null && hi > lo ? 10 ** Math.floor(Math.log10(hi - lo)) : 1;
    const yMin = raw != null ? Math.floor(raw / step) * step : undefined;
    return {
      type: 'bar',
      data: {
        labels: bars.map((b) => b.label),
        datasets: [{ data: bars.map((b) => b.range), backgroundColor: bars.map((b) => color(b.kind)), borderRadius: 3, borderSkipped: false, maxBarThickness: 46 }],
      },
      options: baseOptions({
        plugins: {
          legend: { display: false },
          tooltip: {
            ...baseOptions().plugins.tooltip,
            callbacks: {
              label: (i) => {
                const b = bars[i.dataIndex];
                return b.kind === 'total' ? ` ${format(b.range[1])}` : ` ${b.value >= 0 ? '+' : '−'}${format(Math.abs(b.value))}`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { ...tick, autoSkip: false, maxRotation: 0, callback(v, idx) { const l = this.getLabelForValue(idx); return l.length > 16 ? l.split(' ').reduce((acc, w) => { const last = acc[acc.length - 1]; if (last && (last + ' ' + w).length <= 16) acc[acc.length - 1] = `${last} ${w}`; else acc.push(w); return acc; }, []) : l; } } },
          y: { min: yMin, grid: { color: GRID }, border: { display: false }, ticks: { ...tick, callback: (v) => format(v) } },
        },
      }),
    };
  }, [startLabel, endLabel, start, end, items]);
  return <div className="atr-chart" style={{ height }}><canvas ref={ref} role="img" aria-label={`Perubahan dari ${startLabel} ke ${endLabel}`} /></div>;
}

// Monthly revenue split into baseline, calendar and each channel (ESTIMASI).
export function ContributionChart({ months, channels, target = 'revenue', format = fmtJt }) {
  const ref = useChart(() => {
    const rows = months.filter((m) => m.model?.[target]);
    const val = (m, k) => (k === 'baseline' ? m.model[target].baseline + m.model[target].seasonal : m.model[target].contrib[k]);
    const sets = [
      { key: 'baseline', label: 'Organik, tren & kalender', color: '#cbd3e6' },
      ...channels.map((c) => ({ key: c.key, label: c.label, color: c.color })),
    ];
    return {
      type: 'bar',
      data: {
        labels: rows.map((m) => monthShort(m.month)),
        datasets: [
          ...sets.map((s) => ({ label: s.label, data: rows.map((m) => val(m, s.key)), backgroundColor: s.color, stack: 'c', borderRadius: 2, maxBarThickness: 44 })),
          { type: 'line', label: 'Aktual', data: rows.map((m) => m.model[target].actual), borderColor: INK, backgroundColor: INK, borderWidth: 2, pointRadius: 3, borderDash: [5, 4] },
        ],
      },
      options: baseOptions({
        plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (i) => ` ${i.dataset.label}: ${format(i.parsed.y)}` } } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: tick },
          y: { stacked: true, grid: { color: GRID }, border: { display: false }, ticks: { ...tick, callback: (v) => format(v) } },
        },
      }),
    };
  }, [months, channels, target]);
  return <div className="atr-chart" style={{ height: 300 }}><canvas ref={ref} role="img" aria-label="Kontribusi channel per bulan (estimasi)" /></div>;
}

// Daily revenue: actual vs what the model expected, with spend underneath.
export function DailyChart({ daily, channels, events }) {
  const ref = useChart(() => {
    const flagged = new Map(events.map((e) => [e.date, e]));
    return {
      type: 'bar',
      data: {
        labels: daily.map((d) => dayShort(d.date)),
        datasets: [
          {
            type: 'line',
            label: 'Revenue aktual',
            data: daily.map((d) => d.revenue),
            borderColor: INK,
            backgroundColor: daily.map((d) => (flagged.has(d.date) ? (flagged.get(d.date).direction === 'up' ? '#15803d' : '#c81e1e') : INK)),
            pointRadius: daily.map((d) => (flagged.has(d.date) ? 5 : 0)),
            pointHoverRadius: 5,
            borderWidth: 1.6,
            tension: 0.2,
            yAxisID: 'yRev',
            spanGaps: false,
          },
          { type: 'line', label: 'Perkiraan model', data: daily.map((d) => d.expected), borderColor: '#7c8db5', borderDash: [4, 4], borderWidth: 1.4, pointRadius: 0, yAxisID: 'yRev', spanGaps: false },
          ...channels.map((c) => ({ type: 'bar', label: c.label, data: daily.map((d) => d.spend[c.key]), backgroundColor: `${c.color}99`, stack: 's', yAxisID: 'ySpend' })),
        ],
      },
      options: baseOptions({
        plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (i) => ` ${i.dataset.label}: ${fmtJt(i.parsed.y)}` } } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { ...tick, maxRotation: 0, autoSkipPadding: 14 } },
          yRev: { position: 'left', beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { ...tick, callback: (v) => fmtJt(v) } },
          ySpend: { position: 'right', stacked: true, beginAtZero: true, grid: { drawOnChartArea: false }, border: { display: false }, ticks: { ...tick, callback: (v) => fmtJt(v) } },
        },
      }),
    };
  }, [daily, channels, events]);
  return <div className="atr-chart" style={{ height: 320 }}><canvas ref={ref} role="img" aria-label="Revenue harian, perkiraan model, dan spend per channel" /></div>;
}

// The old sheet's two-line chart, scored: a driver over an outcome. "Dua
// sumbu" draws each on its own axis like the spreadsheet; "Indeks" puts both
// on one z-score scale and shades the gap between them — the smaller the
// shaded band, the closer the two move.
const fmtUnit = (unit) => (unit === 'idr' ? fmtJt : unit === 'pct' ? (v) => fmtPct(v, 2) : unit === 'ratio' ? (v) => fmtNum(v, 2) : (v) => fmtNum(v));
const zs = (xs) => {
  const vals = xs.filter((v) => v != null);
  const m = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
  const s = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / Math.max(vals.length - 1, 1)) || 1;
  return xs.map((v) => (v == null ? null : (v - m) / s));
};

export function TrendPairChart({ target, driver, grain, mode }) {
  const ref = useChart(() => {
    const pts = (s) => new Map(s[grain].filter(([, , days]) => grain === 'monthly' ? days >= 20 : days >= 6).map(([k, v]) => [k, v]));
    const tm = pts(target);
    const dm = pts(driver);
    const keys = [...new Set([...tm.keys(), ...dm.keys()])].sort();
    const label = (k) => (grain === 'monthly' ? monthShort(k) : dayShort(k));
    const tv = keys.map((k) => tm.get(k) ?? null);
    const dv = keys.map((k) => dm.get(k) ?? null);
    const index = mode === 'index';
    const T = index ? zs(tv) : tv;
    const D = index ? zs(dv) : dv;
    const targetColor = '#0f1a3a';
    const driverColor = '#1e3eb8';
    return {
      type: 'line',
      data: {
        labels: keys.map(label),
        datasets: [
          { label: target.label, data: T, borderColor: targetColor, backgroundColor: index ? 'rgba(245,166,35,.18)' : targetColor, borderWidth: 2.2, pointRadius: grain === 'monthly' ? 3 : 0, tension: 0.25, yAxisID: index ? 'y' : 'yT', spanGaps: true, fill: index ? '+1' : false },
          { label: driver.label, data: D, borderColor: driverColor, backgroundColor: driverColor, borderWidth: 2, borderDash: [6, 4], pointRadius: grain === 'monthly' ? 3 : 0, tension: 0.25, yAxisID: index ? 'y' : 'yD', spanGaps: true },
        ],
      },
      options: baseOptions({
        plugins: {
          ...baseOptions().plugins,
          tooltip: {
            ...baseOptions().plugins.tooltip,
            callbacks: {
              label: (i) => {
                const raw = (i.datasetIndex === 0 ? tv : dv)[i.dataIndex];
                const f = fmtUnit(i.datasetIndex === 0 ? target.unit : driver.unit);
                return ` ${i.dataset.label}: ${raw == null ? '—' : f(raw)}`;
              },
            },
          },
        },
        scales: index
          ? {
            x: { grid: { display: false }, ticks: { ...tick, maxRotation: 0, autoSkipPadding: 12 } },
            y: { grid: { color: GRID }, border: { display: false }, ticks: { ...tick, callback: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}σ` }, title: { display: true, text: 'Indeks (z-score)', font: { family: INTER, size: 10, weight: 700 }, color: MUTED } },
          }
          : {
            x: { grid: { display: false }, ticks: { ...tick, maxRotation: 0, autoSkipPadding: 12 } },
            yT: { position: 'left', grid: { color: GRID }, border: { display: false }, ticks: { ...tick, callback: (v) => fmtUnit(target.unit)(v) }, title: { display: true, text: target.label, font: { family: INTER, size: 10, weight: 700 }, color: targetColor } },
            yD: { position: 'right', grid: { drawOnChartArea: false }, border: { display: false }, ticks: { ...tick, callback: (v) => fmtUnit(driver.unit)(v) }, title: { display: true, text: driver.label, font: { family: INTER, size: 10, weight: 700 }, color: driverColor } },
          },
      }),
    };
  }, [target, driver, grain, mode]);
  return <div className="atr-chart" style={{ height: 320 }}><canvas ref={ref} role="img" aria-label={`${driver.label} terhadap ${target.label}`} /></div>;
}
