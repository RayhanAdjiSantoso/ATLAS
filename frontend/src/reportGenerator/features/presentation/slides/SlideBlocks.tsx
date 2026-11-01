import { formatCell, formatDelta, type FormatContext } from '../format';
import { chrome } from '../i18n';
import { kpiRowsPerPage } from '../plan';
import type { ChartBlock, DataBlock, DeltaCell, FunnelBlock, KpiBlock, RankedItem, TableBlock, TopBottomBlock } from '../types';
import { ChartLegend, SlideChart } from './SlideChart';

// One renderer per kind of data block. A block fits any region it is placed in,
// which is what lets a user swap a slide's layout without breaking it.

export interface RenderContext extends FormatContext {
  oldLabel: string;
  curLabel: string;
  // A saved report can compare other dates than the deck: its own periods then
  // head its columns, so a label never claims a period the numbers are not from.
  labelsFor: (block: DataBlock) => { old: string; cur: string };
  lazyCharts?: boolean;
}

function Delta({ delta, ctx }: { delta: DeltaCell | undefined; ctx: FormatContext }) {
  return <span className={`prs-delta prs-delta-${delta?.tone ?? 'neutral'}`}>{formatDelta(delta, ctx)}</span>;
}

function KpiView({ block, ctx, page }: { block: KpiBlock; ctx: RenderContext; page?: number }) {
  const { old, cur } = ctx.labelsFor(block);
  const perPage = kpiRowsPerPage(block.rows.length);
  const rows = page === undefined ? block.rows : block.rows.slice(page * perPage, (page + 1) * perPage);
  return (
    <table className="prs-table prs-kpi">
      <thead>
        <tr>
          <th>{chrome('metric', ctx.lang)}</th>
          <th className="num">{old}</th>
          <th className="num">{cur}</th>
          <th className="num">{chrome('changes', ctx.lang)}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="prs-name">{ctx.currency === 'MYR' ? r.label.replace('(IDR)', '(MYR)') : r.label}</td>
            <td className="num">{formatCell(r.old, ctx)}</td>
            <td className="num">{formatCell(r.cur, ctx)}</td>
            <td className="num"><Delta delta={r.delta} ctx={ctx} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function resolveColumn(label: string, labels: { old: string; cur: string }): string {
  return label.replace('{old}', labels.old).replace('{cur}', labels.cur);
}

function TableView({ block, ctx, page, perPage, compact }: { block: TableBlock; ctx: RenderContext; page: number; perPage: number; compact: boolean }) {
  const rows = perPage ? block.rows.slice(page * perPage, (page + 1) * perPage) : block.rows;
  const labels = ctx.labelsFor(block);
  // Half a slide cannot hold every column; the block says which ones matter most.
  const columns = compact ? block.columns.filter((c) => (block.compactColumns ?? block.columns.slice(0, 4).map((x) => x.key)).includes(c.key)) : block.columns;
  return (
    <table className="prs-table">
      <thead>
        <tr>
          <th>{block.nameLabel}</th>
          {columns.map((c) => <th className="num" key={c.key}>{resolveColumn(c.label, labels)}</th>)}
          {block.deltaLabel && !compact && <th className="num">{block.deltaLabel}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.name}-${i}`}>
            <td className="prs-name">{r.name}</td>
            {columns.map((c) => <td className="num" key={c.key}>{formatCell(r.cells[c.key], ctx)}</td>)}
            {block.deltaLabel && !compact && <td className="num"><Delta delta={r.delta} ctx={ctx} /></td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FunnelView({ block, ctx, compact }: { block: FunnelBlock; ctx: RenderContext; compact: boolean }) {
  const { old, cur } = ctx.labelsFor(block);
  return (
    <div className={`prs-funnel${compact ? ' is-compact' : ''}`}>
      <div className="prs-funnel-head">
        <span>{chrome('metric', ctx.lang)}</span>
        {!compact && <span className="num">{old}</span>}
        <span className="num">{cur}</span>
        <span className="num">{chrome('changes', ctx.lang)}</span>
      </div>
      {block.nodes.map((n, i) => (
        <div className={`prs-funnel-row d${Math.min(n.depth, 4)}`} key={`${n.label}-${i}`}>
          <span className="prs-funnel-name" style={{ paddingLeft: n.depth * 26 }}>
            {n.depth > 0 && <i aria-hidden="true" />}
            {n.label}
          </span>
          {!compact && <span className="num">{formatCell(n.old, ctx)}</span>}
          <span className="num">{formatCell(n.cur, ctx)}</span>
          <span className="num"><Delta delta={n.delta} ctx={ctx} /></span>
        </div>
      ))}
    </div>
  );
}

function Ranked({ title, items, tone, metric, ctx }: { title: string; items: RankedItem[]; tone: 'good' | 'bad'; metric: string; ctx: RenderContext }) {
  return (
    <div className={`prs-rank prs-rank-${tone}`}>
      <h4>{title}</h4>
      <table className="prs-table">
        <thead>
          <tr><th>#</th><th>&nbsp;</th><th className="num">{chrome('spend', ctx.lang)}</th><th className="num">{metric}</th></tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={`${it.name}-${i}`}>
              <td className="prs-rank-n">{i + 1}</td>
              <td className="prs-name">{it.name}</td>
              <td className="num">{formatCell(it.spend, ctx)}</td>
              <td className="num"><b>{formatCell(it.value, ctx)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopBottomView({ block, ctx }: { block: TopBottomBlock; ctx: RenderContext }) {
  return (
    <div className="prs-topbottom">
      <Ranked title={chrome('top', ctx.lang)} items={block.top} tone="good" metric={block.metric} ctx={ctx} />
      <Ranked title={chrome('bottom', ctx.lang)} items={block.bottom} tone="bad" metric={block.metric} ctx={ctx} />
    </div>
  );
}

function ChartView({ block, ctx }: { block: ChartBlock; ctx: RenderContext }) {
  const { old, cur } = ctx.labelsFor(block);
  const props = { block, ctx, oldLabel: old, curLabel: cur };
  if (block.chart === 'donut') {
    return (
      <div className="prs-donut">
        <SlideChart {...props} lazy={ctx.lazyCharts} />
        <ChartLegend {...props} />
      </div>
    );
  }
  return (
    <div className="prs-chart">
      <ChartLegend {...props} />
      <SlideChart {...props} lazy={ctx.lazyCharts} />
    </div>
  );
}

export function MissingData({ ctx }: { ctx: RenderContext }) {
  return (
    <div className="prs-missing">
      <b>{chrome('dataNotAvailable', ctx.lang)}</b>
      <span>{chrome('noData', ctx.lang)}</span>
    </div>
  );
}

export function BlockView({ block, ctx, page, perPage = 0, compact = false }: { block: DataBlock | undefined; ctx: RenderContext; page?: number; perPage?: number; compact?: boolean }) {
  if (!block) return <section className="prs-region"><MissingData ctx={ctx} /></section>;
  const note = block.note?.[ctx.lang];
  const rule = block.kind === 'topBottom' ? block.rule[ctx.lang] : null;
  return (
    <section className={`prs-region prs-region-${block.kind}`}>
      <h3 className="prs-region-title">{block.title[ctx.lang]}</h3>
      <div className="prs-region-body prs-check">
        {block.kind === 'kpi' && <KpiView block={block} ctx={ctx} page={page} />}
        {block.kind === 'table' && <TableView block={block} ctx={ctx} page={page ?? 0} perPage={perPage} compact={compact} />}
        {block.kind === 'funnel' && <FunnelView block={block} ctx={ctx} compact={compact} />}
        {block.kind === 'topBottom' && <TopBottomView block={block} ctx={ctx} />}
        {block.kind === 'chart' && <ChartView block={block} ctx={ctx} />}
      </div>
      {(note || rule) && <p className="prs-note">{rule ?? note}</p>}
    </section>
  );
}
