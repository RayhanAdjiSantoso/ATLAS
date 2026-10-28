import { Chart, type TooltipItem } from 'chart.js/auto';
import { useEffect, useRef, useState } from 'react';
import { SegmentedToggle } from '../../components/SegmentedToggle';
import type { DailyTrendPivotRow } from '../../lib/shopeeDeepDiveInsights';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';

const INTER = "'Inter', system-ui, sans-serif";

// Tren Harian Toko's picture: one metric per day of the month, last period as
// a quiet dashed line under this period's Shopee orange. The metric switch
// offers exactly the metrics the table below shows, under the same names.
// Canvas, like the other report charts, so PDF/PNG export captures it.
export function DailyTrendChart({ rows, labelOf, p1, p2 }: { rows: DailyTrendPivotRow[]; labelOf: (id: string, fallback: string) => string; p1: string; p2: string }) {
  const metrics = rows[0]?.metrics ?? [];
  const [metricId, setMetricId] = useState(metrics[0]?.id ?? '');
  const idx = Math.max(metrics.findIndex((m) => m.id === metricId), 0);
  const metric = metrics[idx];
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !metric) return undefined;
    const fmt = metric.fmt;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const chart = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: rows.map((r) => String(r.day)),
        datasets: [
          {
            label: p1,
            data: rows.map((r) => r.metrics[idx]?.old ?? null),
            borderColor: '#a3afc4',
            backgroundColor: '#a3afc4',
            borderDash: [5, 4],
            borderWidth: 1.8,
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: 4,
            spanGaps: true,
          },
          {
            label: p2,
            data: rows.map((r) => r.metrics[idx]?.cur ?? null),
            borderColor: '#c93b1c',
            backgroundColor: 'rgba(201, 59, 28, .09)',
            fill: 'origin',
            borderWidth: 2.4,
            tension: 0.3,
            pointRadius: 2.5,
            pointBackgroundColor: '#c93b1c',
            pointHoverRadius: 5,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduce ? false : { duration: 500 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: { boxWidth: 18, boxHeight: 2, font: { family: INTER, size: 11, weight: 700 }, color: '#5a6a90' },
          },
          tooltip: {
            backgroundColor: '#0f1a3a',
            padding: 10,
            cornerRadius: 8,
            titleFont: { family: INTER, size: 12, weight: 700 },
            bodyFont: { family: INTER, size: 12 },
            callbacks: {
              title: (items: TooltipItem<'line'>[]) => `Tanggal ${items[0]?.label ?? ''}`,
              label: (item: TooltipItem<'line'>) => ` ${item.dataset.label}: ${item.parsed.y === null ? '—' : fmtPivotVal(item.parsed.y, fmt)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: '#dde2ee' },
            title: { display: true, text: 'Tanggal', font: { family: INTER, size: 11, weight: 600 }, color: '#8a97b4' },
            ticks: { font: { family: INTER, size: 11 }, color: '#5a6a90', maxRotation: 0, autoSkipPadding: 6 },
          },
          y: {
            beginAtZero: true,
            grid: { color: '#eef1f7' },
            border: { display: false },
            ticks: { font: { family: INTER, size: 11 }, color: '#5a6a90', callback: (v) => fmtPivotVal(Number(v), fmt) },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [rows, idx, metric, p1, p2]);

  if (!metric) return null;
  return (
    <div className="ranking-chart" data-feature="shopee-daily-trend-chart">
      {metrics.length > 1 && (
        <div className="chart-controls">
          <SegmentedToggle
            label="Metrik"
            options={metrics.map((m) => ({ value: m.id, label: labelOf(m.id, m.label) }))}
            value={metric.id}
            onChange={setMetricId}
            accent="var(--shopee-700)"
          />
        </div>
      )}
      <p className="chart-caption">
        <strong>{labelOf(metric.id, metric.label)}</strong> per hari, {p2} dibandingkan {p1}.
      </p>
      <div className="chartbox" style={{ height: 280, position: 'relative' }}>
        <canvas ref={canvasRef} role="img" aria-label={`Tren harian ${labelOf(metric.id, metric.label)}`} />
      </div>
    </div>
  );
}
