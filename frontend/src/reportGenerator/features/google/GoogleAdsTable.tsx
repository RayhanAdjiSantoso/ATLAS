import { useState, type ReactNode } from 'react';

export interface GadsColumn<T> {
  key: string;
  label: string;
  value: (row: T) => number | string | null;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right';
}

interface GoogleAdsTableProps<T> {
  columns: GadsColumn<T>[];
  rows: T[];
  sortKey: string;
  sortDir?: 'asc' | 'desc';
  // Rows shown before "Tampilkan semua"; the rest stay one click away, the
  // way Looker pages a table instead of cutting it.
  limit?: number;
  numbered?: boolean;
  emptyMessage?: string;
}

// A sortable metric table for the Google Ads report. Click a header to sort
// by it (again to flip). Null values always sink to the bottom, so sorting a
// cost-per-conversion column never puts the "—" rows first.
export function GoogleAdsTable<T>({ columns, rows, sortKey, sortDir = 'desc', limit, numbered, emptyMessage }: GoogleAdsTableProps<T>) {
  const [sort, setSort] = useState({ key: sortKey, dir: sortDir });
  const [expanded, setExpanded] = useState(false);
  const col = columns.find((c) => c.key === sort.key) ?? columns[0];

  const sorted = [...rows].sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return sort.dir === 'asc' ? cmp : -cmp;
  });
  const shown = limit && !expanded ? sorted.slice(0, limit) : sorted;

  if (!rows.length) return <div className="empty-note" style={{ margin: '1.1rem 1.4rem 1.4rem' }}>{emptyMessage ?? 'Tidak ada data pada periode ini.'}</div>;

  return (
    <>
      <div className="gads-table-scroll">
        <table className="kpi-table metric-wide-table gads-table">
          <thead>
            <tr>
              {numbered && <th className="gads-num-col">#</th>}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.align === 'left' ? 'is-left' : ''}
                  aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' }))}
                >
                  {c.label}
                  {sort.key === c.key && <span className="gads-sort" aria-hidden>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i}>
                {numbered && <td className="gads-num-col">{i + 1}.</td>}
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'left' ? 'is-left' : ''}>
                    {c.render ? c.render(row) : (c.value(row) ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit && rows.length > limit && (
        <div className="gads-table-foot">
          <span>{expanded ? `${rows.length} baris` : `${limit} dari ${rows.length} baris`}</span>
          <button type="button" className="gads-more" onClick={() => setExpanded((e) => !e)}>
            {expanded ? `Tampilkan ${limit} teratas` : 'Tampilkan semua'}
          </button>
        </div>
      )}
    </>
  );
}
