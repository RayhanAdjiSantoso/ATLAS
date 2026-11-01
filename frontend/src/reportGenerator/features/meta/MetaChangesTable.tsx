import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { ExternalLink } from 'lucide-react';
import { DeltaPill } from '../../components/DeltaPill';
import { computeDelta, deltaClassForSentiment, formatDeltaID } from '../../lib/delta';
import { AGE_ORDER, isAllValue } from '../../lib/meta';
import { metricsFor, type AudienceMetricDef, type MetaMetricKind } from '../../lib/metaAudience';
import type { LeadResultKind } from '../../lib/metaFunnel';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { SheetRow } from '../../lib/types';

// The changes table under a chart section: one row per item on the chart's
// axis (campaign, materi iklan, kelompok umur, gender), and for every metric
// of the section this period's value beside its %Chg from the last period.
// Every metric shares one table, so one item reads across a single row; any
// header sorts it. Per materi iklan, a file from ATLAS's Meta API fetch also
// links each ad's preview (`linkCol`); one ad name run in several ad sets
// is several ads, so it can carry more than one link.

const MAX_HEIGHT = 430;
const STICKY: CSSProperties = { position: 'sticky', top: 0, background: 'var(--s2)', zIndex: 1 };
const NUM: CSSProperties = { width: '1%', whiteSpace: 'nowrap', textAlign: 'right' };

type SortKey = { id: string; dir: 'asc' | 'desc' } | null;

// A cost going up is bad news; everything else is read higher-is-better.
const lowerBetter = (key: string) => /^cost|^cpm$|^cpc$/i.test(key);

function groupBy(rows: SheetRow[], dimCol: string): Map<string, SheetRow[]> {
  const map = new Map<string, SheetRow[]>();
  for (const r of rows) {
    const raw = r[dimCol];
    if (isAllValue(raw)) continue;
    const label = String(raw ?? '').trim();
    if (!label) continue;
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(r);
  }
  return map;
}

function ageRank(label: string): number {
  const i = AGE_ORDER.findIndex((a) => a.toLowerCase() === label.toLowerCase());
  return i < 0 ? AGE_ORDER.length : i;
}

interface Cell {
  old: number | null;
  cur: number | null;
  deltaNum: number | null;
  delta: string;
  cls: string;
}

