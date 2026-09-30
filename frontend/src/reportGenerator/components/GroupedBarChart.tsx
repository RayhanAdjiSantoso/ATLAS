import { Chart, type ChartDataset, type TooltipItem } from 'chart.js/auto';
import { getRelativePosition } from 'chart.js/helpers';
import { useEffect, useRef, useState } from 'react';

// Grouped vertical bars, one group per product. Canvas rather than SVG for
// the same reason PieChartCanvas is canvas: these sections are captured by
// html2canvas on export, and a <canvas> comes through as pixels while a live
// SVG chart is at the mercy of its DOM-to-canvas re-implementation.
//
// One or two series. Two series only ever share this axis when they share a
// unit — the %Change charts, where both are percentages. Mixed units get two
// separate charts instead of a second y-axis.

export interface BarSeries {
  label: string;
  values: (number | null)[];
  color: string;
}

const INTER = "'Inter', system-ui, sans-serif";

function truncate(s: string, max = 22): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

export function GroupedBarChart({
  labels,
  series,
  formatValue,
  zeroLine = false,
  height = 320,
  ariaLabel,
  copyLabels = false,
}: {
  labels: string[];
  series: BarSeries[];
  formatValue: (v: number, seriesIndex: number) => string;
  // Draw an emphasised axis at 0 — %Change charts run negative and the sign
  // is the whole point.
  zeroLine?: boolean;
  height?: number;
  ariaLabel: string;
  // Clicking an axis label copies its full, untruncated name — for creative
  // names that only fit the axis cut short and slanted.
  copyLabels?: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  // Keep the newest formatter without making it a re-render trigger.
  const fmtRef = useRef(formatValue);
  fmtRef.current = formatValue;

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    chartRef.current?.destroy();

    const datasets: ChartDataset<'bar', (number | null)[]>[] = series.map((s) => ({
      label: s.label,
      data: s.values,
      backgroundColor: s.color,
      borderRadius: 4,
      borderSkipped: false,
      maxBarThickness: 34,
    }));

    chartRef.current = new Chart(el, {
      type: 'bar',
      data: { labels: labels.map((l) => truncate(l)), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? false : { duration: 420 },
        layout: { padding: { top: 4 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', font: { family: INTER, size: 11, weight: 700 }, color: '#5a6a90' },
          },
          tooltip: {
            backgroundColor: '#0f1a3a',
            titleFont: { family: INTER, size: 12, weight: 700 },
            bodyFont: { family: INTER, size: 12 },
            padding: 10,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              // The axis labels are truncated; the tooltip shows the full name.
              title: (items: TooltipItem<'bar'>[]) => labels[items[0]?.dataIndex ?? 0] ?? '',
              label: (item: TooltipItem<'bar'>) => {
                const v = item.parsed.y;
                return ` ${item.dataset.label}: ${v === null ? '—' : fmtRef.current(v, item.datasetIndex)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: '#dde2ee' },
            ticks: { font: { family: INTER, size: 11, weight: 600 }, color: '#5a6a90', maxRotation: 42, minRotation: 0, autoSkip: false },
          },
          y: {
            grid: { color: '#eef1f7' },
            border: { display: false },
            ticks: {
              font: { family: INTER, size: 11 },
              color: '#5a6a90',
              callback: (v) => fmtRef.current(Number(v), 0),
            },
            ...(zeroLine ? { beginAtZero: true } : { beginAtZero: true }),
          },
        },
      },
      plugins: zeroLine
        ? [
            {
              id: 'zeroRule',
              afterDatasetsDraw(chart) {
                const y = chart.scales.y;
                const { left, right } = chart.chartArea;
                const zero = y.getPixelForValue(0);
                const ctx = chart.ctx;
                ctx.save();
                ctx.strokeStyle = '#a0aec0';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(left, zero);
                ctx.lineTo(right, zero);
                ctx.stroke();
                ctx.restore();
              },
            },
          ]
        : [],
    });

    // Label copy is wired on the canvas itself: Chart.js only reports clicks
    // inside the plot area, and the axis labels sit below it.
    const chart = chartRef.current;
    const labelIndexAt = (e: MouseEvent): number | null => {
      if (!chart) return null;
      const pos = getRelativePosition(e, chart as never);
      if (pos.y <= chart.chartArea.bottom) return null;
      const idx = Math.round(Number(chart.scales.x.getValueForPixel(pos.x)));
      return idx >= 0 && idx < labels.length ? idx : null;
    };
    const onMove = (e: MouseEvent) => { el.style.cursor = labelIndexAt(e) === null ? 'default' : 'copy'; };
    const onClick = (e: MouseEvent) => {
      const idx = labelIndexAt(e);
      if (idx === null) return;
      const name = labels[idx];
      navigator.clipboard?.writeText(name).then(() => {
        setCopied(name);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(null), 1800);
      }).catch(() => {});
    };
    if (copyLabels) {
      el.addEventListener('mousemove', onMove);
      el.addEventListener('click', onClick);
    }

    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('click', onClick);
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [labels, series, zeroLine, copyLabels]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  return (
    <div className="chartbox" style={{ height, position: 'relative' }}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
      {copyLabels && (
        <span className={`chart-copied${copied ? ' is-on' : ''}`} role="status" aria-live="polite">
          {copied ? `Disalin: ${copied}` : ''}
        </span>
      )}
    </div>
  );
}
