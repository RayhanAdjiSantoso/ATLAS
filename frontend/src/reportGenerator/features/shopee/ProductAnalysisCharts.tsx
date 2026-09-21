import { useState } from 'react';
import { GroupedBarChart } from '../../components/GroupedBarChart';
import { ParetoChart } from '../../components/ParetoChart';
import { PotentialParetoChart } from '../../components/PotentialParetoChart';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SegmentedToggle, type SegmentedOption } from '../../components/SegmentedToggle';
import { formatMonth } from '../reports/LibraryFileSlot';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import {
  rankProductPoints,
  type ChartDirection,
  type ParetoRangeSelection,
  type ParetoRow,
  type PotentialProduct,
  type ProductChartGroupDef,
  type ProductChartPoint,
} from '../../lib/shopeeProductAnalysis';

// ── Pareto's "which months" control — shared by the chart card here and the
// table version in AnalysisSections.tsx, both reading the same session
// state (ShopeeTab's paretoRange) so the two stay in sync.
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
// PRODUCT ANALYSIS — the visual half of the product sections.
//
// Three %Change charts (Traffic / Visit→ATC / ATC→Purchase), a Pareto, and a
// single-period Top 5. The tables in "Analisis Produk" keep every product and
// every figure; these five answer the faster question — which handful of
// products moved, and which carry the revenue.
// ══════════════════════════════════════════════════════

const SERIES_A = '#ee4d2d'; // Shopee orange — the section's own identity

