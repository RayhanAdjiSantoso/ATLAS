import { Chart } from 'chart.js/auto';
import { useEffect, useRef } from 'react';
import type { GadsDay } from './googleAds';

const INTER = "'Inter', system-ui, sans-serif";
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const dayLabel = (s: string) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`;

// Impressions and clicks per day on two axes — the line chart on Looker's
// Overall page. Canvas, like the other report charts, so PDF/PNG export
// captures it as pixels.
export function GoogleDailyChart({ days }: { days: GadsDay[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const chart = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: days.map((d) => dayLabel(d.date)),
        datasets: [
          { label: 'Impressions', data: days.map((d) => d.impressions), borderColor: '#1a73e8', backgroundColor: '#1a73e8', yAxisID: 'y', tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
          { label: 'Clicks', data: days.map((d) => d.clicks), borderColor: '#f5a623', backgroundColor: '#f5a623', yAxisID: 'y1', tension: 0.35, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduce ? false : { duration: 600 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { font: { family: INTER, size: 12 }, boxWidth: 18, boxHeight: 2 } },
          tooltip: { backgroundColor: '#202e45', padding: 10, cornerRadius: 10, titleFont: { family: INTER, weight: 700 }, bodyFont: { family: INTER } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: INTER, size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
          y: { position: 'left', beginAtZero: true, title: { display: true, text: 'Impressions', font: { family: INTER, size: 11 } }, ticks: { font: { family: INTER, size: 11 } } },
          y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Clicks', font: { family: INTER, size: 11 } }, ticks: { font: { family: INTER, size: 11 } } },
        },
      },
    });
    return () => chart.destroy();
  }, [days]);

  return (
    <div className="gads-line-wrap">
      <canvas ref={canvasRef} />
    </div>
  );
}
