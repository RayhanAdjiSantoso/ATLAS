import { useMemo, useState } from 'react';
import { GroupedBarChart } from '../../components/GroupedBarChart';
import { PIE_COLORS, PieChartCanvas } from '../../components/PieChartCanvas';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SegmentedToggle } from '../../components/SegmentedToggle';
import { AUDIENCE_TYPE_LABEL, audienceTypeOf, buildBrandAudience, buildLeadAudience, buildObjectiveAudience, buildSalesAudience, type AudienceMetricDef, type AudienceType } from '../../lib/metaAudience';
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
type Kind = 'sales' | 'brand' | 'objective' | 'lead';
const SALES_BASE: Record<string, { key: string; noun: string }> = {
  ctr: { key: 'contentViews', noun: 'klik (content views)' },
  conversionRate: { key: 'orders', noun: 'order' },
  aov: { key: 'gmv', noun: 'revenue' },
};
const PIE_BASE: Record<Kind, Record<string, { key: string; noun: string }>> = {
  sales: SALES_BASE,
  objective: { ctr: { key: 'linkClicks', noun: 'link click' }, leadRate: { key: 'leads', noun: 'leads' }, interactionRate: { key: 'interactions', noun: 'interaksi' } },
  lead: { ctr: { key: 'linkClicks', noun: 'link click' }, leadRate: { key: 'leads', noun: 'leads' }, costPerLead: { key: 'spend', noun: 'spending' } },
  brand: {
    interactionRate: { key: 'interactions', noun: 'interaksi' },
    profileVisitsRate: { key: 'profileVisits', noun: 'profile visit' },
    followRate: { key: 'follows', noun: 'follow' },
  },
};
const PIE_NOTE_SALES: Record<string, string> = {
  impressions: 'Porsi impressions tiap gender — siapa yang paling banyak melihat iklan.',
  ctr: 'Irisan = porsi klik (content views) tiap gender. Angka di legenda = CTR gender itu.',
  conversionRate: 'Irisan = porsi order tiap gender. Angka di legenda = conversion rate gender itu.',
  aov: 'Irisan = porsi revenue tiap gender. Angka di legenda = rata-rata nilai order gender itu.',
};

