import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { DeltaPill } from '../../components/DeltaPill';
import { KpiTable, type KpiRowDisplay } from '../../components/KpiTable';
import { MetricPicker } from '../../components/MetricPicker';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SectionExcelButton } from '../../components/SectionExcelButton';
import { reorderIds, useInlineMetricEditor } from '../../hooks/useInlineMetricEditor';
import { validateFormula } from '../../lib/formula';
import { DAILY_TREND_BUILTIN_METRICS, dailyTrendSelectionId, dailyTrendSelectionLabel, type DailyTrendMetricSelection, type DailyTrendPivotRow, type VariantPerformanceRow } from '../../lib/shopeeDeepDiveInsights';
import { ITEM_BUILTIN_METRICS, metricSelectionId, metricSelectionLabel, type KeywordPivotRow, type MetricSelection, type ProdukPivotRow } from '../../lib/shopeeDeepDiveItemPivot';
import { fmtPivotVal, type PivotFmt, type PivotRow } from '../../lib/shopeeDeepDivePivot';
import type { SheetRow } from '../../lib/types';

// ══════════════════════════════════════════════════════
// FASE 3 — SHOPEE DEEP-DIVE UI building blocks. Kept separate from
// ShopeeTab.tsx since that file is already large; these are pure
// presentational pieces driven entirely by ShopeeDeepDiveReport fields.
// ══════════════════════════════════════════════════════

// Rename/reorder/show-hide-and-readd for every metric row is handled
// entirely by KpiTable now (rows all default visible, matching the previous
// behavior of this section) — no local picker state needed here anymore.
export function ChannelPivotSection({ title, badge, rows, p1, p2 }: { title: string; badge: string; rows: PivotRow[]; p1: string; p2: string }) {
  const kpiRows: KpiRowDisplay[] = rows.map((r) => ({ id: r.key, label: r.label, old: r.old, cur: r.cur, delta: r.delta, cls: r.cls }));
  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        {title} <span className="sec-badge">{badge}</span>
        <SectionDownloadButton />
      </div>
      <KpiTable rows={kpiRows} p1={p1} p2={p2} emptyMessage="Semua metrik disembunyikan — pilih dari '+ Tambah metrik' untuk menampilkannya kembali." padded />
    </div>
  );
}

// ── Shared "N metric columns" table, reused by Per Produk, Per Keyword, and
// the daily trend pivot — all 3 are structurally the same shape (a few
// identity columns, then old/cur/%Chg per selected metric). Shows the first
// VISIBLE_ROWS rows by default; the rest are reached by scrolling the table
// body (the header stays pinned). The cap height is measured from the real
// rendered header + first rows rather than guessed in pixels, so it lands on
// exactly VISIBLE_ROWS regardless of column count, font, or row wrapping.
// ══════════════════════════════════════════════════════

const VISIBLE_ROWS = 10;

interface GenericMetricCell {
  id: string;
  label: string;
  fmt: PivotFmt;
  old: number | null;
  cur: number | null;
  deltaNum: number | null;
  delta: string;
  cls: string;
}

const TABLE_MAX_HEIGHT = 430; // header + ~10 body rows at the .kpi-table row height

// A sortable column is either one of the identity columns (by index) or one
// of {old, cur, %chg} for one of the selected metrics (by index).
type SortColumn = { kind: 'identity'; index: number } | { kind: 'metric'; index: number; field: 'old' | 'cur' | 'delta' };

function sameSortColumn(a: SortColumn, b: SortColumn): boolean {
  if (a.kind !== b.kind || a.index !== b.index) return false;
  return a.kind === 'identity' || (b.kind === 'metric' && a.field === b.field);
}

