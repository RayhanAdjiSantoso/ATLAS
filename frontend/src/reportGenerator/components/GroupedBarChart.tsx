import { Chart, type ChartDataset, type TooltipItem } from 'chart.js/auto';
import { useEffect, useRef } from 'react';

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
}: {
  labels: string[];
  series: BarSeries[];
  formatValue: (v: number, seriesIndex: number) => string;
  // Draw an emphasised axis at 0 — %Change charts run negative and the sign
  // is the whole point.
  zeroLine?: boolean;
  height?: number;
  ariaLabel: string;
}) {
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

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [labels, series, zeroLine]);

  return (
    <div className="chartbox" style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
    </div>
  );
}
