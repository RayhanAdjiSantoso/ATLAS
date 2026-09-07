import { Chart, type TooltipItem } from 'chart.js/auto';
import { useEffect, useRef } from 'react';
import type { ParetoRow } from '../lib/shopeeProductAnalysis';

// The standard Pareto shape: contribution per product as bars (descending),
// the running cumulative as a line on a right-hand 0–100% axis, and a dashed
// rule at 80% so the "vital few" are readable without counting. Single
// period — a Pareto of a %Change would not mean anything.
//
// Both axes are percentages of the same total, so the second axis here is a
// scale change, not a second unit smuggled onto one chart.

const INTER = "'Inter', system-ui, sans-serif";

function truncate(s: string, max = 20): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

const pct = (v: number) => `${v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export function ParetoChart({ rows, height = 340, limit = 12 }: { rows: ParetoRow[]; height?: number; limit?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    chartRef.current?.destroy();

    const shown = rows.slice(0, limit);
    const names = shown.map((r) => r.produk);

    chartRef.current = new Chart(el, {
      type: 'bar',
      data: {
        labels: names.map((n) => truncate(n)),
        datasets: [
          {
            type: 'bar',
            label: 'Kontribusi penjualan',
            data: shown.map((r) => r.contribution),
            backgroundColor: '#ee4d2d',
            borderRadius: 4,
            borderSkipped: false,
            maxBarThickness: 34,
            yAxisID: 'y',
            order: 2,
          },
          {
            type: 'line',
            label: 'Kumulatif',
            data: shown.map((r) => r.cumulative),
            borderColor: '#0f1a3a',
            backgroundColor: '#0f1a3a',
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.25,
            yAxisID: 'yCum',
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? false : { duration: 420 },
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
            callbacks: {
              title: (items: TooltipItem<'bar'>[]) => names[items[0]?.dataIndex ?? 0] ?? '',
              label: (item) => ` ${item.dataset.label}: ${pct(Number(item.parsed.y))}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: '#dde2ee' },
            ticks: { font: { family: INTER, size: 11, weight: 600 }, color: '#5a6a90', maxRotation: 42, autoSkip: false },
          },
          y: {
            beginAtZero: true,
            grid: { color: '#eef1f7' },
            border: { display: false },
            ticks: { font: { family: INTER, size: 11 }, color: '#5a6a90', callback: (v) => pct(Number(v)) },
            title: { display: true, text: 'Kontribusi', font: { family: INTER, size: 10, weight: 700 }, color: '#61708f' },
          },
          yCum: {
            position: 'right',
            beginAtZero: true,
            max: 100,
            grid: { display: false },
            border: { display: false },
            ticks: { font: { family: INTER, size: 11 }, color: '#5a6a90', callback: (v) => `${v}%` },
            title: { display: true, text: 'Kumulatif', font: { family: INTER, size: 10, weight: 700 }, color: '#61708f' },
          },
        },
      },
      plugins: [
        {
          id: 'eightyRule',
          afterDatasetsDraw(chart) {
            const y = chart.scales.yCum;
            if (!y) return;
            const { left, right } = chart.chartArea;
            const at = y.getPixelForValue(80);
            const ctx = chart.ctx;
            ctx.save();
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = '#a83417';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(left, at);
            ctx.lineTo(right, at);
            ctx.stroke();
            ctx.setLineDash([]);
            // Label on the right, against the cumulative axis this rule
            // belongs to — on the left it reads as a mark on the
            // contribution axis, which is a different scale entirely.
            ctx.font = `700 10px ${INTER}`;
            ctx.fillStyle = '#a83417';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText('80% kumulatif', right - 4, at - 3);
            ctx.restore();
          },
        },
      ],
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [rows, limit]);

  return (
    <div className="chartbox" style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label="Pareto: kontribusi penjualan per produk dan kumulatifnya" />
    </div>
  );
}