function MultiMetricTable<T extends { metrics: GenericMetricCell[] }>({
  rows,
  identityHeaders,
  identityRemovableIds,
  renderIdentity,
  identitySortKeys,
  rowKey,
  p1,
  p2,
  emptyMessage,
  labelOverrides,
  onRenameMetric,
  onRemoveMetric,
  onReorderMetrics,
}: {
  rows: T[];
  identityHeaders: string[];
  // Parallel to identityHeaders: an id for the (rare) identity columns that
  // are themselves removable pseudo-metrics (Per Produk's optional
  // Category/Series), null for fixed identity columns (Produk name,
  // Tanggal, Nama Iklan/Kata Pencarian) that always stay put.
  identityRemovableIds?: (string | null)[];
  renderIdentity: (row: T) => ReactNode[];
  // Parallel to renderIdentity, but returns raw comparable values (string or
  // number) instead of rendered nodes — defaults to renderIdentity's own
  // output stringified, which is fine for text columns but wrong for
  // numeric ones (e.g. day-of-month, where "10" must sort after "2").
  identitySortKeys?: (row: T) => (string | number)[];
  rowKey: (row: T, i: number) => string;
  p1: string;
  p2: string;
  emptyMessage: string;
  // Session-only rename applied on top of each metric column-group's own
  // built-in/formula label (id -> custom label), managed by the caller.
  labelOverrides?: Record<string, string>;
  // Rename/reorder happen directly on the metric column-group's own leading
  // header (no separate pill/list) — the caller owns where the override and
  // the new selection order actually live.
  onRenameMetric: (id: string, newLabel: string) => void;
  onRemoveMetric: (id: string) => void;
  onReorderMetrics: (fromId: string, toId: string) => void;
}) {
  const [sort, setSort] = useState<{ col: SortColumn; dir: 'asc' | 'desc' } | null>(null);
  const editor = useInlineMetricEditor({ onRename: onRenameMetric, onReorder: onReorderMetrics });

  // Cap the scroll area to exactly the header + first VISIBLE_ROWS rows,
  // measured from the live DOM so it's right no matter how tall a row wraps.
  // `undefined` = no cap (everything already fits).
  const scrollRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    function measure() {
      const table = scrollRef.current?.querySelector('table');
      const head = table?.tHead;
      const body = table?.tBodies[0];
      if (!head || !body) return;
      if (body.rows.length <= VISIBLE_ROWS) {
        setMaxHeight(undefined);
        return;
      }
      let h = head.getBoundingClientRect().height;
      for (let i = 0; i < VISIBLE_ROWS; i++) h += body.rows[i].getBoundingClientRect().height;
      setMaxHeight(Math.ceil(h) + 1);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [rows]);

  if (!rows.length) return <div className="empty-note">{emptyMessage}</div>;
  const metricMeta = rows[0].metrics.map((m) => ({ id: m.id, label: labelOverrides?.[m.id] ?? m.label }));

  function sortValue(row: T, col: SortColumn): string | number | null {
    if (col.kind === 'identity') {
      const keys = identitySortKeys ? identitySortKeys(row) : renderIdentity(row).map(String);
      return keys[col.index] ?? null;
    }
    const m = row.metrics[col.index];
    if (!m) return null;
    return col.field === 'old' ? m.old : col.field === 'cur' ? m.cur : m.deltaNum;
  }

  function handleHeaderClick(col: SortColumn) {
    setSort((prev) => (prev && sameSortColumn(prev.col, col) ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }));
  }

  function sortIndicator(col: SortColumn): string {
    if (!sort || !sameSortColumn(sort.col, col)) return '';
    return sort.dir === 'asc' ? ' ▲' : ' ▼';
  }

  const displayRows = sort
    ? [...rows].sort((a, b) => {
        const va = sortValue(a, sort.col);
        const vb = sortValue(b, sort.col);
        if (va === null && vb === null) return 0;
        if (va === null) return 1; // nulls (missing/empty cells) always sort last
        if (vb === null) return -1;
        const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
        return sort.dir === 'asc' ? cmp : -cmp;
      })
    : rows;

  const thStyle: CSSProperties = { cursor: 'pointer', userSelect: 'none' };

  return (
    <div ref={scrollRef} style={{ maxHeight, overflow: 'auto' }}>
      <table className="kpi-table metric-wide-table">
        <thead>
          <tr style={{ position: 'sticky', top: 0, background: 'var(--s2)', zIndex: 1 }}>
            {identityHeaders.map((h, i) => {
              const removableId = identityRemovableIds?.[i] ?? null;
              return (
                <th key={h} style={{ ...thStyle, textAlign: 'left' }} onClick={() => handleHeaderClick({ kind: 'identity', index: i })}>
                  {removableId ? (
                    <span className="metric-th-label-wrap">
                      <span>{h}</span>
                      <button
                        type="button"
                        className="metric-remove-btn"
                        title="Hapus kolom"
                        aria-label="Hapus kolom"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveMetric(removableId);
                        }}
                      >
                        ×
                      </button>
                      {sortIndicator({ kind: 'identity', index: i })}
                    </span>
                  ) : (
                    <>
                      {h}
                      {sortIndicator({ kind: 'identity', index: i })}
                    </>
                  )}
                </th>
              );
            })}
            {metricMeta.map((m, mi) => {
              const isEditing = editor.editingId === m.id;
              return (
                <Fragment key={m.id}>
                  <th
                    className={`metric-th-editable${editor.dragClass(m.id)}`}
                    style={{ ...thStyle, textAlign: 'left', cursor: isEditing ? 'default' : 'pointer' }}
                    onClick={() => !isEditing && handleHeaderClick({ kind: 'metric', index: mi, field: 'old' })}
                    {...editor.dropZoneProps(m.id)}
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
                      <span className="metric-th-label-wrap">
                        <span
                          className="metric-drag-handle"
                          title="Tarik untuk mengubah urutan"
                          aria-label="Tarik untuk mengubah urutan"
                          onClick={(e) => e.stopPropagation()}
                          {...editor.dragHandleProps(m.id)}
                        >
                          ☰
                        </span>
                        <span
                          className="demo-th-label"
                          title="Klik untuk ganti nama"
                          onClick={(e) => {
                            e.stopPropagation();
                            editor.startEdit(m.id, m.label);
                          }}
                        >
                          {m.label} {p1}
                        </span>
                        <button
                          type="button"
                          className="metric-remove-btn"
                          title="Hapus metrik"
                          aria-label="Hapus metrik"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveMetric(m.id);
                          }}
                        >
                          ×
                        </button>
                        {sortIndicator({ kind: 'metric', index: mi, field: 'old' })}
                      </span>
                    )}
                  </th>
                  <th style={{ ...thStyle, textAlign: 'left' }} onClick={() => handleHeaderClick({ kind: 'metric', index: mi, field: 'cur' })}>
                    {m.label} {p2}
                    {sortIndicator({ kind: 'metric', index: mi, field: 'cur' })}
                  </th>
                  <th style={{ ...thStyle, textAlign: 'left' }} onClick={() => handleHeaderClick({ kind: 'metric', index: mi, field: 'delta' })}>
                    %Chg {m.label}
                    {sortIndicator({ kind: 'metric', index: mi, field: 'delta' })}
                  </th>
                </Fragment>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {renderIdentity(r).map((cell, ci) => (
                <td key={ci}>{cell}</td>
              ))}
              {r.metrics.map((m) => (
                <Fragment key={m.id}>
                  <td className="num">{m.old === null ? '—' : fmtPivotVal(m.old, m.fmt)}</td>
                  <td className="num">{m.cur === null ? '—' : fmtPivotVal(m.cur, m.fmt)}</td>
                  <td>
                    <DeltaPill cls={m.cls}>{m.delta}</DeltaPill>
                  </td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A user-defined "custom metric" is just a MetricSelection of kind
// 'formula' — kept in ShopeeTab state (session-only, not persisted) and
// offered alongside the built-ins, since "custom metrik dengan perhitungan
// pada metrik yang tersedia" applies to every pivot's metric picker.
function CustomMetricForm({ varLegend, onCreate, onCancel }: { varLegend: string[]; onCreate: (sel: { kind: 'formula'; id: string; label: string; formula: string; fmt: PivotFmt }) => void; onCancel: () => void }) {
  const [label, setLabel] = useState('');
  const [formula, setFormula] = useState('');
  const [fmt, setFmt] = useState<PivotFmt>('num');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    if (!label.trim() || !formula.trim()) {
      setError('Nama dan formula wajib diisi.');
      return;
    }
    const err = validateFormula(formula, varLegend);
    if (err) {
      setError(err);
      return;
    }
    onCreate({ kind: 'formula', id: `custom-${Date.now()}`, label: label.trim(), formula: formula.trim(), fmt });
    setLabel('');
    setFormula('');
    setError(null);
  }

  return (
    <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '.8rem', marginTop: '.6rem', background: 'var(--s2)' }}>
      <div style={{ fontSize: '.72rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '.5rem' }}>
        Variabel yang bisa dipakai: {varLegend.join(', ')}. Operator: + − × (*) ÷ (/) dan tanda kurung. Contoh: <code>{varLegend[0]} / {varLegend[1] ?? varLegend[0]}</code>
      </div>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <input className="period-text-input" placeholder="Nama metrik" value={label} onChange={(e) => setLabel(e.target.value)} style={{ maxWidth: 200 }} />
        <input className="period-text-input" placeholder={`Formula, mis. ${varLegend[0]} / ${varLegend[1] ?? varLegend[0]}`} value={formula} onChange={(e) => setFormula(e.target.value)} style={{ minWidth: 260, flex: '1 1 260px' }} />
        <select className="custom-col-select" value={fmt} onChange={(e) => setFmt(e.target.value as PivotFmt)} style={{ maxWidth: 140 }}>
          <option value="num">Angka</option>
          <option value="rp">Rupiah</option>
          <option value="pct">Persen</option>
          <option value="roas">Rasio (x)</option>
        </select>
      </div>
      {error && (
        <div className="empty-note" style={{ color: '#dc2626', paddingTop: '.4rem' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: '.5rem', marginTop: '.6rem' }}>
        <button type="button" className="btn btn-primary" onClick={handleSubmit}>
          Simpan Metrik
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Batal
        </button>
      </div>
    </div>
  );
}

// Toggle between the per-produk and per-keyword item pivots — the dominant
// channel (per detectDominantChannel) opens by default, but both stay
// reachable via this pill switch (Step 5: "SELALU bangun KEDUA pivot").
// Both sides now use the same multi-select metric picker (Step 1's request
// that Per Produk work like Per Keyword), drawing from the same built-in +
// custom-formula metric pool.
const PRODUK_IDENTITY_COLS: readonly { id: string; label: string }[] = [
  { id: 'category', label: 'Category' },
  { id: 'series', label: 'Series' },
];

export function ItemPivotSection({
  produkRows,
  produkSelections,
  onProdukSelectionsChange,
  keywordRows,
  hasKeywordData,
  keywordSelections,
  onKeywordSelectionsChange,
  customMetrics,
  onAddCustomMetric,
  activeTab,
  onTabChange,
  p1,
  p2,
}: {
  produkRows: ProdukPivotRow[];
  produkSelections: readonly MetricSelection[];
  onProdukSelectionsChange: (sels: MetricSelection[]) => void;
  keywordRows: KeywordPivotRow[];
  hasKeywordData: boolean;
  keywordSelections: readonly MetricSelection[];
  onKeywordSelectionsChange: (sels: MetricSelection[]) => void;
  customMetrics: MetricSelection[];
  onAddCustomMetric: (sel: MetricSelection) => void;
  activeTab: 'produk' | 'keyword';
  onTabChange: (tab: 'produk' | 'keyword') => void;
  p1: string;
  p2: string;
}) {
  const [showCustomForm, setShowCustomForm] = useState(false);
  // Session-only rename, shared across the Per Produk/Per Keyword tabs since
  // they draw from the same metric id space (e.g. 'biaya' means the same
  // thing in both).
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // Category/Series are optional identity columns on the Per Produk table
  // only (Step 2's request) — a purely local display toggle, kept here since
  // there's only one instance.
  const [produkIdentityCols, setProdukIdentityCols] = useState<string[]>(PRODUK_IDENTITY_COLS.map((c) => c.id));
  const allSelections: MetricSelection[] = [...ITEM_BUILTIN_METRICS.map((m): MetricSelection => ({ kind: 'builtin', key: m.key })), ...customMetrics];
  const byId = new Map(allSelections.map((s) => [metricSelectionId(s), s]));
  const activeSelections = activeTab === 'produk' ? produkSelections : keywordSelections;
  const onActiveChange = activeTab === 'produk' ? onProdukSelectionsChange : onKeywordSelectionsChange;

  function handleCreate(sel: MetricSelection) {
    onAddCustomMetric(sel);
    setShowCustomForm(false);
    onActiveChange([...activeSelections, sel]);
  }

  // On Per Produk, Category/Series ride along in the very same picker as
  // the metrics (not a second, separate control) — the picker just also
  // knows about 2 extra "pseudo-metric" ids that toggle identity columns
  // instead of adding a metric column-group.
  const identityOptionIds = activeTab === 'produk' ? PRODUK_IDENTITY_COLS.map((c) => c.id) : [];
  const pickerAllCols = [...allSelections.map((s) => metricSelectionId(s)), ...identityOptionIds];
  const pickerActiveCols = [...activeSelections.map((s) => metricSelectionId(s)), ...(activeTab === 'produk' ? produkIdentityCols : [])];

  function handlePickerChange(ids: string[]) {
    if (activeTab === 'produk') {
      setProdukIdentityCols(ids.filter((id) => identityOptionIds.includes(id)));
      onActiveChange(
        ids
          .filter((id) => !identityOptionIds.includes(id))
          .map((id) => byId.get(id))
          .filter((s): s is MetricSelection => Boolean(s)),
      );
    } else {
      onActiveChange(ids.map((id) => byId.get(id)).filter((s): s is MetricSelection => Boolean(s)));
    }
  }

  function pickerLabel(id: string): string {
    if (overrides[id]) return overrides[id];
    const identityCol = PRODUK_IDENTITY_COLS.find((c) => c.id === id);
    if (identityCol) return identityCol.label;
    return byId.get(id) ? metricSelectionLabel(byId.get(id)!) : id;
  }

  const activeIdentityCols = PRODUK_IDENTITY_COLS.filter((c) => produkIdentityCols.includes(c.id));
  const produkIdentityHeaders = ['Produk', ...activeIdentityCols.map((c) => pickerLabel(c.id))];
  const produkIdentityRemovableIds: (string | null)[] = [null, ...activeIdentityCols.map((c) => c.id)];
  function renderProdukIdentity(r: ProdukPivotRow) {
    const cells: ReactNode[] = [r.cleanName];
    if (produkIdentityCols.includes('category')) cells.push(r.category);
    if (produkIdentityCols.includes('series')) cells.push(r.series);
    return cells;
  }

  // Rename applies uniformly regardless of whether the id is a real metric
  // or one of Per Produk's Category/Series pseudo-metric identity columns.
  function handleRenameMetric(id: string, newLabel: string) {
    setOverrides((prev) => ({ ...prev, [id]: newLabel }));
  }

  function handleRemoveMetric(id: string) {
    if (activeTab === 'produk' && identityOptionIds.includes(id)) {
      setProdukIdentityCols((prev) => prev.filter((x) => x !== id));
      return;
    }
    onActiveChange(activeSelections.filter((s) => metricSelectionId(s) !== id));
  }

  function handleReorderMetrics(fromId: string, toId: string) {
    if (activeTab === 'produk' && identityOptionIds.includes(fromId) && identityOptionIds.includes(toId)) {
      setProdukIdentityCols((prev) => reorderIds(prev, fromId, toId));
      return;
    }
    const ids = activeSelections.map((s) => metricSelectionId(s));
    const bySelId = new Map(activeSelections.map((s) => [metricSelectionId(s), s]));
    onActiveChange(
      reorderIds(ids, fromId, toId)
        .map((id) => bySelId.get(id))
        .filter((s): s is MetricSelection => Boolean(s)),
    );
  }

  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        Analisis Per Item <span className="sec-badge">Iklan Toko + Iklan Produk</span>
        <SectionExcelButton />
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '1rem 1.4rem 0', display: 'flex', gap: '.5rem' }}>
        <button type="button" className={`ind-pill${activeTab === 'produk' ? ' selected' : ''}`} onClick={() => onTabChange('produk')}>
          <span className="ind-pill-dot" />
          Per Produk (Iklan Produk)
        </button>
        {hasKeywordData && (
          <button type="button" className={`ind-pill${activeTab === 'keyword' ? ' selected' : ''}`} onClick={() => onTabChange('keyword')}>
            <span className="ind-pill-dot" />
            Per Keyword (Iklan Toko)
          </button>
        )}
      </div>
      <div style={{ padding: '1rem 1.4rem 0', display: 'flex', gap: '.6rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <MetricPicker allCols={pickerAllCols} activeCols={pickerActiveCols} onChange={handlePickerChange} labelFn={pickerLabel} dense />
        <button type="button" className="mpill mpill-add" onClick={() => setShowCustomForm((v) => !v)}>
          {showCustomForm ? '✕ Batal metrik custom' : '+ Buat metrik custom'}
        </button>
      </div>
      {showCustomForm && (
        <div style={{ padding: '0 1.4rem' }}>
          <CustomMetricForm varLegend={ITEM_BUILTIN_METRICS.map((m) => m.key)} onCreate={handleCreate} onCancel={() => setShowCustomForm(false)} />
        </div>
      )}
      <div style={{ padding: '1rem 1.4rem 1.4rem' }}>
        {activeTab === 'produk' ? (
          <MultiMetricTable
            rows={produkRows}
            identityHeaders={produkIdentityHeaders}
            identityRemovableIds={produkIdentityRemovableIds}
            renderIdentity={renderProdukIdentity}
            rowKey={(r) => r.cleanName}
            p1={p1}
            p2={p2}
            emptyMessage="Tidak ada data produk."
            labelOverrides={overrides}
            onRenameMetric={handleRenameMetric}
            onRemoveMetric={handleRemoveMetric}
            onReorderMetrics={handleReorderMetrics}
          />
        ) : (
          <MultiMetricTable
            rows={keywordRows}
            identityHeaders={['Nama Iklan', 'Kata Pencarian']}
            renderIdentity={(r) => [r.namaIklan, r.kataPencarian]}
            rowKey={(r, i) => r.namaIklan + '|' + r.kataPencarian + i}
            p1={p1}
            p2={p2}
            emptyMessage="Tidak ada data keyword."
            labelOverrides={overrides}
            onRenameMetric={handleRenameMetric}
            onRemoveMetric={handleRemoveMetric}
            onReorderMetrics={handleReorderMetrics}
          />
        )}
      </div>
    </div>
  );
}

// Inline "complete the mapping" form — Step 2's requirement that unmatched
// products are shown (never dropped) with a way to fix the mapping right
// there, since this tool's users won't understand a separate admin page.
export function UncategorizedPanel({ names, onSave }: { names: string[]; onSave: (name: string, category: string, series: string) => Promise<void> }) {
  if (!names.length) return null;
  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        Produk Belum Terkategori <span className="sec-badge">{names.length} produk</span>
      </div>
      <div style={{ padding: '.6rem 1.4rem 1.4rem' }}>
        <div className="empty-note" style={{ paddingBottom: '.8rem' }}>
          Nama iklan berikut belum cocok dengan kategori/series manapun. Isi lalu simpan untuk melengkapi pemetaannya — laporan akan otomatis diperbarui.
        </div>
        {/* Capped to ~10 visible rows with an internal scroll for the rest. */}
        <div style={{ maxHeight: TABLE_MAX_HEIGHT, overflow: 'auto' }}>
          {names.map((name) => (
            <UncategorizedRow key={name} name={name} onSave={onSave} />
          ))}
        </div>
      </div>
    </div>
  );
}

function UncategorizedRow({ name, onSave }: { name: string; onSave: (name: string, category: string, series: string) => Promise<void> }) {
  const [category, setCategory] = useState('');
  const [series, setSeries] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (!category.trim()) return;
    setSaving(true);
    try {
      await onSave(name, category.trim(), series.trim());
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', padding: '.5rem 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 260px', fontSize: '.82rem', fontWeight: 600 }}>{name}</div>
      <input className="period-text-input" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 160 }} disabled={saved} />
      <input className="period-text-input" placeholder="Series" value={series} onChange={(e) => setSeries(e.target.value)} style={{ maxWidth: 160 }} disabled={saved} />
      <button type="button" className="btn btn-ghost" disabled={saving || saved || !category.trim()} onClick={handleSave}>
        {saved ? 'Tersimpan ✓' : saving ? 'Menyimpan…' : 'Simpan'}
      </button>
    </div>
  );
}