export function MetaChangesTable({
  rows,
  oldRows,
  dimCol,
  kind,
  leadKind,
  metrics,
  p1,
  p2,
  dimNoun,
  initialSort,
  initialDir = 'desc',
  linkCol = null,
  withOld = false,
}: {
  rows: SheetRow[];
  oldRows: SheetRow[];
  dimCol: string;
  kind: MetaMetricKind;
  leadKind?: LeadResultKind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metrics: readonly AudienceMetricDef<any>[];
  p1: string;
  p2: string;
  dimNoun: string;
  // The metric the table opens ranked on (highest first); omitted, an age
  // axis keeps its own order and anything else ranks on the first metric.
  initialSort?: string;
  // Which end that ranking opens on — the chart's Tertinggi / Terendah.
  initialDir?: 'asc' | 'desc';
  // The column holding each row's preview link (lib/metaAudience findPreviewCol).
  linkCol?: string | null;
  // A chart pick's table: last period's value written under this one (its
  // own column in the Excel export), and only the picked metric — the first
  // — judged green or red; its costs read neutral.
  withOld?: boolean;
}) {
  const isAge = dimCol.toLowerCase().includes('age');
  const hasOld = oldRows.length > 0;

  const table = useMemo(() => {
    const cur = groupBy(rows, dimCol);
    const old = groupBy(oldRows, dimCol);
    return [...cur.entries()]
      .map(([label, rs]) => {
        const mCur = metricsFor(kind, rs, leadKind);
        const prev = old.get(label);
        const mOld = prev ? metricsFor(kind, prev, leadKind) : null;
        const cells: Record<string, Cell> = {};
        for (const m of metrics) {
          const key = String(m.key);
          const c = (mCur[key] ?? null) as number | null;
          const o = mOld ? ((mOld[key] ?? null) as number | null) : null;
          const { deltaNum, deltaStr } = prev ? computeDelta(o, c) : { deltaNum: null, deltaStr: 'New' };
          cells[key] = {
            old: o,
            cur: c,
            deltaNum,
            delta: c === null ? '—' : formatDeltaID(deltaNum, deltaStr),
            cls: deltaClassForSentiment(deltaNum, lowerBetter(key) ? 'lower-better' : 'higher-better'),
          };
        }
        const links = linkCol ? [...new Set(rs.map((r) => String(r[linkCol] ?? '').trim()).filter((l) => /^https?:\/\//i.test(l)))] : [];
        return { label, cells, links };
      })
      .sort((a, b) => (isAge ? ageRank(a.label) - ageRank(b.label) : 0) || a.label.localeCompare(b.label, 'id'));
  }, [rows, oldRows, dimCol, kind, leadKind, metrics, isAge, linkCol]);
  const hasLinks = table.some((r) => r.links.length > 0);
  const showOld = withOld && hasOld;

  const firstKey = initialSort ?? (isAge ? null : metrics[0] ? String(metrics[0].key) : null);
  const [sort, setSort] = useState<SortKey>(firstKey ? { id: firstKey, dir: initialDir } : null);

  const sorted = useMemo(() => {
    if (!sort) return table;
    const get = (r: (typeof table)[number]): string | number | null => {
      if (sort.id === '__name') return r.label;
      const [key, part] = sort.id.split('__');
      const cell = r.cells[key];
      return cell ? (part === 'd' ? cell.deltaNum : cell.cur) : null;
    };
    return [...table].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'id');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [table, sort]);

  if (!table.length) return null;

  const click = (id: string) => setSort((prev) => (prev && prev.id === id ? { id, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { id, dir: 'desc' }));
  const mark = (id: string) => (sort?.id === id ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const th = (id: string, label: string, style: CSSProperties = NUM) => (
    <th style={{ ...style, cursor: 'pointer', userSelect: 'none' }} onClick={() => click(id)}>
      {label}
      {mark(id)}
    </th>
  );

  return (
    <div className="meta-changes">
      <p className="chart-caption">
        Klik judul kolom mana pun untuk mengurutkan — {metrics.map((m) => m.label).join(', ')} berbagi satu tabel agar satu {dimNoun} bisa dibaca sekaligus
        {hasOld ? <>; %Chg dibandingkan {p1}.</> : '.'}
        {showOld && <> Angka tebal = {p2}; angka abu-abu di bawahnya = {p1}.</>}
      </p>
      <div style={{ maxHeight: MAX_HEIGHT, overflow: 'auto' }}>
        <table className="kpi-table meta-changes-table">
          <thead style={STICKY}>
            <tr>
              <th rowSpan={2} style={{ width: '2.75rem', textAlign: 'left' }}>#</th>
              <th rowSpan={2} style={{ width: 'auto', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }} onClick={() => click('__name')}>
                {dimNoun}
                {mark('__name')}
              </th>
              {hasLinks && <th rowSpan={2} data-feature="meta-ad-preview-link" style={{ ...NUM, textAlign: 'left' }}>Preview</th>}
              {metrics.map((m) => (
                <th key={String(m.key)} colSpan={hasOld ? 2 : 1} data-xl-colspan={showOld ? 3 : undefined} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  {m.label}
                </th>
              ))}
            </tr>
            <tr>
              {metrics.map((m) => {
                const key = String(m.key);
                return (
                  <Fragment key={key}>
                    {showOld && <th className="xl-only">{p1}</th>}
                    {th(key, p2)}
                    {hasOld && th(`${key}__d`, '%Chg')}
                  </Fragment>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.label}>
                <td style={{ textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</td>
                <td style={{ textAlign: 'left', minWidth: '14rem' }}>{r.label}</td>
                {hasLinks && (
                  <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                    {r.links.length
                      ? r.links.map((href, j) => (
                          <a key={href} href={href} target="_blank" rel="noopener noreferrer" title={href} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 }}>
                            {r.links.length > 1 ? `Lihat ${j + 1}` : 'Lihat'}
                            <ExternalLink size={12} aria-hidden="true" />
                          </a>
                        ))
                      : '—'}
                  </td>
                )}
                {metrics.map((m, mi) => {
                  const key = String(m.key);
                  const c = r.cells[key];
                  return (
                    <Fragment key={key}>
                      {showOld && <td className="xl-only">{c?.old === null || c?.old === undefined ? '—' : fmtPivotVal(c.old, m.fmt)}</td>}
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {showOld ? (
                          <span className="dt-was">
                            <b>{c?.cur === null || c?.cur === undefined ? '—' : fmtPivotVal(c.cur, m.fmt)}</b>
                            <small className="xl-skip">{c?.old === null || c?.old === undefined ? '—' : fmtPivotVal(c.old, m.fmt)}</small>
                          </span>
                        ) : c?.cur === null || c?.cur === undefined ? '—' : fmtPivotVal(c.cur, m.fmt)}
                      </td>
                      {hasOld && <td style={{ whiteSpace: 'nowrap' }}>{c ? <DeltaPill cls={showOld && mi > 0 ? 'delta-neutral' : c.cls}>{c.delta}</DeltaPill> : '—'}</td>}
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!hasOld && <p className="chart-foot">Periode lalu tidak punya data untuk channel ini — kolom %Chg tidak ditampilkan.</p>}
    </div>
  );
}

