import { useState, type CSSProperties, type ReactNode } from 'react';
import { DeltaPill } from '../../components/DeltaPill';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SectionExcelButton } from '../../components/SectionExcelButton';
import { useInlineMetricEditor } from '../../hooks/useInlineMetricEditor';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { FunnelTreeRow, FunnelValueRow } from '../../lib/shopeeFunnel';
import type { SymptomSummary } from '../../lib/shopeeFunnelSummary';
import type { ParetoRow, ProductMetricRanking } from '../../lib/shopeeProductAnalysis';

// ══════════════════════════════════════════════════════
// SHOPEE ADS — presentational sections for the 4 "manual report" analyses:
// Fundamental / Pareto / Traffic / Conversion. Pure renderers driven by
// ShopeeFunnelReport fields (see shopeeFunnelReport.ts).
// ══════════════════════════════════════════════════════

const TABLE_MAX_HEIGHT = 430;

// .kpi-table's stylesheet pins the first column to 44% and right-aligns
// everything else. These override that per-cell for the ranking tables so
// every column shrinks to its own content and only "Produk" absorbs the
// slack. Inline styles beat the stylesheet regardless of selector.
const RANK_TH: CSSProperties = { width: '2.75rem', textAlign: 'left', whiteSpace: 'nowrap' };
const RANK_TD: CSSProperties = { textAlign: 'left', fontVariantNumeric: 'tabular-nums' };
const PRODUK_TH: CSSProperties = { width: 'auto', textAlign: 'left' };
const NUM_TH: CSSProperties = { width: '1%', whiteSpace: 'nowrap' };
const NUM_TD: CSSProperties = { whiteSpace: 'nowrap' };
const STICKY_HEAD: CSSProperties = { position: 'sticky', top: 0, background: 'var(--s2)', zIndex: 1 };

// ── Shared sortable + renamable-header table ─────────────────────────────
// Click any header to sort (desc, then asc); click a `renamable` header's
// label to rename it inline (session-only). Renumbering follows the sorted
// order; the "#" column itself sorts by the table's incoming order.

type SortDir = 'asc' | 'desc';

interface DataColumn<T> {
  id: string;
  label: string;
  // When set, the label is click-to-rename (session-only).
  renamable?: boolean;
  thStyle?: CSSProperties;
  tdStyle?: CSSProperties;
  // Omit to make the column unsortable. `null` values always sort last.
  sortValue?: (row: T, index: number) => string | number | null;
  render: (row: T, displayIndex: number) => ReactNode;
}

