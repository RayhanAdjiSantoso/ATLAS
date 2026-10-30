import { resolveMetaMonth } from '../../lib/metaSources';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import api from '../../../api/client.js';
import { LibraryFileSlot } from '../reports/LibraryFileSlot';
import { ManualFileSlot } from '../reports/ManualFileSlot';
import { ReportPages } from '../../components/ReportPages';
import { SectionAccordion } from '../../components/SectionAccordion';
import { useScrollAfterGenerate } from '../../hooks/useScrollAfterGenerate';
import MetaDatasetSpecs, { SPEC_INTRO, SPEC_NOTES } from '../../../components/brandSettings/MetaDatasetSpecs.jsx';
import { InlineNotice } from '../../components/InlineNotice';
import {
  splitMonths,
  detectMetaObjectiveCol,
  resolveCampaignObjectives,
  metaDayRange,
  stripCampaignSubtotals,
  type MetaIndustry,
  type MetaObjectiveKey,
} from '../../lib/meta';
import { alignRowKeys, findCol } from '../../lib/columns';
import { daysBetweenInclusive, formatPeriodLabel } from '../../lib/periodLabel';
import { fromISODate, toISODate } from '../../lib/dateFmt';
import { readSpreadsheetFile } from '../../lib/xlsxUtils';
import { requireColumns, validateFileBasics } from '../../lib/validation';
import type { SheetRow } from '../../lib/types';
import { OverviewDetailedCard } from '../../components/OverviewDetailedCard';
import { DownloadPdfButton } from '../../components/DownloadPdfButton';
import { PeriodCompareChip } from '../../components/PeriodCompareChip';
import { PeriodWarningBanner } from '../../components/PeriodWarningBanner';
import { StepIndicator, type Step } from '../../components/StepIndicator';
import type { PlatformResultData } from '../../lib/summary';
import { AiSummarySection } from '../ai/AiSummarySection';
import {
  BRAND_CONVERSION_METRICS,
  BRAND_CONSIDERATION_RATE_METRICS,
  BRAND_TOP_EFFICIENCY_METRICS,
  B2B_AUDIENCE_TRAFFIC_METRICS,
  B2B_TRAFFIC_METRICS,
  RETAIL_AUDIENCE_CONVERSION_METRICS,
  SALES_CREATIVE_CONVERSION_METRICS,
  RETAIL_TOP_CONTENT_METRICS,
  SALES_AUDIENCE_TRAFFIC_METRICS,
  SALES_TRAFFIC_METRICS,
  audienceTypeOf,
  findAdCol,
  findAdsetCol,
  NON_RETAIL_TOP_CONTENT_METRICS,
  type AudienceMetricDef,
} from '../../lib/metaAudience';
import { MetaCompareBars } from './MetaCompareBars';
import { relabelMetaMenu as L, relabelMetaRows } from '../../lib/metaLabels';
import { buildMetaOverviewRows } from '../../lib/metaOverview';
import { SymptomTreePanel } from '../shopee/AnalysisSections';
import { buildMetaNonRetailFunnel, buildMetaSalesFunnel, type DailyLeadsTotals, type LeadResultKind, type MetaFunnel } from '../../lib/metaFunnel';
import { SegmentedToggle } from '../../components/SegmentedToggle';
import { SaveStatus } from '../reports/SaveStatus';
import { useAutoSave } from '../reports/useAutoSave';
import { useRestoreLastReport } from '../reports/useRestoreLastReport';
import { forgetLastReport } from '../reports/lastReportStore';
import { mapMetaCpasRows, mapMetaMainRows } from '../reports/rowMapping';
import { PeriodSourcePicker, type LibraryMonth, type PeriodSourceTab, type PickScopeOption } from '../reports/PeriodSourcePicker';
import { RangeCalendar } from '../reports/RangeCalendar';
import { periodBound } from '../reports/periodOrder';
import type { AutoRange } from '../reports/AutoRangePanel';
import { getClients, getSavedPeriod } from '../reports/api';
import { formatChannelCoverage } from '../reports/savedPeriodLabels';
import { PeriodSourceSwitch, SavedSlotCard, type PeriodSourceKind, type SlotSource } from '../../components/SlotSourceTabs';
import type { PeriodRole, RawFileEntry, SavedPeriod, SaveReportPayload } from '../reports/types';
import { buildMetaReport, isBoostRow, type MetaAudienceSides, type MetaReport, type NonBoostLane, type NonBoostLaneKey } from './metaReport';

// Meta's export uses either a "Month" breakdown or a "Day" breakdown column
// as the period dimension — either satisfies the requirement.
const REQUIRED_COLS = [
  { label: 'Amount Spent', kw: ['amount spent'] },
  { label: 'Month/Day', kw: ['month', 'day'] },
  { label: 'Campaign Name', kw: ['campaign'] },
];

// Brand Setting's Kategori Industri (and the older spellings it still reads)
// mapped onto the two lanes this report knows. Food & Beverage sells to end
// customers, so it reads as Retail.
const BRAND_INDUSTRY_TO_META: Record<string, Exclude<MetaIndustry, 'custom' | null>> = {
  'Retail Fashion': 'retail',
  'Retail-Fashion': 'retail',
  'Retail Non-Fashion': 'retail',
  'Retail-Non Fashion': 'retail',
  'Food & Beverage': 'retail',
  'Food & Beverages': 'retail',
  'B2B Services': 'b2b',
  'B2B + Services': 'b2b',
};
const CONSIDERATION_MIN_IMPRESSIONS = 3000;
// Audience Analysis reads only ad sets that spent more than this.
const AUDIENCE_MIN_SPEND = 100000;

// 'boost' / 'nonboost' are the two halves of a month's Meta Ads export in
// Data Collection Hub; 'meta' is the combined file of before that split.
const META_MAIN_CHANNELS = ['boost', 'nonboost', 'meta'] as const;
const META_PERIOD_CHANNELS = [...META_MAIN_CHANNELS, 'cpas'] as const;

const SOURCE_HINT: Record<PeriodSourceKind, string> = {
  upload: '',
  library: 'Buka Perpustakaan Brand — pilih bulan, Meta Ads & CPAS terisi sekaligus',
  archive: 'Buka Arsip Laporan — pakai ulang periode laporan yang pernah dibuat',
  range: 'Pilih rentang tanggal bebas dari data harian tarikan otomatis',
};

interface MetaFileState {
  rows: SheetRow[];
  fileName: string;
  // Where rows that did not come from a device upload were taken from.
  origin?: 'hub' | 'archive';
}

// What one stored pick may fill: Meta Ads (Boost + Non Boost), CPAS, or
// both — so a brand that only needs CPAS takes only CPAS from the hub.
type PickTarget = 'meta' | 'cpas';
const BOTH: PickTarget[] = ['meta', 'cpas'];
const META_PICK_SCOPE: PickScopeOption[] = [
  { key: 'meta', label: 'Meta Ads', hint: 'Boost & Non Boost', libraryChannels: ['boost', 'nonboost', 'meta'], archiveChannels: ['boost', 'nonboost'] },
  { key: 'cpas', label: 'CPAS', hint: 'Shopee / Tokopedia', libraryChannels: ['cpas'], archiveChannels: ['cpas_overall'] },
];
const scopeNote = (include?: string[]) => (include && include.length === 1 ? (include[0] === 'cpas' ? ' · CPAS saja' : ' · Meta Ads saja') : '');
const EMPTY_META_SIDES: Record<PeriodRole, MetaFileState | null> = { old: null, cur: null };

interface LibraryFileMeta {
  id: number;
  platform: string;
  channel: string;
  original_filename: string;
  period_month: string | null;
}

// The auto-fetched daily rows of a custom range, served as the same Ads
// Manager-style workbook a library month is. 404 = nothing stored there.
async function downloadAutoRange(clientId: number, accountType: 'MAIN' | 'CPAS', range: AutoRange): Promise<File | null> {
  try {
    const { data } = await api.get('/meta-ads-insights/export', {
      params: { brandId: clientId, accountType, start: range.start, end: range.end },
      responseType: 'blob',
    });
    return new File([data], `ATLAS-auto_${accountType === 'CPAS' ? 'cpas' : 'meta'}_${range.start}_${range.end}.xlsx`, { type: (data as Blob).type });
  } catch (err) {
    if ((err as { response?: { status?: number } }).response?.status === 404) return null;
    throw err;
  }
}

