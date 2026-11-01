import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeDelta, deltaClassForSentiment } from '../../../lib/delta';
import { formatCell, formatDelta, parseCell, parseDelta, type FormatContext } from '../format';
import { FIELD_TITLE, chrome } from '../i18n';
import { LAYOUTS } from '../plan';
import type { ActionItem, DataBlock, NarrativeField, PresentationDocument, SlideDoc, Snapshot, SupportingImage } from '../types';
import { fetchAssetDataUrl } from '../api';
import { BlockView, type RenderContext } from './SlideBlocks';
import './slides.css';

// The 14 slide templates. Every slide is the same fixed 1920×1080 stage with one
// header and one footer; a layout only decides how data blocks and narrative share
// the body. The preview and the PDF draw this same component, so they cannot drift.

export const STAGE_W = 1920;
export const STAGE_H = 1080;

export function renderContext(doc: PresentationDocument, snapshot: Snapshot | null, lazyCharts = false): RenderContext {
  const { lang, currency, period } = doc.config;
  const bySource = new Map((snapshot?.sources ?? []).map((s) => [s.source, s]));
  return {
    lang, currency, lazyCharts,
    oldLabel: period.oldLabel,
    curLabel: period.curLabel,
    labelsFor: (block: DataBlock) => {
      const source = bySource.get(block.source);
      return source?.periodMismatch && source.periodOld && source.periodCur
        ? { old: source.periodOld, cur: source.periodCur }
        : { old: period.oldLabel, cur: period.curLabel };
    },
  };
}

function MilLogo({ color, tile }: { color: string; tile?: boolean }) {
  return (
    <span className={`prs-logo${tile ? ' is-tile' : ''}`} style={{ color }}>
      <svg viewBox="96 50 328 358" width="30" height="33" aria-hidden="true">
        <g fill={color}>
          <rect x="120" y="300" width="52" height="92" rx="20" />
          <rect x="196" y="244" width="52" height="148" rx="20" />
          <rect x="272" y="188" width="52" height="204" rx="20" />
          <rect x="348" y="132" width="52" height="260" rx="20" />
          <circle cx="374" cy="96" r="30" />
        </g>
      </svg>
      <span>MIL Digital</span>
    </span>
  );
}

// An image, not inline SVG: html2canvas loses an inline gradient stroke, and the
// mark vanished from the PDF while the preview still showed it.
const SWOOSH = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1080" viewBox="0 0 1000 1080"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2f7be8"/><stop offset="1" stop-color="#00e0c6"/></linearGradient></defs><path d="M120 1080 V640 C120 560 200 520 270 580 L480 760 C520 795 560 790 590 750 L1000 200" fill="none" stroke="url(#g)" stroke-width="96" stroke-linecap="round"/></svg>')}`;

function Swoosh() {
  return <img className="prs-swoosh" src={SWOOSH} alt="" />;
}

function Points({ field, slide, lang, hint }: { field: NarrativeField; slide: SlideDoc; lang: FormatContext['lang']; hint?: boolean }) {
  if (slide.hiddenFields.includes(field)) return null;
  const points = slide.narrative[field].filter((p) => p.text.trim());
  if (!points.length && !hint) return null;
  return (
    <div className={`prs-points prs-points-${field}`}>
      <h4>{FIELD_TITLE[field][lang]}</h4>
      {points.length ? (
        <ul>{points.map((p) => <li key={p.id}>{p.text}</li>)}</ul>
      ) : (
        <p className="prs-hint">Belum diisi. Baris ini tidak ikut ke PDF.</p>
      )}
    </div>
  );
}

function hasPoints(slide: SlideDoc, fields: NarrativeField[]) {
  return fields.some((f) => !slide.hiddenFields.includes(f) && slide.narrative[f].some((p) => p.text.trim()));
}

const PRIORITY_RANK: Record<ActionItem['priority'], number> = { High: 0, Medium: 1, Low: 2 };

