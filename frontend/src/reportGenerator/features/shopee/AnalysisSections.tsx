import { useState, type CSSProperties, type ReactNode } from 'react';
import { DeltaPill } from '../../components/DeltaPill';
import { KpiTable, type KpiRowDisplay } from '../../components/KpiTable';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SectionExcelButton } from '../../components/SectionExcelButton';
import { useInlineMetricEditor } from '../../hooks/useInlineMetricEditor';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import type { FunnelTreeRow, FunnelValueRow } from '../../lib/shopeeFunnel';
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
// Two panels shown side by side, exactly as in the reference workbook:
//   • Values — the full flat metric list, old vs cur vs %Change.
//   • Symptom Analysis — the 13 funnel nodes as an indented tree, each row
//     showing ONLY its %Change (the numbers live in the Values panel).

function SymptomTree({ rows }: { rows: FunnelTreeRow[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="kpi-table">
        <thead>
          <tr>
            <th style={{ width: 'auto', textAlign: 'left', whiteSpace: 'nowrap' }}>Node</th>
            <th style={NUM_TH}>%Chg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre', color: 'var(--muted)' }}>{r.prefix}</span>
                <span style={{ fontWeight: r.prefix === '' ? 700 : 500 }}>{r.label}</span>
              </td>
              <td style={NUM_TD}>
                <DeltaPill cls={r.cls}>{r.delta}</DeltaPill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FundamentalAnalysisSection({
  values,
  tree,
  liveGmv,
  p1,
  p2,
}: {
  values: FunnelValueRow[];
  tree: FunnelTreeRow[];
  liveGmv: { old: number; cur: number; hasData: boolean };
  p1: string;
  p2: string;
}) {
  const kpiRows: KpiRowDisplay[] = values.map((r) => ({
    id: r.key,
    label: r.label,
    old: fmtPivotVal(r.oldNum, r.fmt),
    cur: fmtPivotVal(r.curNum, r.fmt),
    delta: r.delta,
    cls: r.cls,
  }));

  const panelLabel: CSSProperties = { fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.5rem' };

  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        Fundamental Analysis <span className="sec-badge">Iklan Produk + Iklan Toko · funnel decomposition</span>
        <SectionExcelButton />
        <SectionDownloadButton />
      </div>
      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start', padding: '1.1rem 1.4rem 0' }}>
        <div style={{ flex: '2 1 440px', minWidth: 0 }}>
          <div style={panelLabel}>Values</div>
          <div style={{ overflowX: 'auto' }}>
            <KpiTable rows={kpiRows} p1={p1} p2={p2} />
          </div>
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 0 }}>
          <div style={panelLabel}>
            Symptom Analysis <span style={{ fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>· {p1} → {p2}</span>
          </div>
          <SymptomTree rows={tree} />
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
