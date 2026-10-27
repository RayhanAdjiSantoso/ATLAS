import { useState } from 'react';
import { GroupedBarChart } from '../../components/GroupedBarChart';
import { SegmentedToggle, type SegmentedOption } from '../../components/SegmentedToggle';
import { formatMonth } from '../reports/LibraryFileSlot';
import { rankProductPoints, type ChartDirection, type ParetoRangeSelection, type ProductChartGroupDef, type ProductChartPoint } from '../../lib/shopeeProductAnalysis';

// ── Pareto's "which months" control — drawn by Pareto Analysis
// (AnalysisSections.tsx) over its chart and table, reading the session state
// in ShopeeTab's paretoRange.
const PARETO_MODES: readonly SegmentedOption<ParetoRangeSelection['mode']>[] = [
  { value: 'all', label: 'Semua Bulan' },
  { value: 'range', label: 'Rentang Bulan' },
  { value: 'single', label: 'Satu Bulan' },
];

export function ParetoRangeControl({ range, months, onChange }: { range: ParetoRangeSelection; months: string[]; onChange: (next: ParetoRangeSelection) => void }) {
  if (months.length < 2) return null; // nothing to narrow down with 0-1 month uploaded
  return (
    <div className="chart-controls">
      <SegmentedToggle label="Cakupan" options={PARETO_MODES} value={range.mode} onChange={(mode) => onChange({ ...range, mode })} accent="var(--shopee-700)" />
      {range.mode === 'range' && (
        <>
          <label style={{ display: 'inline-flex', flexDirection: 'column', gap: '.2rem', fontSize: '.68rem', fontWeight: 600, color: 'var(--muted)' }}>
            Bulan Awal
            <select className="custom-col-select" value={range.start ?? ''} onChange={(e) => onChange({ ...range, start: e.target.value || null })}>
              <option value="">— pilih —</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'inline-flex', flexDirection: 'column', gap: '.2rem', fontSize: '.68rem', fontWeight: 600, color: 'var(--muted)' }}>
            Bulan Akhir
            <select className="custom-col-select" value={range.end ?? ''} onChange={(e) => onChange({ ...range, end: e.target.value || null })}>
              <option value="">— pilih —</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {range.mode === 'single' && (
        <label style={{ display: 'inline-flex', flexDirection: 'column', gap: '.2rem', fontSize: '.68rem', fontWeight: 600, color: 'var(--muted)' }}>
          Bulan
          <select className="custom-col-select" value={range.single ?? ''} onChange={(e) => onChange({ ...range, single: e.target.value || null })}>
            <option value="">— pilih —</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// PRODUCT ANALYSIS — the visual half of Traffic / Conversion Analysis.
//
// A %Change chart drawn at the top of its analysis section, above the table
// that holds every product and figure: the chart answers the faster question
// (which handful of products moved), the table the exact one.
// ══════════════════════════════════════════════════════

const SERIES_A = '#ee4d2d'; // Shopee orange — the section's own identity

// Bars are percentage changes, so they carry a sign and the axis crosses zero.
function fmtPctChange(v: number): string {
  const s = v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${v > 0 ? '+' : ''}${s}%`;
}

const DIRECTIONS = [
  { value: 'highest' as ChartDirection, label: 'Highest' },
  { value: 'lowest' as ChartDirection, label: 'Lowest' },
];
const COUNTS = [
  { value: '5' as const, label: '5 produk' },
  { value: '10' as const, label: '10 produk' },
];

// Nothing to draw without two periods — the table below already says so.
export function ProductChangeChart({
  group,
  points,
  hasCur,
  hasOld,
  missingVisitorsCol,
  p1,
  p2,
}: {
  group: ProductChartGroupDef;
  points: ProductChartPoint[];
  hasCur: boolean;
  hasOld: boolean;
  missingVisitorsCol: boolean;
  p1: string;
  p2: string;
}) {
  const [direction, setDirection] = useState<ChartDirection>('highest');
  const [metricIdx, setMetricIdx] = useState('0');
  const [count, setCount] = useState<'5' | '10'>('5');

  if (!hasCur || !hasOld) return null;
  // Visit → ATC is derived from the plain "Pengunjung Produk" column.
  const needsVisitors = (key: string) => key === 'visitors' || key === 'visitToAtcRate';
  const usable = group.metrics.map((m, i) => ({ m, i })).filter(({ m }) => !(missingVisitorsCol && needsVisitors(m.key)));
  const idx = usable.some((u) => u.i === Number(metricIdx)) ? Number(metricIdx) : usable[0]?.i ?? 0;
  const metric = group.metrics[idx];
  const shown = rankProductPoints(points, idx, direction, Number(count));

  return (
    <div className="ranking-chart">
      <div className="chart-controls">
        <SegmentedToggle label="Urutan" options={DIRECTIONS} value={direction} onChange={setDirection} accent="var(--shopee-700)" />
        <SegmentedToggle
          label="Urut berdasarkan"
          options={usable.map(({ m, i }) => ({ value: String(i), label: m.label }))}
          value={String(idx)}
          onChange={setMetricIdx}
          accent="var(--shopee-700)"
        />
        <SegmentedToggle label="Tampilkan" options={COUNTS} value={count} onChange={setCount} accent="var(--shopee-700)" />
      </div>
      {shown.length === 0 ? (
        <div className="empty-note">Tidak ada produk yang muncul di kedua periode, jadi %Change tidak bisa dihitung.</div>
      ) : (
        <>
          <p className="chart-caption">
            {count} produk dengan %Change <strong>{metric.label}</strong> {direction === 'highest' ? 'tertinggi' : 'terendah'}, {p1} → {p2}.
          </p>
          <GroupedBarChart
            labels={shown.map((p) => p.produk)}
            series={[{ label: metric.label, values: shown.map((p) => p.pct[idx]), color: SERIES_A }]}
            formatValue={fmtPctChange}
            zeroLine
            height={320}
            ariaLabel={`${group.title}: %Change ${metric.label} untuk ${count} produk teratas`}
          />
          <p className="chart-foot">
            Batang adalah <strong>persentase perubahan</strong>, bukan angka absolut — angka lengkap tiap produk ada di tabel di bawah.
            {missingVisitorsCol && usable.length < group.metrics.length && ' Metrik berbasis Pengunjung Produk disembunyikan karena kolomnya tidak ada di file Product Performance.'}
          </p>
        </>
      )}
    </div>
  );
}
