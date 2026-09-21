import { useState, type CSSProperties, type ReactNode } from 'react';
import { DeltaPill } from '../../components/DeltaPill';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SectionExcelButton } from '../../components/SectionExcelButton';
import { useInlineMetricEditor } from '../../hooks/useInlineMetricEditor';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { FunnelTreeRow, FunnelValueRow } from '../../lib/shopeeFunnel';
import type { SymptomSummary } from '../../lib/shopeeFunnelSummary';
import type { ParetoRangeSelection, ParetoRow, ProductMetricRanking, ProductRankRow } from '../../lib/shopeeProductAnalysis';
import { ParetoRangeControl } from './ProductAnalysisCharts';

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
// The flat "Values" list — old vs cur vs %Change, the same shape and order as
// the reference workbook's left-hand pivot.
// The Values table — ONE table, in the reference workbook's own order, with a
// firm rule after Amount Spend. Above that rule sits the performance index
// people read first (GMV, contribution, ROAS, spend); below it, the funnel
// detail that explains the index. This used to be two separate draggable
// tables ("Ads Strategist" / "Client"), which read as two different reports
// of the same account; one table with one rule says "same reading, two
// altitudes". Definition order IS reading order, so there is no reordering
// and no regrouping — only renaming, which clients do ask for.
const FA_CORE_KEYS = new Set(['gmvOverall', 'gmvAds', 'adContribution', 'roas', 'spend']);