async function downloadLibraryFile(clientId: number, file: LibraryFileMeta): Promise<File> {
  const { data } = await api.get(`/brands/${clientId}/library/${file.id}/download`, { responseType: 'blob' });
  return new File([data], file.original_filename, { type: (data as Blob).type });
}

function formatGeneratedDate(at?: string): string {
  return (at ? new Date(at) : new Date()).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Day-breakdown Meta exports carry the full original row (every column) into
// the saved report's payload, which grows much faster than the raw file
// itself — measured at ~95KB/day combined (raw file + saved payload) for a
// real sample. 45 days keeps a comfortable margin under hosting platforms'
// request-size limits (e.g. Vercel Functions' 4.5MB hard cap) well before
// the point where a save would actually fail. Purely advisory — never
// blocks upload or Generate.
const LONG_DAY_RANGE_WARNING_THRESHOLD = 45;

interface MetaTabProps {
  isActive: boolean;
  clientId: number | null;
  onGenerated: (data: PlatformResultData) => void;
  onInvalidate: () => void;
}

export function MetaTab({ isActive, clientId, onGenerated, onInvalidate }: MetaTabProps) {
  // One upload per period side now (not one file spanning both) — matches
  // Shopee/TikTok's Periode Lalu/Periode Ini split, so nobody has to
  // download a combined 2-month export from Meta Ads Reporting anymore.
  // metaRows/metaHeaders below are the two sides concatenated, which is all
  // buildMetaReport (and its Month/Day auto-split) has ever needed.
  const [metaSides, setMetaSides] = useState<Record<PeriodRole, MetaFileState | null>>(EMPTY_META_SIDES);
  const [cpasSides, setCpasSides] = useState<Record<PeriodRole, MetaFileState | null>>(EMPTY_META_SIDES);

  // alignRowKeys: the two periods' exports may not carry the same columns
  // (see lib/columns.ts) — without it a breakdown only one side has is
  // invisible to every parser, and its subtotal rows get counted as data.
  const metaRows = useMemo(() => (metaSides.old || metaSides.cur ? alignRowKeys([...(metaSides.old?.rows ?? []), ...(metaSides.cur?.rows ?? [])]) : null), [metaSides]);
  const metaHeaders = useMemo(() => (metaRows?.length ? Object.keys(metaRows[0]) : []), [metaRows]);
  const cpasRows = useMemo(() => (cpasSides.old || cpasSides.cur ? alignRowKeys([...(cpasSides.old?.rows ?? []), ...(cpasSides.cur?.rows ?? [])]) : null), [cpasSides]);
  const cpasHeaders = useMemo(() => (cpasRows?.length ? Object.keys(cpasRows[0]) : []), [cpasRows]);
  // Meta Ads and CPAS are each optional — a brand that only runs CPAS gets a
  // CPAS-only report. The periods (and the day pickers) follow Meta Ads when
  // it is loaded, else CPAS.
  const periodSides = metaSides.old || metaSides.cur ? metaSides : cpasSides;
  const periodRows = metaRows ?? cpasRows;

  // B2B / Retail — not in the export; read from the brand's Kategori Industri
  // in Brand Setting and only editable there. Objective — Meta's ODAX
  // objective; auto-prefilled from the file's "Objective" column when present,
  // still overridable.
  const [brandIndustry, setBrandIndustry] = useState<string | null | undefined>(undefined); // undefined = loading
  const industry: MetaIndustry = brandIndustry ? BRAND_INDUSTRY_TO_META[brandIndustry] ?? null : null;
  // Which audience the CPAS Shopee overall card reads: Gabungan, NV or RM.
  const [cpasAud, setCpasAud] = useState<'all' | 'NV' | 'RM'>('all');
  // The same switch on the Boost Post and Non-Boost lane overall cards.
  const [boostAud, setBoostAud] = useState<'all' | 'NV' | 'RM'>('all');
  const [laneAud, setLaneAud] = useState<Record<NonBoostLaneKey, 'all' | 'NV' | 'RM'>>({ retail: 'all', b2b: 'all' });
  // Legacy — the "Custom Conversion" column picker is gone; kept so old saved
  // report configs still round-trip.
  const [customResultsCol, setCustomResultsCol] = useState<string | null>(null);
  const [objective, setObjective] = useState<MetaObjectiveKey | null>(null);
  // True once the objective was auto-prefilled for the current file, so the
  // prefill effect doesn't keep stomping a manual change.
  const objectivePrefilledFor = useRef<string>('');

  // Day-breakdown support: when a side's upload has a "Day" column instead
  // of "Month" (a real per-day export, not a bucketed calendar month), its
  // own min/max day becomes that side's default range — the date pickers
  // below still let the user trim within it.
  const dayCol = useMemo(() => (periodRows ? findCol(periodRows, ['day']) : null), [periodRows]);

  const [oldRange, setOldRange] = useState<{ start: Date; end: Date } | null>(null);
  const [curRange, setCurRange] = useState<{ start: Date; end: Date } | null>(null);
  const oldDayBounds = useMemo(() => (dayCol && periodSides.old ? metaDayRange(periodSides.old.rows, dayCol) : null), [dayCol, periodSides.old]);
  const curDayBounds = useMemo(() => (dayCol && periodSides.cur ? metaDayRange(periodSides.cur.rows, dayCol) : null), [dayCol, periodSides.cur]);

  // Each side's suggested range is simply that side's own file bounds —
  // exact by construction now that old/cur are 2 separate uploads, not a
  // heuristic half-split of one combined file like before. Still user-
  // editable via the date inputs below (e.g. to trim a few days off).
  useEffect(() => {
    setOldRange(oldDayBounds ? { start: oldDayBounds.min, end: oldDayBounds.max } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldDayBounds]);
  useEffect(() => {
    setCurRange(curDayBounds ? { start: curDayBounds.min, end: curDayBounds.max } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curDayBounds]);

  const [report, setReport] = useState<MetaReport | null>(null);

  // Non-Boost Post (Non Retail): deals and cold leads of both periods from
  // Brand Tracking › Leads Data, for its Root Cause Analysis. null until
  // read (or when the periods have no dates) — the tree then shows "—".
  const [leadTotals, setLeadTotals] = useState<{ old: DailyLeadsTotals; cur: DailyLeadsTotals } | null>(null);
  const hasNonRetail = Boolean(report?.nonBoostLanes?.some((l) => l.key === 'b2b'));
  useEffect(() => {
    setLeadTotals(null);
    const r = report;
    if (!clientId || !hasNonRetail || !r?.periodOldStart || !r.periodOldEnd || !r.periodCurStart || !r.periodCurEnd) return undefined;
    let alive = true;
    api.get('/daily-tracking/leads-summary', {
      params: { brandId: clientId, ranges: `${r.periodOldStart}..${r.periodOldEnd},${r.periodCurStart}..${r.periodCurEnd}` },
    })
      .then(({ data }: { data: { ranges: DailyLeadsTotals[] } }) => { if (alive) setLeadTotals({ old: data.ranges[0], cur: data.ranges[1] }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [clientId, hasNonRetail, report]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // "Pilih Periode" — per side, sourced from the brand library (any month
  // uploaded there), exactly like Shopee's picker: one pick fills that
  // side's Meta Ads + CPAS files at once; a fresh upload on either slot
  // below still overrides just that one file.
  const [oldSource, setOldSource] = useState<SlotSource>('upload');
  const [curSource, setCurSource] = useState<SlotSource>('upload');
  const [oldPickedMonth, setOldPickedMonth] = useState<(LibraryMonth & { include?: string[] }) | null>(null);
  const [curPickedMonth, setCurPickedMonth] = useState<(LibraryMonth & { include?: string[] }) | null>(null);
  // The other stored source: a period of a report already generated. Its rows
  // come back from the archive exactly as they were parsed, so a slot can be
  // filled without the original file.
  const [oldPickedRun, setOldPickedRun] = useState<(SavedPeriod & { include?: string[] }) | null>(null);
  const [curPickedRun, setCurPickedRun] = useState<(SavedPeriod & { include?: string[] }) | null>(null);
  // The third stored source: any day range of the auto-fetched daily rows.
  const [oldPickedRange, setOldPickedRange] = useState<AutoRange | null>(null);
  const [curPickedRange, setCurPickedRange] = useState<AutoRange | null>(null);
  const [pickerRole, setPickerRole] = useState<PeriodRole | null>(null);
  // Which stored source the switch last asked for, per period, until a pick
  // lands — and which list the dialog opens on.
  const [pendingKind, setPendingKind] = useState<Record<PeriodRole, PeriodSourceKind>>({ old: 'library', cur: 'library' });
  const [pickerTab, setPickerTab] = useState<PeriodSourceTab>('library');
  // Which datasets the open dialog fills, and whether it fills one row only
  // (opened from an upload slot) instead of switching the period's source.
  const [pickerInclude, setPickerInclude] = useState<PickTarget[]>(BOTH);
  const [pickerRowOnly, setPickerRowOnly] = useState(false);
  const [rangeAutoOpen, setRangeAutoOpen] = useState<PeriodRole | null>(null);

  function sourceKindOf(role: PeriodRole): PeriodSourceKind {
    if ((role === 'old' ? oldSource : curSource) === 'upload') return 'upload';
    if (role === 'old' ? oldPickedMonth : curPickedMonth) return 'library';
    if (role === 'old' ? oldPickedRun : curPickedRun) return 'archive';
    if (role === 'old' ? oldPickedRange : curPickedRange) return 'range';
    return pendingKind[role];
  }

  function openPicker(role: PeriodRole, kind: PeriodSourceKind, include: PickTarget[] = BOTH, rowOnly = false) {
    setPickerTab(kind === 'upload' ? 'library' : kind);
    setPickerInclude(include);
    setPickerRowOnly(rowOnly);
    setPickerRole(role);
  }

  function chooseSourceKind(role: PeriodRole, kind: PeriodSourceKind) {
    if (kind === 'upload') {
      (role === 'old' ? setOldSource : setCurSource)('upload');
      return;
    }
    setPendingKind((prev) => ({ ...prev, [role]: kind }));
    (role === 'old' ? setOldSource : setCurSource)('saved');
    // A date range is picked on the page (RangeCalendar opens under its
    // field); the library and the archive are lists, so they open the dialog.
    if (kind === 'range') setRangeAutoOpen(role);
    else openPicker(role, kind);
  }
  const [applyingRole, setApplyingRole] = useState<PeriodRole | null>(null);

  async function applyLibraryMonth(targetRole: PeriodRole, month: LibraryMonth, include: string[] = BOTH, rowOnly = false) {
    if (!clientId) return;
    setApplyingRole(targetRole);
    setUploadError(null);
    try {
      const { data } = await api.get(`/brands/${clientId}/library`);
      const files = (data.files as LibraryFileMeta[]).filter((f) => f.platform === 'meta' && f.period_month?.slice(0, 7) === month.month);
      // Split files (Boost + Non Boost) win over the old combined export:
      // a month is never read from both (lib/metaSources).
      const source = resolveMetaMonth(files.filter((f) => (META_MAIN_CHANNELS as readonly string[]).includes(f.channel)), month.month, 'auto');
      const metaList = source.files;
      const cpasList = files.filter((f) => f.channel === 'cpas');

      async function downloadAndParse(list: LibraryFileMeta[]): Promise<SheetRow[]> {
        const parts = await Promise.all(list.map((f) => downloadLibraryFile(clientId!, f)));
        return alignRowKeys((await Promise.all(parts.map(readSpreadsheetFile))).flat());
      }

      // Only the ticked datasets are filled; the other row keeps what it has.
      if (include.includes('meta')) {
        const rows = metaList.length ? await downloadAndParse(metaList) : [];
        setMetaSides((prev) => ({ ...prev, [targetRole]: rows.length ? { rows, fileName: metaList.map((f) => f.original_filename).join(' · '), origin: 'hub' } : null }));
      }
      if (include.includes('cpas')) {
        const rows = cpasList.length ? await downloadAndParse(cpasList) : [];
        setCpasSides((prev) => ({ ...prev, [targetRole]: rows.length ? { rows, fileName: cpasList.map((f) => f.original_filename).join(' · '), origin: 'hub' } : null }));
      }

      setReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal memuat periode dari perpustakaan: ' + (err as Error).message);
      if (!rowOnly) {
        (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
        (targetRole === 'old' ? setOldSource : setCurSource)('upload');
      }
    } finally {
      setApplyingRole(null);
    }
  }

  function handlePickMonth(month: LibraryMonth, include: string[]) {
    const targetRole = pickerRole;
    if (!targetRole) return;
    if (!pickerRowOnly) {
      (targetRole === 'old' ? setOldPickedRun : setCurPickedRun)(null);
      (targetRole === 'old' ? setOldPickedRange : setCurPickedRange)(null);
      (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)({ ...month, include });
      (targetRole === 'old' ? setOldSource : setCurSource)('saved');
    }
    applyLibraryMonth(targetRole, month, include, pickerRowOnly);
  }

  // Boost and Non-Boost were stored as two channels of one Meta file; putting
  // them back together restores exactly what that report read.
  async function applyArchivePeriod(targetRole: PeriodRole, period: SavedPeriod, include: string[] = BOTH, rowOnly = false) {
    setApplyingRole(targetRole);
    setUploadError(null);
    try {
      const detail = await getSavedPeriod(period.runId, period.role);
      const metaRowsSaved = include.includes('meta') ? [...(detail.channels.boost ?? []), ...(detail.channels.nonboost ?? [])] : [];
      const cpasRowsSaved = include.includes('cpas') ? detail.channels.cpas_overall ?? [] : [];
      if (!metaRowsSaved.length && !cpasRowsSaved.length) throw new Error('Periode ini tidak menyimpan baris data untuk pilihan tersebut.');
      const name = `Arsip · ${period.label || period.sourceComparison}`;
      if (include.includes('meta')) setMetaSides((prev) => ({ ...prev, [targetRole]: metaRowsSaved.length ? { rows: metaRowsSaved, fileName: name, origin: 'archive' } : null }));
      if (include.includes('cpas')) setCpasSides((prev) => ({ ...prev, [targetRole]: cpasRowsSaved.length ? { rows: cpasRowsSaved, fileName: name, origin: 'archive' } : null }));
      setReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal memuat periode dari arsip laporan: ' + (err as Error).message);
      if (!rowOnly) {
        (targetRole === 'old' ? setOldPickedRun : setCurPickedRun)(null);
        (targetRole === 'old' ? setOldSource : setCurSource)('upload');
      }
    } finally {
      setApplyingRole(null);
    }
  }

  function handlePickArchive(period: SavedPeriod, include: string[]) {
    const targetRole = pickerRole;
    if (!targetRole) return;
    if (!pickerRowOnly) {
      (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
      (targetRole === 'old' ? setOldPickedRange : setCurPickedRange)(null);
      (targetRole === 'old' ? setOldPickedRun : setCurPickedRun)({ ...period, include });
      (targetRole === 'old' ? setOldSource : setCurSource)('saved');
    }
    applyArchivePeriod(targetRole, period, include, pickerRowOnly);
  }

  async function applyAutoRange(targetRole: PeriodRole, range: AutoRange) {
    if (!clientId) return;
    setApplyingRole(targetRole);
    setUploadError(null);
    try {
      const [metaFile, cpasFile] = await Promise.all([
        downloadAutoRange(clientId, 'MAIN', range),
        range.channels.cpas ? downloadAutoRange(clientId, 'CPAS', range) : Promise.resolve(null),
      ]);
      const metaRowsRange = metaFile ? await readSpreadsheetFile(metaFile) : [];
      const cpasRowsRange = cpasFile ? await readSpreadsheetFile(cpasFile) : [];
      if (!metaRowsRange.length && !cpasRowsRange.length) throw new Error('Belum ada data Meta Ads atau CPAS tersimpan pada rentang ini.');
      const name = `Tarikan otomatis · ${range.label}`;
      setMetaSides((prev) => ({ ...prev, [targetRole]: metaRowsRange.length ? { rows: metaRowsRange, fileName: name } : null }));
      setCpasSides((prev) => ({ ...prev, [targetRole]: cpasRowsRange.length ? { rows: cpasRowsRange, fileName: name } : null }));
      setReport(null);
      onInvalidate();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } }; message: string };
      setUploadError('Gagal memuat rentang tanggal: ' + (e.response?.data?.message ?? e.message));
      (targetRole === 'old' ? setOldPickedRange : setCurPickedRange)(null);
      (targetRole === 'old' ? setOldSource : setCurSource)('upload');
    } finally {
      setApplyingRole(null);
    }
  }

  // The inline "Rentang tanggal" field applies straight to its own period.
  function applyRangeFor(targetRole: PeriodRole, range: AutoRange) {
    setRangeAutoOpen(null);
    (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
    (targetRole === 'old' ? setOldPickedRun : setCurPickedRun)(null);
    (targetRole === 'old' ? setOldPickedRange : setCurPickedRange)(range);
    (targetRole === 'old' ? setOldSource : setCurSource)('saved');
    applyAutoRange(targetRole, range);
  }

  function clearPickedPeriod(role: PeriodRole) {
    (role === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
    (role === 'old' ? setOldPickedRun : setCurPickedRun)(null);
    (role === 'old' ? setOldPickedRange : setCurPickedRange)(null);
    (role === 'old' ? setOldSource : setCurSource)('upload');
    setMetaSides((prev) => ({ ...prev, [role]: null }));
    setCpasSides((prev) => ({ ...prev, [role]: null }));
    setReport(null);
    onInvalidate();
  }

  // Same contract the Shopee and TikTok tabs already follow: the source tabs
  // decide which slot appears. Meta rendered the library picker whichever tab
  // was active, so "Upload file baru" was a switch that changed nothing — and
  // since it is the DEFAULT source, the upload column looked missing outright.
  function metaDropzone(target: 'meta' | 'cpas', role: PeriodRole, tag: string) {
    const f = (target === 'meta' ? metaSides : cpasSides)[role];
    const setSides = target === 'meta' ? setMetaSides : setCpasSides;
    const infoText = f ? `${f.rows.length} baris` : undefined;
    if ((role === 'old' ? oldSource : curSource) === 'upload') {
      return (
        <ManualFileSlot
          tag={tag}
          accept=".csv,.xlsx,.xls"
          loaded={Boolean(f)}
          fileName={f?.fileName}
          infoText={infoText}
          onFiles={(files) => handleUpload(files, target, role)}
          onClear={() => setSides((prev) => ({ ...prev, [role]: null }))}
          onPickStored={clientId ? () => openPicker(role, 'library', [target], true) : undefined}
          pickStoredLabel={`Ambil ${target === 'meta' ? 'Meta Ads' : 'CPAS'} dari Data Collection Hub`}
          loadedTitle={f?.origin === 'hub' ? 'Diambil dari Data Collection Hub' : f?.origin === 'archive' ? 'Diambil dari Arsip Laporan' : undefined}
        />
      );
    }
    return (
      <LibraryFileSlot
        clientId={clientId}
        platform="meta"
        channel={target === 'meta' ? META_MAIN_CHANNELS : target}
        tag={tag}
        accept=".csv,.xlsx,.xls"
        onFiles={(files) => handleUpload(files, target, role)}
        loaded={Boolean(f)}
        fileName={f?.fileName}
        infoText={infoText}
      />
    );
  }

  async function handleUpload(input: File[], target: 'meta' | 'cpas', role: PeriodRole) {
    const file = input[0];
    const basics = validateFileBasics(file, ['.csv', '.xlsx', '.xls']);
    if (!basics.ok) {
      throw new Error(basics.message || 'File tidak valid.');
    }
    try {
      const rows = alignRowKeys((await Promise.all(input.map(readSpreadsheetFile))).flat());
      if (!rows.length) {
        throw new Error('File kosong.');
      }
      const cols = requireColumns(rows, REQUIRED_COLS);
      if (!cols.ok) {
        throw new Error(cols.message || 'Kolom wajib tidak ditemukan.');
      }
      const monthColumn = findCol(rows, ['month']);
      const dayColumn = findCol(rows, ['day']);
      if (!dayColumn) {
        const monthCount = splitMonths(rows, monthColumn).months.length;
        if (monthCount !== 1) {
          throw new Error(
            monthCount === 0
              ? 'Kolom Month tidak terbaca — export ulang dengan breakdown Month atau Day.'
              : 'File ini mencakup lebih dari 1 bulan Month — upload satu bulan saja untuk slot Periode Lalu/Periode Ini ini.',
          );
        }
      }
      setUploadError(null);
      const fileState: MetaFileState = { rows, fileName: input.map((f) => f.name).join(' · ') };
      (target === 'meta' ? setMetaSides : setCpasSides)((prev) => ({ ...prev, [role]: fileState }));
      setReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal membaca isi file: ' + (err as Error).message);
      throw err;
    }
  }

  // Re-read on every visit to the tab, so a change saved in Brand Setting
  // shows up without reloading the page.
  useEffect(() => {
    if (!clientId || !isActive) return;
    let alive = true;
    getClients()
      .then((list) => {
        if (!alive) return;
        const next = list.find((c) => c.id === clientId)?.industry ?? null;
        if (brandIndustry !== undefined && brandIndustry !== next) {
          setReport(null);
          onInvalidate();
        }
        setBrandIndustry(next);
      })
      .catch(() => alive && brandIndustry === undefined && setBrandIndustry(null));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, isActive]);
  // When the export carries an "Objective" column, Non-Boost is split per
  // objective automatically. Without it, the prefilled objective below is the
  // single Non-Boost headline.
  const objectiveCol = metaRows ? detectMetaObjectiveCol(metaHeaders) : null;

  // Prefill the objective with the Non-Boost lane's highest-spend
  // objective — read per campaign from the Objective column, else the name,
  // else the metrics — once per file. Boost rows stay out: the objective is
  // about Non-Boost.
  useEffect(() => {
    if (!metaRows) return;
    const fileKey = (objectiveCol ?? '') + '·' + metaRows.length;
    if (objectivePrefilledFor.current === fileKey) return;
    objectivePrefilledFor.current = fileKey;
    const leaves = stripCampaignSubtotals(metaRows);
    const campCol = findCol(leaves, ['campaign']);
    const spentCol = metaHeaders.find((h) => h.toLowerCase().includes('amount spent')) ?? null;
    const isBoost = isBoostRow(campCol);
    const resolved = resolveCampaignObjectives(leaves.filter((r) => !isBoost(r)), campCol);
    const spend = new Map<MetaObjectiveKey, number>();
    for (const r of leaves) {
      const hit = campCol && !isBoost(r) ? resolved.get(String(r[campCol] ?? '').trim()) : undefined;
      if (!hit || hit.key === 'other') continue;
      spend.set(hit.key, (spend.get(hit.key) ?? 0) + (spentCol ? Number(r[spentCol]) || 0 : 1));
    }
    const dom = [...spend].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (dom) setObjective(dom);
  }, [metaRows, objectiveCol, metaHeaders]);

  const dayRangesOk = !dayCol || Boolean(oldRange && curRange && oldRange.start <= oldRange.end && curRange.start <= curRange.end);
  // Either source is enough. A Non-Boost lane with no objective signal falls
  // back to the brand's industry, else Retail.
  const ready = Boolean((metaRows || cpasRows) && clientId && dayRangesOk);
  const dayRanges = oldRange && curRange ? { old: oldRange, cur: curRange } : null;

  const autoSave = useAutoSave('meta');
  const armReportScroll = useScrollAfterGenerate('report-meta', report);

  // `restoredAt`: reopening the last report (useRestoreLastReport) — shown
  // with its original date and not saved a second time.
  function generate(restoredAt?: string) {
    if (!metaRows && !cpasRows) return;
    const r = buildMetaReport({ metaRows: metaRows ?? [], metaHeaders, cpasRows, cpasHeaders, industry, customResultsCol, objective, dayRanges });
    setReport(r);
    setGeneratedAt(formatGeneratedDate(restoredAt));
    onGenerated({ period: { old: r.p1, cur: r.p2 }, kpis: r.summary.kpis, cpasKpis: r.summary.cpasKpis, spend: r.summary.spend });
    if (!restoredAt) autoSave.save(clientId, buildSavePayload(r), buildSaveFiles());
  }

  const restoring = useRestoreLastReport({
    platform: 'meta',
    clientId,
    apply: async (old, cur) => {
      for (const [role, period] of [['old', old], ['cur', cur]] as const) {
        (role === 'old' ? setOldPickedRun : setCurPickedRun)({ ...period, include: BOTH });
        (role === 'old' ? setOldSource : setCurSource)('saved');
        await applyArchivePeriod(role, period, BOTH);
      }
    },
    // The industry (from Brand Setting) feeds the report too.
    ready: ready && brandIndustry !== undefined && !applyingRole,
    generate,
  });

  function reset() {
    forgetLastReport('meta', clientId);
    setMetaSides(EMPTY_META_SIDES);
    setCpasSides(EMPTY_META_SIDES);
    setOldSource('upload');
    setCurSource('upload');
    setOldPickedMonth(null);
    setCurPickedMonth(null);
    setOldPickedRange(null);
    setCurPickedRange(null);
    setCustomResultsCol(null);
    setObjective(null);
    objectivePrefilledFor.current = '';
    setReport(null);
    setUploadError(null);
    onInvalidate();
  }

  function buildSavePayload(r: MetaReport): Omit<SaveReportPayload, 'brandId' | 'platform'> {
    return {
      period: {
        oldStart: r.periodOldStart ?? null,
        oldEnd: r.periodOldEnd ?? null,
        curStart: r.periodCurStart ?? null,
        curEnd: r.periodCurEnd ?? null,
        oldLabel: r.p1,
        curLabel: r.p2,
      },
      // metaHeaders/cpasHeaders are persisted explicitly (not re-derived from
      // Object.keys() on the reopened rows) because Postgres's jsonb column
      // type does not preserve object key insertion order — it reorders keys
      // on storage — while buildMetaReport()'s column-matching (getOverviewDefs/
      // matchDef, both "first header containing keyword X" lookups) is
      // order-sensitive. Losing the original file's column order would pick
      // the wrong column whenever two headers share a keyword (e.g. "Purchase
      // ROAS (return on ad spend)" vs "Results ROAS" both contain "roas").
      reportConfig: { industry, customResultsCol, objective, metaHeaders, cpasHeaders },
      rows: {
        meta: [...mapMetaMainRows(metaRows ?? [], dayRanges), ...(cpasRows ? mapMetaCpasRows(cpasRows, dayRanges) : [])],
      },
    };
  }

  // Original source files already live in the brand library. Save parsed report rows only.
  function buildSaveFiles(): RawFileEntry[] { return []; }


  const hasAnySection = Boolean(
    report && (report.boost || report.nonBoost || report.nonBoostLanes?.length || report.boostAgeDemo || report.boostGenderDemo || report.ageDemo || report.genderDemo || (report.cpas && Object.keys(report.cpas).length)),
  );

  // The Audience & Creative Analysis of one channel, as the architecture
  // sheet lays them out. Selling channels (CPAS, Non-Boost Retail) read the
  // purchase funnel; B2B Leads the lead funnel; Boost Post brand actions.
  // The B2B lane is read on Leads — form leads, Messaging Contacts and
  // Messaging Conversations Started together. Null for a lane that is not B2B.
  function laneLeadKind(lane: NonBoostLane): LeadResultKind | null {
    return lane.leadResults ? 'leads' : null;
  }

  // The Audiens switch of an overall card; none when the channel has no
  // campaign named NV or RM. A side the period has no campaign for is shown
  // disabled.
  function audienceToggle(sides: MetaAudienceSides | undefined, value: 'all' | 'NV' | 'RM', onChange: (v: 'all' | 'NV' | 'RM') => void) {
    if (!sides?.NV && !sides?.RM) return null;
    const none = 'Tidak ada campaign dengan label ini di periode ini';
    return (
      <span data-feature="meta-overview-audience" style={{ display: 'contents' }}>
        <SegmentedToggle
          label="Audiens"
          options={[
            { value: 'all', label: 'Gabungan NV + RM', disabled: false },
            { value: 'NV', label: 'NV', disabled: sides.NV ? false : none },
            { value: 'RM', label: 'RM', disabled: sides.RM ? false : none },
          ]}
          value={value}
          onChange={onChange}
          accent="var(--acc)"
        />
      </span>
    );
  }

  // ── Per-channel pages (Boost Post, Non-Boost Post (Retail) / (Non Retail),
  // CPAS Shopee): one navigator row per page, no group labels. The channel's
  // own Overall card first, then Traffic, Conversion and Top Content
  // Analysis; audience read per ad set, creative per materi iklan. Boost Post
  // has no purchase funnel to send traffic down, so it goes from Overall
  // straight to its brand actions (Consideration Analysis). Every chart opens
  // ranked and carries a changes table against the last period.
  function rcaPanel(f: MetaFunnel | undefined, p1: string, p2: string, title = 'Root Cause Analysis', badge = `${p1} → ${p2}`) {
    return f?.hasData ? <SymptomTreePanel tree={f.tree} p1={p1} p2={p2} title={title} badge={badge} /> : undefined;
  }

  function channelSections({
    prefix,
    period,
    p1,
    rows,
    oldRows,
    kind,
    campCol,
    leadKind,
    overall,
  }: {
    prefix: string;
    period: string;
    p1: string;
    rows: SheetRow[];
    oldRows: SheetRow[];
    kind: 'sales' | 'b2b' | 'brand';
    campCol: string | null;
    leadKind?: LeadResultKind;
    overall: ReactNode;
  }) {
    const adCol = rows.length ? findAdCol(rows) : null;
    const creativeBadge = `per materi iklan · ${period}`;
    const changes = { oldRows, p1, p2: period };
    const noRows = 'Periode ini tidak punya baris data untuk channel ini.';
    const noAd = 'Bagian ini membandingkan performa per materi iklan. File yang diunggah tidak dipecah per Ad — export ulang dari Meta Ads Reporting dengan breakdown Ad name.';
    const empty = (m: string) => (rows.length ? m : noRows);
    // Several charts stacked under a hidden heading that names the page
    // (each chart keeps its own).
    const page = (title: string, b: string, charts: ReactNode) => (
      <div className="sec-stack">
        <div className="sec-heading" style={{ display: 'none' }}>
          {`${prefix} · ${title}`}
          <span className="sec-badge">{b}</span>
        </div>
        {charts}
      </div>
    );

    if (kind === 'brand') {
      const brandBars = (title: string, b: string, menu: typeof BRAND_CONVERSION_METRICS, dimCol: string | null, dimNoun: string, emptyMessage: string, minImpressions?: number) => (
        <MetaCompareBars key={title} heading={`${prefix} · ${title}`} badge={b} rows={rows} kind="brand" menu={L(menu)} dimCol={dimCol} campCol={campCol} audience="none" sortable hideDefaultOrder copyLabels dimNoun={dimNoun} emptyMessage={empty(emptyMessage)} changes={changes} minImpressions={minImpressions} />
      );
      // Consideration reads per materi iklan, only ads that reached 3,000
      // impressions — a rate over fewer is noise.
      return (
        <>
          {overall}
          {brandBars('Consideration Analysis', creativeBadge, BRAND_CONSIDERATION_RATE_METRICS, adCol, 'materi iklan', noAd, CONSIDERATION_MIN_IMPRESSIONS)}
          {brandBars('Top Content Analysis', creativeBadge, BRAND_TOP_EFFICIENCY_METRICS, adCol, 'materi iklan', noAd)}
        </>
      );
    }

    // Non Retail has no Conversion Analysis.
    const menus = kind === 'b2b'
      ? { audienceTraffic: B2B_AUDIENCE_TRAFFIC_METRICS, traffic: B2B_TRAFFIC_METRICS, conversion: null, creativeConversion: null, topContent: NON_RETAIL_TOP_CONTENT_METRICS }
      : { audienceTraffic: SALES_AUDIENCE_TRAFFIC_METRICS, traffic: SALES_TRAFFIC_METRICS, conversion: RETAIL_AUDIENCE_CONVERSION_METRICS, creativeConversion: SALES_CREATIVE_CONVERSION_METRICS, topContent: RETAIL_TOP_CONTENT_METRICS };
    const adsetCol = rows.length ? findAdsetCol(rows) : null;
    const noAdset = 'Bagian ini membandingkan performa per ad set. File yang diunggah tidak dipecah per Ad Set — export ulang dari Meta Ads Reporting dengan breakdown Ad set name.';
    const audienceBadge = `per ad set · NV · RM · ${period}`;
    // `ownLabels` keeps the menu's own short names (Conversion Analysis reads
    // "Conversion Rate", not the report-wide "Conversion Rate (CVR)").
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bars = (title: string, b: string, menu: readonly AudienceMetricDef<any>[], level: 'adset' | 'creative', ownLabels = false) => (
      <MetaCompareBars
        key={title}
        heading={`${prefix} · ${title}`}
        badge={b}
        rows={rows}
        kind={kind}
        leadKind={leadKind}
        menu={ownLabels ? menu : L(menu)}
        dimCol={level === 'adset' ? adsetCol : adCol}
        campCol={campCol}
        audience={level === 'adset' ? 'campaign' : 'creative'}
        sortable
        hideDefaultOrder
        copyLabels
        dimNoun={level === 'adset' ? 'ad set' : 'materi iklan'}
        emptyMessage={empty(level === 'adset' ? noAdset : noAd)}
        changes={changes}
        minSpend={level === 'adset' ? AUDIENCE_MIN_SPEND : undefined}
      />
    );
    return (
      <>
        {overall}
        {page('Traffic Analysis', audienceBadge, (
          <>
            {bars('Traffic Analysis by Audience', audienceBadge, menus.audienceTraffic, 'adset')}
            {bars('Traffic Analysis by Creative', creativeBadge, menus.traffic, 'creative')}
          </>
        ))}
        {menus.conversion && menus.creativeConversion && page('Conversion Analysis', audienceBadge, (
          <>
            {bars('Conversion Analysis by Audience', audienceBadge, menus.conversion, 'adset', true)}
            {bars('Conversion Analysis by Creative', creativeBadge, menus.creativeConversion, 'creative', true)}
          </>
        ))}
        {bars('Top Content Analysis by Creative', creativeBadge, menus.topContent, 'creative')}
      </>
    );
  }

  // The Overall card of one Non-Boost lane, with its Audiens switch.
  // Retail's root cause always draws the whole Conversion Rate branch
  // (Visit → ATC Rate and ATC → Purchase Rate), "—" where the file lacks it.
  function laneOverallCard(lane: NonBoostLane, r: MetaReport) {
    const kind = laneLeadKind(lane);
    // The audience picked on the card, back to Gabungan when this period has
    // no campaign for it.
    const aud = laneAud[lane.key] !== 'all' && lane.audiences?.[laneAud[lane.key] as 'NV' | 'RM'] ? laneAud[lane.key] : 'all';
    const side = aud === 'all' ? undefined : lane.audiences?.[aud];
    const variant = kind ? (side ? side.byKind?.[kind] : lane.leadResults?.byKind[kind]) : undefined;
    // Non Retail: deals and chats come from Brand Tracking, which counts the
    // whole brand — an NV or RM slice gets its own Meta half and "—" for them.
    const audRows = (rows: SheetRow[]) => (side && lane.campCol ? rows.filter((row) => audienceTypeOf(row[lane.campCol!]) === aud) : rows);
    const laneLeads = side ? null : leadTotals;
    const funnel = lane.key === 'b2b'
      ? buildMetaNonRetailFunnel(audRows(lane.oldRows), audRows(lane.curRows), laneLeads?.old ?? null, laneLeads?.cur ?? null)
      : side
        ? variant?.funnel ?? side.funnel
        : buildMetaSalesFunnel(lane.oldRows, lane.curRows, { keepConversionBranch: true });
    const overview = side?.overview ?? lane.overview;
    const audToggle = audienceToggle(lane.audiences, aud, (v) => setLaneAud((prev) => ({ ...prev, [lane.key]: v })));
    const rcaTitle = aud === 'all' ? 'Root Cause Analysis' : `Root Cause Analysis · ${aud}`;
    return (
      <OverviewDetailedCard
        fixedMetrics
        key={`${lane.key}-${aud}`}
        toolbar={audToggle ?? undefined}
        heading={lane.key === 'retail' ? 'Non-Boost Post (Retail) · Performance Overview' : 'Non-Boost Post (Non Retail) · Performance Overview'}
        badge={lane.objectives.length ? `objective ${lane.objectives.join(', ')}` : 'Meta Ads'}
        overviewRows={relabelMetaRows(lane.key === 'b2b'
          ? buildMetaOverviewRows('b2b', audRows(lane.oldRows), audRows(lane.curRows), !r.reachWarning, laneLeads)
          : variant?.overviewRows ?? overview.overviewRows)}
        detailedRows={relabelMetaRows(overview.detailedRows)}
        allCols={overview.allCols}
        p1={r.p1}
        p2={r.p2}
        aside={rcaPanel(funnel, r.p1, r.p2, rcaTitle)}
      />
    );
  }

  function lanePage(r: MetaReport, key: NonBoostLaneKey) {
    const lane = r.nonBoostLanes?.find((l) => l.key === key);
    if (!lane) return null;
    return (
      <SectionAccordion key={`v2-${lane.key}`}>
        {channelSections({
          prefix: key === 'retail' ? 'Non-Boost Post (Retail)' : 'Non-Boost Post (Non Retail)',
          period: r.p2,
          p1: r.p1,
          rows: lane.curRows,
          oldRows: lane.oldRows,
          kind: key === 'retail' ? 'sales' : 'b2b',
          leadKind: laneLeadKind(lane) ?? undefined,
          campCol: lane.campCol,
          overall: laneOverallCard(lane, r),
        })}
      </SectionAccordion>
    );
  }

  const steps: Step[] = [
    {
      label: 'Pilih file Meta Ads / CPAS',
      sub: periodSides.old && periodSides.cur ? `${periodSides.old.fileName} · ${periodSides.cur.fileName}` : undefined,
      status: metaRows || cpasRows ? 'done' : 'current',
    },
    { label: 'Generate laporan', status: report ? 'done' : ready ? 'current' : 'todo' },
    { label: 'Lihat & unduh PDF', status: report ? 'current' : 'todo' },
  ];

  // Each side's picked period, so the other side cannot be picked out of
  // order (Periode Ini before Periode Lalu).
  function pickedPeriod(role: PeriodRole): { start: string | null; label: string } | null {
    const month = role === 'old' ? oldPickedMonth : curPickedMonth;
    if (month) return { start: `${month.month}-01`, label: month.label };
    const run = role === 'old' ? oldPickedRun : curPickedRun;
    if (run) return { start: run.start, label: run.label || run.sourceComparison };
    const range = role === 'old' ? oldPickedRange : curPickedRange;
    return range ? { start: range.start, label: range.label } : null;
  }
  const boundFor = (role: PeriodRole) => periodBound(role, pickedPeriod('old'), pickedPeriod('cur'));

  return (
    <div className={`panel${isActive ? ' active' : ''}`}>

      <StepIndicator steps={steps} accent="var(--acc)" />

      {/* One board for every input of the comparison: periods across, sources
          down. Each period picks its source on the page itself — Upload,
          Perpustakaan, Arsip, or Rentang tanggal — and one stored pick fills
          that period's Meta Ads and CPAS together. */}
      <section className="setup-board" aria-label="Sumber data">
        <header className="setup-board-head">
          <h3>Sumber data</h3>
          <p>
            Isi Meta Ads, CPAS, atau keduanya — cukup salah satu. <strong>Perpustakaan</strong> dan <strong>Arsip</strong> mengisi baris yang Anda centang
            (Meta Ads, CPAS, atau keduanya); <strong>Rentang tanggal</strong> mengisi keduanya. Di mode Upload, tiap baris juga bisa diambil langsung dari Data Collection Hub.
          </p>
        </header>
        <div className="setup-grid">
          <div className="setup-corner" aria-hidden="true" />
          <div className="setup-col-head">Periode Lalu</div>
          <div className="setup-col-head">Periode Ini</div>

          <div className="setup-row-head">
            <strong>Sumber</strong>
            <small>per periode</small>
          </div>
          {(['old', 'cur'] as const).map((role) => {
            const pickedMonth = role === 'old' ? oldPickedMonth : curPickedMonth;
            const pickedRun = role === 'old' ? oldPickedRun : curPickedRun;
            const pickedRange = role === 'old' ? oldPickedRange : curPickedRange;
            const picked = pickedMonth
              ? { title: pickedMonth.label, summary: formatChannelCoverage(pickedMonth.channels), metaLine: `Perpustakaan Brand${scopeNote(pickedMonth.include)}` }
              : pickedRange
                ? {
                    title: pickedRange.label,
                    summary: Object.entries(pickedRange.channels).map(([ch, n]) => `${ch === 'cpas' ? 'CPAS' : 'Meta Ads'} ${n} hari`).join(' · '),
                    metaLine: 'Rentang tanggal · tarikan otomatis',
                  }
              : pickedRun
                ? {
                    title: pickedRun.label || pickedRun.sourceComparison,
                    summary: formatChannelCoverage(pickedRun.channels),
                    metaLine: `Arsip Laporan · ${pickedRun.sourceComparison}${scopeNote(pickedRun.include)}`,
                  }
                : null;
            const source = role === 'old' ? oldSource : curSource;
            const label = role === 'old' ? 'Periode Lalu' : 'Periode Ini';
            return (
              <div key={role} className="setup-cell" data-label={label}>
                <PeriodSourceSwitch
                  label={label}
                  value={sourceKindOf(role)}
                  onChange={(kind) => chooseSourceKind(role, kind)}
                  disabledSavedReason={!clientId ? 'Pilih klien terlebih dahulu' : null}
                />
                {source === 'saved' &&
                  (applyingRole === role ? (
                    <div className="setup-applying" role="status">
                      <span className="setup-spinner" aria-hidden="true" /> Menerapkan periode…
                    </div>
                  ) : sourceKindOf(role) === 'range' && clientId ? (
                    <RangeCalendar
                      clientId={clientId}
                      role={role}
                      value={pickedRange ? { start: pickedRange.start, end: pickedRange.end } : null}
                      other={(() => {
                        const o = role === 'old' ? curPickedRange : oldPickedRange;
                        return o ? { start: o.start, end: o.end } : null;
                      })()}
                      autoOpen={rangeAutoOpen === role}
                      onApply={(range) => applyRangeFor(role, range)}
                      bound={boundFor(role)}
                    />
                  ) : (
                    <SavedSlotCard
                      picked={picked && { title: picked.title, sourceComparison: '', savedAt: '', summary: picked.summary, metaLine: picked.metaLine }}
                      hint={SOURCE_HINT[sourceKindOf(role)]}
                      onOpen={() => openPicker(role, sourceKindOf(role))}
                      onClear={() => clearPickedPeriod(role)}
                    />
                  ))}
              </div>
            );
          })}

          <div className="setup-row-head">
            <strong>Meta Ads</strong>
            <small>opsional · Boost & Non-Boost</small>
          </div>
          <div className="setup-cell" data-label="Periode Lalu">{metaDropzone('meta', 'old', 'Periode Lalu')}</div>
          <div className="setup-cell" data-label="Periode Ini">{metaDropzone('meta', 'cur', 'Periode Ini')}</div>

          <div className="setup-row-head">
            <strong>CPAS Shopee</strong>
            <small>opsional</small>
          </div>
          <div className="setup-cell" data-label="Periode Lalu">{metaDropzone('cpas', 'old', 'Periode Lalu')}</div>
          <div className="setup-cell" data-label="Periode Ini">{metaDropzone('cpas', 'cur', 'Periode Ini')}</div>

          {dayCol && (oldDayBounds || curDayBounds) && (
            <>
              <div className="setup-row-head">
                <strong>Rentang dibandingkan</strong>
                <small>breakdown harian</small>
              </div>
              {(['old', 'cur'] as const).map((role) => {
                const bounds = role === 'old' ? oldDayBounds : curDayBounds;
                const range = role === 'old' ? oldRange : curRange;
                const setRange = role === 'old' ? setOldRange : setCurRange;
                const label = role === 'old' ? 'Periode Lalu' : 'Periode Ini';
                return (
                  <div key={role} className="setup-cell" data-label={label}>
                    {bounds ? (
                      <div className="setup-range">
                        <div className="setup-range-inputs">
                          <input
                            type="date"
                            className="period-text-input"
                            aria-label={`${label} — mulai`}
                            value={toISODate(range?.start ?? null) ?? ''}
                            min={toISODate(bounds.min) ?? undefined}
                            max={toISODate(bounds.max) ?? undefined}
                            onChange={(e) => {
                              const d = fromISODate(e.target.value);
                              if (d) setRange((prev) => ({ start: d, end: prev?.end ?? d }));
                              setReport(null);
                              onInvalidate();
                            }}
                          />
                          <span aria-hidden="true">–</span>
                          <input
                            type="date"
                            className="period-text-input"
                            aria-label={`${label} — selesai`}
                            value={toISODate(range?.end ?? null) ?? ''}
                            min={toISODate(bounds.min) ?? undefined}
                            max={toISODate(bounds.max) ?? undefined}
                            onChange={(e) => {
                              const d = fromISODate(e.target.value);
                              if (d) setRange((prev) => ({ start: prev?.start ?? d, end: d }));
                              setReport(null);
                              onInvalidate();
                            }}
                          />
                        </div>
                        {range && (
                          <span className="setup-range-meta num">
                            {formatPeriodLabel(range.start, range.end)} · {daysBetweenInclusive(range.start, range.end)} hari
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="setup-empty">Belum ada file {label}.</div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {uploadError && <InlineNotice title="File ini belum kebaca">{uploadError}</InlineNotice>}
        {dayCol &&
          ((oldDayBounds ? daysBetweenInclusive(oldDayBounds.min, oldDayBounds.max) : 0) > LONG_DAY_RANGE_WARNING_THRESHOLD ||
            (curDayBounds ? daysBetweenInclusive(curDayBounds.min, curDayBounds.max) : 0) > LONG_DAY_RANGE_WARNING_THRESHOLD) && (
            <InlineNotice tone="info" title="Salah satu file breakdown harian ini cukup panjang — pastikan ini yang dimaksud">
              Tidak masalah untuk digenerate, tapi kalau ini bukan rentang yang dimaksud, cek kembali file yang diexport dari Meta Ads Reporting.
            </InlineNotice>
          )}
        {dayCol && oldRange && curRange && Math.abs(daysBetweenInclusive(oldRange.start, oldRange.end) - daysBetweenInclusive(curRange.start, curRange.end)) > 1 && (
          <div className="period-warning" style={{ marginTop: '.8rem', marginBottom: 0 }}>
            Panjang periode berbeda: {daysBetweenInclusive(oldRange.start, oldRange.end)} hari vs {daysBetweenInclusive(curRange.start, curRange.end)} hari — bandingkan dengan hati-hati.
          </div>
        )}
      </section>

      {pickerRole && clientId && (
        <PeriodSourcePicker
          clientId={clientId}
          platform="meta"
          periodChannels={META_PERIOD_CHANNELS}
          sideLabel={`${pickerRowOnly ? `${pickerInclude.map((k) => (k === 'cpas' ? 'CPAS' : 'Meta Ads')).join(' & ')} · ` : ''}${pickerRole === 'old' ? 'Periode Lalu' : 'Periode Ini'}`}
          platformLabel="Meta Ads"
          scope={{ options: META_PICK_SCOPE, initial: pickerInclude }}
          selectedMonth={pickerRowOnly ? null : (pickerRole === 'old' ? oldPickedMonth : curPickedMonth)?.month ?? null}
          selectedRun={
            (pickerRole === 'old' ? oldPickedRun : curPickedRun)
              ? { runId: (pickerRole === 'old' ? oldPickedRun : curPickedRun)!.runId, role: (pickerRole === 'old' ? oldPickedRun : curPickedRun)!.role }
              : null
          }
          onClose={() => setPickerRole(null)}
          onPickLibrary={handlePickMonth}
          onPickArchive={handlePickArchive}
          initialTab={pickerTab === 'range' ? 'library' : pickerTab}
          bound={boundFor(pickerRole)}
        />
      )}

      {ready && (
        <div id="cta" style={{ marginTop: '1rem' }}>
          <div className="action-row">
            <button
              className="btn btn-primary"
              onClick={() => {
                generate();
                armReportScroll();
              }}
            >
              Generate Laporan
            </button>
            <button className="btn btn-ghost" onClick={reset}>
              <RotateCcw size={15} aria-hidden /> Reset
            </button>
          </div>
        </div>
      )}

      {restoring && (
        <div className="setup-applying" role="status">
          <span className="setup-spinner" aria-hidden="true" /> Membuka laporan terakhir…
        </div>
      )}

      {report && (
        <div id="report-meta">
          <div className="report-top">
            <div className="report-title">Performance Report</div>
            <div className="report-period">
              <PeriodCompareChip old={report.p1} cur={report.p2} onBrand />
            </div>
            <div className="report-meta num">Generated {generatedAt}</div>
          </div>
          <div data-role="r-body" ref={bodyRef}>
            <PeriodWarningBanner message={report.periodWarning} />
            <PeriodWarningBanner message={report.reachWarning} />
            <PeriodWarningBanner message={report.reachApproxNote} />
            {!hasAnySection && <div className="empty-note">Tidak ada section yang bisa ditampilkan. Periksa format file.</div>}
            <ReportPages
              accent="var(--acc)"
              pages={[
                {
                  id: 'v2-boost',
                  label: 'Boost Post',
                  hidden: !report.boost,
                  content: report.boost ? (
                    <SectionAccordion>
                      {channelSections({
                        prefix: 'Boost Post',
                        period: report.p2,
                        p1: report.p1,
                        rows: report.curRows?.boost ?? [],
                        oldRows: report.oldRows?.boost ?? [],
                        kind: 'brand',
                        campCol: report.cols?.campaign ?? null,
                        overall: (() => {
                          const aud = boostAud !== 'all' && report.boostAudiences?.[boostAud] ? boostAud : 'all';
                          const side = aud === 'all' ? report.boost! : report.boostAudiences![aud]!.overview;
                          const funnel = aud === 'all' ? report.boostFunnel : report.boostAudiences![aud]!.funnel;
                          const audToggle = audienceToggle(report.boostAudiences, aud, setBoostAud);
                          return (
                            <OverviewDetailedCard
                              fixedMetrics
                              key={aud}
                              toolbar={audToggle ?? undefined}
                              heading="Boost Post · Performance Overview"
                              badge={report.boostObjective ? `objective ${report.boostObjective.label}${report.boostObjective.mixed ? ' (dominan)' : ''}` : 'Meta Ads'}
                              overviewRows={relabelMetaRows(side.overviewRows)}
                              detailedRows={relabelMetaRows(side.detailedRows)}
                              allCols={side.allCols}
                              p1={report.p1}
                              p2={report.p2}
                              aside={rcaPanel(funnel, report.p1, report.p2, aud === 'all' ? 'Root Cause Analysis' : `Root Cause Analysis · ${aud}`, 'Brand Consideration')}
                            />
                          );
                        })(),
                      })}
                    </SectionAccordion>
                  ) : null,
                },
                {
                  id: 'v2-nb-retail',
                  label: 'Non-Boost Post (Retail)',
                  hidden: !report.nonBoostLanes?.some((l) => l.key === 'retail'),
                  content: lanePage(report, 'retail'),
                },
                {
                  id: 'v2-nb-nonretail',
                  label: 'Non-Boost Post (Non Retail)',
                  hidden: !report.nonBoostLanes?.some((l) => l.key === 'b2b'),
                  content: lanePage(report, 'b2b'),
                },
                {
                  id: 'v2-cpas',
                  label: 'CPAS Shopee',
                  hidden: !report.cpas || !(report.cpas.overall || report.cpas.nv || report.cpas.rm),
                  content: (() => {
                    const cpas = report.cpas;
                    if (!cpas) return null;
                    return (
                      <SectionAccordion>
                        {channelSections({
                          prefix: 'CPAS Shopee',
                          period: cpas.p2,
                          p1: cpas.p1,
                          rows: report.curRows?.cpas ?? [],
                          oldRows: report.oldRows?.cpas ?? [],
                          kind: 'sales',
                          campCol: report.cols?.cpasCampaign ?? null,
                          overall: (() => {
                            // One card, the audience picked on its toolbar; a side
                            // the period has no campaign for is shown disabled.
                            const sides = { all: cpas.overall, NV: cpas.nv, RM: cpas.rm };
                            const funnels = { all: cpas.funnel, NV: cpas.nvFunnel, RM: cpas.rmFunnel };
                            const aud = sides[cpasAud] ? cpasAud : (['all', 'NV', 'RM'] as const).find((k) => sides[k]) ?? 'all';
                            const side = sides[aud];
                            if (!side) return null;
                            const none = 'Tidak ada campaign dengan label ini di periode ini';
                            return (
                              <OverviewDetailedCard
                                fixedMetrics
                                key={aud}
                                toolbar={cpas.nv || cpas.rm ? (
                                  <SegmentedToggle
                                    label="Audiens"
                                    options={[
                                      { value: 'all', label: 'Gabungan NV + RM', disabled: cpas.overall ? false : none },
                                      { value: 'NV', label: 'NV', disabled: cpas.nv ? false : none },
                                      { value: 'RM', label: 'RM', disabled: cpas.rm ? false : none },
                                    ]}
                                    value={aud}
                                    onChange={setCpasAud}
                                    accent="var(--acc)"
                                  />
                                ) : undefined}
                                heading="CPAS Shopee · Performance Overview"
                                badge={aud === 'NV' ? 'New Visitor' : aud === 'RM' ? 'Re-Marketing' : 'Gabungan NV + RM'}
                                overviewRows={relabelMetaRows(side.overviewRows)}
                                detailedRows={relabelMetaRows(side.detailedRows)}
                                allCols={side.allCols}
                                p1={cpas.p1}
                                p2={cpas.p2}
                                aside={rcaPanel(funnels[aud], cpas.p1, cpas.p2, aud === 'all' ? 'Root Cause Analysis' : `Root Cause Analysis · ${aud}`)}
                              />
                            );
                          })(),
                        })}
                      </SectionAccordion>
                    );
                  })(),
                },
              ]}
            />
          </div>
          <AiSummarySection
              clientId={clientId}
              platform="meta"
              period={{ old: report.p1, cur: report.p2 }}
              periodDates={{ oldStart: report.periodOldStart, oldEnd: report.periodOldEnd, curStart: report.periodCurStart, curEnd: report.periodCurEnd }}
              kpis={report.summary.kpis}
              cpasKpis={report.summary.cpasKpis}
              periodWarning={report.periodWarning}
              notes={[report.reachWarning, report.reachApproxNote].filter(Boolean) as string[]}
            />
          <div className="action-row" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
            <DownloadPdfButton targetId="report-meta" filename="Performance Report - Meta Ads.pdf" />
            <button className="btn btn-ghost" onClick={reset}>
              <RotateCcw size={15} aria-hidden /> Ganti Sumber Data
            </button>
          </div>
          <SaveStatus status={autoSave.status} message={autoSave.message} />
        </div>
      )}
    </div>
  );
}
