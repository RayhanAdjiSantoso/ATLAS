import { useMemo, useState } from 'react';
import { reorderIds, useInlineMetricEditor } from '../hooks/useInlineMetricEditor';
import { AGE_ORDER, agg, aggSum, displayName, fmt, groupByDim } from '../lib/meta';
import type { SheetRow } from '../lib/types';
import { MetricPicker } from './MetricPicker';
import { PIE_COLORS, PieChartCanvas } from './PieChartCanvas';
import { SectionDownloadButton } from './SectionDownloadButton';
import { SectionExcelButton } from './SectionExcelButton';

interface DemoBreakdownCardProps {
  heading: string;
  badge?: string;
  rows: SheetRow[];
  dimCol: string;
  allCols: string[];
  defaultCols: string[];
  headingClassName?: string;
}

// Ported from the original demoTable() + the pie-chart wiring in renderSection —
// Age/Gender Breakdown card: fixed default metrics, "+ Tambah metrik" picker,
// and an Amount Spent pie chart when that column is present.
export function DemoBreakdownCard({ heading, badge, rows, dimCol, allCols, defaultCols, headingClassName }: DemoBreakdownCardProps) {
  const [activeCols, setActiveCols] = useState<string[]>(defaultCols);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // `null` col means "sort by the dimension column itself" (Age/Gender).
  const [sort, setSort] = useState<{ col: string | null; dir: 'asc' | 'desc' } | null>(null);
  const resolveLabel = (c: string) => overrides[c] ?? displayName(c);

  const grouped = useMemo(() => groupByDim(rows, dimCol), [rows, dimCol]);
  const isAge = dimCol.toLowerCase().includes('age');
  const defaultOrderedLabels = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => {
      if (isAge) {
        const ia = AGE_ORDER.indexOf(a);
        const ib = AGE_ORDER.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
      }
      return a.localeCompare(b);
    });
  }, [grouped, isAge]);
  const labels = useMemo(() => {
    if (!sort) return defaultOrderedLabels;
    const withVal = defaultOrderedLabels.map((l) => ({ l, v: sort.col === null ? l : agg(grouped[l], sort.col) }));
    withVal.sort((a, b) => {
      if (a.v === null && b.v === null) return 0;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const cmp = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return withVal.map((r) => r.l);
  }, [defaultOrderedLabels, grouped, sort]);

  function toggleSort(col: string | null) {
    setSort((prev) => (prev && prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  }
  function sortIndicator(col: string | null): string {
    if (!sort || sort.col !== col) return '';
    return sort.dir === 'asc' ? ' ▲' : ' ▼';
  }

  const editor = useInlineMetricEditor({
    onRename: (id, newLabel) => setOverrides((prev) => ({ ...prev, [id]: newLabel })),
    onReorder: (fromId, toId) => setActiveCols((prev) => reorderIds(prev, fromId, toId)),
  });

  function handleRemove(c: string) {
    setActiveCols((prev) => prev.filter((x) => x !== c));
  }

  const spentColKey = labels.length ? Object.keys(grouped[labels[0]]?.[0] || {}).find((h) => h.toLowerCase().includes('amount spent')) : undefined;
  const pieLabels = labels.filter((l) => l.toLowerCase() !== 'unknown');
  const pieValues = spentColKey ? pieLabels.map((l) => aggSum(grouped[l], spentColKey) || 0) : [];
  const pieTotal = pieValues.reduce((a, b) => a + b, 0);

  if (!rows.length) return null;

  return (
    <div className="sec-block">
      <div className={`sec-heading${headingClassName ? ' ' + headingClassName : ''}`}>
        {heading}
        {badge && <span className="sec-badge">{badge}</span>}
        <SectionExcelButton />
        <SectionDownloadButton />
      </div>
      <MetricPicker allCols={allCols} activeCols={activeCols} onChange={setActiveCols} labelFn={resolveLabel} />
      <div style={{ padding: '0 1.4rem 1.4rem' }}>
        {spentColKey && (
          <div className="pie-wrap">
            <PieChartCanvas labels={pieLabels} values={pieValues} />
            <div>
              <div className="pie-caption">Amount Spent per {isAge ? 'Age' : 'Gender'}</div>
              <div className="pie-legend">
                {pieLabels.map((l, i) => {
                  const pct = pieTotal > 0 ? ((pieValues[i] / pieTotal) * 100).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '0';
                  return (
                    <div className="pie-legend-item" key={l}>
                      <div className="pie-legend-dot" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="pie-legend-label">{l}</span>
                      <span className="pie-legend-val">Rp{Math.round(pieValues[i]).toLocaleString('id-ID')}</span>
                      <span className="pie-legend-pct">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {!activeCols.length ? (
          <div className="empty-note" style={{ padding: '.5rem 0 0' }}>
            Klik "+ Tambah metrik" untuk menampilkan data.
          </div>
        ) : (
          <div className="tbl-scroll">
            <table className="demo-table">
              <thead>
                <tr>
                  <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(null)}>
                    {isAge ? 'Age' : 'Gender'}
                    {sortIndicator(null)}
                  </th>
                  {activeCols.map((c) => {
                    const isEditing = editor.editingId === c;
                    return (
                      <th
                        key={c}
                        className={`demo-th-editable${editor.dragClass(c)}`}
                        style={{ cursor: isEditing ? 'default' : 'pointer', userSelect: 'none', textAlign: 'left' }}
                        onClick={() => !isEditing && toggleSort(c)}
                        {...editor.dropZoneProps(c)}
                      >
                        {isEditing ? (
                          <input
                            className="demo-th-input"
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
                          <span className="demo-th-label-wrap">
                            <span
                              className="metric-drag-handle"
                              title="Tarik untuk mengubah urutan"
                              aria-label="Tarik untuk mengubah urutan"
                              onClick={(e) => e.stopPropagation()}
                              {...editor.dragHandleProps(c)}
                            >
                              ☰
                            </span>
                            <span
                              className="demo-th-label"
                              title="Klik untuk ganti nama"
                              onClick={(e) => {
                                e.stopPropagation();
                                editor.startEdit(c, resolveLabel(c));
                              }}
                            >
                              {resolveLabel(c)}
                            </span>
                            <button
                              type="button"
                              className="metric-remove-btn"
                              title="Hapus metrik"
                              aria-label="Hapus metrik"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemove(c);
                              }}
                            >
                              ×
                            </button>
                            {sortIndicator(c)}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {labels.map((l) => (
                  <tr key={l}>
                    <td>{l}</td>
                    {activeCols.map((c) => (
                      <td key={c} className="num">
                        {fmt(agg(grouped[l], c), c)}
                      </td>
                    ))}
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
