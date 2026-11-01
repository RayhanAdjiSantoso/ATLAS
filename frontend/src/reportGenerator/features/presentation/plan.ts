import { periodLabelFromDates } from './format';
import { L } from './data/helpers';
import { TEMPLATE_VERSION, type ChannelKey, type LayoutKey, type NarrativeField, type PresentationConfig, type PresentationDocument, type SectionDoc, type SlideDoc, type Snapshot, type TableBlock, type Text2 } from './types';

// The default deck for a brand: only what its data can back. No fixed slide
// count anywhere; a channel without data contributes nothing, and a long table
// continues on as many slides as it needs (up to MAX_TABLE_PAGES).

export interface LayoutDef {
  key: LayoutKey;
  label: string;
  // Data blocks the layout has room for.
  blocks: number;
  // Narrative fields it shows, and table rows per page for block regions.
  fields: NarrativeField[];
  rowsPerPage: number;
  // Layouts with no data region cannot be swapped to or from a data layout.
  group: 'structure' | 'data' | 'narrative';
  actions?: boolean;
  supporting?: boolean;
}

export const LAYOUTS: Record<LayoutKey, LayoutDef> = {
  cover: { key: 'cover', label: 'Cover', blocks: 0, fields: [], rowsPerPage: 0, group: 'structure' },
  agenda: { key: 'agenda', label: 'Agenda', blocks: 0, fields: [], rowsPerPage: 0, group: 'structure' },
  divider: { key: 'divider', label: 'Section Divider', blocks: 0, fields: [], rowsPerPage: 0, group: 'structure' },
  closing: { key: 'closing', label: 'Closing', blocks: 0, fields: [], rowsPerPage: 0, group: 'structure' },
  executive: { key: 'executive', label: 'Executive Summary', blocks: 1, fields: ['takeaways'], rowsPerPage: 7, group: 'data' },
  kpi_chart: { key: 'kpi_chart', label: 'KPI Comparison + Chart', blocks: 2, fields: ['findings'], rowsPerPage: 7, group: 'data' },
  chart_findings: { key: 'chart_findings', label: 'Full-width Chart + Findings', blocks: 1, fields: ['findings'], rowsPerPage: 7, group: 'data' },
  chart_insights: { key: 'chart_insights', label: 'Chart + Insights (dua kolom)', blocks: 1, fields: ['insights'], rowsPerPage: 9, group: 'data' },
  table: { key: 'table', label: 'Campaign / Audience / Product Performance', blocks: 1, fields: ['findings'], rowsPerPage: 8, group: 'data' },
  two_blocks: { key: 'two_blocks', label: 'Dua Blok Data', blocks: 2, fields: ['findings'], rowsPerPage: 8, group: 'data' },
  top_bottom: { key: 'top_bottom', label: 'Top vs Bottom Performers', blocks: 1, fields: ['insights'], rowsPerPage: 5, group: 'data' },
  funnel: { key: 'funnel', label: 'Funnel / Root Cause', blocks: 1, fields: ['findings', 'insights'], rowsPerPage: 0, group: 'data' },
  narrative: { key: 'narrative', label: 'Findings & Insights', blocks: 0, fields: ['findings', 'insights'], rowsPerPage: 0, group: 'narrative' },
  win_risk: { key: 'win_risk', label: 'Win & Risk', blocks: 0, fields: ['wins', 'risks'], rowsPerPage: 0, group: 'narrative' },
  next_actions: { key: 'next_actions', label: 'Next Action Items', blocks: 0, fields: [], rowsPerPage: 0, group: 'narrative', actions: true },
  supporting: { key: 'supporting', label: 'Supporting Data & Context', blocks: 0, fields: [], rowsPerPage: 0, group: 'narrative', supporting: true },
};

// With 8 rows a page this is data/helpers.ts's MAX_TABLE_ROWS.
export const MAX_TABLE_PAGES = 3;

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyNarrative(): SlideDoc['narrative'] {
  return { takeaways: [], findings: [], insights: [], wins: [], risks: [] };
}

