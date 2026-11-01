import { Chart, type ChartConfiguration, type Plugin } from 'chart.js/auto';
import { useEffect, useRef, useState } from 'react';
import { formatCompact, formatValue, type FormatContext } from '../format';
import type { ChartBlock } from '../types';

// Every chart on a slide, on the Chart.js ATLAS already ships. The report's own
// chart components hard-code dashboard type sizes, too small for a slide; this one
// keeps their engine (a <canvas> comes through html2canvas as pixels) at
// presentation sizes, drawn at twice the stage resolution so it stays sharp in
// the PDF. It always has one y-scale: a Pareto's bars and cumulative line are both
// percentages of the same total.

const INK = '#0f1a3a';
const MUTED = '#5a6a90';
const RULE = '#e7ebf5';
const SURFACE = '#ffffff';
const FONT = "'Inter', system-ui, sans-serif";

export const COLOR_OLD = '#a7b4cc';
export const COLOR_CUR = '#1e3eb8';
// Fixed order, never cycled. Cyan and gold sit under 3:1 on white, so anything
// using them also carries a legend and values in ink.
const CATEGORICAL = ['#1e3eb8', '#00c2e0', '#f5a623', '#0d9488', '#7c3aed', '#ee4d2d'];
const OTHER = '#94a3b8';
const MAX_SLICES = 6;

interface Props {
  block: ChartBlock;
  ctx: FormatContext;
  oldLabel: string;
  curLabel: string;
}

function seriesColor(role: 'old' | 'cur' | undefined, index: number): string {
  if (role === 'old') return COLOR_OLD;
  if (role === 'cur') return COLOR_CUR;
  return CATEGORICAL[index] ?? OTHER;
}

// A long tail folds into "Other" instead of asking for colours that do not exist.
function foldSlices(labels: string[], values: (number | null)[], otherLabel: string): { labels: string[]; values: number[] } {
  const pairs = labels.map((l, i) => ({ l, v: values[i] ?? 0 })).filter((p) => p.v > 0);
  if (pairs.length <= MAX_SLICES) return { labels: pairs.map((p) => p.l), values: pairs.map((p) => p.v) };
  const sorted = [...pairs].sort((a, b) => b.v - a.v);
  const kept = sorted.slice(0, MAX_SLICES - 1);
  const rest = sorted.slice(MAX_SLICES - 1).reduce((s, p) => s + p.v, 0);
  return { labels: [...kept.map((p) => p.l), otherLabel], values: [...kept.map((p) => p.v), rest] };
}

// Values at the ends of the bars, only where there is room for one per bar.
function barLabels(fmt: (v: number) => string, horizontal: boolean): Plugin {
  return {
    id: 'prsBarLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = `600 17px ${FONT}`;
      ctx.fillStyle = INK;
      chart.data.datasets.forEach((ds, i) => {
        if ((ds as { type?: string }).type === 'line') return;
        chart.getDatasetMeta(i).data.forEach((el, j) => {
          const v = ds.data[j] as number | null;
          if (v === null || v === undefined) return;
          const { x, y } = el.getProps(['x', 'y'], true) as { x: number; y: number };
          if (horizontal) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(fmt(v), x + 8, y);
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(fmt(v), x, y - 6);
          }
        });
      });
      ctx.restore();
    },
  };
}