function FundamentalValuesTable({ values, p1, p2 }: { values: FunnelValueRow[]; p1: string; p2: string }) {
  const lastCore = values.reduce((last, v, i) => (FA_CORE_KEYS.has(v.key) ? i : last), -1);

  return (
    <div className="fa-values">
      <div className="fg-scroll">
        <table className="kpi-table fg-table fa-values-table">
          <thead>
            <tr>
              <th>Values</th>
              <th>{p1}</th>
              <th>{p2}</th>
              <th>Changes</th>
            </tr>
          </thead>
          <tbody>
            {values.map((v, i) => (
              <tr key={v.key} className={i === lastCore ? 'fa-rule' : undefined}>
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
  // The account-level funnel tree and its plain-language read. The read sits
  // under this section's own table, the same place every channel's read sits
  // under its own — one rule, applied everywhere, rather than a separate
  // section that divorced each conclusion from the numbers behind it.
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
            <FundamentalValuesTable values={values} p1={p1} p2={p2} />
          </div>
          {tree && <SymptomTreePanel tree={tree} p1={p1} p2={p2} title="Symptom Analysis" badge={`${p1} → ${p2}`} />}
        </div>
        {symptom && <SymptomSummaryPanel summary={symptom} />}

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

// No cascade index any more: the tree used to stagger itself in via `--i`,
// which made it invisible to html2canvas (the clone restarts every CSS
// animation, so a PNG caught every node still at opacity:0). Depth now reads
// from weight and the connector rails alone.
function SymptomTreeNode({ node }: { node: SymptomNode }) {
  return (
    <li className="st-item">
      <div className={`st-node${node.depth === 0 ? ' st-root' : ''}`} data-depth={node.depth}>
        <span className="st-label">{node.label}</span>
        <span className="st-vals num">
          <span className="st-old">{fmtPivotVal(node.oldNum, node.fmt)}</span>
          <span className="st-arrow" aria-hidden="true">→</span>
          <span className="st-cur">{fmtPivotVal(node.curNum, node.fmt)}</span>
        </span>
        <DeltaPill cls={node.cls}>{node.delta}</DeltaPill>
      </div>
      {node.children.length > 0 && (
        <ul className="st-children">
          {node.children.map((c) => (
            <SymptomTreeNode key={c.key} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

function SymptomTree({ rows, p1, p2 }: { rows: FunnelTreeRow[]; p1: string; p2: string }) {
  const tree = nestFunnelRows(rows);
  return (
    <div className="symptom-tree">
      {/* The head shares the node grid, so these labels sit directly over the
          column they name at every depth. */}
      <div className="symptom-tree-head">
        <span>Node</span>
        <span className="st-vals">
          {p1} <span className="st-arrow" aria-hidden="true">→</span> {p2}
        </span>
        <span className="st-head-delta">Perubahan</span>
      </div>
      <ul className="st-root-list">
        {tree.map((n) => (
          <SymptomTreeNode key={n.key} node={n} />
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

const PARETO_TABLE_SCOPE_LABEL: Record<ParetoRangeSelection['mode'], string> = {
  all: 'seluruh bulan terunggah',
  range: 'rentang bulan terpilih',
  single: 'satu bulan terpilih',
};

export function ParetoAnalysisSection({
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
        Pareto Analysis <span className="sec-badge">Product Performance · {PARETO_TABLE_SCOPE_LABEL[range.mode]}</span>
        <SectionExcelButton />
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '.6rem 1.4rem 1.4rem' }}>
        <ParetoRangeControl range={range} months={availableMonths} onChange={onRangeChange} />
        {!hasData ? (
          <div className="empty-note">Upload file Product Performance (bulan berapa pun) di Pengaturan Brand untuk melihat analisis 80/20.</div>
        ) : !rows.length ? (
          <div className="empty-note">Tidak ada produk dengan penjualan pada cakupan bulan ini.</div>
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} rowStyle={(r) => (r.cumulative <= 80 ? { fontWeight: 600 } : undefined)} />
        )}
      </div>
    </div>
  );
}

// ── Traffic / Conversion Analysis ────────────────────────────────────────
// ONE table per analysis, not one table per metric. The three metrics of an
// analysis describe the SAME products, so three stacked tables forced the
// reader to find a product three times over just to compare its own numbers.
// Here each metric is a sortable column: click Impressions to rank by reach,
// click CTR to rank by efficiency — the product list never moves out from
// under you, and the comparison is a glance across a row.

interface MergedRankRow {
  key: string;
  produk: string;
  by: Record<string, ProductRankRow | undefined>;
}

function mergeRankings(rankings: ProductMetricRanking[]): MergedRankRow[] {
  const byKey = new Map<string, MergedRankRow>();
  for (const ranking of rankings) {
    for (const row of ranking.rows) {
      let merged = byKey.get(row.key);
      if (!merged) {
        merged = { key: row.key, produk: row.produk, by: {} };
        byKey.set(row.key, merged);
      }
      merged.by[ranking.metric] = row;
    }
  }
  // Open on the first metric's own ranking, so the table lands on the reading
  // its title promises before anyone touches a header.
  const lead = rankings[0];
  const leadOrder = new Map(lead ? lead.rows.map((r, i) => [r.key, i] as const) : []);
  return [...byKey.values()].sort(
    (a, b) => (leadOrder.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (leadOrder.get(b.key) ?? Number.MAX_SAFE_INTEGER),
  );
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
  const rows = mergeRankings(rankings);

  const columns: DataColumn<MergedRankRow>[] = [
    { id: 'rank', label: '#', thStyle: RANK_TH, tdStyle: RANK_TD, sortValue: (_r, i) => i, render: (_r, i) => i + 1 },
    { id: 'produk', label: 'Produk', thStyle: PRODUK_TH, tdStyle: { textAlign: 'left' }, sortValue: (r) => r.produk, render: (r) => r.produk },
  ];
  for (const ranking of rankings) {
    columns.push({
      id: ranking.metric,
      label: hasOld ? `${ranking.label} ${p2}` : ranking.label,
      renamable: true,
      thStyle: NUM_TH,
      tdStyle: NUM_TD,
      sortValue: (r) => r.by[ranking.metric]?.cur ?? null,
      render: (r) => {
        const cur = r.by[ranking.metric]?.cur;
        return cur === null || cur === undefined ? '—' : fmtPivotVal(cur, ranking.fmt);
      },
    });
    if (hasOld) {
      columns.push({
        id: `${ranking.metric}__delta`,
        label: `%Chg ${ranking.label}`,
        thStyle: NUM_TH,
        tdStyle: NUM_TD,
        sortValue: (r) => r.by[ranking.metric]?.deltaNum ?? null,
        render: (r) => {
          const row = r.by[ranking.metric];
          return row ? <DeltaPill cls={row.cls}>{row.delta}</DeltaPill> : '—';
        },
      });
    }
  }

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
        ) : !rows.length ? (
          <div className="empty-note">Tidak ada produk dengan data pada periode ini.</div>
        ) : (
          <>
            {!hasOld && (
              <div className="empty-note" style={{ marginBottom: '.9rem' }}>
                Hanya periode ini yang tersedia — ranking ditampilkan tanpa kolom %Perubahan. Upload Product Performance{' '}
                <strong>periode lalu</strong> untuk melihat tren antar periode.
              </div>
            )}
            <p className="chart-caption">
              Klik judul kolom mana pun untuk mengurutkan — {rankings.map((r) => r.label).join(', ')} berbagi satu tabel agar satu produk bisa dibaca sekaligus.
            </p>
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} />
          </>
        )}
      </div>
    </div>
  );
}