function slide(sectionId: string, layout: LayoutKey, title: Text2, lang: PresentationConfig['lang'], blockIds: (string | null | undefined)[] = [], page?: number): SlideDoc {
  return {
    id: newId('s'), sectionId, layout, hidden: false,
    title: title[lang], autoTitle: title,
    headline: '', blockIds: blockIds.filter((b): b is string => Boolean(b)), page,
    narrative: emptyNarrative(), hiddenFields: [], actions: [],
  };
}

export function newSlide(sectionId: string, layout: LayoutKey, title: string): SlideDoc {
  return { id: newId('s'), sectionId, layout, hidden: false, title, headline: '', blockIds: [], narrative: emptyNarrative(), hiddenFields: [], actions: [], ...(LAYOUTS[layout].supporting ? { supporting: { kpis: [], notes: [], images: [] } } : {}) };
}

const CHANNEL_TITLE: Record<ChannelKey, string> = { meta: 'Meta Ads', shopee: 'Shopee Ads', tiktok: 'TikTok Ads', google: 'Google Ads' };

// One slide per page of a table; a short table is simply one slide.
function tableSlides(snap: Snapshot, sectionId: string, layout: LayoutKey, title: Text2, lang: PresentationConfig['lang'], blockId: string | null | undefined): SlideDoc[] {
  if (!blockId || !snap.blocks[blockId]) return [];
  const block = snap.blocks[blockId];
  const perPage = LAYOUTS[layout].rowsPerPage;
  const pages = block.kind === 'table' && perPage ? Math.min(MAX_TABLE_PAGES, Math.ceil((block as TableBlock).rows.length / perPage)) : 1;
  return Array.from({ length: Math.max(1, pages) }, (_, page) => slide(sectionId, layout, page === 0 ? title : { id: `${title.id} (lanjutan)`, en: `${title.en} (continued)` }, lang, [blockId], block.kind === 'table' ? page : undefined));
}

// More rows than half a slide holds once long metric names wrap.
const KPI_ROWS_BESIDE_CHART = 9;
// A KPI table alone on a slide holds this many, then continues on the next.
export const KPI_ROWS_PER_SLIDE = 12;

