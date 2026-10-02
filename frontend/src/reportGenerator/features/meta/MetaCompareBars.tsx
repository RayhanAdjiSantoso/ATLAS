import { useMemo, useState, type ReactNode } from 'react';
import { GroupedBarChart, type BarSeries } from '../../components/GroupedBarChart';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SegmentedToggle } from '../../components/SegmentedToggle';
import { AGE_ORDER, isAllValue } from '../../lib/meta';
import { AUDIENCE_TYPE_LABEL, audienceTypeOf, metricsFor, type AudienceMetricDef, type AudienceType, type MetaMetricKind } from '../../lib/metaAudience';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { SheetRow } from '../../lib/types';

// One bar chart of the architecture sheet: a dimension (age group, campaign,
// materi iklan) on the axis, one of a few metrics on the bars, read through
// the New Visitor / Re-Marketing split MIL buys its audiences by.
//
// `mode` is how NV / RM enters the chart:
//   • series — NV and RM side by side per group (Age: "is 25-34 cheaper to
//     win as a new visitor or as a re-target?");
//   • tint   — the axis IS the campaign, so each bar is coloured by its own
//     audience instead of doubling into two;
//   • filter — a Semua / NV / RM switch (materi iklan run in both);
//   • none   — Boost Post, which has no NV / RM.
// "Lowest & Highest" is the sort switch, plus the two ends named above the
// chart; a long axis (materi iklan) shows the top or bottom 15 of the order.

type Filter = 'all' | AudienceType | 'other';
type Order = 'default' | 'desc' | 'asc';

const TYPE_COLOR: Record<AudienceType | 'other' | 'all', string> = {
  NV: '#2856b6',
  RM: '#38bdf8',
  'NV+RM': '#7c9cf0',
  other: '#9fb0cc',
  all: '#1e3eb8',
};
const TYPE_ORDER: (AudienceType | 'other')[] = ['NV', 'RM', 'NV+RM', 'other'];
const SHORT: Record<AudienceType | 'other', string> = { NV: 'NV', RM: 'RM', 'NV+RM': 'NV + RM', other: 'Lainnya' };
const MAX_BARS = 15;

// Campaign and materi names share most of their words ("RM | CS - Purchase |
// …"), so cut short on the axis they all read the same. The axis drops the
// audience token (the bar colour says it) and any part most names share,
// keeping what tells them apart; the tooltip and copy keep the full name.
function compactLabels(labels: string[]): string[] {
  if (labels.length < 2) return labels;
  const parts = labels.map((l) => l.split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean));
  const count = new Map<string, number>();
  for (const ps of parts) for (const x of new Set(ps)) count.set(x, (count.get(x) ?? 0) + 1);
  return parts.map((ps, i) => {
    const kept = ps.filter((x) => !/^(nv|rm|nv rm|nv\+rm)$/i.test(x) && (count.get(x) ?? 0) <= labels.length / 2);
    return kept.length ? kept.join(' · ') : labels[i];
  });
}

function ageRank(label: string): number {
  const i = AGE_ORDER.findIndex((a) => a.toLowerCase() === label.toLowerCase());
  return i < 0 ? AGE_ORDER.length : i;
}

