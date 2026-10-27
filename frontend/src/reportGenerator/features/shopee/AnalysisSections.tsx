import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DeltaPill } from '../../components/DeltaPill';
import { GroupedBarChart } from '../../components/GroupedBarChart';
import { ParetoChart } from '../../components/ParetoChart';
import { SegmentedToggle } from '../../components/SegmentedToggle';
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
// The name column takes the slack but never collapses to a word per line.
const PRODUK_TD: CSSProperties = { textAlign: 'left', minWidth: '11rem' };
// Headers wrap (a metric name stacks over its period), values never do — the
// table then fits its card instead of scrolling sideways.
const NUM_TH: CSSProperties = { width: '1%', whiteSpace: 'normal' };
const NUM_TD: CSSProperties = { whiteSpace: 'nowrap' };
const STICKY_HEAD: CSSProperties = { position: 'sticky', top: 0, zIndex: 1 };

// ── Shared sortable + renamable-header table ─────────────────────────────
// Click any header to sort (desc, then asc); click a `renamable` header's
// label to rename it inline (session-only). Renumbering follows the sorted
// order; the "#" column itself sorts by the table's incoming order.

type SortDir = 'asc' | 'desc';

export interface DataColumn<T> {
  id: string;
  label: string;
  // Columns sharing a group (consecutive) get one header cell above them —
  // the metric's name over its own "<period> | %Chg" pair.
  group?: string;
  // A second, quieter header line (a unit, or what a two-line cell holds).
  sub?: string;
  // When set, the label is click-to-rename (session-only).
  renamable?: boolean;
  thStyle?: CSSProperties;
  tdStyle?: CSSProperties;
  // Omit to make the column unsortable. `null` values always sort last.
  sortValue?: (row: T, index: number) => string | number | null;
  render: (row: T, displayIndex: number) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowStyle,
  maxHeight = TABLE_MAX_HEIGHT,
  className = '',
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  rowStyle?: (row: T) => CSSProperties | undefined;
  maxHeight?: number;
  className?: string;
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