function channelSlides(snap: Snapshot, key: ChannelKey, sectionId: string, lang: PresentationConfig['lang']): SlideDoc[] {
  const has = (id: string | null | undefined) => Boolean(id && snap.blocks[id]);
  const pick = (...ids: string[]) => ids.filter(has);
  const out: SlideDoc[] = [slide(sectionId, 'divider', L(CHANNEL_TITLE[key]), lang)];
  // KPI and chart share a slide when they fit; a long KPI table takes its own.
  const overview = (title: Text2, kpi: string, chart: string): SlideDoc[] => {
    const block = snap.blocks[kpi];
    const rows = block?.kind === 'kpi' ? block.rows.length : 0;
    if (has(chart) && rows > KPI_ROWS_BESIDE_CHART) {
      const pages = Math.ceil(rows / KPI_ROWS_PER_SLIDE);
      const tables = Array.from({ length: pages }, (_, page) => slide(sectionId, 'chart_findings', page === 0 ? title : { id: `${title.id} (lanjutan)`, en: `${title.en} (continued)` }, lang, [kpi], pages > 1 ? page : undefined));
      return [...tables, slide(sectionId, 'chart_findings', { id: `${title.id} (grafik)`, en: `${title.en} (chart)` }, lang, [chart])];
    }
    return [slide(sectionId, has(chart) ? 'kpi_chart' : 'chart_findings', title, lang, pick(kpi, chart))];
  };

  if (key === 'meta') {
    if (has('meta.split.chart')) out.push(slide(sectionId, 'kpi_chart', L('Boost Post vs Non-Boost Post Overview'), lang, pick('meta.split.kpi', 'meta.split.chart')));
    for (const sub of snap.metaSubs) {
      const id = (s: string) => `meta.${sub.key}.${s}`;
      out.push(...overview(L(`${sub.label} · Performance Overview`), id('kpi'), id('traffic')));
      if (has(id('funnel'))) out.push(slide(sectionId, 'funnel', L(`${sub.label} · Root Cause Analysis`), lang, [id('funnel')]));
      if (has(id('nvrm'))) out.push(...tableSlides(snap, sectionId, 'table', L(`${sub.label} · New Visitor vs Remarketing`), lang, id('nvrm')));
      if (has(id('conversion'))) out.push(slide(sectionId, 'chart_findings', L(`${sub.label} · Conversion Analysis`), lang, [id('conversion')]));
      out.push(...tableSlides(snap, sectionId, 'table', L(`${sub.label} · Campaign Performance`), lang, id('campaigns')));
      if (has(id('age'))) out.push(slide(sectionId, has(id('age_chart')) ? 'two_blocks' : 'table', L(`${sub.label} · Audience Performance`), lang, pick(id('age_chart'), id('age'))));
      if (has(id('gender'))) out.push(...tableSlides(snap, sectionId, 'table', L(`${sub.label} · Gender`), lang, id('gender')));
      if (has(id('creative'))) out.push(slide(sectionId, 'top_bottom', L(`${sub.label} · Top & Bottom Creative`), lang, [id('creative')]));
    }
  }

  if (key === 'shopee') {
    out.push(...overview(L('Shopee Ads · Performance Overview'), 'shopee.kpi', 'shopee.mix.chart'));
    if (has('shopee.mix.table')) out.push(slide(sectionId, 'table', L('Product Ads vs Shop Ads vs Live Ads'), lang, ['shopee.mix.table']));
    if (has('shopee.funnel')) out.push(slide(sectionId, 'funnel', L('Shopee Ads · Root Cause Analysis'), lang, ['shopee.funnel']));
    for (const c of snap.shopeeChannels) {
      const kpi = `shopee.channel.${c.key}.kpi`;
      const tree = `shopee.channel.${c.key}.funnel`;
      if (has(tree)) out.push(slide(sectionId, 'two_blocks', L(`${c.label} · Detailed Analysis`), lang, [kpi, tree]));
    }
    if (has('shopee.traffic')) out.push(slide(sectionId, 'chart_insights', L('Traffic Analysis'), lang, ['shopee.traffic']));
    if (has('shopee.conversion')) out.push(slide(sectionId, 'chart_insights', L('Conversion Analysis'), lang, ['shopee.conversion']));
    if (has('shopee.pareto')) out.push(slide(sectionId, 'chart_findings', L('Pareto Analysis'), lang, ['shopee.pareto']));
    if (has('shopee.daily')) out.push(...(has('shopee.store') ? overview(L('Tren Harian Toko', 'Store Daily Trends'), 'shopee.store', 'shopee.daily') : [slide(sectionId, 'chart_findings', L('Tren Harian Toko', 'Store Daily Trends'), lang, ['shopee.daily'])]));
    out.push(...tableSlides(snap, sectionId, 'table', L('Performa Produk', 'Product Performance'), lang, 'shopee.products.table'));
    if (has('shopee.products.rank')) out.push(slide(sectionId, 'top_bottom', L('Top & Bottom Products'), lang, ['shopee.products.rank']));
    out.push(...tableSlides(snap, sectionId, 'table', L('Performa Keyword', 'Keyword Performance'), lang, 'shopee.keywords'));
  }

  if (key === 'tiktok') {
    out.push(...overview(L('TikTok Ads · Performance Overview'), 'tiktok.kpi', 'tiktok.chart'));
    out.push(...tableSlides(snap, sectionId, 'table', L('Campaign Performance'), lang, 'tiktok.campaigns'));
    if (has('tiktok.rank')) out.push(slide(sectionId, 'top_bottom', L('Top & Bottom Campaigns'), lang, ['tiktok.rank']));
  }

  if (key === 'google') {
    out.push(...overview(L('Google Ads · Performance Overview'), 'google.kpi', 'google.daily'));
    out.push(...tableSlides(snap, sectionId, 'table', L('Campaign Performance'), lang, 'google.campaigns'));
    if (has('google.rank')) out.push(slide(sectionId, 'top_bottom', L('Top & Bottom Campaigns'), lang, ['google.rank']));
    out.push(...tableSlides(snap, sectionId, 'table', L('Keyword Performance'), lang, 'google.keywords'));
    out.push(...tableSlides(snap, sectionId, 'table', L('Performa per Lokasi', 'Location Performance'), lang, 'google.cities'));
  }

  out.push(slide(sectionId, 'narrative', L(`${CHANNEL_TITLE[key]} · Findings & Insights`), lang));
  out.push(slide(sectionId, 'next_actions', L(`${CHANNEL_TITLE[key]} · Next Action Items`), lang));
  return out;
}

