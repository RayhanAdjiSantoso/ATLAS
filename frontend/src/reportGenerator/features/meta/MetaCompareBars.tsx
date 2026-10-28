import { useMemo, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { GroupedBarChart, type BarSeries } from '../../components/GroupedBarChart';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SegmentedToggle } from '../../components/SegmentedToggle';
import { AGE_ORDER, isAllValue } from '../../lib/meta';
import { AUDIENCE_TYPE_LABEL, audienceTypeOf, leadMenuFor, metricsFor, type AudienceMetricDef, type AudienceType, type MetaMetricKind } from '../../lib/metaAudience';
import { leadResultKind, type LeadResultKind } from '../../lib/metaFunnel';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { SheetRow } from '../../lib/types';
import { copyText } from '../../utils/copyText';
import { MetaChangesTable } from './MetaChangesTable';

// One bar chart of the architecture sheet: a dimension (age group, campaign,
// materi iklan) on the axis, one of a few metrics on the bars, read through
// the New Visitor / Re-Marketing split MIL buys its audiences by.
//
// Every chart that reads a channel bought by audience carries the same
// switch — Gabungan NV + RM, NV, RM — and the Age chart one more, NV vs RM
// side by side. A side the period has no campaign for is shown disabled, so
// the switch reads the same on every chart. `audience` says which:
//   • age      — NV vs RM (default) / Gabungan / NV / RM;
//   • campaign — the axis IS the campaign (or its ad set), so Gabungan tints
//                each bar by its own audience instead of doubling it;
//   • creative — Gabungan / NV / RM over the materi iklan, tinted the same way;
//   • none     — Boost Post, which has no NV / RM.
// "Lowest & Highest" is the sort switch plus the two ends named above the
// chart; a long axis shows the top or bottom 15 of the order. Names on the
// axis, the bars, and the two ends all copy the full name on click.

type Aud = 'split' | 'all' | 'NV' | 'RM';
type Order = 'default' | 'desc' | 'asc';
type TypeKey = AudienceType | 'other';

// NV ATLAS blue, RM coral — two audiences, two clearly different hues, the
// same pair the pie charts use.
const TYPE_COLOR: Record<TypeKey | 'all', string> = {
  NV: '#3D6BEA',
  RM: '#F0643C',
  'NV+RM': '#14B8A6',
  other: '#94A3B8',
  all: '#3D6BEA',
};
const TYPE_ORDER: TypeKey[] = ['NV', 'RM', 'NV+RM', 'other'];
const SHORT: Record<TypeKey, string> = { NV: 'NV', RM: 'RM', 'NV+RM': 'NV + RM', other: 'Lainnya' };
const MAX_BARS = 15;
// The previous period's bar sits beside each item in the same hue, faded.
const fade = (c: string | string[]) => (Array.isArray(c) ? c.map((x) => `${x}66`) : `${c}66`);

function ageRank(label: string): number {
  const i = AGE_ORDER.findIndex((a) => a.toLowerCase() === label.toLowerCase());
  return i < 0 ? AGE_ORDER.length : i;
}

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