function PieTile<M>({ metric, slices, group, kind }: { metric: AudienceMetricDef<M>; slices: AudienceSlice<M>[]; group: string; kind: Kind }) {
  const base = metric.additive ? null : PIE_BASE[kind][String(metric.key)];
  const PIE_NOTE: Record<string, string> = kind === 'sales' ? PIE_NOTE_SALES : { impressions: PIE_NOTE_SALES.impressions };
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
          <PieChartCanvas labels={usable.map((s) => s.label)} values={shares} format={(v) => fmtPivotVal(v, base ? (base.key === 'gmv' || base.key === 'spend' ? 'rp' : 'num') : metric.fmt)} centerTitle={base ? `Total ${base.noun.replace(/\s*\(.*\)$/, '')}` : 'Total'} />
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
  metrics: menu,
  prefer,
  emptyMessage,
  campCol = null,
}: {
  heading: string;
  badge: string;
  rows: SheetRow[];
  dimCol: string;
  // Which metric family this channel belongs to — selling channels decompose
  // the sales funnel, Boost Post decomposes brand actions, and a Non-Boost
  // objective that is not selling (leads, messages, traffic) its own results.
  kind: Kind;
  metrics: readonly AudienceMetricDef<M>[];
  // 'pies' shows every metric as its own pie on one page, no metric toggle.
  prefer: 'bar' | 'pie' | 'pies';
  emptyMessage?: string;
  // When given, a Semua / NV / RM switch reads the breakdown for one
  // audience at a time (campaigns named "NV | …" / "RM | …").
  campCol?: string | null;
}) {
  const typeOf = (r: SheetRow): AudienceType | 'other' => (campCol ? audienceTypeOf(r[campCol]) : null) ?? 'other';
  const types = useMemo(() => {
    if (!campCol) return [] as (AudienceType | 'other')[];
    const seen = new Set(rows.map(typeOf));
    return (['NV', 'RM', 'NV+RM', 'other'] as const).filter((t) => seen.has(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, campCol]);
  const splitting = types.length >= 2 && types.some((t) => t !== 'other');
  const [aud, setAud] = useState<string>('all');
  const scoped = useMemo(() => (splitting && aud !== 'all' ? rows.filter((r) => typeOf(r) === aud) : rows), [rows, aud, splitting]); // eslint-disable-line react-hooks/exhaustive-deps
  const slices = useMemo(
    () =>
      (kind === 'brand'
        ? buildBrandAudience(scoped, dimCol)
        : kind === 'objective'
          ? buildObjectiveAudience(scoped, dimCol)
          : kind === 'lead'
            ? buildLeadAudience(scoped, dimCol)
            : buildSalesAudience(scoped, dimCol)) as unknown as AudienceSlice<M>[],
    [scoped, dimCol, kind],
  );
  const audToggle = splitting ? (
    <SegmentedToggle
      label="Audiens"
      options={[{ value: 'all', label: 'Semua' }, ...types.map((t) => ({ value: t as string, label: t === 'other' ? 'Lainnya' : t === 'NV+RM' ? 'NV + RM' : t }))]}
      value={aud}
      onChange={setAud}
      accent="var(--acc)"
    />
  ) : null;
  // Only metrics this file can compute are offered — a button that always
  // answers "column missing" is noise. Up to four, in the menu's order; what
  // was left out is named under the chart instead.
  const available = useMemo(() => {
    const ok = menu.filter((m) => slices.some((s) => s.metrics[m.key] !== null && s.metrics[m.key] !== undefined));
    return (ok.length ? ok : menu).slice(0, 4);
  }, [menu, slices]);
  const missing = menu.slice(0, 4).filter((m) => !available.includes(m));
  const metrics = available;
  const [pick, setPick] = useState('0');
  // Highest/lowest ordering for the bars. Age keeps its natural order — its
  // groups are a scale (18–24 → 65+), and sorting would scramble it.
  const [order, setOrder] = useState<'default' | 'desc' | 'asc'>('default');
  const sortable = !dimCol.toLowerCase().includes('age');
  const metric = metrics[Number(pick)] ?? metrics[0];
  const valueOf = (s: AudienceSlice<M>) => (s.metrics[metric.key] ?? null) as number | null;
  const usableRaw = slices.filter((s) => valueOf(s) !== null);
  const usable = sortable && order !== 'default'
    ? [...usableRaw].sort((a, b) => (order === 'desc' ? (valueOf(b) as number) - (valueOf(a) as number) : (valueOf(a) as number) - (valueOf(b) as number)))
    : usableRaw;
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
        {audToggle && (
          <div className="chart-controls" style={{ padding: '1.1rem 1.4rem 0' }}>
            {audToggle}
            {aud !== 'all' && <span className="sm-hint">{AUDIENCE_TYPE_LABEL[aud as AudienceType | 'other']}</span>}
          </div>
        )}
        <div style={{ padding: '1.1rem 1.4rem 1.4rem' }}>
          {!slices.length ? (
            <div className="empty-note">{emptyMessage ?? 'Breakdown ini tidak ada di file yang diunggah.'}</div>
          ) : (
            <div className={`bd-pies${metrics.length === 3 ? ' bd-pies-3' : ''}`}>
              {metrics.map((m) => <PieTile key={`${String(m.key)}-${aud}`} metric={m} slices={slices} group={group} kind={kind} />)}
            </div>
          )}
          {missing.length > 0 && (
            <p className="chart-foot">Tidak ditampilkan karena kolomnya tidak ada di file: {missing.map((m) => m.label).join(', ')}.</p>
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
        {audToggle}
        {sortable && !(prefer === 'pie' && metric.additive) && (
          <SegmentedToggle
            label="Urutan"
            options={[
              { value: 'default', label: 'Bawaan' },
              { value: 'desc', label: 'Tertinggi' },
              { value: 'asc', label: 'Terendah' },
            ]}
            value={order}
            onChange={(v) => setOrder(v as 'default' | 'desc' | 'asc')}
            accent="var(--acc)"
          />
        )}
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
            <PieChartCanvas labels={usable.map((s) => s.label)} values={usable.map((s) => (s.metrics[metric.key] ?? 0) as number)} format={fmt} legend />
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
              copyLabels={!dimCol.toLowerCase().includes('age') && !dimCol.toLowerCase().includes('gender')}
            />
            {prefer === 'pie' && (
              <p className="chart-foot">
                Digambar sebagai batang, bukan pie: <strong>{metric.label}</strong> adalah rasio, dan rasio tidak bisa dijumlahkan — irisan pie-nya akan menjadi porsi
                dari total yang tidak pernah ada. Pilih <strong>Impressions</strong> untuk melihat pie porsinya.
              </p>
            )}
          </>
        )}
        {asPie ? null : !dimCol.toLowerCase().match(/age|gender/) && usable.length > 0 && (
          <p className="chart-foot">Klik nama di bawah grafik untuk menyalin nama lengkapnya.</p>
        )}
        {missing.length > 0 && (
          <p className="chart-foot">
            Tidak ditampilkan karena kolomnya tidak ada di file: {missing.map((m) => m.label).join(', ')}.
          </p>
        )}
      </div>
    </div>
  );
}
