import { useState } from 'react';
import { reorderIds, useInlineMetricEditor } from '../hooks/useInlineMetricEditor';
import type { DeltaClassName } from '../lib/types';
import { DeltaPill } from './DeltaPill';
import { MetricPicker } from './MetricPicker';

export interface KpiRowDisplay {
  // Stable identity for rename/reorder/remove — falls back to `label` when
  // omitted, which is safe since every existing table's labels are already
  // unique within that table.
  id?: string;
  label: string;
  old: string;
  cur: string;
  delta: string;
  cls: DeltaClassName;
  // Business/Summary Overview's per-channel tables append a bold "Total" row
  // (ported from the original's inline `style="font-weight:700;border-top:..."`).
  // Total rows are computed aggregates, not user metrics — excluded from
  // rename/reorder/remove entirely and always pinned at the bottom.
  isTotal?: boolean;
}

interface KpiTableProps {
  rows: KpiRowDisplay[];
  // Which rows are visible on first render (by id) — omit to show everything.
  // `rows` itself is always the full universe the "+ Tambah metrik" picker
  // can add back from once a row's been removed.
  defaultVisibleIds?: string[];
  p1: string;
  p2: string;
  emptyMessage?: string;
  // When true, this table owns its own section padding (no wrapping padded
  // div from the caller) — used by callers that render KpiTable directly as
  // a sec-block's only body content (OverviewDetailedCard, ChannelPivotSection).
  padded?: boolean;
}

const TOTAL_ROW_STYLE = { fontWeight: 700, borderTop: '2px solid var(--border)' };

function rowId(r: KpiRowDisplay): string {
  return r.id ?? r.label;
}

// Ported from the original kpiTableWithPrev (label + both periods + Changes) —
// the only table shape actually used by the current report (the plain
// single-period kpiTable variant was dead code in the original, unreachable
// from generate()). Every row-form metric table in the app now shares this
// engine directly: click a row's label to rename it inline, hover to reveal
// the remove (×) affordance, drag the ☰ handle to move the row to a new
// position. Removed rows go back into "+ Tambah metrik".
export function KpiTable({ rows, defaultVisibleIds, p1, p2, emptyMessage, padded }: KpiTableProps) {
  const metricRows = rows.filter((r) => !r.isTotal);
  const totalRow = rows.find((r) => r.isTotal);
  const rowById = new Map(metricRows.map((r) => [rowId(r), r]));
  const allIds = metricRows.map(rowId);

  const [order, setOrder] = useState<string[]>(() => (defaultVisibleIds ? defaultVisibleIds.filter((id) => rowById.has(id)) : allIds));
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const visibleOrder = order.filter((id) => rowById.has(id));
  const visibleRows = visibleOrder.map((id) => rowById.get(id)!);
  const resolveLabel = (id: string) => overrides[id] ?? rowById.get(id)?.label ?? id;

  const editor = useInlineMetricEditor({
    onRename: (id, newLabel) => setOverrides((prev) => ({ ...prev, [id]: newLabel })),
    onReorder: (fromId, toId) => setOrder((prev) => reorderIds(prev, fromId, toId)),
  });

  function handleRemove(id: string) {
    setOrder((prev) => prev.filter((c) => c !== id));
  }

  const tableBody =
    !visibleRows.length && !totalRow ? (
      <div className="empty-note">{emptyMessage || 'Tidak ada data.'}</div>
    ) : (
      <table className="kpi-table">
        <thead>
          <tr>
            <th></th>
            <th>{p1}</th>
            <th>{p2}</th>
            <th>Changes</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((r) => {
            const id = rowId(r);
            const isEditing = editor.editingId === id;
            return (
              <tr key={id} className={`kpi-row-editable${editor.dragClass(id)}`} {...editor.dropZoneProps(id)}>
                <td>
                  {isEditing ? (
                    <input
                      className="kpi-row-input"
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
                    <span className="kpi-row-label-wrap">
                      <span
                        className="metric-drag-handle"
                        title="Tarik untuk mengubah urutan"
                        aria-label="Tarik untuk mengubah urutan"
                        {...editor.dragHandleProps(id)}
                      >
                        ☰
                      </span>
                      <span className="kpi-row-label" title="Klik untuk ganti nama" onClick={() => editor.startEdit(id, resolveLabel(id))}>
                        {resolveLabel(id)}
                      </span>
                      <button
                        type="button"
                        className="metric-remove-btn"
                        title="Hapus metrik"
                        aria-label="Hapus metrik"
                        onClick={() => handleRemove(id)}
                      >
                        ×
                      </button>
                    </span>
                  )}
                </td>
                <td className="num">{r.old}</td>
                <td className="num">{r.cur}</td>
                <td>
                  <DeltaPill cls={r.cls}>{r.delta}</DeltaPill>
                </td>
              </tr>
            );
          })}
          {totalRow && (
            <tr style={TOTAL_ROW_STYLE}>
              <td>{totalRow.label}</td>
              <td className="num">{totalRow.old}</td>
              <td className="num">{totalRow.cur}</td>
              <td>
                <DeltaPill cls={totalRow.cls}>{totalRow.delta}</DeltaPill>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );

  return (
    <>
      {allIds.length > 0 && <MetricPicker allCols={allIds} activeCols={visibleOrder} onChange={setOrder} labelFn={resolveLabel} dense={!padded} />}
      {padded ? <div style={{ padding: '0 1.4rem 1.4rem' }}>{tableBody}</div> : tableBody}
    </>
  );
}
