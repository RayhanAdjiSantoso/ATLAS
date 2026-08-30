import { Chart, type Plugin } from 'chart.js/auto';
import { useEffect, useRef } from 'react';

export const PIE_COLORS = ['#1e3eb8', '#00c2e0', '#f5a623', '#2f54d4', '#00e5c8', '#f5a623cc', '#5b7fe8', '#00a0bb', '#ffc55a', '#7c9ff5'];

interface PieChartCanvasProps {
  labels: string[];
  values: number[];
}

// Ported 1:1 from the original renderPieChart, including its custom
// outer-label plugin (leader lines + percentage labels drawn outside the pie).
export function PieChartCanvas({ labels, values }: PieChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const outerLabelPlugin: Plugin<'pie'> = {
      id: 'outerLabels',
      afterDraw(chart) {
        const { ctx, data, chartArea } = chart;
        const { top, bottom, left, right } = chartArea;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        const meta = chart.getDatasetMeta(0);
        const dataset = data.datasets[0].data as number[];
        const tot = dataset.reduce((a, b) => a + b, 0);
        ctx.save();
        meta.data.forEach((arc, i) => {
          const val = dataset[i];
          const pct = tot > 0 ? (val / tot) * 100 : 0;
          if (pct < 2) return;
          const a = arc as unknown as { startAngle: number; endAngle: number; outerRadius: number };
          const midAngle = (a.startAngle + a.endAngle) / 2;
          const r = a.outerRadius;
          const p1r = r + 5;
          const p2r = r + 20;
          const p1x = cx + Math.cos(midAngle) * p1r;
          const p1y = cy + Math.sin(midAngle) * p1r;
          const p2x = cx + Math.cos(midAngle) * p2r;
          const p2y = cy + Math.sin(midAngle) * p2r;
          const side = Math.cos(midAngle) >= 0 ? 1 : -1;
          const p3x = p2x + side * 12;
          const p3y = p2y;
          ctx.beginPath();
          ctx.moveTo(p1x, p1y);
          ctx.lineTo(p2x, p2y);
          ctx.lineTo(p3x, p3y);
          ctx.strokeStyle = '#9aa5c4';
          ctx.lineWidth = 1;
          ctx.stroke();
          const lx = p3x + side * 4;
          const align = side >= 0 ? 'left' : 'right';
          ctx.textAlign = align;
          ctx.textBaseline = 'middle';
          ctx.font = '700 11.5px Inter, sans-serif';
          ctx.fillStyle = '#0f1a3a';
          ctx.fillText(String(data.labels?.[i] ?? ''), lx, p3y - 7);
          ctx.font = '600 10.5px Inter, sans-serif';
          ctx.fillStyle = '#6b7a9e';
          ctx.fillText(pct.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%', lx, p3y + 7);
        });
        ctx.restore();
      },
    };

    chartRef.current = new Chart(canvasRef.current, {
      type: 'pie',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: PIE_COLORS.slice(0, labels.length), borderWidth: 2.5, borderColor: '#ffffff', hoverOffset: 5 }],
      },
      options: {
        responsive: false,
        layout: { padding: { top: 46, bottom: 46, left: 80, right: 80 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        animation: { duration: 500 },
      },
      plugins: [outerLabelPlugin],
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(labels), JSON.stringify(values)]);

  return (
    <div className="pie-canvas-wrap">
      <canvas ref={canvasRef} width={340} height={300} />
    </div>
  );
}
