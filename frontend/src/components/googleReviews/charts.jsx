import { useEffect, useRef } from 'react';
import { Chart } from 'chart.js/auto';

// Google Reviews › the three chart.js charts. Sentiment always wears the same
// three colours (validated for colour-blind separation: green / amber / red);
// the amber is light on white, so every chart here also prints its numbers
// as text — legend rows, bar-end labels, a table under the trend.

export const SENTIMENT = {
  positive: { label: 'Positive', color: '#15803d' },
  neutral: { label: 'Neutral', color: '#c9a227' },
  negative: { label: 'Negative', color: '#c81e1e' },
};
const INK = '#0f1a3a';
const MUTED = '#5a6a90';
const GRID = '#e7ebf5';
const FONT = "'Inter', system-ui, sans-serif";
const fmtPct = (v) => (v == null ? '—' : `${v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const fmtInt = (v) => (v ?? 0).toLocaleString('id-ID');

const tooltipBase = {
  backgroundColor: '#0f1a3a',
  titleFont: { family: FONT, weight: '700', size: 12 },
  bodyFont: { family: FONT, size: 12 },
  padding: 10,
  cornerRadius: 8,
  boxPadding: 4,
};

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

/* ── Sentiment donut ─────────────────────────────────────────────────── */

export function SentimentDonut({ distribution }) {
  const items = distribution.items;
  const total = distribution.analyzed;
  const ref = useChart(() => ({
    type: 'doughnut',
    data: {
      labels: items.map((i) => SENTIMENT[i.key].label),
      datasets: [{
        data: items.map((i) => i.count),
        backgroundColor: items.map((i) => SENTIMENT[i.key].color),
        borderColor: '#ffffff',
        borderWidth: 2,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '66%',
      layout: { padding: 6 },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipBase,
          callbacks: { label: (ctx) => ` ${fmtInt(ctx.raw)} ulasan · ${fmtPct(items[ctx.dataIndex].pct)}` },
        },
      },
    },
  }), [JSON.stringify(items)]);

  return (
    <div className="gr-donut">
      <div className="gr-donut-ring">
        <canvas ref={ref} role="img" aria-label={`Distribusi sentimen: ${items.map((i) => `${SENTIMENT[i.key].label} ${fmtPct(i.pct)}`).join(', ')}`} />
        <div className="gr-donut-centre" aria-hidden="true">
          <strong>{fmtInt(total)}</strong>
          <span>ulasan teks</span>
        </div>
      </div>
      <ul className="gr-legend">
        {items.map((i) => (
          <li key={i.key}>
            <span className="gr-swatch" style={{ background: SENTIMENT[i.key].color }} />
            <span className="gr-legend-name">{SENTIMENT[i.key].label}</span>
            <strong>{fmtPct(i.pct)}</strong>
            <span className="gr-legend-count">{fmtInt(i.count)} ulasan</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Rating bars ─────────────────────────────────────────────────────── */

export function RatingBars({ ratings }) {
  const items = ratings.items;
  const ref = useChart(() => ({
    type: 'bar',
    data: {
      labels: items.map((i) => `${i.star} ★`),
      datasets: [{
        data: items.map((i) => i.count),
        backgroundColor: '#1e3eb8',
        hoverBackgroundColor: '#142c82',
        borderRadius: { topRight: 4, bottomRight: 4 },
        borderSkipped: 'start',
        maxBarThickness: 22,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 86 } },
      scales: {
        x: { beginAtZero: true, grid: { color: GRID }, border: { display: false }, ticks: { color: MUTED, font: { family: FONT, size: 11 }, precision: 0 } },
        y: { grid: { display: false }, border: { color: GRID }, ticks: { color: INK, font: { family: FONT, size: 12, weight: '700' } } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipBase, callbacks: { label: (ctx) => ` ${fmtInt(ctx.raw)} ulasan · ${fmtPct(items[ctx.dataIndex].pct)}` } },
      },
    },
    // Count and share at each bar's end, in ink.
    plugins: [{
      id: 'barEnds',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.font = `600 11.5px ${FONT}`;
        ctx.textBaseline = 'middle';
        chart.getDatasetMeta(0).data.forEach((bar, idx) => {
          const it = items[idx];
          ctx.fillStyle = INK;
          ctx.fillText(fmtInt(it.count), bar.x + 8, bar.y);
          const w = ctx.measureText(fmtInt(it.count)).width;
          ctx.fillStyle = MUTED;
          ctx.fillText(`· ${fmtPct(it.pct)}`, bar.x + 12 + w, bar.y);
        });
        ctx.restore();
      },
    }],
  }), [JSON.stringify(items)]);

  return (
    <div className="gr-bars">
      <canvas ref={ref} role="img" aria-label={`Distribusi rating: ${items.map((i) => `${i.star} bintang ${i.count}`).join(', ')}`} />
    </div>
  );
}

/* ── Sentiment trend ─────────────────────────────────────────────────── */

export function TrendChart({ points, metric, kind }) {
  const pct = metric === 'pct';
  const ref = useChart(() => {
    const keys = ['positive', 'neutral', 'negative'];
    const datasets = keys.map((k) => {
      const data = points.map((p) => (pct ? p[`${k}Pct`] : p[k]));
      const s = SENTIMENT[k];
      return kind === 'bar'
        ? { label: s.label, data, backgroundColor: s.color, borderColor: '#ffffff', borderWidth: { top: 2 }, borderSkipped: false, maxBarThickness: 24, stack: 's' }
        : {
          label: s.label,
          data,
          borderColor: s.color,
          backgroundColor: s.color,
          borderWidth: 2,
          pointRadius: points.length > 40 ? 0 : 3,
          pointHoverRadius: 5,
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          tension: 0.25,
          spanGaps: false,
          // The open period is still filling up: its segment is dashed.
          segment: { borderDash: (ctx) => (points[ctx.p1DataIndex]?.partial ? [4, 4] : undefined) },
        };
    });
    return {
      type: kind === 'bar' ? 'bar' : 'line',
      data: { labels: points.map((p) => (p.partial ? `${p.label}*` : p.label)), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: kind === 'bar', grid: { display: false }, border: { color: GRID }, ticks: { color: MUTED, font: { family: FONT, size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
          y: {
            stacked: kind === 'bar',
            beginAtZero: true,
            max: pct ? 100 : undefined,
            grid: { color: GRID },
            border: { display: false },
            ticks: { color: MUTED, font: { family: FONT, size: 11 }, precision: 0, callback: (v) => (pct ? `${v}%` : v.toLocaleString('id-ID')) },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipBase,
            callbacks: {
              title: (items) => {
                const p = points[items[0].dataIndex];
                return `${p.label}${p.partial ? ' (berjalan)' : ''} · ${p.total} ulasan teks`;
              },
              label: (ctx) => {
                const p = points[ctx.dataIndex];
                const k = keys[ctx.datasetIndex];
                return ` ${SENTIMENT[k].label}: ${fmtInt(p[k])} (${fmtPct(p[`${k}Pct`])})`;
              },
            },
          },
        },
      },
    };
  }, [JSON.stringify(points), metric, kind]);

  return (
    <div className="gr-trend-canvas">
      <canvas ref={ref} role="img" aria-label="Tren sentimen per periode" />
    </div>
  );
}
