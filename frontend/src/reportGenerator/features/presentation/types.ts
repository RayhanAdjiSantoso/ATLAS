// The Presentation Report Builder's data model. Two halves, stored apart:
//   - PresentationDocument: what the user decides (config, slide order, layouts,
//     narrative, supporting data). Saved on every edit.
//   - Snapshot: the figures, computed once from ATLAS's own report builders and
//     frozen, so a deck keeps showing what was reviewed until the user chooses
//     to refresh it.
// Slides only ever point at snapshot blocks by id, which is why a block that is
// missing (a metric the export does not carry) can never become a made-up number.

export const TEMPLATE_VERSION = 1;

export type ChannelKey = 'meta' | 'shopee' | 'tiktok' | 'google';
export const CHANNEL_KEYS: readonly ChannelKey[] = ['meta', 'shopee', 'tiktok', 'google'];
export type BlockSource = ChannelKey | 'business' | 'overview';
export type Lang = 'id' | 'en';
export type Tone = 'professional' | 'concise' | 'analytical';
export type Currency = 'IDR' | 'MYR';
export type TemplateKey = 'mil-blue' | 'mil-light';

// A label in both report languages, so switching language needs no rebuild.
export interface Text2 {
  id: string;
  en: string;
}

// ── Values ────────────────────────────────────────────────────────────
export type ValueFmt = 'money' | 'num' | 'pct' | 'signedPct' | 'x' | 'dec' | 'text';
export interface Cell {
  n: number | null;
  f: ValueFmt;
  t?: string; // the text, when f is 'text'
  // Read back from a display string that had already rounded to a whole unit,
  // so it must not be shown with decimals it does not have.
  rounded?: boolean;
}
export type Sentiment3 = 'good' | 'bad' | 'neutral';
export interface DeltaCell {
  n: number | null;
  // Shown instead of a percentage: 'New' (no baseline), '—' (not comparable).
  s?: string;
  tone: Sentiment3;
}
export interface KpiRow {
  label: string;
  old: Cell;
  cur: Cell;
  delta: DeltaCell;
}

// ── Data blocks (the snapshot's contents) ─────────────────────────────
export interface BlockBase {
  id: string;
  source: BlockSource;
  title: Text2;
  // A definition or coverage caveat that must travel with the figure.
  note?: Text2;
}
export interface KpiBlock extends BlockBase {
  kind: 'kpi';
  rows: KpiRow[];
}
export type ChartType = 'bar' | 'hbar' | 'line' | 'stacked' | 'donut' | 'pareto';
export interface ChartSeries {
  label: string;
  values: (number | null)[];
  // old/cur take the comparison colours, the rest take the categorical palette.
  role?: 'old' | 'cur';
}
export interface ChartBlock extends BlockBase {
  kind: 'chart';
  chart: ChartType;
  labels: string[];
  series: ChartSeries[];
  fmt: ValueFmt;
}
export interface TableColumn {
  key: string;
  label: string;
}
export interface TableRow {
  name: string;
  cells: Record<string, Cell>;
  delta?: DeltaCell;
}
export interface TableBlock extends BlockBase {
  kind: 'table';
  nameLabel: string;
  columns: TableColumn[];
  // The columns kept when the table shares a slide; the first four otherwise.
  compactColumns?: string[];
  deltaLabel?: string;
  rows: TableRow[];
}
export interface FunnelNode {
  label: string;
  depth: number;
  old: Cell;
  cur: Cell;
  delta: DeltaCell;
}
export interface FunnelBlock extends BlockBase {
  kind: 'funnel';
  nodes: FunnelNode[];
  // The report's own reading of the tree (Indonesian); AI context, not slide text.
  reading?: string[];
}
export interface RankedItem {
  name: string;
  value: Cell;
  spend?: Cell;
  delta?: DeltaCell;
}
export interface TopBottomBlock extends BlockBase {
  kind: 'topBottom';
  metric: string;
  rule: Text2;
  top: RankedItem[];
  bottom: RankedItem[];
}
export type DataBlock = KpiBlock | ChartBlock | TableBlock | FunnelBlock | TopBottomBlock;

// An analysis the deck would normally carry but this brand's data cannot back.
export interface MissingAnalysis {
  id: string;
  source: BlockSource;
  title: Text2;
  reason: string;
  // The tab that can supply it, when importing is possible.
  importTo?: string;
}

