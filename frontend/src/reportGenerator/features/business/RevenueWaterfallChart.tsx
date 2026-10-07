import { Chart, type TooltipItem } from 'chart.js/auto';
import { useEffect, useRef } from 'react';

// Revenue bridge: Periode Lalu's total, one floating bar per channel for what
// it added or took away, then Periode Ini's total. Canvas (Chart.js floating
// bars) for the same reason as GroupedBarChart — html2canvas captures a
// <canvas> as pixels on PNG/PDF export.

export interface WaterfallStep {
  label: string;
  delta: number;
}

const INTER = "'Inter', system-ui, sans-serif";
const TOTAL_COLOR = '#0d9488';
const UP_COLOR = '#16a34a';
const DOWN_COLOR = '#dc2626';

type Bar = { label: string; range: [number, number]; kind: 'total' | 'up' | 'down'; value: number };

export function RevenueWaterfallChart({
  startLabel,
  startValue,
  endLabel,
  steps,
  formatValue,
  formatShort,
  height = 340,
  ariaLabel,
}: {
  startLabel: string;
  startValue: number;
  endLabel: string;
  steps: WaterfallStep[];
  formatValue: (v: number) => string;
  formatShort: (v: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fmtRef = useRef({ formatValue, formatShort });
  fmtRef.current = { formatValue, formatShort };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const bars: Bar[] = [{ label: startLabel, range: [0, startValue], kind: 'total', value: startValue }];
    let running = startValue;
    for (const s of steps) {
      bars.push({ label: s.label, range: [running, running + s.delta], kind: s.delta >= 0 ? 'up' : 'down', value: s.delta });
      running += s.delta;
    }
    bars.push({ label: endLabel, range: [0, running], kind: 'total', value: running });
    const color = (b: Bar) => (b.kind === 'total' ? TOTAL_COLOR : b.kind === 'up' ? UP_COLOR : DOWN_COLOR);
    const signed = (b: Bar) => (b.kind === 'total' ? '' : b.value >= 0 ? '+' : '−');

    const chart = new Chart(el, {
      type: 'bar',
      data: {
        labels: bars.map((b) => b.label),
        datasets: [{
          data: bars.map((b) => b.range),
          backgroundColor: bars.map(color),
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 46,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? false : { duration: 420 },
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f1a3a',
            titleFont: { family: INTER, size: 12, weight: 700 },
            bodyFont: { family: INTER, size: 12 },
            padding: 10,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: (item: TooltipItem<'bar'>) => {
                const b = bars[item.dataIndex];
                return b.kind === 'total'
                  ? ` Total revenue: ${fmtRef.current.formatValue(b.value)}`
                  : ` Perubahan: ${signed(b)}${fmtRef.current.formatValue(Math.abs(b.value))}`;
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
            beginAtZero: true,
            grid: { color: '#eef1f7' },
            border: { display: false },
            ticks: { font: { family: INTER, size: 11 }, color: '#5a6a90', callback: (v) => fmtRef.current.formatShort(Number(v)) },
          },
        },
      },
      plugins: [{
        // Dashed connectors from each bar's end to the next bar's start, and
        // the value printed above every bar.
        id: 'waterfallDecor',
        afterDatasetsDraw(c) {
          const ctx = c.ctx;
          const meta = c.getDatasetMeta(0);
          const y = c.scales.y;
          ctx.save();
          ctx.strokeStyle = '#a0aec0';
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1;
          for (let i = 0; i < bars.length - 1; i++) {
            const a = meta.data[i] as unknown as { x: number; width: number };
            const b = meta.data[i + 1] as unknown as { x: number; width: number };
            const level = y.getPixelForValue(bars[i].range[1]);
            ctx.beginPath();
            ctx.moveTo(a.x + a.width / 2, level);
            ctx.lineTo(b.x - b.width / 2, level);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.font = `700 11px ${INTER}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          bars.forEach((bar, i) => {
            const el = meta.data[i] as unknown as { x: number };
            const top = y.getPixelForValue(Math.max(bar.range[0], bar.range[1]));
            ctx.fillStyle = bar.kind === 'total' ? '#0f1a3a' : color(bar);
            ctx.fillText(`${signed(bar)}${fmtRef.current.formatShort(Math.abs(bar.value))}`, el.x, top - 4);
          });
          ctx.restore();
        },
      }],
    });

    return () => chart.destroy();
  }, [startLabel, startValue, endLabel, steps]);

  return (
    <div className="chartbox" style={{ height, position: 'relative' }}>
      <canvas ref={canvasRef} role="img" aria-label={ariaLabel} />
    </div>
  );
}