export function MetaCompareBars({
  heading,
  badge,
  rows,
  kind,
  menu: rawMenu,
  dimCol,
  campCol,
  audience,
  leadKind: leadKindProp,
  sortable,
  copyLabels = false,
  dimNoun,
  note,
  emptyMessage,
  changes,
  hideDefaultOrder = false,
  minImpressions,
  minSpend,
}: {
  heading: string;
  badge: string;
  rows: SheetRow[];
  kind: MetaMetricKind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  menu: readonly AudienceMetricDef<any>[];
  dimCol: string | null;
  campCol: string | null;
  audience: 'age' | 'campaign' | 'creative' | 'none';
  sortable: boolean;
  copyLabels?: boolean;
  // "kelompok umur", "campaign", "materi iklan" — for the copy.
  dimNoun: string;
  note?: ReactNode;
  emptyMessage?: string;
  // Lead / B2B: which result the leads figures read (the report's pick);
  // without it, the automatic pick over these rows.
  leadKind?: LeadResultKind;
  // When given, a changes table follows the chart: every metric of the menu
  // per item, this period beside its %Chg from `oldRows`.
  changes?: { oldRows: SheetRow[]; p1: string; p2: string };
  // Drop "Bawaan" from the sort switch — the chart opens ranked.
  hideDefaultOrder?: boolean;
  // Only items with at least this many impressions this period — chart and
  // changes table alike; a rate over a handful of impressions is noise.
  minImpressions?: number;
  // Only items that spent more than this (Rp) this period — the same floor,
  // read on spend.
  minSpend?: number;
}) {
  const typeOf = (r: SheetRow): TypeKey => (campCol ? audienceTypeOf(r[campCol]) : null) ?? 'other';
  const leadKind = useMemo(() => leadKindProp ?? leadResultKind(rows), [leadKindProp, rows]);
  const leadish = kind === 'lead' || kind === 'b2b';
  const menu = useMemo(() => (leadish ? leadMenuFor(rawMenu, leadKind) : rawMenu), [leadish, rawMenu, leadKind]);

  const typesPresent = useMemo(() => {
    if (audience === 'none' || !campCol) return [] as TypeKey[];
    const seen = new Set(rows.map(typeOf));
    return TYPE_ORDER.filter((t) => seen.has(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, campCol, audience]);
  const hasNV = typesPresent.includes('NV');
  const hasRM = typesPresent.includes('RM');
  const canSplit = typesPresent.length >= 2 && (hasNV || hasRM);

  const [aud, setAud] = useState<Aud>(audience === 'age' && canSplit ? 'split' : 'all');
  // The items that clear `minImpressions` / `minSpend`, by label (null = no floor).
  const eligible = useMemo(() => {
    if ((!minImpressions && !minSpend) || !dimCol) return null;
    const map = new Map<string, SheetRow[]>();
    for (const r of rows) {
      const label = String(r[dimCol] ?? '').trim();
      if (!label || isAllValue(r[dimCol])) continue;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(r);
    }
    const clears = (rs: SheetRow[]) => {
      const m = metricsFor(kind, rs, leadKind);
      return (!minImpressions || ((m.impressions as number | null) ?? 0) >= minImpressions) && (!minSpend || ((m.spend as number | null) ?? 0) > minSpend);
    };
    return new Set([...map].filter(([, rs]) => clears(rs)).map(([label]) => label));
  }, [rows, dimCol, minImpressions, minSpend, kind, leadKind]);
  const floorText = [
    minImpressions ? `minimal ${minImpressions.toLocaleString('id-ID')} impressions` : '',
    minSpend ? `spending di atas Rp${minSpend.toLocaleString('id-ID')}` : '',
  ].filter(Boolean).join(' dan ');
  const inFloor = (r: SheetRow) => !eligible || !dimCol || eligible.has(String(r[dimCol] ?? '').trim());
  const scoped = useMemo(() => (aud === 'NV' || aud === 'RM' ? rows.filter((r) => typeOf(r) === aud) : rows).filter(inFloor), [rows, aud, eligible]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const split = aud === 'split' && canSplit;
    return [...map.entries()]
      .map(([label, rs]) => ({
        label,
        total: metricsFor(kind, rs, leadKind),
        perType: split ? Object.fromEntries(typesPresent.map((t) => [t, metricsFor(kind, rs.filter((r) => typeOf(r) === t), leadKind)])) : null,
        type: campCol ? typeOf(rs[0]) : ('other' as TypeKey),
      }))
      .sort((a, b) => (isAge ? ageRank(a.label) - ageRank(b.label) : 0) || a.label.localeCompare(b.label, 'id'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, dimCol, kind, aud, canSplit, typesPresent, campCol, leadKind]);

  // The same items over `changes.oldRows`, read the same way (audience side,
  // floor) — the faded bar beside each one.
  const oldScoped = useMemo(
    () => (changes ? (aud === 'NV' || aud === 'RM' ? changes.oldRows.filter((r) => typeOf(r) === aud) : changes.oldRows).filter(inFloor) : []),
    [changes, aud, eligible], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const oldGroups = useMemo(() => {
    const out = new Map<string, { total: Record<string, unknown>; perType: Record<string, Record<string, unknown>> | null }>();
    if (!dimCol || !oldScoped.length) return out;
    const map = new Map<string, SheetRow[]>();
    for (const r of oldScoped) {
      if (isAllValue(r[dimCol])) continue;
      const label = String(r[dimCol] ?? '').trim();
      if (!label) continue;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(r);
    }
    const split = aud === 'split' && canSplit;
    for (const [label, rs] of map) {
      out.set(label, {
        total: metricsFor(kind, rs, leadKind),
        perType: split ? Object.fromEntries(typesPresent.map((t) => [t, metricsFor(kind, rs.filter((r) => typeOf(r) === t), leadKind)])) : null,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldScoped, dimCol, kind, aud, canSplit, typesPresent, leadKind]);
  const hasOld = oldGroups.size > 0;

  const metrics = useMemo(() => menu.filter((m) => groups.some((g) => g.total[m.key as string] !== null && g.total[m.key as string] !== undefined)), [menu, groups]);
  const missing = menu.filter((m) => !metrics.includes(m));

  const [pick, setPick] = useState('0');
  const [order, setOrder] = useState<Order>(sortable ? 'desc' : 'default');
  const [copied, setCopied] = useState<string | null>(null);
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
    let legend: TypeKey[] = [];
    // Each series of this period, paired with its previous-period twin first.
    const withOld = (s: BarSeries, old: (g: (typeof shown)[number]) => Record<string, unknown> | null | undefined): BarSeries[] =>
      hasOld && changes
        ? [{ label: `${s.label} · ${changes.p1}`, values: shown.map((g) => val(old(g))), color: fade(s.color) }, { ...s, label: `${s.label} · ${changes.p2}` }]
        : [s];
    if (aud === 'split' && canSplit) {
      series = typesPresent.flatMap((t) => withOld({ label: SHORT[t], values: shown.map((g) => val(g.perType?.[t] as Record<string, unknown>)), color: TYPE_COLOR[t] }, (g) => oldGroups.get(g.label)?.perType?.[t]));
      legend = typesPresent;
    } else if ((audience === 'campaign' || audience === 'creative') && aud === 'all' && typesPresent.length) {
      series = withOld({ label: metric.label, values: shown.map((g) => val(g.total)), color: shown.map((g) => TYPE_COLOR[g.type]) }, (g) => oldGroups.get(g.label)?.total);
      legend = typesPresent.filter((t) => shown.some((g) => g.type === t));
    } else {
      series = withOld({ label: metric.label, values: shown.map((g) => val(g.total)), color: aud === 'NV' || aud === 'RM' ? TYPE_COLOR[aud] : TYPE_COLOR.all }, (g) => oldGroups.get(g.label)?.total);
      if (aud === 'NV' || aud === 'RM') legend = [aud];
    }
    const ranked = [...usable].sort((a, b) => (val(b.total) as number) - (val(a.total) as number));
    return {
      labels,
      ticks: compactLabels(labels),
      series,
      legend,
      total: usable.length,
      cut: shown.length < sorted.length,
      high: ranked[0] ?? null,
      low: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, oldGroups, hasOld, changes, metric, order, aud, canSplit, typesPresent, audience]);

  const mixedOnly = typesPresent.includes('NV+RM') && !hasNV && !hasRM;
  const noSide = mixedOnly ? 'Campaign di sini memakai NV dan RM dalam satu campaign — tidak bisa dipisah' : 'Tidak ada campaign dengan label ini di periode ini';
  const off = (ok: boolean): string | false => (ok ? false : noSide);
  const audOptions: { value: Aud; label: string; disabled?: string | false }[] = [
    ...(audience === 'age' ? [{ value: 'split' as Aud, label: 'NV vs RM', disabled: off(canSplit) }] : []),
    { value: 'all', label: 'Gabungan NV + RM' },
    { value: 'NV', label: 'NV', disabled: off(hasNV) },
    { value: 'RM', label: 'RM', disabled: off(hasRM) },
  ];

  const copy = (name: string) =>
    copyText(name).then((ok) => {
      if (!ok) return;
      setCopied(name);
      window.setTimeout(() => setCopied((c) => (c === name ? null : c)), 1600);
    });
  const End = ({ tone, g }: { tone: 'high' | 'low'; g: (typeof groups)[number] }) => (
    <div className={`cb-end is-${tone}`}>
      <span>{tone === 'high' ? 'Tertinggi' : 'Terendah'}</span>
      {copyLabels ? (
        <button type="button" className="cb-end-name" title={`Salin: ${g.label}`} onClick={() => copy(g.label)}>
          <strong>{copied === g.label ? 'Disalin' : g.label}</strong>
          <Copy size={13} aria-hidden="true" />
        </button>
      ) : (
        <strong title={g.label}>{g.label}</strong>
      )}
      <b>{fmt(val(g.total) as number)}</b>
    </div>
  );

  return (
    <div className="sec-block">
      <div className="sec-heading">
        {heading}
        <span className="sec-badge">{badge}</span>
        <SectionDownloadButton />
      </div>

      {(metrics.length > 1 || audience !== 'none' || sortable) && (
        <div className="chart-controls" style={{ padding: '1.1rem 1.4rem 0' }}>
          {audience !== 'none' && campCol && <SegmentedToggle label="Audiens" options={audOptions} value={aud} onChange={setAud} accent="var(--acc)" />}
          {metrics.length > 1 && (
            <SegmentedToggle label="Metrik" options={metrics.map((m, i) => ({ value: String(i), label: m.label }))} value={pick} onChange={setPick} accent="var(--acc)" />
          )}
          {sortable && (
            <SegmentedToggle
              label="Urutan"
              options={[
                { value: 'desc', label: 'Tertinggi' },
                { value: 'asc', label: 'Terendah' },
                ...(hideDefaultOrder ? [] : [{ value: 'default', label: 'Bawaan' }]),
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
          <div className="empty-note">
            {!dimCol || aud === 'all' || aud === 'split'
              ? eligible && dimCol && rows.length
                ? `Tidak ada ${dimNoun} dengan ${floorText} di periode ini.`
                : emptyMessage ?? 'Breakdown ini tidak ada di file yang diunggah.'
              : `Tidak ada campaign ${aud} di periode ini.`}
          </div>
        ) : !metric || !view || !view.total ? (
          <div className="empty-note">
            {missing.map((m) => m.label).join(' dan ')} belum bisa dihitung — kolom dasarnya tidak ada di file yang diunggah.
            {kind === 'b2b' && ' Campaign B2B Leads (Send Message / Lead form) umumnya tidak memakai event Add to Cart dan Purchase; bagian ini terisi otomatis bila file memuat kolomnya.'}
          </div>
        ) : (
          <>
            {view.high && view.low && (
              <div className="cb-ends">
                <End tone="high" g={view.high} />
                <End tone="low" g={view.low} />
              </div>
            )}
            {(view.legend.length > 0 || (hasOld && changes)) && (
              <ul className="cb-legend" aria-label="Audiens">
                {view.legend.map((t) => (
                  <li key={t}>
                    <span style={{ background: TYPE_COLOR[t] }} aria-hidden="true" />
                    {AUDIENCE_TYPE_LABEL[t]}
                  </li>
                ))}
                {hasOld && changes && (
                  <>
                    <li data-feature="meta-bars-periode-lalu">
                      <span style={{ background: fade('#5A6A90') as string }} aria-hidden="true" />
                      Periode lalu · {changes.p1}
                    </li>
                    <li>
                      <span style={{ background: '#5A6A90' }} aria-hidden="true" />
                      Periode ini · {changes.p2}
                    </li>
                  </>
                )}
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
              {hasOld && changes ? ` · batang pudar = ${changes.p1}` : ''}
              {aud === 'NV' || aud === 'RM' ? ` · hanya campaign ${aud}` : aud === 'all' && audience !== 'none' && campCol ? ' · gabungan NV + RM' : ''}
              {eligible ? ` · hanya ${dimNoun} dengan ${floorText}` : ''}
              {view.cut ? ` — ${MAX_BARS} ${order === 'asc' ? 'terendah' : 'tertinggi'} dari ${view.total} ditampilkan` : ''}.
              {copyLabels ? ' Klik batang, nama di bawah grafik, atau nama Tertinggi/Terendah untuk menyalin nama lengkapnya.' : ''}
              {note ? <> {note}</> : null}
            </p>
          </>
        )}
        {missing.length > 0 && metrics.length > 0 && groups.length > 0 && <p className="chart-foot">Tidak ditampilkan karena kolomnya tidak ada di file: {missing.map((m) => m.label).join(', ')}.</p>}
        {changes && dimCol && metric && view && view.total > 0 && (
          <MetaChangesTable
            key={`${String(metric.key)}-${aud}`}
            rows={scoped}
            oldRows={(aud === 'NV' || aud === 'RM' ? changes.oldRows.filter((r) => typeOf(r) === aud) : changes.oldRows).filter(inFloor)}
            dimCol={dimCol}
            kind={kind}
            leadKind={leadKind}
            metrics={metrics}
            p1={changes.p1}
            p2={changes.p2}
            dimNoun={dimNoun}
            initialSort={sortable ? String(metric.key) : undefined}
          />
        )}
      </div>
    </div>
  );
}