export function planDocument(config: PresentationConfig, snap: Snapshot): PresentationDocument {
  const { lang } = config;
  const has = (id: string) => Boolean(snap.blocks[id]);
  const sections: SectionDoc[] = [];
  const slides: SlideDoc[] = [];
  const section = (kind: SectionDoc['kind'], title: string, channel?: ChannelKey): string => {
    const id = newId('sec');
    sections.push({ id, kind, title, channel, enabled: true });
    return id;
  };

  const intro = section('intro', 'Introduction');
  slides.push(slide(intro, 'cover', L('Monthly Overview'), lang));
  slides.push(slide(intro, 'agenda', L('Agenda'), lang));
  slides.push(slide(intro, 'executive', L('Executive Summary'), lang, has('overview.exec') ? ['overview.exec'] : []));

  const overview = section('overview', 'Monthly Overview');
  slides.push(slide(overview, 'divider', L('Monthly Overview'), lang));
  if (has('business.kpi')) slides.push(slide(overview, has('business.daily') ? 'kpi_chart' : 'chart_findings', L('Sales Performance'), lang, ['business.kpi', ...(has('business.daily') ? ['business.daily'] : [])]));
  if (has('business.channels.chart')) slides.push(slide(overview, has('business.trend') ? 'two_blocks' : 'chart_findings', L('Channel Revenue'), lang, ['business.channels.chart', ...(has('business.trend') ? ['business.trend'] : [])]));
  if (has('overview.spend.kpi')) slides.push(slide(overview, 'kpi_chart', L('Advertising Spend'), lang, ['overview.spend.kpi', has('overview.spend.share') ? 'overview.spend.share' : 'overview.spend.chart']));
  slides.push(slide(overview, 'narrative', L('Business Findings'), lang));
  slides.push(slide(overview, 'win_risk', L('Win & Risk'), lang));

  for (const key of ['meta', 'shopee', 'tiktok', 'google'] as const) {
    const source = snap.sources.find((s) => s.source === key);
    if (source?.status !== 'ok') continue;
    const sectionId = section('channel', CHANNEL_TITLE[key], key);
    slides.push(...channelSlides(snap, key, sectionId, lang));
  }

  const conclusion = section('conclusion', 'Conclusion');
  slides.push(slide(conclusion, 'narrative', L('Overall Recommendations'), lang));
  slides.push({ ...slide(conclusion, 'next_actions', L('Next Action Items Summary'), lang), aggregateActions: true });
  slides.push(slide(conclusion, 'closing', L('Closing'), lang));

  return { templateVersion: TEMPLATE_VERSION, config, sections, slides, aiContext: '' };
}

// Slides with their section enabled and not hidden, in deck order. The document
// keeps slides in one list; sections only group them.
export function visibleSlides(doc: PresentationDocument): SlideDoc[] {
  const enabled = new Set(doc.sections.filter((s) => s.enabled).map((s) => s.id));
  return orderedSlides(doc).filter((s) => !s.hidden && enabled.has(s.sectionId));
}

export function orderedSlides(doc: PresentationDocument): SlideDoc[] {
  const order = new Map(doc.sections.map((s, i) => [s.id, i]));
  return [...doc.slides].sort((a, b) => (order.get(a.sectionId) ?? 99) - (order.get(b.sectionId) ?? 99));
}

// Keeps a language switch from leaving generated titles in the old language.
export function applyLanguage(doc: PresentationDocument, lang: PresentationConfig['lang']): PresentationDocument {
  const from = doc.config.lang;
  const period = doc.config.period;
  return {
    ...doc,
    config: {
      ...doc.config,
      lang,
      period: {
        ...period,
        curLabel: period.curLabel === periodLabelFromDates(period.curStart, period.curEnd, from) ? periodLabelFromDates(period.curStart, period.curEnd, lang) : period.curLabel,
        oldLabel: period.oldLabel === periodLabelFromDates(period.oldStart, period.oldEnd, from) ? periodLabelFromDates(period.oldStart, period.oldEnd, lang) : period.oldLabel,
      },
    },
    slides: doc.slides.map((s) => (s.autoTitle && s.title === s.autoTitle[from] ? { ...s, title: s.autoTitle[lang] } : s)),
  };
}