// Bars are percentage changes, so they carry a sign and the axis crosses zero.
function fmtPctChange(v: number): string {
  const s = v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${v > 0 ? '+' : ''}${s}%`;
}

function SectionShell({ title, badge, children }: { title: string; badge: string; children: React.ReactNode }) {
  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        {title} <span className="sec-badge">{badge}</span>
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '1rem 1.4rem 1.4rem' }}>{children}</div>
    </div>
  );
}

const DIRECTIONS = [
  { value: 'highest' as ChartDirection, label: 'Highest' },
  { value: 'lowest' as ChartDirection, label: 'Lowest' },
];
const COUNTS = [
  { value: '5' as const, label: '5 produk' },
  { value: '10' as const, label: '10 produk' },
];

// ── #1–3: paired %Change charts ──────────────────────────────────────────
export function ProductChangeChartSection({
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

  const idx = Number(metricIdx);
  const metric = group.metrics[idx] ?? group.metrics[0];
  const badge = `${group.metrics.map((m) => m.label).join(' · ')} · %Change ${p1} → ${p2}`;

  if (!hasCur) {
    return (
      <SectionShell title={`Visualisasi ${group.title}`} badge={badge}>
        <div className="empty-note">Upload file Product Performance periode ini untuk melihat visualisasi ini.</div>
      </SectionShell>
    );
  }
  if (!hasOld) {
    return (
      <SectionShell title={`Visualisasi ${group.title}`} badge={badge}>
        <div className="empty-note">
          Grafik ini membandingkan dua periode. Upload juga file <strong>Product Performance periode lalu</strong> agar %Change bisa dihitung.
        </div>
      </SectionShell>
    );
  }
  // Only the Visit → ATC group reads the plain "Pengunjung Produk" column.
  // Visit → ATC is derived from the plain "Pengunjung Produk" column.
  if (missingVisitorsCol && group.metrics.some((m) => m.key === 'visitors' || m.key === 'visitToAtcRate')) {
    return (
      <SectionShell title={`Visualisasi ${group.title}`} badge={badge}>
        <div className="empty-note">
          Kolom <strong>Pengunjung Produk</strong> tidak ada di file Product Performance yang diupload, jadi metrik Visitor tidak bisa dihitung. Export ulang dari Shopee
          Seller Center dengan kolom tersebut disertakan.
        </div>
      </SectionShell>
    );
  }

  const shown = rankProductPoints(points, idx, direction, Number(count));

  return (
    <SectionShell title={`Visualisasi ${group.title}`} badge={badge}>
      <div className="chart-controls">
        <SegmentedToggle label="Urutan" options={DIRECTIONS} value={direction} onChange={setDirection} accent="var(--shopee-700)" />
        <SegmentedToggle
          label="Urut berdasarkan"
          options={group.metrics.map((m, i) => ({ value: String(i), label: m.label }))}
          value={metricIdx}
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
            {count} produk dengan %Change <strong>{metric.label}</strong> {direction === 'highest' ? 'tertinggi' : 'terendah'}.
          </p>
          <GroupedBarChart
            labels={shown.map((p) => p.produk)}
            series={[{ label: metric.label, values: shown.map((p) => p.pct[idx]), color: SERIES_A }]}
            formatValue={fmtPctChange}
            zeroLine
            height={340}
            ariaLabel={`${group.title}: %Change ${metric.label} untuk ${count} produk teratas`}
          />
          <p className="chart-foot">
            Batang adalah <strong>persentase perubahan</strong> {p1} → {p2}, bukan angka absolut. Hanya metrik yang sedang diurutkan yang digambar — ganti metrik di atas
            untuk membaca yang lain.
          </p>
        </>
      )}
    </SectionShell>
  );
}

// ── #4: Pareto ───────────────────────────────────────────────────────────
const PARETO_SCOPE_LABEL: Record<ParetoRangeSelection['mode'], string> = {
  all: 'seluruh bulan terunggah',
  range: 'rentang bulan terpilih',
  single: 'satu bulan terpilih',
};

export function ParetoChartSection({
  rows,
  hasData,
  range,
  availableMonths,
  onRangeChange,
}: {
  rows: ParetoRow[];
  hasData: boolean;
  range: ParetoRangeSelection;
  availableMonths: string[];
  onRangeChange: (next: ParetoRangeSelection) => void;
}) {
  const vital = rows.findIndex((r) => r.cumulative >= 80);
  return (
    <SectionShell title="Visualisasi Pareto Analysis" badge={`Kontribusi penjualan · ${PARETO_SCOPE_LABEL[range.mode]}`}>
      <ParetoRangeControl range={range} months={availableMonths} onChange={onRangeChange} />
      {!hasData ? (
        <div className="empty-note">Upload file Product Performance (bulan berapa pun) di Pengaturan Brand untuk melihat analisis 80/20.</div>
      ) : !rows.length ? (
        <div className="empty-note">Tidak ada produk dengan penjualan pada cakupan bulan ini.</div>
      ) : (
        <>
          <p className="chart-caption">
            {vital >= 0 ? (
              <>
                <strong>{vital + 1} produk</strong> dari {rows.length} sudah menyumbang 80% penjualan.
              </>
            ) : (
              <>Penjualan tersebar cukup merata — tidak ada kelompok kecil yang mencapai 80%.</>
            )}
          </p>
          <ParetoChart rows={rows} />
          <p className="chart-foot">Menjumlahkan {PARETO_SCOPE_LABEL[range.mode]} Product Performance; Pareto membandingkan produk satu sama lain, bukan antar periode.</p>
        </>
      )}
    </SectionShell>
  );
}

// ── #5: Produk Potensial (Top 5) ─────────────────────────────────────────
export function PotentialProductsSection({ products, hasData, periodLabel }: { products: PotentialProduct[]; hasData: boolean; periodLabel: string }) {
  return (
    <SectionShell title="Visualisasi Produk Potensial" badge={`Revenue & Conversion Rate · ${periodLabel}`}>
      {!hasData ? (
        <div className="empty-note">Upload file Product Performance periode ini untuk melihat produk potensial.</div>
      ) : !products.length ? (
        <div className="empty-note">Tidak ada produk dengan penjualan pada periode ini.</div>
      ) : (
        <>
          <p className="chart-caption">{products.length} produk dengan revenue tertinggi, diurutkan menurun.</p>
          <PotentialParetoChart products={products} />
          <p className="chart-foot">
            Batang adalah revenue (sumbu kiri) — satu-satunya seri yang panjangnya jadi ukuran. Titik <strong>Conversion Rate</strong> memakai sumbu kanan yang
            diskalakan mengikuti CVR tertinggi pada periode ini, bukan 0–100%, supaya selisih antar produk terbaca. Batang tinggi dengan titik CVR rendah adalah
            produk yang sudah menghasilkan tapi konversinya masih punya ruang.
          </p>
        </>
      )}
    </SectionShell>
  );
}