export function MetaCompareBars({
  heading,
  badge,
  rows,
  kind,
  menu,
  dimCol,
  campCol,
  mode,
  sortable,
  copyLabels = false,
  dimNoun,
  note,
  emptyMessage,
}: {
  heading: string;
  badge: string;
  rows: SheetRow[];
  kind: MetaMetricKind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  menu: readonly AudienceMetricDef<any>[];
  dimCol: string | null;
  campCol: string | null;
  mode: 'series' | 'tint' | 'filter' | 'none';
  sortable: boolean;
  copyLabels?: boolean;
  // "kelompok umur", "campaign", "materi iklan" — for the copy.
  dimNoun: string;
  note?: ReactNode;
  emptyMessage?: string;
}) {
  const typeOf = (r: SheetRow): AudienceType | 'other' => (campCol ? audienceTypeOf(r[campCol]) : null) ?? 'other';

  const typesPresent = useMemo(() => {
    if (mode === 'none' || !campCol) return [] as (AudienceType | 'other')[];
    const seen = new Set(rows.map(typeOf));
    return TYPE_ORDER.filter((t) => seen.has(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, campCol, mode]);
  const splitting = typesPresent.length >= 2 && typesPresent.some((t) => t !== 'other');

  const [filter, setFilter] = useState<Filter>('all');
  const scoped = useMemo(() => (mode === 'filter' && filter !== 'all' ? rows.filter((r) => typeOf(r) === filter) : rows), [rows, filter, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // One entry per axis label: its rows, its totals, and (series mode) its
  // totals per audience.
  const groups = useMemo(() => {
    if (!dimCol) return [];
    const map = new Map<string, SheetRow[]>();
    for (const r of scoped) {
      const raw = r[dimCol];
      if (isAllValue(raw)) continue;
      const label = String(raw ?? '').trim();
      if (!label) continue;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(r);
    }
    const isAge = dimCol.toLowerCase().includes('age');
    return [...map.entries()]
      .map(([label, rs]) => ({
        label,
        rows: rs,
        total: metricsFor(kind, rs),
        perType: mode === 'series' && splitting ? Object.fromEntries(typesPresent.map((t) => [t, metricsFor(kind, rs.filter((r) => typeOf(r) === t))])) : null,
        type: mode === 'tint' && campCol ? typeOf(rs[0]) : null,
      }))
      .sort((a, b) => (isAge ? ageRank(a.label) - ageRank(b.label) : 0) || a.label.localeCompare(b.label, 'id'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, dimCol, kind, mode, splitting, typesPresent, campCol]);

  // Only metrics this file can compute are offered.
  const metrics = useMemo(() => {
    const ok = menu.filter((m) => groups.some((g) => g.total[m.key as string] !== null && g.total[m.key as string] !== undefined));
    return ok;
  }, [menu, groups]);
  const missing = menu.filter((m) => !metrics.includes(m));

  const [pick, setPick] = useState('0');
  const [order, setOrder] = useState<Order>(sortable ? 'desc' : 'default');
  const metric = metrics[Number(pick)] ?? metrics[0];
  const val = (m: Record<string, unknown> | null | undefined) => (metric && m ? ((m[metric.key as string] ?? null) as number | null) : null);
  const fmt = (v: number) => fmtPivotVal(v, metric?.fmt ?? 'num');

  const view = useMemo(() => {
    if (!metric) return null;
    const usable = groups.filter((g) => val(g.total) !== null);
    const sorted = order === 'default' ? usable : [...usable].sort((a, b) => (order === 'desc' ? (val(b.total) as number) - (val(a.total) as number) : (val(a.total) as number) - (val(b.total) as number)));
    const shown = order !== 'default' && sorted.length > MAX_BARS ? sorted.slice(0, MAX_BARS) : sorted;
    const labels = shown.map((g) => g.label);
    let series: BarSeries[];
    if (mode === 'series' && splitting) {
      series = typesPresent.map((t) => ({ label: SHORT[t], values: shown.map((g) => val(g.perType?.[t] as Record<string, unknown>)), color: TYPE_COLOR[t] }));
    } else if (mode === 'tint' && splitting) {
      series = [{ label: metric.label, values: shown.map((g) => val(g.total)), color: shown.map((g) => TYPE_COLOR[g.type ?? 'other']) }];
    } else {
      series = [{ label: metric.label, values: shown.map((g) => val(g.total)), color: mode === 'filter' && filter !== 'all' ? TYPE_COLOR[filter] : TYPE_COLOR.all }];
    }
    const ranked = [...usable].sort((a, b) => (val(b.total) as number) - (val(a.total) as number));
    return {
      labels,
      ticks: compactLabels(labels),
      series,
      total: usable.length,
      cut: shown.length < sorted.length,
      high: ranked[0] ?? null,
      low: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, metric, order, mode, splitting, typesPresent, filter]);

  const filterOptions: { value: Filter; label: string }[] = [{ value: 'all', label: 'Semua' }, ...typesPresent.map((t) => ({ value: t as Filter, label: SHORT[t] }))];

  return (
    <div className="sec-block">
      <div className="sec-heading">
        {heading}
        <span className="sec-badge">{badge}</span>
        <SectionDownloadButton />
      </div>

      {metrics.length > 0 && (
        <div className="chart-controls" style={{ padding: '1.1rem 1.4rem 0' }}>
          {metrics.length > 1 && (
            <SegmentedToggle label="Metrik" options={metrics.map((m, i) => ({ value: String(i), label: m.label }))} value={pick} onChange={setPick} accent="var(--acc)" />
          )}
          {mode === 'filter' && splitting && <SegmentedToggle label="Audiens" options={filterOptions} value={filter} onChange={setFilter} accent="var(--acc)" />}
          {sortable && (
            <SegmentedToggle
              label="Urutan"
              options={[
                { value: 'desc', label: 'Tertinggi' },
                { value: 'asc', label: 'Terendah' },
                { value: 'default', label: 'Bawaan' },
              ]}
              value={order}
              onChange={(v) => setOrder(v as Order)}
              accent="var(--acc)"
            />
          )}
        </div>
      )}

      <div style={{ padding: '1.1rem 1.4rem 1.4rem' }}>
        {!dimCol || !groups.length ? (
          <div className="empty-note">{emptyMessage ?? 'Breakdown ini tidak ada di file yang diunggah.'}</div>
        ) : !metric || !view || !view.total ? (
          <div className="empty-note">Metrik bagian ini belum bisa dihitung — kolom dasarnya tidak ada di file yang diunggah.</div>
        ) : (
          <>
            {view.high && view.low && (
              <div className="cb-ends">
                <div className="cb-end is-high">
                  <span>Tertinggi</span>
                  <strong title={view.high.label}>{view.high.label}</strong>
                  <b>{fmt(val(view.high.total) as number)}</b>
                </div>
                <div className="cb-end is-low">
                  <span>Terendah</span>
                  <strong title={view.low.label}>{view.low.label}</strong>
                  <b>{fmt(val(view.low.total) as number)}</b>
                </div>
              </div>
            )}
            {(mode === 'tint' || mode === 'series') && splitting && (
              <ul className="cb-legend" aria-label="Audiens">
                {typesPresent.map((t) => (
                  <li key={t}>
                    <span style={{ background: TYPE_COLOR[t] }} aria-hidden="true" />
                    {AUDIENCE_TYPE_LABEL[t]}
                  </li>
                ))}
              </ul>
            )}
            <GroupedBarChart
              labels={view.labels}
              series={view.series}
              formatValue={fmt}
              height={320}
              ariaLabel={`${heading}: ${metric.label} per ${dimNoun}`}
              copyLabels={copyLabels}
              legend={false}
              tickLabels={view.ticks}
            />
            <p className="chart-foot">
              {metric.label} per {dimNoun}
              {view.cut ? ` — ${MAX_BARS} ${order === 'asc' ? 'terendah' : 'tertinggi'} dari ${view.total} ditampilkan` : ''}.
              {copyLabels ? ' Klik nama di bawah grafik untuk menyalin nama lengkapnya.' : ''}
              {note ? <> {note}</> : null}
            </p>
          </>
        )}
        {missing.length > 0 && groups.length > 0 && <p className="chart-foot">Tidak ditampilkan karena kolomnya tidak ada di file: {missing.map((m) => m.label).join(', ')}.</p>}
      </div>
    </div>
  );
}
