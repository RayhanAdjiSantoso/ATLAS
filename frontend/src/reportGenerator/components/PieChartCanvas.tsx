import { Chart, type Plugin } from 'chart.js/auto';
import { useEffect, useRef } from 'react';

// A lively set — ATLAS blue, coral, teal, amber, violet… — saturated enough
// that the chart reads at a glance, each hue far from its neighbours. Coral is
// warm, not the alarm red the delta pills use for "worse".
export const PIE_COLORS = ['#3D6BEA', '#F0643C', '#14B8A6', '#F6B12B', '#8B5CF6', '#2CB1E8', '#EC5B93', '#6DB33F', '#FF8A3D', '#94A3B8'];

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
  // Slice colours in order, when the slices carry fixed meanings.
  colors?: string[];
  // Ring diameter in px (default 260).
  size?: number;
}

const INTER = "'Inter', system-ui, sans-serif";
const defaultFormat = (v: number) => Math.round(v).toLocaleString('id-ID');
const pct = (v: number, total: number) => (total > 0 ? ((v / total) * 100).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0,0') + '%';

// A ring with the total in its centre; hovering a slice lifts it and puts
// that slice's name and value in the centre instead. Canvas rather than SVG:
// report sections are exported through html2canvas, and a canvas comes
// through as pixels — the centre text is drawn on it for the same reason.
export function PieChartCanvas({ labels, values, format = defaultFormat, centerTitle = 'Total', centerValue, legend = false, colors, size = 260 }: PieChartCanvasProps) {
  const palette = colors?.length ? colors : PIE_COLORS;
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
        ctx.font = `600 13px ${INTER}`;
        ctx.fillText(title, cx, cy - 13, room);
        ctx.fillStyle = '#202e45';
        ctx.font = `800 ${value.length > 12 ? 16 : 20}px ${INTER}`;
        ctx.fillText(value, cx, cy + 10, room);
        if (active) {
          ctx.fillStyle = '#2856b6';
          ctx.font = `700 12px ${INTER}`;
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
          backgroundColor: labels.map((_, i) => palette[i % palette.length]),
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
  }, [JSON.stringify(labels), JSON.stringify(values), centerTitle, centerValue, palette.join(), size]);

  return (
    <div className={`donut${legend ? ' has-legend' : ''}`}>
      <div className="pie-canvas-wrap donut-canvas" style={{ width: size, height: size }}>
        <canvas ref={canvasRef} width={size} height={size} style={{ width: size, height: size }} />
      </div>
      {legend && (
        <ul className="donut-legend">
          {labels.map((l, i) => (
            <li key={`${l}-${i}`}>
              <span className="donut-bar" style={{ background: palette[i % palette.length] }} aria-hidden="true" />
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
