import { Chart, type Plugin } from 'chart.js/auto';
import { useEffect, useRef } from 'react';

// One blue family, deep to pale, then sky — slices read as parts of one whole
// rather than unrelated categories. No red: on these pages red means "worse".
export const PIE_COLORS = ['#2856b6', '#5b8def', '#38bdf8', '#9cc7ff', '#1e3eb8', '#7dd3fc', '#c7dcff', '#0ea5e9', '#3b6fd8', '#bfe6fb'];

interface PieChartCanvasProps {
  labels: string[];
  values: number[];
  // How a value reads (Rp…, 1.234, …). Used by the centre label, the tooltip
  // and the built-in legend.
  format?: (v: number) => string;
  // Centre of the ring: "Total" and the sum, unless the caller says otherwise.
  centerTitle?: string;
  centerValue?: string;
  // The built-in legend (colour bar · name · value · share). Off where the
  // caller already draws its own legend beside the chart.
  legend?: boolean;
}

const INTER = "'Inter', system-ui, sans-serif";
const defaultFormat = (v: number) => Math.round(v).toLocaleString('id-ID');
const pct = (v: number, total: number) => (total > 0 ? ((v / total) * 100).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0,0') + '%';

// A ring with the total in its centre; hovering a slice lifts it and puts
// that slice's name and value in the centre instead. Canvas rather than SVG:
// report sections are exported through html2canvas, and a canvas comes
// through as pixels — the centre text is drawn on it for the same reason.
export function PieChartCanvas({ labels, values, format = defaultFormat, centerTitle = 'Total', centerValue, legend = false }: PieChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const fmtRef = useRef(format);
  fmtRef.current = format;
  const total = values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();

    const centreText: Plugin<'doughnut'> = {
      id: 'centreText',
      afterDraw(chart) {
        const { ctx, chartArea } = chart;
        const cx = (chartArea.left + chartArea.right) / 2;
        const cy = (chartArea.top + chartArea.bottom) / 2;
        const active = chart.getActiveElements()[0];
        const title = active ? String(chart.data.labels?.[active.index] ?? '') : centerTitle;
        const raw = active ? Number(chart.data.datasets[0].data[active.index]) : total;
        const value = active ? fmtRef.current(raw) : centerValue ?? fmtRef.current(total);
        const inner = (chart.getDatasetMeta(0).data[0] as unknown as { innerRadius?: number } | undefined)?.innerRadius ?? 60;
        const room = inner * 1.7;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#7a889f';
        ctx.font = `600 12px ${INTER}`;
        ctx.fillText(title, cx, cy - 13, room);
        ctx.fillStyle = '#202e45';
        ctx.font = `800 ${value.length > 12 ? 15 : 19}px ${INTER}`;
        ctx.fillText(value, cx, cy + 10, room);
        if (active) {
          ctx.fillStyle = '#2856b6';
          ctx.font = `700 11px ${INTER}`;
          ctx.fillText(pct(raw, total), cx, cy + 30, room);
        }
        ctx.restore();
      },
    };

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    chartRef.current = new Chart(canvasRef.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: PIE_COLORS.slice(0, labels.length).concat(PIE_COLORS).slice(0, labels.length),
          borderColor: '#ffffff',
          borderWidth: 3,
          borderRadius: 4,
          hoverOffset: 10,
          spacing: 1,
        }],
      },
      options: {
        responsive: false,
        cutout: '64%',
        layout: { padding: 14 },
        animation: reduce ? false : { animateRotate: true, animateScale: false, duration: 850, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#202e45',
            padding: 10,
            cornerRadius: 10,
            titleFont: { family: INTER, size: 12, weight: 700 },
            bodyFont: { family: INTER, size: 12 },
            callbacks: {
              label: (item) => ` ${fmtRef.current(Number(item.parsed))} · ${pct(Number(item.parsed), total)}`,
            },
          },
        },
      },
      plugins: [centreText],
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(labels), JSON.stringify(values), centerTitle, centerValue]);

  return (
    <div className={`donut${legend ? ' has-legend' : ''}`}>
      <div className="pie-canvas-wrap donut-canvas">
        <canvas ref={canvasRef} width={260} height={260} />
      </div>
      {legend && (
        <ul className="donut-legend">
          {labels.map((l, i) => (
            <li key={`${l}-${i}`}>
              <span className="donut-bar" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} aria-hidden="true" />
              <span className="donut-name">{l}</span>
              <b className="donut-val">{format(values[i] ?? 0)}</b>
              <span className="donut-share">{pct(values[i] ?? 0, total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