// Only rendered when a Product Performance file was actually uploaded — an
// empty `rows` array is ambiguous between "no file" and "file uploaded, but
// everything that sells is already advertised", so the caller passes
// `hasFile` explicitly instead of inferring it from rows.length.
export function UnadvertisedVariantsTable({ rows, hasFile }: { rows: VariantPerformanceRow[]; hasFile: boolean }) {
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);
  if (!hasFile) return null;
  const displayRows = sortDir ? [...rows].sort((a, b) => (sortDir === 'asc' ? a.penjualanSiapDikirim - b.penjualanSiapDikirim : b.penjualanSiapDikirim - a.penjualanSiapDikirim)) : rows;
  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        Laku tapi Belum Pernah Diiklankan <span className="sec-badge">Product Performance</span>
        <SectionExcelButton />
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '.6rem 1.4rem 1.4rem' }}>
        {!rows.length ? (
          <div className="empty-note">Tidak ada — semua produk/varian yang laku sudah pernah diiklankan di salah satu channel.</div>
        ) : (
          <div style={{ maxHeight: TABLE_MAX_HEIGHT, overflow: 'auto' }}>
            <table className="kpi-table">
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: 'var(--s2)', zIndex: 1 }}>
                  <th style={{ textAlign: 'left' }}>Produk</th>
                  <th style={{ textAlign: 'left' }}>Varian</th>
                  <th>Kode Produk</th>
                  <th
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                  >
                    Penjualan (Siap Dikirim){sortDir ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((r, i) => (
                  <tr key={r.kodeProduk + '|' + r.kodeVariasi + i}>
                    <td>{r.produk}</td>
                    <td style={{ textAlign: 'left' }}>{r.namaVariasi}</td>
                    <td>{r.kodeProduk}</td>
                    <td>{fmtPivotVal(r.penjualanSiapDikirim, 'rp')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Only rendered by the caller when non-empty (the real sample file has this
// sheet empty — spec: "kalau ternyata berisi data ... tampilkan juga").
// Columns aren't fixed ahead of time, so every key present is shown as-is.
export function TingkatkanDenganIklanTable({ rows }: { rows: SheetRow[] }) {
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]);
  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        Tingkatkan dengan Iklan <span className="sec-badge">Product Performance · referensi silang</span>
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '.6rem 1.4rem 1.4rem', overflowX: 'auto' }}>
        <table className="kpi-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} style={{ textAlign: 'left' }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} style={{ textAlign: 'left' }}>
                    {String(r[c] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Tren Harian Toko — a single side-by-side pivot (day-of-month | metric p1 |
// metric p2 | %Chg, per selected metric), same shape/scroll/metric-picker
// pattern as the item pivots above instead of two separate stacked tables.
export function DailyTrendSection({
  rows,
  selections,
  onSelectionsChange,
  p1,
  p2,
}: {
  rows: DailyTrendPivotRow[];
  selections: readonly DailyTrendMetricSelection[];
  onSelectionsChange: (sels: DailyTrendMetricSelection[]) => void;
  p1: string;
  p2: string;
}) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  if (!rows.length) return null;
  const allSelections: DailyTrendMetricSelection[] = DAILY_TREND_BUILTIN_METRICS.map((m) => ({ kind: 'builtin', key: m.key }));
  const byId = new Map(allSelections.map((s) => [dailyTrendSelectionId(s), s]));

  function handleReorderMetrics(fromId: string, toId: string) {
    const ids = selections.map((s) => dailyTrendSelectionId(s));
    onSelectionsChange(
      reorderIds(ids, fromId, toId)
        .map((id) => byId.get(id))
        .filter((s): s is DailyTrendMetricSelection => Boolean(s)),
    );
  }

  return (
    <div className="sec-block">
      <div className="sec-heading shopee-heading">
        Tren Harian Toko <span className="sec-badge">Product Overview</span>
        <SectionExcelButton />
        <SectionDownloadButton />
      </div>
      <div style={{ padding: '1rem 1.4rem 0', display: 'flex', gap: '.6rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <MetricPicker
          allCols={allSelections.map((s) => dailyTrendSelectionId(s))}
          activeCols={selections.map((s) => dailyTrendSelectionId(s))}
          onChange={(ids) => onSelectionsChange(ids.map((id) => byId.get(id)).filter((s): s is DailyTrendMetricSelection => Boolean(s)))}
          labelFn={(id) => overrides[id] ?? (byId.get(id) ? dailyTrendSelectionLabel(byId.get(id)!) : id)}
        />
      </div>
      <div style={{ padding: '1rem 1.4rem 1.4rem' }}>
        <MultiMetricTable
          rows={rows}
          identityHeaders={['Tanggal']}
          renderIdentity={(r) => [String(r.day)]}
          identitySortKeys={(r) => [r.day]}
          rowKey={(r) => String(r.day)}
          p1={p1}
          p2={p2}
          emptyMessage="Tidak ada data tren harian."
          labelOverrides={overrides}
          onRenameMetric={(id, v) => setOverrides((prev) => ({ ...prev, [id]: v }))}
          onRemoveMetric={(id) => onSelectionsChange(selections.filter((s) => dailyTrendSelectionId(s) !== id))}
          onReorderMetrics={handleReorderMetrics}
        />
      </div>
    </div>
  );
}
