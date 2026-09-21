import { useMemo, useState } from 'react';
import { GroupedBarChart } from '../../components/GroupedBarChart';
import { PieChartCanvas } from '../../components/PieChartCanvas';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SegmentedToggle } from '../../components/SegmentedToggle';
import { buildBrandAudience, buildSalesAudience, type AudienceMetricDef } from '../../lib/metaAudience';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { SheetRow } from '../../lib/types';
import type { AudienceSlice } from '../../lib/metaAudience';

// One breakdown — Age, Gender, or Ad — with the metric chosen by the reader.
//
// `prefer` is what the architecture sheet asks the visual to be. It is
// honoured for metrics whose slices sum to a whole, and quietly downgraded to
// bars for rates: a pie of CTR would size its slices by each rate's share of
// the SUM of the rates, a quantity that does not exist. The note says so
// rather than leaving the reader to wonder why the shape changed.

const SERIES = '#1e3eb8';

export function MetaBreakdownSection<M>({
  heading,
  badge,
  rows,
  dimCol,
  kind,
  metrics,
  prefer,
  emptyMessage,
}: {
  heading: string;
  badge: string;
  rows: SheetRow[];
  dimCol: string;
  // Which metric family this channel belongs to — selling channels decompose
  // the sales funnel, Boost Post decomposes brand actions.
  kind: 'sales' | 'brand';
  metrics: readonly AudienceMetricDef<M>[];
  prefer: 'bar' | 'pie';
  emptyMessage?: string;
}) {
  const slices = useMemo(
    () => (kind === 'brand' ? buildBrandAudience(rows, dimCol) : buildSalesAudience(rows, dimCol)) as unknown as AudienceSlice<M>[],
    [rows, dimCol, kind],
  );
  const [pick, setPick] = useState('0');
  const metric = metrics[Number(pick)] ?? metrics[0];
  const values = slices.map((s) => (s.metrics[metric.key] ?? null) as number | null);
  const usable = slices.filter((_, i) => values[i] !== null);
  const asPie = prefer === 'pie' && metric.additive;
  const fmt = (v: number) => fmtPivotVal(v, metric.fmt);

  return (
    <div className="sec-block">
      <div className="sec-heading">
        {heading}
        <span className="sec-badge">{badge}</span>
        <SectionDownloadButton />
      </div>

      <div className="chart-controls" style={{ padding: '1.1rem 1.4rem 0' }}>
        <SegmentedToggle
          label="Metrik"
          options={metrics.map((m, i) => ({ value: String(i), label: m.label }))}
          value={pick}
          onChange={setPick}
          accent="var(--acc)"
        />
      </div>

      <div style={{ padding: '1.1rem 1.4rem 1.4rem' }}>
        {!slices.length ? (
          <div className="empty-note">{emptyMessage ?? 'Breakdown ini tidak ada di file yang diunggah.'}</div>
        ) : !usable.length ? (
          <div className="empty-note">
            <strong>{metric.label}</strong> belum bisa dihitung dari file ini — kolom dasarnya tidak tersedia pada export ini.
          </div>
        ) : asPie ? (
          <>
            <PieChartCanvas labels={usable.map((s) => s.label)} values={usable.map((s) => (s.metrics[metric.key] ?? 0) as number)} />
            <p className="chart-foot">Porsi {metric.label.toLowerCase()} per {heading.toLowerCase().includes('gender') ? 'gender' : 'kelompok'}.</p>
          </>
        ) : (
          <>
            <GroupedBarChart
              labels={usable.map((s) => s.label)}
              series={[{ label: metric.label, values: usable.map((s) => (s.metrics[metric.key] ?? null) as number | null), color: SERIES }]}
              formatValue={fmt}
              height={320}
              ariaLabel={`${heading}: ${metric.label} per kelompok`}
            />
            {prefer === 'pie' && (
              <p className="chart-foot">
                Digambar sebagai batang, bukan pie: <strong>{metric.label}</strong> adalah rasio, dan rasio tidak bisa dijumlahkan — irisan pie-nya akan menjadi porsi
                dari total yang tidak pernah ada. Pilih <strong>Impressions</strong> untuk melihat pie porsinya.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