function configure(block: ChartBlock, { ctx, oldLabel, curLabel }: Props, width: number): ChartConfiguration {
  const fmtShort = (v: number) => formatCompact(v, block.fmt, ctx);
  const fmtFull = (v: number) => formatValue(v, block.fmt, ctx);
  const nameOf = (s: ChartBlock['series'][number]) => (s.role === 'old' ? oldLabel : s.role === 'cur' ? curLabel : s.label);
  const tick = { color: MUTED, font: { family: FONT, size: 18 } };
  const tooltip = { callbacks: { label: (item: { dataset: { label?: string }; parsed: { x: number; y: number }; chart: Chart }) => `${item.dataset.label}: ${fmtFull((item.chart.options as { indexAxis?: string }).indexAxis === 'y' ? item.parsed.x : item.parsed.y)}` } };
  const base = { responsive: false, animation: false as const, maintainAspectRatio: false, devicePixelRatio: 2, layout: { padding: { top: 24, right: 12 } }, plugins: { legend: { display: false }, tooltip } };
  const valueAxis = { beginAtZero: true, grid: { color: RULE }, border: { display: false }, ticks: { ...tick, maxTicksLimit: 6, callback: (v: number | string) => fmtShort(Number(v)) } };
  const categoryAxis = { grid: { display: false }, border: { color: RULE }, ticks: { ...tick, autoSkip: true, maxRotation: 0, minRotation: 0 } };

  if (block.chart === 'donut') {
    const { labels, values } = foldSlices(block.labels, block.series[0]?.values ?? [], ctx.lang === 'id' ? 'Lainnya' : 'Other');
    return {
      type: 'doughnut',
      data: { labels, datasets: [{ data: values, backgroundColor: labels.map((_, i) => (i === MAX_SLICES - 1 && block.labels.length > MAX_SLICES ? OTHER : CATEGORICAL[i])), borderColor: SURFACE, borderWidth: 2 }] },
      options: { ...base, layout: { padding: 8 }, cutout: '62%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (item: { label: string; parsed: number }) => `${item.label}: ${fmtFull(item.parsed)}` } } } } as ChartConfiguration['options'],
    };
  }

  if (block.chart === 'line') {
    return {
      type: 'line',
      data: {
        labels: block.labels,
        datasets: block.series.map((s, i) => ({ label: nameOf(s), data: s.values, borderColor: seriesColor(s.role, i), backgroundColor: seriesColor(s.role, i), borderWidth: s.role === 'old' ? 2 : 3, pointRadius: 0, pointHoverRadius: 6, cubicInterpolationMode: 'monotone' as const, spanGaps: false })),
      },
      options: { ...base, interaction: { mode: 'index', intersect: false }, scales: { x: categoryAxis, y: valueAxis } } as ChartConfiguration['options'],
    };
  }

  if (block.chart === 'pareto') {
    const [bars, line] = block.series;
    return {
      type: 'bar',
      data: {
        labels: block.labels,
        datasets: [
          { type: 'bar', label: bars.label, data: bars.values as number[], backgroundColor: COLOR_CUR, borderRadius: 4, maxBarThickness: 64, order: 2 },
          { type: 'line', label: line.label, data: line.values as number[], borderColor: '#f5a623', backgroundColor: '#f5a623', borderWidth: 3, pointRadius: 6, pointBorderColor: SURFACE, pointBorderWidth: 2, order: 1 },
        ],
      },
      options: { ...base, scales: { x: { ...categoryAxis, ticks: { ...tick, font: { family: FONT, size: 16 }, autoSkip: false, maxRotation: 35, minRotation: 35 } }, y: { ...valueAxis, max: 100, ticks: { ...tick, callback: (v: number | string) => `${v}%` } } } } as ChartConfiguration['options'],
    };
  }

  const horizontal = block.chart === 'hbar';
  const stacked = block.chart === 'stacked';
  // A value over every bar only where it does not run into the next one's.
  const barSlot = width / Math.max(1, block.labels.length * block.series.length);
  const labelled = !stacked && (horizontal ? block.labels.length <= 10 : barSlot >= 84);
  const config: ChartConfiguration = {
    type: 'bar',
    data: {
      labels: block.labels,
      datasets: block.series.map((s, i) => ({
        label: nameOf(s),
        data: s.values as number[],
        backgroundColor: seriesColor(s.role, i),
        borderColor: SURFACE,
        borderWidth: stacked ? 2 : 0,
        borderRadius: stacked ? 0 : 4,
        maxBarThickness: horizontal ? 26 : 72,
        ...(stacked ? {} : { categoryPercentage: 0.72, barPercentage: 0.92 }),
      })),
    },
    options: {
      ...base,
      indexAxis: horizontal ? 'y' : 'x',
      layout: { padding: { top: 28, right: horizontal ? 120 : 12 } },
      scales: horizontal
        ? { x: { ...valueAxis, display: !labelled }, y: categoryAxis }
        : { x: { ...categoryAxis, stacked }, y: { ...valueAxis, stacked } },
    } as ChartConfiguration['options'],
    plugins: labelled ? [barLabels(fmtShort, horizontal)] : [],
  };
  return config;
}

export function ChartLegend({ block, ctx, oldLabel, curLabel }: Props) {
  if (block.chart === 'donut') {
    const { labels, values } = foldSlices(block.labels, block.series[0]?.values ?? [], ctx.lang === 'id' ? 'Lainnya' : 'Other');
    const total = values.reduce((a, b) => a + b, 0);
    return (
      <ul className="prs-donut-legend">
        {labels.map((l, i) => (
          <li key={l}>
            <i style={{ background: i === MAX_SLICES - 1 && block.labels.length > MAX_SLICES ? OTHER : CATEGORICAL[i] }} />
            <span className="prs-dl-name">{l}</span>
            <b>{formatCompact(values[i], block.fmt, ctx)}</b>
            <em>{total > 0 ? formatValue((values[i] / total) * 100, 'pct', ctx) : '—'}</em>
          </li>
        ))}
      </ul>
    );
  }
  if (block.series.length < 2) return null;
  const color = (i: number) => (block.chart === 'pareto' ? (i === 0 ? COLOR_CUR : '#f5a623') : seriesColor(block.series[i].role, i));
  return (
    <ul className="prs-legend">
      {block.series.map((s, i) => (
        <li key={s.label + i}>
          <i style={{ background: color(i) }} />
          {s.role === 'old' ? oldLabel : s.role === 'cur' ? curLabel : s.label}
        </li>
      ))}
    </ul>
  );
}

// `lazy`: wait until the slide is on screen (a review grid of many slides).
export function SlideChart({ block, ctx, oldLabel, curLabel, lazy }: Props & { lazy?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(!lazy);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    // clientWidth ignores the preview's CSS scale, so the chart is always laid
    // out at stage size and only ever shown smaller.
    const measure = () => setSize((prev) => (prev && prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    let io: IntersectionObserver | undefined;
    if (lazy) {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      }, { rootMargin: '400px' });
      io.observe(el);
    }
    return () => {
      ro.disconnect();
      io?.disconnect();
    };
  }, [lazy]);

  const signature = JSON.stringify([block.chart, block.labels, block.series, block.fmt, ctx, oldLabel, curLabel]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size || !visible || size.w < 10 || size.h < 10) return;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    canvas.width = size.w;
    canvas.height = size.h;
    const chart = new Chart(canvas, configure(block, { block, ctx, oldLabel, curLabel }, size.w));
    canvas.dataset.ready = '1';
    return () => {
      delete canvas.dataset.ready;
      chart.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, size, visible]);

  return (
    <div className="prs-chart-box" ref={boxRef}>
      <canvas ref={canvasRef} role="img" aria-label={`${block.title.en}: ${block.labels.slice(0, 8).join(', ')}`} />
    </div>
  );
}