  const headerCell = (col: DataColumn<T>, rowSpan?: number) => {
    const isEditing = editor.editingId === col.id;
    return (
      <th
        key={col.id}
        rowSpan={rowSpan}
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
            {col.sub && <span className="th-sub">{col.sub}</span>}
          </>
        )}
      </th>
    );
  };

  // Top header row: ungrouped columns span both rows, each run of a group gets
  // one cell.
  const grouped = columns.some((c) => c.group);
  const headTop: ({ col: DataColumn<T> } | { label: string; span: number })[] = [];
  for (let i = 0; i < columns.length; ) {
    const g = columns[i].group;
    if (!g) {
      headTop.push({ col: columns[i] });
      i += 1;
      continue;
    }
    let j = i;
    while (j < columns.length && columns[j].group === g) j += 1;
    headTop.push({ label: g, span: j - i });
    i = j;
  }

  return (
    <div className="dt-wrap" style={{ maxHeight, overflow: 'auto' }}>
      <table className={`kpi-table dt-compact ${className}`.trim()}>
        <thead style={STICKY_HEAD}>
          {grouped ? (
            <>
              <tr>
                {headTop.map((cell) =>
                  'col' in cell ? (
                    headerCell(cell.col, 2)
                  ) : (
                    <th key={`g:${cell.label}`} colSpan={cell.span} className="th-group">
                      {cell.label}
                    </th>
                  ),
                )}
              </tr>
              <tr>{columns.filter((c) => c.group).map((c) => headerCell(c))}</tr>
            </>
          ) : (
            <tr>{columns.map((c) => headerCell(c))}</tr>
          )}
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

// ── Table changes beside root cause, one height ──────────────────────────
// The values table and the symptom tree sit side by side; whichever is
// shorter grows to the other's height. A short table gets taller rows (the
// table's height is raised and the browser spreads it over its rows); a short
// tree gets taller nodes (--st-node-h, which the connector elbows are drawn
// from, so the rails stay aligned). Re-measured whenever either side resizes
// — a section opened from hidden, a metric added or removed, the window
// resized — and left alone when the two are stacked.
export function EqualSplit({ className = '', children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    let busy = false;
    const apply = () => {
      const main = el.querySelector<HTMLElement>(':scope > .sec-split-main');
      const aside = el.querySelector<HTMLElement>(':scope > .sympt-panel');
      const table = main?.querySelector<HTMLTableElement>('table');
      const tree = aside?.querySelector<HTMLElement>('.symptom-tree');
      if (!main || !aside || !table || !tree) return;
      busy = true;
      table.style.height = '';
      tree.style.removeProperty('--st-node-h');
      const mainBox = main.getBoundingClientRect();
      const asideBox = aside.getBoundingClientRect();
      const sideBySide = mainBox.height > 0 && asideBox.height > 0 && Math.abs(mainBox.top - asideBox.top) < 4;
      if (sideBySide) {
        const gap = asideBox.height - mainBox.height;
        if (gap > 2) {
          table.style.height = `${table.getBoundingClientRect().height + gap}px`;
        } else if (gap < -2) {
          const nodes = tree.querySelectorAll<HTMLElement>('.st-node');
          let nodeH = parseFloat(getComputedStyle(tree).getPropertyValue('--st-node-h')) || 38;
          // A node can already be taller than its minimum (a wrapped label),
          // so the first raise may fall short — settle in a few passes.
          for (let pass = 0; pass < 4 && nodes.length; pass += 1) {
            const missing = mainBox.height - aside.getBoundingClientRect().height;
            if (Math.abs(missing) <= 2) break;
            nodeH = Math.max(nodeH + missing / nodes.length, 0);
            tree.style.setProperty('--st-node-h', `${nodeH}px`);
          }
        }
      }
      requestAnimationFrame(() => { busy = false; });
    };
    const schedule = () => {
      if (busy) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    el.querySelectorAll(':scope > *').forEach((child) => ro.observe(child));
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className={`sec-split sec-split-equal ${className}`.trim()}>
      {children}
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
        Fundamental Analysis <span className="sec-badge">Semua Iklan · Product Ads + Shop+ Ads · funnel decomposition</span>
        <SectionExcelButton />
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '1.1rem 1.4rem 0' }}>
        <EqualSplit>
          <div className="sec-split-main">
            <FundamentalValuesTable values={values} p1={p1} p2={p2} />
          </div>
          {tree && <SymptomTreePanel tree={tree} p1={p1} p2={p2} title="Root Cause" badge={`${p1} → ${p2}`} />}
        </EqualSplit>
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
  // Reading order, top to bottom — drives the open cascade (--st-i).
  order: number;
}

// Flat FUNNEL_TREE_DEFS (each row carries its `depth`) → real nested tree, so
// the connector rails can be drawn per subtree instead of faked with prefixes.
function nestFunnelRows(rows: FunnelTreeRow[]): SymptomNode[] {
  const roots: SymptomNode[] = [];
  const stack: SymptomNode[] = [];
  for (const [order, r] of rows.entries()) {
    const node: SymptomNode = { ...r, children: [], order };
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(node);
    stack.push(node);
  }
  return roots;
}

// `--st-i` is the node's reading order. A report skin may stagger the tree in
// with it (Shopee does), but only with a backwards-filled animation that every
// export turns off: html2canvas restarts CSS animations in its clone, and a
// cascade caught mid-way would print nodes at opacity 0.
function SymptomTreeNode({ node }: { node: SymptomNode }) {
  return (
    <li className="st-item">
      <div
        className={`st-node${node.depth === 0 ? ' st-root' : ''}`}
        data-depth={node.depth}
        // Which way this node moved for the better or worse — a skin may light
        // the branch into it with the same green/red the pill carries.
        data-tone={node.cls === 'delta-good' ? 'good' : node.cls === 'delta-bad' ? 'bad' : 'flat'}
        style={{ '--st-i': node.order } as CSSProperties}
      >
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
  const vital = rows.findIndex((r) => r.cumulative >= 80);
  const columns: DataColumn<ParetoRow>[] = [
    { id: 'rank', label: '#', thStyle: RANK_TH, tdStyle: RANK_TD, sortValue: (_r, i) => i, render: (_r, i) => i + 1 },
    { id: 'produk', label: 'Produk', thStyle: PRODUK_TH, tdStyle: PRODUK_TD, sortValue: (r) => r.produk, render: (r) => r.produk },
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
          <div className="empty-note">Upload file Product Performance (bulan berapa pun) di Data Collection Hub untuk melihat analisis 80/20.</div>
        ) : !rows.length ? (
          <div className="empty-note">Tidak ada produk dengan penjualan pada cakupan bulan ini.</div>
        ) : (
          <>
            <p className="chart-caption">
              {vital >= 0 ? (
                <>
                  <strong>{vital + 1} produk</strong> dari {rows.length} sudah menyumbang 80% penjualan — baris tebal di tabel.
                </>
              ) : (
                <>Penjualan tersebar cukup merata — tidak ada kelompok kecil yang mencapai 80%.</>
              )}
            </p>
            <ParetoChart rows={rows} />
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} rowStyle={(r) => (r.cumulative <= 80 ? { fontWeight: 600 } : undefined)} />
          </>
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

// Any ranking of items (products, keywords, live sessions) by a few metrics.
type RankingLike = Pick<ProductMetricRanking, 'label' | 'fmt' | 'rows'> & { metric: string };

export function ProductRankingSection({
  title,
  badge,
  rankings,
  hasCur,
  hasOld,
  p1,
  p2,
  itemLabel = 'Produk',
  emptyText = 'Upload file Product Performance periode ini untuk melihat analisis ini.',
  oldMissingText,
  chart,
}: {
  title: string;
  badge: string;
  rankings: RankingLike[];
  hasCur: boolean;
  hasOld: boolean;
  p1: string;
  p2: string;
  itemLabel?: string;
  emptyText?: string;
  // Shown when there is no older period to compare with; omitted → the
  // Product Performance wording.
  oldMissingText?: ReactNode;
  // The analysis' visual, drawn above its table — one section reads picture
  // first, then the numbers behind it.
  chart?: ReactNode;
}) {
  const rows = mergeRankings(rankings as ProductMetricRanking[]);

  const columns: DataColumn<MergedRankRow>[] = [
    { id: 'rank', label: '#', thStyle: RANK_TH, tdStyle: RANK_TD, sortValue: (_r, i) => i, render: (_r, i) => i + 1 },
    { id: 'produk', label: itemLabel, thStyle: PRODUK_TH, tdStyle: PRODUK_TD, sortValue: (r) => r.produk, render: (r) => r.produk },
  ];
  // Up to three metrics: each gets its value and %Chg columns under one
  // header. Four or more would not fit the card side by side, so each metric
  // becomes one column with its %Chg stacked under the value.
  const stacked = hasOld && rankings.length > 3;
  for (const ranking of rankings) {
    columns.push({
      id: ranking.metric,
      label: hasOld && !stacked ? p2 : ranking.label,
      group: hasOld && !stacked ? ranking.label : undefined,
      renamable: !hasOld || stacked,
      thStyle: NUM_TH,
      tdStyle: NUM_TD,
      sortValue: (r) => r.by[ranking.metric]?.cur ?? null,
      render: (r) => {
        const row = r.by[ranking.metric];
        const cur = row?.cur;
        const value = cur === null || cur === undefined ? '—' : fmtPivotVal(cur, ranking.fmt);
        if (!stacked) return value;
        return (
          <span className="dt-stack">
            <b>{value}</b>
            {row && <DeltaPill cls={row.cls}>{row.delta}</DeltaPill>}
          </span>
        );
      },
    });
    if (hasOld && !stacked) {
      columns.push({
        id: `${ranking.metric}__delta`,
        label: '%Chg',
        group: ranking.label,
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
          <div className="empty-note">{emptyText}</div>
        ) : !rows.length ? (
          <div className="empty-note">Tidak ada {itemLabel.toLowerCase()} dengan data pada periode ini.</div>
        ) : (
          <>
            {!hasOld && (
              <div className="empty-note" style={{ marginBottom: '.9rem' }}>
                {oldMissingText ?? (
                  <>
                    Hanya periode ini yang tersedia — ranking ditampilkan tanpa kolom %Perubahan. Upload Product Performance{' '}
                    <strong>periode lalu</strong> untuk melihat tren antar periode.
                  </>
                )}
              </div>
            )}
            {chart}
            <p className="chart-caption">
              Klik judul kolom mana pun untuk mengurutkan — {rankings.map((r) => r.label).join(', ')} berbagi satu tabel agar satu {itemLabel.toLowerCase()} bisa dibaca sekaligus.
              {stacked && ` Angka = ${p2}; di bawahnya perubahan dari ${p1}.`}
            </p>
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} />
          </>
        )}
      </div>
    </div>
  );
}

// ── A ranking's picture: one metric, top items, last period beside this one ─
// For the channel tabs, whose items (ads, ad groups, sessions) have absolute
// values worth comparing directly. Grey = last period, colour = this period;
// an item that did not run last period simply has no grey bar.

const RANKING_CHART_COUNT = 8;

export function RankingChart({
  rankings,
  hasOld,
  p1,
  p2,
  itemLabel,
  color,
}: {
  rankings: RankingLike[];
  hasOld: boolean;
  p1: string;
  p2: string;
  itemLabel: string;
  color: string;
}) {
  const [metric, setMetric] = useState(rankings[0]?.metric ?? '');
  const ranking = rankings.find((r) => r.metric === metric) ?? rankings[0];
  if (!ranking) return null;
  const shown = ranking.rows.filter((r) => r.cur !== null).slice(0, RANKING_CHART_COUNT);
  // One bar compares nothing — the table row says it all.
  if (shown.length < 2) return null;
  const series = [
    ...(hasOld ? [{ label: p1, values: shown.map((r) => r.old), color: '#cbd5e1' }] : []),
    { label: p2, values: shown.map((r) => r.cur), color },
  ];
  return (
    <div className="ranking-chart">
      {rankings.length > 1 && (
        <div className="chart-controls">
          <SegmentedToggle
            label="Metrik"
            options={rankings.map((r) => ({ value: r.metric, label: r.label }))}
            value={ranking.metric}
            onChange={setMetric}
            accent="var(--shopee-700)"
          />
        </div>
      )}
      <p className="chart-caption">
        {shown.length} {itemLabel.toLowerCase()} dengan <strong>{ranking.label}</strong> tertinggi {p2}
        {hasOld ? `, dibandingkan ${p1}` : ''}.
      </p>
      <GroupedBarChart
        labels={shown.map((r) => r.produk)}
        series={series}
        formatValue={(v) => fmtPivotVal(v, ranking.fmt)}
        height={300}
        ariaLabel={`${ranking.label} per ${itemLabel.toLowerCase()}`}
      />
    </div>
  );
}