export interface SourceStatus {
  source: BlockSource;
  label: string;
  status: 'ok' | 'unavailable' | 'error';
  message?: string;
  periodOld?: string;
  periodCur?: string;
  // Non-null when the source compares periods of unequal length.
  periodWarning?: string | null;
  // The saved report's dates differ from the deck's: its labels head its columns.
  periodMismatch?: boolean;
  runId?: number | null;
  currency?: string | null;
}

export interface Snapshot {
  builtAt: string;
  sources: SourceStatus[];
  blocks: Record<string, DataBlock>;
  missing: MissingAnalysis[];
  // The sub-channels found in the data, which the slide plan walks.
  metaSubs: { key: string; label: string }[];
  shopeeChannels: { key: string; label: string }[];
}

// ── The document ──────────────────────────────────────────────────────
export interface PeriodConfig {
  curStart: string;
  curEnd: string;
  curLabel: string;
  oldStart: string;
  oldEnd: string;
  oldLabel: string;
}
export interface ChannelConfig {
  enabled: boolean;
  runId: number | null; // the saved report used; unused for Google (range based)
}
export interface PresentationConfig {
  brandId: number;
  brandName: string;
  lang: Lang;
  tone: Tone;
  template: TemplateKey;
  currency: Currency;
  period: PeriodConfig;
  channels: Record<ChannelKey, ChannelConfig>;
  includeBusiness: boolean;
}

export type LayoutKey =
  | 'cover' | 'agenda' | 'divider' | 'executive' | 'kpi_chart' | 'chart_findings' | 'chart_insights'
  | 'table' | 'two_blocks' | 'top_bottom' | 'funnel' | 'narrative' | 'win_risk' | 'next_actions'
  | 'supporting' | 'closing';

export type PointKind = 'fact' | 'hypothesis' | 'recommendation';
export interface NarrativePoint {
  id: string;
  text: string;
  kind?: PointKind;
}
export type NarrativeField = 'takeaways' | 'findings' | 'insights' | 'wins' | 'risks';
export type ActionPriority = 'High' | 'Medium' | 'Low';
export interface ActionItem {
  id: string;
  action: string;
  owner: string; // 'MIL Digital' | 'Client' | anything typed
  priority: ActionPriority;
  targetDate?: string;
  status?: string;
}
export interface SupportingKpi {
  id: string;
  label: string;
  old: string;
  cur: string;
  source: string;
  lowerIsBetter?: boolean;
}
export interface SupportingNote {
  id: string;
  title: string;
  text: string;
  source: string;
}
export interface SupportingImage {
  id: string;
  assetId: number;
  caption: string;
  source: string;
}

export interface SlideDoc {
  id: string;
  sectionId: string;
  layout: LayoutKey;
  hidden: boolean;
  title: string;
  // The generated title in both languages; while `title` still equals it, a
  // language switch translates the slide. An edited title is left alone.
  autoTitle?: Text2;
  headline: string;
  blockIds: string[];
  // Which page of a long table this slide shows (0-based); rows per page come
  // from the layout, so a table can run on over several slides.
  page?: number;
  narrative: Record<NarrativeField, NarrativePoint[]>;
  // Fields the user chose not to show, kept rather than discarded.
  hiddenFields: string[];
  actions: ActionItem[];
  // next_actions only: also list every other slide's action items.
  aggregateActions?: boolean;
  supporting?: { kpis: SupportingKpi[]; notes: SupportingNote[]; images: SupportingImage[] };
}

export interface SectionDoc {
  id: string;
  title: string;
  kind: 'intro' | 'overview' | 'channel' | 'conclusion' | 'supporting' | 'custom';
  channel?: ChannelKey;
  enabled: boolean;
}

export interface PresentationDocument {
  templateVersion: number;
  config: PresentationConfig;
  sections: SectionDoc[];
  slides: SlideDoc[];
  aiContext: string;
}

// A draft row as the API returns it.
export interface DraftSummary {
  id: number;
  brand_id: number;
  name: string;
  channels: string[];
  period_cur_start: string | null;
  period_cur_end: string | null;
  period_old_start: string | null;
  period_old_end: string | null;
  revision: number;
  created_by_name: string | null;
  updated_by_name: string | null;
  updated_at: string;
}
export interface DraftDetail extends DraftSummary {
  document: PresentationDocument;
  snapshot: Snapshot | null;
}

export interface AiSuggestion {
  field: NarrativeField | 'headline' | 'actions';
  slideId: string;
  headline?: string;
  points?: { text: string; kind: PointKind }[];
  actions?: { action: string; priority: ActionPriority; owner: string }[];
  unmatched: string[];
}
