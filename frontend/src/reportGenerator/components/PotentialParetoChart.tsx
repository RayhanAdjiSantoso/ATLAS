import { Chart, type TooltipItem } from 'chart.js/auto';
import { useEffect, useRef } from 'react';
import type { PotentialProduct } from '../lib/shopeeProductAnalysis';

// Produk Potensial: revenue per product, descending, with each product's
// conversion rate marked as a dot.
//
//   bars — revenue. The only length-encoded series, so no bar length is ever
//          compared against something measured differently.
//   dots — conversion rate, on a right-hand axis scaled to the conversion
//          rates actually present. Dots, not a line: consecutive products are
//          a ranking, not a sequence CVR travels along.
//
// The cumulative-contribution line this chart used to carry has been removed.
// It forced the right axis to span 0–100%, which pinned every CVR dot to the
// baseline — a 3% rate and a 0.5% rate looked identical. Scaling that axis to
// the data instead is what makes the dots readable, and reading them is the
// point: a tall bar under a low dot is a product already earning while
// converting badly, the clearest headroom in the catalogue.

const INTER = "'Inter', system-ui, sans-serif";

function truncate(s: string, max = 20): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

const rp = (v: number) => `Rp${Math.round(v).toLocaleString('id-ID')}`;
const pct = (v: number) => `${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;

const rpAxis = (v: number) => {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `Rp${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`;
  if (abs >= 1e6) return `Rp${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (abs >= 1e3) return `Rp${(n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return rp(n);
};

// Round up to the next 1 / 2 / 5 × 10ⁿ so the axis ends on a readable number
// instead of whatever the highest CVR happens to be.
function niceCeil(value: number): number {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const fraction = value / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * base;
}

export function PotentialParetoChart({ products, height = 380 }: { products: PotentialProduct[]; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    chartRef.current?.destroy();

    const names = products.map((p) => p.produk);
    // Headroom above the highest rate so the top dot never sits on the frame.
    const cvrMax = niceCeil(Math.max(...products.map((p) => p.conversionRate), 0) * 1.25);

    chartRef.current = new Chart(el, {
      type: 'bar',
      data: {
        labels: names.map((n) => truncate(n)),
        datasets: [
          {
            type: 'bar',
            label: 'Revenue',
            data: products.map((p) => p.revenue),
            backgroundColor: '#ee4d2d',
            borderRadius: 4,
            borderSkipped: false,
            maxBarThickness: 38,
            yAxisID: 'y',
            order: 2,
          },
          {
            type: 'line',
            label: 'Conversion Rate',
            data: products.map((p) => p.conversionRate),
            borderColor: '#1e3eb8',
            backgroundColor: '#1e3eb8',
            showLine: false,
            pointRadius: 6,
            pointHoverRadius: 8,
            pointStyle: 'circle',
            yAxisID: 'yCvr',
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
              label: (item) => {
                const v = Number(item.parsed.y);
                return ` ${item.dataset.label}: ${item.dataset.yAxisID === 'y' ? rp(v) : pct(v)}`;
              },
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
            ticks: { font: { family: INTER, size: 11 }, color: '#5a6a90', callback: (v) => rpAxis(Number(v)) },
            title: { display: true, text: 'Revenue', font: { family: INTER, size: 10, weight: 700 }, color: '#61708f' },
          },
          yCvr: {
            position: 'right',
            beginAtZero: true,
            max: cvrMax,
            grid: { display: false },
            border: { display: false },
            ticks: { font: { family: INTER, size: 11 }, color: '#5a6a90', callback: (v) => pct(Number(v)) },
            title: { display: true, text: 'Conversion Rate', font: { family: INTER, size: 10, weight: 700 }, color: '#61708f' },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [products]);

  return (
    <div className="chartbox" style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label="Revenue per produk dengan conversion rate masing-masing" />
    </div>
  );
}
