import { KpiTable, type KpiRowDisplay } from './KpiTable';
import { SectionDownloadButton } from './SectionDownloadButton';

// A row already resolved for display, plus the raw column key the metric
// picker uses to match it against allCols/activeCols.
export interface DetailedRow extends KpiRowDisplay {
  col: string;
}

interface OverviewDetailedCardProps {
  heading: string;
  badge?: string;
  overviewRows: KpiRowDisplay[];
  detailedRows: DetailedRow[];
  allCols: string[];
  p1: string;
  p2: string;
  headingClassName?: string;
}

// Shared by Meta (Boost/Non-Boost/CPAS) and Shopee Ads: a single table
// combining the fixed default metrics with whatever extra metrics the user
// adds via "+ Tambah metrik" — Overview and Detailed used to be two separate
// stacked tables, now unified into one. Rename/reorder/remove-and-readd for
// every row (default or added) is handled entirely by KpiTable itself: every
// row here already carries its own resolved `.label` (from
// displayName()/shopeeLabelFor upstream), so the full universe can be handed
// straight to KpiTable with no separate label-resolution step needed here.
export function OverviewDetailedCard({ heading, badge, overviewRows, detailedRows, allCols, p1, p2, headingClassName }: OverviewDetailedCardProps) {
  if (!overviewRows.length && !detailedRows.length) return null;

  // overviewRows' underlying `col` (present on every row except a computed
  // Cost-per-X row, which has no single raw column — its `label` doubles as
  // a stable id in that case) is excluded from the extra pool so a default
  // metric can't appear twice.
  const overviewCols = new Set((overviewRows as (KpiRowDisplay & { col?: string })[]).map((r) => r.col).filter((c): c is string => Boolean(c)));
  const overviewIds = overviewRows.map((r) => (r as KpiRowDisplay & { col?: string }).col ?? r.label);
  const extraRows = detailedRows.filter((r) => !overviewCols.has(r.col) && allCols.includes(r.col));
  const rows: KpiRowDisplay[] = [
    ...overviewRows.map((r) => ({ ...r, id: (r as KpiRowDisplay & { col?: string }).col ?? r.label })),
    ...extraRows.map((r) => ({ ...r, id: r.col })),
  ];

  return (
    <div className="sec-block">
      <div className={`sec-heading${headingClassName ? ' ' + headingClassName : ''}`}>
        {heading}
        {badge && <span className="sec-badge">{badge}</span>}
        <SectionDownloadButton />
      </div>
      <KpiTable rows={rows} defaultVisibleIds={overviewIds} p1={p1} p2={p2} emptyMessage="Tidak ada data." padded />
    </div>
  );
}