function ActionTable({ items, ctx }: { items: ActionItem[]; ctx: RenderContext }) {
  const showTarget = items.some((a) => a.targetDate);
  const showStatus = items.some((a) => a.status);
  const pr = { High: chrome('high', ctx.lang), Medium: chrome('medium', ctx.lang), Low: chrome('low', ctx.lang) };
  return (
    <table className="prs-table prs-actions">
      <thead>
        <tr>
          <th>{chrome('action', ctx.lang)}</th>
          <th>{chrome('owner', ctx.lang)}</th>
          <th>{chrome('priority', ctx.lang)}</th>
          {showTarget && <th>{chrome('target', ctx.lang)}</th>}
          {showStatus && <th>{chrome('status', ctx.lang)}</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((a) => (
          <tr key={a.id}>
            <td className="prs-action-text">{a.action}</td>
            <td>{a.owner}</td>
            <td><span className={`prs-pri prs-pri-${a.priority.toLowerCase()}`}>{pr[a.priority]}</span></td>
            {showTarget && <td>{a.targetDate || '—'}</td>}
            {showStatus && <td>{a.status || '—'}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceTag({ source, lang }: { source: string; lang: FormatContext['lang'] }) {
  return <span className="prs-source-tag">{chrome('supportingBadge', lang)}{source ? ` · ${chrome('sourcePrefix', lang)}: ${source}` : ''}</span>;
}

function ImagePanel({ image, reportId, lang }: { image: SupportingImage; reportId: number | null; lang: FormatContext['lang'] }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (reportId) fetchAssetDataUrl(reportId, image.assetId).then((u) => { if (alive) setUrl(u); }).catch(() => {});
    return () => { alive = false; };
  }, [reportId, image.assetId]);
  // A background rather than <img>: html2canvas honours background-size but not
  // object-fit, so this is the form that keeps its proportions in the PDF.
  return (
    <figure className="prs-image" data-image-ready={url ? '1' : '0'}>
      <div className="prs-image-frame" style={url ? { backgroundImage: `url("${url}")` } : undefined} />
      <figcaption>{image.caption && <span>{image.caption}</span>}<SourceTag source={image.source} lang={lang} /></figcaption>
    </figure>
  );
}

function SupportingBody({ slide, ctx, reportId }: { slide: SlideDoc; ctx: RenderContext; reportId: number | null }) {
  const s = slide.supporting;
  if (!s) return null;
  const kpis = s.kpis.filter((k) => k.label.trim());
  const notes = s.notes.filter((n) => n.title.trim() || n.text.trim());
  return (
    <div className={`prs-supporting${s.images.length ? ' has-images' : ''}`}>
      <div className="prs-supporting-main">
        {kpis.length > 0 && (
          <table className="prs-table prs-kpi">
            <thead>
              <tr><th>{chrome('metric', ctx.lang)}</th><th className="num">{ctx.oldLabel}</th><th className="num">{ctx.curLabel}</th><th className="num">{chrome('changes', ctx.lang)}</th><th>{chrome('sourcePrefix', ctx.lang)}</th></tr>
            </thead>
            <tbody>
              {kpis.map((k) => {
                const old = parseCell(k.old);
                const cur = parseCell(k.cur);
                const { deltaNum, deltaStr } = computeDelta(old.n, cur.n);
                const delta = parseDelta(deltaStr, deltaClassForSentiment(deltaNum, k.lowerIsBetter ? 'lower-better' : 'higher-better'), deltaNum);
                return (
                  <tr key={k.id}>
                    <td className="prs-name">{k.label}</td>
                    <td className="num">{old.f === 'text' ? k.old : k.old ? formatCell(old, ctx) : '—'}</td>
                    <td className="num">{cur.f === 'text' ? k.cur : k.cur ? formatCell(cur, ctx) : '—'}</td>
                    <td className="num"><span className={`prs-delta prs-delta-${delta.tone}`}>{formatDelta(delta, ctx)}</span></td>
                    <td className="prs-source-cell">{k.source || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {notes.map((n) => (
          <div className="prs-note-card" key={n.id}>
            {n.title && <h4>{n.title}</h4>}
            {n.text && <p>{n.text}</p>}
            <SourceTag source={n.source} lang={ctx.lang} />
          </div>
        ))}
      </div>
      {s.images.length > 0 && (
        <div className="prs-supporting-images">
          {s.images.slice(0, 2).map((img) => <ImagePanel key={img.id} image={img} reportId={reportId} lang={ctx.lang} />)}
        </div>
      )}
    </div>
  );
}

export interface SlideViewProps {
  slide: SlideDoc;
  doc: PresentationDocument;
  snapshot: Snapshot | null;
  reportId: number | null;
  // Its page in the PDF; 0 for a slide that will not be exported yet.
  number: number;
  // All slides, for the agenda and the action summary.
  deck: SlideDoc[];
  ctx: RenderContext;
  // Editor preview only: says what is still empty. Never true for export.
  hints?: boolean;
  onFit?: (overflow: boolean) => void;
}

// Type shrinks by steps until the body fits, down to a floor that still reads on a
// projector. Past that the slide is flagged, not clipped silently: Review lists it.
const FIT_STEPS = [1, 0.95, 0.9, 0.85, 0.8];

function bodyOverflows(el: HTMLElement): boolean {
  if (el.scrollHeight > el.clientHeight + 1) return true;
  return Array.from(el.querySelectorAll<HTMLElement>('.prs-check')).some((c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1);
}

export function SlideView({ slide, doc, snapshot, reportId, number, deck, ctx, hints, onFit }: SlideViewProps) {
  const { config } = doc;
  const layout = LAYOUTS[slide.layout];
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => slide.blockIds.map((id) => snapshot?.blocks[id]), [slide.blockIds, snapshot]);
  const contentKey = JSON.stringify([slide, ctx.lang, ctx.currency, ctx.oldLabel, ctx.curLabel, slide.aggregateActions ? deck.map((d) => d.actions) : 0]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    const root = rootRef.current;
    if (!body || !root) return;
    // Cover, divider and closing have no bounded body to overflow.
    if (!body.classList.contains('prs-body')) {
      onFit?.(false);
      return;
    }
    let overflow = false;
    for (const step of FIT_STEPS) {
      body.style.setProperty('--fit', String(step));
      overflow = bodyOverflows(body);
      if (!overflow) break;
    }
    root.dataset.overflow = overflow ? '1' : '0';
    onFit?.(overflow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  const period = ctx.curLabel;
  const showHeadline = slide.headline.trim() && !slide.hiddenFields.includes('headline');

  const shell = (children: ReactNode) => (
    <div ref={rootRef} className={`prs-slide prs-t-${config.template} prs-l-${slide.layout}`} data-slide-id={slide.id}>
      <header className="prs-head">
        <div className="prs-title">{slide.title}</div>
        {showHeadline && <h2 className="prs-headline">{slide.headline}</h2>}
        {!showHeadline && hints && <div className="prs-hint prs-hint-headline">Headline belum diisi.</div>}
      </header>
      <div className="prs-body" ref={bodyRef}>{children}</div>
      <footer className="prs-foot">
        <MilLogo color="#1e3eb8" />
        <span className="prs-foot-mid">{config.brandName} · {period}</span>
        <span className="prs-foot-n">{number || '—'}</span>
      </footer>
    </div>
  );

  // The dark structural slides have no header or footer of their own.
  if (slide.layout === 'cover' || slide.layout === 'divider' || slide.layout === 'closing') {
    const year = (config.period.curEnd || '').slice(0, 4);
    return (
      <div ref={rootRef} className={`prs-slide prs-full prs-t-${config.template} prs-l-${slide.layout}`} data-slide-id={slide.id}>
        <Swoosh />
        <div className="prs-full-top"><MilLogo color={config.template === 'mil-light' ? '#1e3eb8' : '#ffffff'} /></div>
        <div className="prs-full-main" ref={bodyRef}>
          {slide.layout === 'cover' && (
            <>
              <div className="prs-cover-brand">{config.brandName}</div>
              <div className="prs-cover-sub">{slide.title}</div>
              <div className="prs-cover-pill">{period}</div>
            </>
          )}
          {slide.layout === 'divider' && <div className="prs-divider-title">{slide.title}</div>}
          {slide.layout === 'closing' && (
            <>
              <div className="prs-divider-title">{chrome('thanks', config.lang)}</div>
              <div className="prs-cover-sub">{config.brandName} · {period}</div>
            </>
          )}
          {showHeadline && <div className="prs-full-headline">{slide.headline}</div>}
        </div>
        <div className="prs-full-foot">MIL Digital · {year}</div>
      </div>
    );
  }

  if (slide.layout === 'agenda') {
    const enabled = doc.sections.filter((s) => s.enabled && deck.some((d) => d.sectionId === s.id));
    return shell(
      <ol className="prs-agenda">
        {enabled.map((s, i) => (
          <li key={s.id}>
            <span className="prs-agenda-n">{String(i + 1).padStart(2, '0')}</span>
            <span className="prs-agenda-t">{s.title}</span>
          </li>
        ))}
      </ol>,
    );
  }

  const primary = blocks[0];
  const second = blocks[1];
  const perPage = layout.rowsPerPage;

  if (slide.layout === 'executive') {
    const hasKpi = slide.blockIds.length > 0;
    const hasText = hasPoints(slide, ['takeaways']) || hints;
    return shell(
      <div className={`prs-split${hasKpi && hasText ? '' : ' is-single'}`}>
        {hasText && <div className="prs-col prs-check prs-text-col"><Points field="takeaways" slide={slide} lang={ctx.lang} hint={hints} /></div>}
        {hasKpi && <div className="prs-col prs-check"><BlockView block={primary} ctx={ctx} /></div>}
      </div>,
    );
  }

  if (slide.layout === 'kpi_chart') {
    return shell(
      <div className="prs-stack">
        {(hasPoints(slide, ['findings']) || hints) && <div className="prs-text-row prs-check"><Points field="findings" slide={slide} lang={ctx.lang} hint={hints} /></div>}
        <div className="prs-split prs-grow">
          {/* Chart on the left, the numbers behind it on the right, as MIL's decks read. */}
          <div className="prs-col prs-check"><BlockView block={second ?? primary} ctx={ctx} page={slide.page} perPage={perPage} /></div>
          {second && <div className="prs-col prs-check"><BlockView block={primary} ctx={ctx} page={slide.page} perPage={perPage} /></div>}
        </div>
      </div>,
    );
  }

  if (slide.layout === 'chart_findings' || slide.layout === 'table') {
    return shell(
      <div className="prs-stack">
        <div className="prs-grow prs-check"><BlockView block={primary} ctx={ctx} page={slide.page} perPage={perPage} /></div>
        {(hasPoints(slide, ['findings']) || hints) && <div className="prs-text-row prs-check"><Points field="findings" slide={slide} lang={ctx.lang} hint={hints} /></div>}
      </div>,
    );
  }

  if (slide.layout === 'chart_insights' || slide.layout === 'top_bottom') {
    return shell(
      <div className={`prs-insight-split${hasPoints(slide, ['insights']) || hints ? '' : ' is-single'}`}>
        <div className="prs-col prs-check"><BlockView block={primary} ctx={ctx} page={slide.page} perPage={perPage} /></div>
        {(hasPoints(slide, ['insights']) || hints) && <div className="prs-col prs-check prs-text-col"><Points field="insights" slide={slide} lang={ctx.lang} hint={hints} /></div>}
      </div>,
    );
  }

  if (slide.layout === 'two_blocks') {
    return shell(
      <div className="prs-stack">
        {(hasPoints(slide, ['findings']) || hints) && <div className="prs-text-row prs-check"><Points field="findings" slide={slide} lang={ctx.lang} hint={hints} /></div>}
        <div className="prs-split prs-grow">
          <div className="prs-col prs-check"><BlockView block={primary} ctx={ctx} page={slide.page} perPage={perPage} compact /></div>
          <div className="prs-col prs-check"><BlockView block={second} ctx={ctx} page={slide.page} perPage={perPage} compact /></div>
        </div>
      </div>,
    );
  }

  if (slide.layout === 'funnel') {
    const text = hasPoints(slide, ['findings', 'insights']) || hints;
    return shell(
      <div className={`prs-insight-split prs-funnel-split${text ? '' : ' is-single'}`}>
        <div className="prs-col prs-check"><BlockView block={primary} ctx={ctx} /></div>
        {text && (
          <div className="prs-col prs-check prs-text-col">
            <Points field="findings" slide={slide} lang={ctx.lang} hint={hints} />
            <Points field="insights" slide={slide} lang={ctx.lang} hint={hints} />
          </div>
        )}
      </div>,
    );
  }

  if (slide.layout === 'narrative') {
    return shell(
      <div className="prs-split">
        <div className="prs-col prs-check prs-text-col prs-card"><Points field="findings" slide={slide} lang={ctx.lang} hint={hints} /></div>
        <div className="prs-col prs-check prs-text-col prs-card prs-card-accent"><Points field="insights" slide={slide} lang={ctx.lang} hint={hints} /></div>
      </div>,
    );
  }

  if (slide.layout === 'win_risk') {
    return shell(
      <div className="prs-winrisk">
        <div className="prs-check prs-text-col prs-card prs-card-good"><Points field="wins" slide={slide} lang={ctx.lang} hint={hints} /></div>
        <div className="prs-check prs-text-col prs-card prs-card-bad"><Points field="risks" slide={slide} lang={ctx.lang} hint={hints} /></div>
      </div>,
    );
  }

  if (slide.layout === 'next_actions') {
    const others = slide.aggregateActions ? deck.filter((d) => d.id !== slide.id).flatMap((d) => d.actions) : [];
    const items = [...slide.actions, ...others].filter((a) => a.action.trim()).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    return shell(
      <div className="prs-check prs-grow-full">
        {items.length ? <ActionTable items={items} ctx={ctx} /> : hints ? <p className="prs-hint">Belum ada action item. Slide ini kosong di PDF.</p> : null}
      </div>,
    );
  }

  if (slide.layout === 'supporting') {
    return shell(<div className="prs-check prs-grow-full"><SupportingBody slide={slide} ctx={ctx} reportId={reportId} /></div>);
  }

  return shell(null);
}

// Scales the stage to whatever width it is given; the stage itself never reflows.
export function ScaledSlide({ width, children }: { width: number; children: ReactNode }) {
  const scale = width / STAGE_W;
  return (
    <div className="prs-scale-outer" style={{ width, height: STAGE_H * scale }}>
      <div className="prs-scale-inner" style={{ transform: `scale(${scale})` }}>{children}</div>
    </div>
  );
}