function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowStyle,
  maxHeight = TABLE_MAX_HEIGHT,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  rowStyle?: (row: T) => CSSProperties | undefined;
  maxHeight?: number;
}) {
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const editor = useInlineMetricEditor({
    onRename: (id, label) => setOverrides((prev) => ({ ...prev, [id]: label })),
    onReorder: () => {},
  });

  const labelFor = (col: DataColumn<T>) => overrides[col.id] ?? col.label;

  function handleHeaderClick(col: DataColumn<T>) {
    if (!col.sortValue) return;
    setSort((prev) => (prev && prev.id === col.id ? { id: col.id, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { id: col.id, dir: 'desc' }));
  }

  function indicator(col: DataColumn<T>): string {
    if (!sort || sort.id !== col.id) return '';
    return sort.dir === 'asc' ? ' ▲' : ' ▼';
  }

  const indexed = rows.map((row, i) => ({ row, i }));
  if (sort) {
    const col = columns.find((c) => c.id === sort.id);
    if (col?.sortValue) {
      const get = col.sortValue;
      indexed.sort((a, b) => {
        const va = get(a.row, a.i);
        const vb = get(b.row, b.i);
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
  }

  return (
    <div style={{ maxHeight, overflow: 'auto' }}>
      <table className="kpi-table">
        <thead>
          <tr style={STICKY_HEAD}>
            {columns.map((col) => {
              const isEditing = editor.editingId === col.id;
              return (
                <th
                  key={col.id}
                  style={{ ...col.thStyle, cursor: col.sortValue ? 'pointer' : 'default', userSelect: 'none' }}
                  onClick={() => !isEditing && handleHeaderClick(col)}
                >
                  {isEditing ? (
                    <input
                      className="metric-th-input"
                      autoFocus
                      value={editor.editingValue}
                      onChange={(e) => editor.setEditingValue(e.target.value)}
                      onBlur={editor.commitEdit}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') editor.commitEdit();
                        if (e.key === 'Escape') editor.cancelEdit();
                      }}
                    />
                  ) : (
                    <>
                      {col.renamable ? (
                        <span
                          className="demo-th-label"
                          title="Klik untuk ganti nama"
                          onClick={(e) => {
                            e.stopPropagation();
                            editor.startEdit(col.id, labelFor(col));
                          }}
                        >
                          {labelFor(col)}
                        </span>
                      ) : (
                        labelFor(col)
                      )}
                      {indicator(col)}
                    </>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {indexed.map(({ row }, displayIndex) => (
            <tr key={rowKey(row, displayIndex)} style={rowStyle?.(row)}>
              {columns.map((col) => (
                <td key={col.id} style={col.tdStyle}>
                  {col.render(row, displayIndex)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Fundamental Analysis ─────────────────────────────────────────────────
// The flat "Values" list, old vs cur vs %Change (same shape as the reference
// workbook's left-hand pivot), split into two draggable groups — the metrics
// an ads strategist works from vs. the ones a client cares about. Drag a row
// (or tap ⇄) to move it between groups; the choice is session-only.

// The three headline numbers, pulled straight from the funnel values (no new
// maths) into a fixed table above the editable groups — a quick read before
// anyone rearranges the detail.
const FA_OVERALL_KEYS = ['spend', 'purchases', 'roas'] as const;

function OverallAdsTable({ values, p1, p2 }: { values: FunnelValueRow[]; p1: string; p2: string }) {
  const rows = FA_OVERALL_KEYS.map((k) => values.find((v) => v.key === k)).filter((v): v is FunnelValueRow => Boolean(v));
  if (!rows.length) return null;
  return (
    <div className="fa-overall">
      <div className="fa-overall-head">
        Overall Ads <span className="sec-badge">3 metrik utama</span>
      </div>
      <div className="tbl-scroll">
      <table className="kpi-table fa-overall-table">
        <thead>
          <tr>
            <th></th>
            <th>{p1}</th>
            <th>{p2}</th>
            <th>Changes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.key}>
              <td>{v.label}</td>
              <td className="num">{fmtPivotVal(v.oldNum, v.fmt)}</td>
              <td className="num">{fmtPivotVal(v.curNum, v.fmt)}</td>
              <td>
                <DeltaPill cls={v.cls}>{v.delta}</DeltaPill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

type FgGroup = 'strategist' | 'client';

const FG_DEFAULT: Record<string, FgGroup> = {
  gmvOverall: 'client', gmvAds: 'client', adContribution: 'client', roas: 'client',
  purchases: 'client', itemsSold: 'client', aov: 'client', abs: 'client', aur: 'client',
  spend: 'strategist', impressions: 'strategist', cpm: 'strategist', clicks: 'strategist',
  ctr: 'strategist', cpc: 'strategist', addToCart: 'strategist', clicksToAtcRate: 'strategist',
  cpAtc: 'strategist', atcToPurchaseRate: 'strategist', cpp: 'strategist', cvr: 'strategist',
};

const FG_GROUPS: { id: FgGroup; title: string; sub: string }[] = [
  { id: 'strategist', title: 'Metrik Ads Strategist', sub: 'lever operasional — media, biaya, funnel' },
  { id: 'client', title: 'Metrik Client', sub: 'hasil bisnis — omzet, ROAS, order' },
];

function FundamentalGroupedValues({ values, p1, p2 }: { values: FunnelValueRow[]; p1: string; p2: string }) {
  const [group, setGroup] = useState<Record<string, FgGroup>>(() => ({ ...FG_DEFAULT }));
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<FgGroup | null>(null);
  const [moved, setMoved] = useState<string | null>(null);

  const groupOf = (key: string): FgGroup => group[key] ?? FG_DEFAULT[key] ?? 'client';
  const rowsIn = (g: FgGroup) => values.filter((v) => groupOf(v.key) === g);

  function move(key: string, to: FgGroup) {
    if (groupOf(key) === to) return;
    setGroup((prev) => ({ ...prev, [key]: to }));
    setMoved(key);
    window.setTimeout(() => setMoved((k) => (k === key ? null : k)), 800);
  }

  return (
    <div className="fg-wrap">
      {FG_GROUPS.map((grp) => {
        const rows = rowsIn(grp.id);
        const other: FgGroup = grp.id === 'strategist' ? 'client' : 'strategist';
        return (
          <div
            key={grp.id}
            data-grp={grp.id}
            className={`fg-group${dropTarget === grp.id && dragKey && groupOf(dragKey) !== grp.id ? ' fg-drop' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(grp.id);
            }}
            onDragLeave={() => setDropTarget((d) => (d === grp.id ? null : d))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragKey) move(dragKey, grp.id);
              setDragKey(null);
              setDropTarget(null);
            }}
          >
            <div className="fg-group-head">
              <span className="fg-group-title">{grp.title}</span>
              <span className="fg-group-sub">{grp.sub}</span>
              <span className="fg-group-count">{rows.length}</span>
            </div>
            <div className="fg-scroll">
            <table className="kpi-table fg-table">
              <thead>
                <tr>
                  <th></th>
                  <th>{p1}</th>
                  <th>{p2}</th>
                  <th>Changes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr
                    key={v.key}
                    className={`fg-row${dragKey === v.key ? ' fg-dragging' : ''}${moved === v.key ? ' fg-moved' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragKey(v.key);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDropTarget(null);
                    }}
                  >
                    <td>
                      <span className="fg-row-label">
                        <span className="fg-handle" aria-hidden>
                          ⠿
                        </span>
                        {v.label}
                        <button type="button" className="fg-move" title={`Pindahkan ke ${other === 'strategist' ? 'Ads Strategist' : 'Client'}`} onClick={() => move(v.key, other)}>
                          ⇄
                        </button>
                      </span>
                    </td>
                    <td className="num">{fmtPivotVal(v.oldNum, v.fmt)}</td>
                    <td className="num">{fmtPivotVal(v.curNum, v.fmt)}</td>
                    <td>
                      <DeltaPill cls={v.cls}>{v.delta}</DeltaPill>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="fg-empty">
                      Tarik metrik ke sini
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        );
      })}
      <div className="empty-note fg-hint">
        Tarik baris metrik antar kotak (atau ketuk <strong>⇄</strong>) untuk mengatur mana yang tampil untuk <strong>ads strategist</strong> dan mana untuk <strong>client</strong>. Berlaku sesi ini.
      </div>
    </div>
  );
}

export function FundamentalAnalysisSection({
  values,
  liveGmv,
  tree,
  symptom,
  p1,
  p2,
}: {
  values: FunnelValueRow[];
  liveGmv: { old: number; cur: number; hasData: boolean };
  // The account-level funnel tree + its plain-language read. Both used to be
  // their own "Symptom Analysis" section; they belong next to the numbers
  // they explain, and the narrow table leaves room for exactly that.
  tree?: FunnelTreeRow[];
  symptom?: SymptomSummary;
  p1: string;
  p2: string;
}) {
  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        Fundamental Analysis <span className="sec-badge">Iklan Produk + Iklan Toko · funnel decomposition</span>
        <SectionExcelButton />
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '1.1rem 1.4rem 0' }}>
        <div className="sec-split">
          <div className="sec-split-main">
            <OverallAdsTable values={values} p1={p1} p2={p2} />
          </div>
          {symptom && <SymptomSummaryPanel summary={symptom} />}
        </div>
        <div className="sec-split">
          <div className="sec-split-main">
            <FundamentalGroupedValues values={values} p1={p1} p2={p2} />
          </div>
          {tree && <SymptomTreePanel tree={tree} p1={p1} p2={p2} title="Symptom Analysis" badge={`${p1} → ${p2}`} />}
        </div>
      </div>
      <div className="empty-note" style={{ padding: '.9rem 1.4rem 0' }}>
        <strong>Catatan ATC:</strong> "Tambah ke Keranjang" hanya dilaporkan oleh Iklan Produk (Iklan Toko tidak punya kolomnya). Node
        "Clicks → ATC Rate" &amp; "ATC → Purchase Rate" memakai ATC dari Iklan Produk saja, sementara penyebutnya (Clicks) tetap gabungan
        Produk + Toko — sama seperti report manual, dan menjaga identitas CVR = ClicksATC × ATCPurchase tetap konsisten.
      </div>
      {liveGmv.hasData ? (
        <div className="empty-note" style={{ padding: '.4rem 1.4rem 1.3rem' }}>
          <strong>Iklan Live (di luar funnel):</strong> GMV {fmtPivotVal(liveGmv.old, 'rp')} → {fmtPivotVal(liveGmv.cur, 'rp')}. Iklan Live
          tidak masuk breakdown funnel karena exportnya tidak punya kolom Impressions/Clicks/CTR (Penonton ≠ Impressions).
        </div>
      ) : (
        <div style={{ paddingBottom: '1rem' }} />
      )}
    </div>
  );
}

// ── Symptom Analysis ─────────────────────────────────────────────────────
// Its own section: a plain-language read of what moved GMV, then the funnel
// drawn as a real nested tree (root GMV at the top, each child indented under
// its parent with a connector) instead of monospace box-drawing glyphs.

interface SymptomNode extends FunnelTreeRow {
  children: SymptomNode[];
}

// Flat FUNNEL_TREE_DEFS (each row carries its `depth`) → real nested tree, so
// the connector rails can be drawn per subtree instead of faked with prefixes.
function nestFunnelRows(rows: FunnelTreeRow[]): SymptomNode[] {
  const roots: SymptomNode[] = [];
  const stack: SymptomNode[] = [];
  for (const r of rows) {
    const node: SymptomNode = { ...r, children: [] };
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

function SymptomTreeNode({ node, seq }: { node: SymptomNode; seq: { i: number } }) {
  const i = seq.i++;
  return (
    <li className="st-item">
      <div className={`st-node${node.depth === 0 ? ' st-root' : ''}`} data-depth={node.depth} style={{ '--i': i } as CSSProperties}>
        <span className="st-label">{node.label}</span>
        <span className="st-vals num">
          {fmtPivotVal(node.oldNum, node.fmt)} <span className="st-arrow">→</span> {fmtPivotVal(node.curNum, node.fmt)}
        </span>
        <DeltaPill cls={node.cls}>{node.delta}</DeltaPill>
      </div>
      {node.children.length > 0 && (
        <ul className="st-children">
          {node.children.map((c) => (
            <SymptomTreeNode key={c.key} node={c} seq={seq} />
          ))}
        </ul>
      )}
    </li>
  );
}

function SymptomTree({ rows, p1, p2 }: { rows: FunnelTreeRow[]; p1: string; p2: string }) {
  const tree = nestFunnelRows(rows);
  const seq = { i: 0 };
  return (
    <div className="symptom-tree">
      <div className="symptom-tree-head">
        <span>Node</span>
        <span>
          {p1} → {p2}
        </span>
      </div>
      <ul className="st-root-list">
        {tree.map((n) => (
          <SymptomTreeNode key={n.key} node={n} seq={seq} />
        ))}
      </ul>
    </div>
  );
}

// The funnel tree on its own — rendered to the right of a metrics table so
// the empty half of a narrow table earns its keep.
export function SymptomTreePanel({ tree, p1, p2, title, badge }: { tree: FunnelTreeRow[]; p1: string; p2: string; title?: string; badge?: string }) {
  return (
    <div className="sympt-panel">
      {title && (
        <div className="sympt-panel-head">
          <span className="sympt-panel-title">{title}</span>
          {badge && <span className="sec-badge">{badge}</span>}
        </div>
      )}
      <SymptomTree rows={tree} p1={p1} p2={p2} />
    </div>
  );
}

// The plain-language read (headline + points + verdict) on its own.
export function SymptomSummaryPanel({ summary }: { summary: SymptomSummary }) {
  return (
    <div className={`sympt-summary sympt-summary-${summary.gmvDir}`}>
      <div className="sympt-summary-headline">{summary.headline}</div>
      <ul className="sympt-summary-points">
        {summary.points.map((pt, i) => (
          <li key={i}>{pt}</li>
        ))}
      </ul>
      <div className="sympt-summary-verdict">Kesimpulan: {summary.verdict}</div>
    </div>
  );
}

export function SymptomAnalysisSection({ tree, summary, p1, p2 }: { tree: FunnelTreeRow[]; summary: SymptomSummary; p1: string; p2: string }) {
  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        Symptom Analysis <span className="sec-badge">pembacaan funnel · {p1} → {p2}</span>
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '1.1rem 1.4rem 1.4rem' }}>
        <div className={`sympt-summary sympt-summary-${summary.gmvDir}`}>
          <div className="sympt-summary-headline">{summary.headline}</div>
          <ul className="sympt-summary-points">
            {summary.points.map((pt, i) => (
              <li key={i}>{pt}</li>
            ))}
          </ul>
          <div className="sympt-summary-verdict">Kesimpulan: {summary.verdict}</div>
        </div>
        <SymptomTree rows={tree} p1={p1} p2={p2} />
      </div>
    </div>
  );
}

// ── Pareto Analysis ──────────────────────────────────────────────────────

export function ParetoAnalysisSection({ rows, hasData, periodLabel }: { rows: ParetoRow[]; hasData: boolean; periodLabel: string }) {
  const columns: DataColumn<ParetoRow>[] = [
    { id: 'rank', label: '#', thStyle: RANK_TH, tdStyle: RANK_TD, sortValue: (_r, i) => i, render: (_r, i) => i + 1 },
    { id: 'produk', label: 'Produk', thStyle: PRODUK_TH, tdStyle: { textAlign: 'left' }, sortValue: (r) => r.produk, render: (r) => r.produk },
    { id: 'sales', label: 'Sales (Confirmed Order)', renamable: true, thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.sales, render: (r) => fmtPivotVal(r.sales, 'rp') },
    { id: 'contribution', label: 'Kontribusi', renamable: true, thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.contribution, render: (r) => fmtPivotVal(r.contribution, 'pct') },
    { id: 'cumulative', label: 'Kumulatif', renamable: true, thStyle: NUM_TH, tdStyle: NUM_TD, sortValue: (r) => r.cumulative, render: (r) => fmtPivotVal(r.cumulative, 'pct') },
  ];

  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        Pareto Analysis <span className="sec-badge">Product Performance · {periodLabel}</span>
        <SectionExcelButton />
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '.6rem 1.4rem 1.4rem' }}>
        {!hasData ? (
          <div className="empty-note">Upload file Product Performance periode ini untuk melihat analisis 80/20.</div>
        ) : !rows.length ? (
          <div className="empty-note">Tidak ada produk dengan penjualan pada periode ini.</div>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} rowStyle={(r) => (r.cumulative <= 80 ? { fontWeight: 600 } : undefined)} />
        )}
      </div>
    </div>
  );
}

// ── Traffic / Conversion Analysis ────────────────────────────────────────
// One table per metric (Clicks / Impressions / CTR — or CVR / Visit→ATC /
// ATC→Purchase), each ranked by that metric for the current period, with
// the old value + %Change alongside. When there's no old-period Product
// Performance file the old/%Change columns are dropped and a prompt to
// upload it is shown (the section is never hidden entirely).

function MetricRankingTable({ ranking, label, hasOld, p1, p2 }: { ranking: ProductMetricRanking; label: string; hasOld: boolean; p1: string; p2: string }) {
  const columns: DataColumn<ProductMetricRanking['rows'][number]>[] = [
    { id: 'rank', label: '#', thStyle: RANK_TH, tdStyle: RANK_TD, sortValue: (_r, i) => i, render: (_r, i) => i + 1 },
    { id: 'produk', label: 'Produk', thStyle: PRODUK_TH, tdStyle: { textAlign: 'left' }, sortValue: (r) => r.produk, render: (r) => r.produk },
  ];
  if (hasOld) {
    columns.push({
      id: 'old',
      label: `${label} ${p1}`,
      thStyle: NUM_TH,
      tdStyle: NUM_TD,
      sortValue: (r) => r.old,
      render: (r) => (r.old === null ? '—' : fmtPivotVal(r.old, ranking.fmt)),
    });
  }
  columns.push({
    id: 'cur',
    label: hasOld ? `${label} ${p2}` : label,
    thStyle: NUM_TH,
    tdStyle: NUM_TD,
    sortValue: (r) => r.cur,
    render: (r) => (r.cur === null ? '—' : fmtPivotVal(r.cur, ranking.fmt)),
  });
  if (hasOld) {
    columns.push({
      id: 'delta',
      label: '%Chg',
      thStyle: NUM_TH,
      tdStyle: NUM_TD,
      sortValue: (r) => r.deltaNum,
      render: (r) => <DeltaPill cls={r.cls}>{r.delta}</DeltaPill>,
    });
  }
  return <DataTable columns={columns} rows={ranking.rows} rowKey={(r) => r.key} />;
}

export function ProductRankingSection({
  title,
  badge,
  rankings,
  hasCur,
  hasOld,
  p1,
  p2,
}: {
  title: string;
  badge: string;
  rankings: ProductMetricRanking[];
  hasCur: boolean;
  hasOld: boolean;
  p1: string;
  p2: string;
}) {
  // Session-only metric renames, keyed by metric id — one rename flows to
  // both the sub-table heading and its column headers.
  const [labels, setLabels] = useState<Record<string, string>>({});
  const editor = useInlineMetricEditor({
    onRename: (id, label) => setLabels((prev) => ({ ...prev, [id]: label })),
    onReorder: () => {},
  });
  const labelFor = (r: ProductMetricRanking) => labels[r.metric] ?? r.label;

  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        {title} <span className="sec-badge">{badge}</span>
        <SectionExcelButton />
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '.6rem 1.4rem 1.4rem' }}>
        {!hasCur ? (
          <div className="empty-note">Upload file Product Performance periode ini untuk melihat analisis ini.</div>
        ) : (
          <>
            {!hasOld && (
              <div className="empty-note" style={{ marginBottom: '.9rem' }}>
                Hanya periode ini yang tersedia — ranking ditampilkan tanpa kolom %Perubahan. Upload Product Performance{' '}
                <strong>periode lalu</strong> untuk melihat tren antar periode.
              </div>
            )}
            {rankings.map((ranking) => (
              <div key={ranking.metric} style={{ marginBottom: '1.4rem' }}>
                <div style={{ fontSize: '.78rem', fontWeight: 700, marginBottom: '.4rem' }}>
                  Ranking berdasarkan{' '}
                  {editor.editingId === ranking.metric ? (
                    <input
                      className="metric-th-input"
                      autoFocus
                      value={editor.editingValue}
                      onChange={(e) => editor.setEditingValue(e.target.value)}
                      onBlur={editor.commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') editor.commitEdit();
                        if (e.key === 'Escape') editor.cancelEdit();
                      }}
                    />
                  ) : (
                    <span className="demo-th-label" title="Klik untuk ganti nama metrik" onClick={() => editor.startEdit(ranking.metric, labelFor(ranking))}>
                      {labelFor(ranking)}
                    </span>
                  )}
                </div>
                <MetricRankingTable ranking={ranking} label={labelFor(ranking)} hasOld={hasOld} p1={p1} p2={p2} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
