import { useMemo, useState } from 'react';
import { GroupedBarChart } from '../../components/GroupedBarChart';
import { PIE_COLORS, PieChartCanvas } from '../../components/PieChartCanvas';
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

// For the all-pies layout. A ratio has no share of its own, so its pie is
// drawn from the count the ratio is built on, and the legend carries each
// group's actual ratio beside that share.
const PIE_BASE: Record<string, { key: string; noun: string }> = {
  ctr: { key: 'contentViews', noun: 'klik (content views)' },
  conversionRate: { key: 'orders', noun: 'order' },
  aov: { key: 'gmv', noun: 'revenue' },
};
const PIE_NOTE: Record<string, string> = {
  impressions: 'Porsi impressions tiap gender — siapa yang paling banyak melihat iklan.',
  ctr: 'Irisan = porsi klik (content views) tiap gender. Angka di legenda = CTR gender itu.',
  conversionRate: 'Irisan = porsi order tiap gender. Angka di legenda = conversion rate gender itu.',
  aov: 'Irisan = porsi revenue tiap gender. Angka di legenda = rata-rata nilai order gender itu.',
};

function PieTile<M>({ metric, slices, group }: { metric: AudienceMetricDef<M>; slices: AudienceSlice<M>[]; group: string }) {
  const base = metric.additive ? null : PIE_BASE[String(metric.key)];
  const shareOf = (s: AudienceSlice<M>) => (s.metrics[(base?.key ?? metric.key) as keyof M] ?? null) as number | null;
  const usable = slices.filter((s) => (shareOf(s) ?? 0) > 0);
  const shares = usable.map((s) => shareOf(s) as number);
  const total = shares.reduce((a, b) => a + b, 0);
  const note = PIE_NOTE[String(metric.key)] ?? (base ? `Irisan = porsi ${base.noun} tiap ${group}. Angka di legenda = ${metric.label.toLowerCase()} ${group} itu.` : `Porsi ${metric.label.toLowerCase()} tiap ${group}.`);
  return (
    <figure className="bd-pie">
      <figcaption>
        <h4>{metric.label}</h4>
        <p>{note}</p>
      </figcaption>
      {!usable.length ? (
        <div className="empty-note">Kolom dasar {metric.label} tidak ada di file ini.</div>
      ) : (
        <>
          <PieChartCanvas labels={usable.map((s) => s.label)} values={shares} />
          <ul className="bd-pie-legend">
            {usable.map((s, i) => {
              const value = (s.metrics[metric.key] ?? null) as number | null;
              return (
                <li key={s.key}>
                  <span className="bd-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="bd-label">{s.label}</span>
                  <b>{value === null ? '—' : fmtPivotVal(value, metric.fmt)}</b>
                  <span className="bd-pct">{total > 0 ? ((shares[i] / total) * 100).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0'}%</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </figure>
  );
}

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
  // 'pies' shows every metric as its own pie on one page, no metric toggle.
  prefer: 'bar' | 'pie' | 'pies';
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
  const group = heading.toLowerCase().includes('gender') ? 'gender' : heading.toLowerCase().includes('age') ? 'kelompok umur' : 'kelompok';

  if (prefer === 'pies') {
    return (
      <div className="sec-block">
        <div className="sec-heading">
          {heading}
          <span className="sec-badge">{badge}</span>
          <SectionDownloadButton />
        </div>
        <div style={{ padding: '1.1rem 1.4rem 1.4rem' }}>
          {!slices.length ? (
            <div className="empty-note">{emptyMessage ?? 'Breakdown ini tidak ada di file yang diunggah.'}</div>
          ) : (
            <div className="bd-pies">
              {metrics.map((m) => <PieTile key={String(m.key)} metric={m} slices={slices} group={group} />)}
            </div>
          )}
        </div>
      </div>
    );
  }

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
