import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import api from '../../../api/client.js';
import { LibraryFileSlot } from '../reports/LibraryFileSlot';
import { ManualFileSlot } from '../reports/ManualFileSlot';
import { ReportPages } from '../../components/ReportPages';
import { SectionAccordion, SectionGroup } from '../../components/SectionAccordion';
import { useScrollAfterGenerate } from '../../hooks/useScrollAfterGenerate';
import { HowTo, HowToStep } from '../../components/HowTo';
import { InlineNotice } from '../../components/InlineNotice';
import { SearchSelect } from '../../components/SearchSelect';
import {
  META_OBJECTIVE_CHOICES,
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
import { MetaSpecialMomentSection, type MomentPeriod, type MomentSource } from './MetaSpecialMomentSection';
import { MetaBreakdownSection } from './MetaBreakdownSection';
import {
  BRAND_AUDIENCE_METRICS,
  BRAND_CREATIVE_METRICS,
  B2B_AGE_METRICS,
  B2B_ATC_PURCHASE_METRICS,
  B2B_CLICK_ATC_METRICS,
  B2B_CONVERSION_METRICS,
  B2B_CREATIVE_CONVERSION_METRICS,
  B2B_GENDER_METRICS,
  B2B_TRAFFIC_METRICS,
  SALES_AGE_METRICS,
  SALES_ATC_PURCHASE_METRICS,
  SALES_AUDIENCE_METRICS,
  SALES_CLICK_ATC_METRICS,
  SALES_CONVERSION_METRICS,
  SALES_CREATIVE_CONVERSION_METRICS,
  SALES_TRAFFIC_METRICS,
  findAdCol,
} from '../../lib/metaAudience';
import { MetaCompareBars } from './MetaCompareBars';
import { MetaLaneSwitch } from './MetaLaneSwitch';
import { SymptomTreePanel } from '../shopee/AnalysisSections';
import type { MetaFunnel } from '../../lib/metaFunnel';
import { SaveStatus } from '../reports/SaveStatus';
import { useAutoSave } from '../reports/useAutoSave';
import { mapMetaCpasRows, mapMetaMainRows } from '../reports/rowMapping';
import { PeriodSourcePicker, type LibraryMonth, type PeriodSourceTab } from '../reports/PeriodSourcePicker';
import { RangeCalendar } from '../reports/RangeCalendar';
import type { AutoRange } from '../reports/AutoRangePanel';
import { getClients, getSavedPeriod } from '../reports/api';
import { formatChannelCoverage } from '../reports/savedPeriodLabels';
import { PeriodSourceSwitch, SavedSlotCard, type PeriodSourceKind, type SlotSource } from '../../components/SlotSourceTabs';
import type { PeriodRole, RawFileEntry, SavedPeriod, SaveReportPayload } from '../reports/types';
import { buildMetaReport, isBoostRow, type MetaReport, type NonBoostLaneKey } from './metaReport';

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
const META_INDUSTRY_LABEL: Record<'b2b' | 'retail', string> = { b2b: 'B2B / Services', retail: 'Retail' };
const OBJECTIVE_OPTIONS = META_OBJECTIVE_CHOICES.map((o) => ({ id: o.key, name: o.label }));

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
}
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

function formatGeneratedDate(): string {
  return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
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

  // B2B / Retail — not in the export; read from the brand's Kategori Industri
  // in Brand Setting and only editable there. Objective — Meta's ODAX
  // objective; auto-prefilled from the file's "Objective" column when present,
  // still overridable.
  const [brandIndustry, setBrandIndustry] = useState<string | null | undefined>(undefined); // undefined = loading
  const industry: MetaIndustry = brandIndustry ? BRAND_INDUSTRY_TO_META[brandIndustry] ?? null : null;
  // Which Non-Boost lane (Retail / B2B Leads) the Non-Boost page reads.
  const [nbLane, setNbLane] = useState<NonBoostLaneKey>('retail');
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
  const dayCol = useMemo(() => (metaRows ? findCol(metaRows, ['day']) : null), [metaRows]);

  // The report is read one ad source at a time (CPAS / Non-Boost / Boost), so
  // Special Moment is too: each section's own rows, both periods, subtotal
  // rows dropped the same way buildMetaReport drops them.
  const nonBoostAllRows = useMemo(() => {
    if (!metaRows) return [];
    const leaves = stripCampaignSubtotals(metaRows);
    const isBoost = isBoostRow(findCol(leaves, ['campaign']));
    return leaves.filter((r) => !isBoost(r));
  }, [metaRows]);
  const boostAllRows = useMemo(() => {
    if (!metaRows) return [];
    const leaves = stripCampaignSubtotals(metaRows);
    const isBoost = isBoostRow(findCol(leaves, ['campaign']));
    return leaves.filter(isBoost);
  }, [metaRows]);
  const cpasAllRows = useMemo(() => (cpasRows ? stripCampaignSubtotals(cpasRows) : []), [cpasRows]);
  const cpasDayCol = useMemo(() => (cpasAllRows.length ? findCol(cpasAllRows, ['day']) : null), [cpasAllRows]);

  // Special Moment compares the two periods, so it needs each side's own date
  // range: the Meta sides use the ranges shown in the date pickers, the CPAS
  // sides their file's own first/last day.
  const cpasRanges = useMemo(() => {
    if (!cpasDayCol) return { old: null, cur: null };
    return {
      old: cpasSides.old ? metaDayRange(cpasSides.old.rows, cpasDayCol) : null,
      cur: cpasSides.cur ? metaDayRange(cpasSides.cur.rows, cpasDayCol) : null,
    };
  }, [cpasSides, cpasDayCol]);
  const [oldRange, setOldRange] = useState<{ start: Date; end: Date } | null>(null);
  const [curRange, setCurRange] = useState<{ start: Date; end: Date } | null>(null);
  const oldDayBounds = useMemo(() => (dayCol && metaSides.old ? metaDayRange(metaSides.old.rows, dayCol) : null), [dayCol, metaSides.old]);
  const curDayBounds = useMemo(() => (dayCol && metaSides.cur ? metaDayRange(metaSides.cur.rows, dayCol) : null), [dayCol, metaSides.cur]);

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
  const bodyRef = useRef<HTMLDivElement>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // "Pilih Periode" — per side, sourced from the brand library (any month
  // uploaded there), exactly like Shopee's picker: one pick fills that
  // side's Meta Ads + CPAS files at once; a fresh upload on either slot
  // below still overrides just that one file.
  const [oldSource, setOldSource] = useState<SlotSource>('upload');
  const [curSource, setCurSource] = useState<SlotSource>('upload');
  const [oldPickedMonth, setOldPickedMonth] = useState<LibraryMonth | null>(null);
  const [curPickedMonth, setCurPickedMonth] = useState<LibraryMonth | null>(null);
  // The other stored source: a period of a report already generated. Its rows
  // come back from the archive exactly as they were parsed, so a slot can be
  // filled without the original file.
  const [oldPickedRun, setOldPickedRun] = useState<SavedPeriod | null>(null);
  const [curPickedRun, setCurPickedRun] = useState<SavedPeriod | null>(null);
  // The third stored source: any day range of the auto-fetched daily rows.
  const [oldPickedRange, setOldPickedRange] = useState<AutoRange | null>(null);
  const [curPickedRange, setCurPickedRange] = useState<AutoRange | null>(null);
  const [pickerRole, setPickerRole] = useState<PeriodRole | null>(null);
  // Which stored source the switch last asked for, per period, until a pick
  // lands — and which list the dialog opens on.
  const [pendingKind, setPendingKind] = useState<Record<PeriodRole, PeriodSourceKind>>({ old: 'library', cur: 'library' });
  const [pickerTab, setPickerTab] = useState<PeriodSourceTab>('library');
  const [rangeAutoOpen, setRangeAutoOpen] = useState<PeriodRole | null>(null);

  function sourceKindOf(role: PeriodRole): PeriodSourceKind {
    if ((role === 'old' ? oldSource : curSource) === 'upload') return 'upload';
    if (role === 'old' ? oldPickedMonth : curPickedMonth) return 'library';
    if (role === 'old' ? oldPickedRun : curPickedRun) return 'archive';
    if (role === 'old' ? oldPickedRange : curPickedRange) return 'range';
    return pendingKind[role];
  }

  function openPicker(role: PeriodRole, kind: PeriodSourceKind) {
    setPickerTab(kind === 'upload' ? 'library' : kind);
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

  async function applyLibraryMonth(targetRole: PeriodRole, month: LibraryMonth) {
    if (!clientId) return;
    setApplyingRole(targetRole);
    setUploadError(null);
    try {
      const { data } = await api.get(`/brands/${clientId}/library`);
      const files = (data.files as LibraryFileMeta[]).filter((f) => f.platform === 'meta' && f.period_month?.slice(0, 7) === month.month);
      const metaList = files.filter((f) => (META_MAIN_CHANNELS as readonly string[]).includes(f.channel));
      const cpasList = files.filter((f) => f.channel === 'cpas');

      async function downloadAndParse(list: LibraryFileMeta[]): Promise<SheetRow[]> {
        const parts = await Promise.all(list.map((f) => downloadLibraryFile(clientId!, f)));
        return alignRowKeys((await Promise.all(parts.map(readSpreadsheetFile))).flat());
      }

      if (metaList.length) {
        const rows = await downloadAndParse(metaList);
        setMetaSides((prev) => ({ ...prev, [targetRole]: rows.length ? { rows, fileName: metaList.map((f) => f.original_filename).join(' · ') } : null }));
      } else {
        setMetaSides((prev) => ({ ...prev, [targetRole]: null }));
      }
      if (cpasList.length) {
        const rows = await downloadAndParse(cpasList);
        setCpasSides((prev) => ({ ...prev, [targetRole]: rows.length ? { rows, fileName: cpasList.map((f) => f.original_filename).join(' · ') } : null }));
      } else {
        setCpasSides((prev) => ({ ...prev, [targetRole]: null }));
      }

      setReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal memuat periode dari perpustakaan: ' + (err as Error).message);
      (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
      (targetRole === 'old' ? setOldSource : setCurSource)('upload');
    } finally {
      setApplyingRole(null);
    }
  }

  function handlePickMonth(month: LibraryMonth) {
    const targetRole = pickerRole;
    if (!targetRole) return;
    (targetRole === 'old' ? setOldPickedRun : setCurPickedRun)(null);
    (targetRole === 'old' ? setOldPickedRange : setCurPickedRange)(null);
    (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(month);
    (targetRole === 'old' ? setOldSource : setCurSource)('saved');
    applyLibraryMonth(targetRole, month);
  }

  // Boost and Non-Boost were stored as two channels of one Meta file; putting
  // them back together restores exactly what that report read.
  async function applyArchivePeriod(targetRole: PeriodRole, period: SavedPeriod) {
    setApplyingRole(targetRole);
    setUploadError(null);
    try {
      const detail = await getSavedPeriod(period.runId, period.role);
      const metaRowsSaved = [...(detail.channels.boost ?? []), ...(detail.channels.nonboost ?? [])];
      const cpasRowsSaved = detail.channels.cpas_overall ?? [];
      if (!metaRowsSaved.length && !cpasRowsSaved.length) throw new Error('Periode ini tidak menyimpan baris data apa pun.');
      const name = `Arsip · ${period.label || period.sourceComparison}`;
      setMetaSides((prev) => ({ ...prev, [targetRole]: metaRowsSaved.length ? { rows: metaRowsSaved, fileName: name } : null }));
      setCpasSides((prev) => ({ ...prev, [targetRole]: cpasRowsSaved.length ? { rows: cpasRowsSaved, fileName: name } : null }));
      setReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal memuat periode dari arsip laporan: ' + (err as Error).message);
      (targetRole === 'old' ? setOldPickedRun : setCurPickedRun)(null);
      (targetRole === 'old' ? setOldSource : setCurSource)('upload');
    } finally {
      setApplyingRole(null);
    }
  }

  function handlePickArchive(period: SavedPeriod) {
    const targetRole = pickerRole;
    if (!targetRole) return;
    (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
    (targetRole === 'old' ? setOldPickedRange : setCurPickedRange)(null);
    (targetRole === 'old' ? setOldPickedRun : setCurPickedRun)(period);
    (targetRole === 'old' ? setOldSource : setCurSource)('saved');
    applyArchivePeriod(targetRole, period);
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
      if (!metaRowsRange.length) throw new Error('Belum ada data Meta Ads tersimpan pada rentang ini.');
      const cpasRowsRange = cpasFile ? await readSpreadsheetFile(cpasFile) : [];
      const name = `Tarikan otomatis · ${range.label}`;
      setMetaSides((prev) => ({ ...prev, [targetRole]: { rows: metaRowsRange, fileName: name } }));
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
  function pickObjective(obj: MetaObjectiveKey | null) {
    setObjective(obj);
    setReport(null);
    onInvalidate();
  }

  // When the export carries an "Objective" column, Non-Boost is split per
  // objective automatically; the Objective dropdown is prefilled but purely
  // informational then. Without the column, the Objective pick is the single
  // Non-Boost headline.
  const objectiveCol = metaRows ? detectMetaObjectiveCol(metaHeaders) : null;

  // Prefill the Objective dropdown with the Non-Boost lane's highest-spend
  // objective — read per campaign from the Objective column, else the name,
  // else the metrics — once per file; a manual change afterwards sticks.
  // Boost rows stay out: the dropdown is about Non-Boost.
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

  const objectiveOk = Boolean(objectiveCol) || Boolean(objective) || Boolean(industry);
  const dayRangesOk = !dayCol || Boolean(oldRange && curRange && oldRange.start <= oldRange.end && curRange.start <= curRange.end);
  const ready = Boolean(metaRows && objectiveOk && clientId && dayRangesOk);
  const dayRanges = oldRange && curRange ? { old: oldRange, cur: curRange } : null;

  const autoSave = useAutoSave('meta');
  const armReportScroll = useScrollAfterGenerate('report-meta', report);

  function generate() {
    if (!metaRows) return;
    const r = buildMetaReport({ metaRows, metaHeaders, cpasRows, cpasHeaders, industry, customResultsCol, objective, dayRanges });
    setNbLane(r.nonBoostLanes?.[0]?.key ?? 'retail');
    setReport(r);
    setGeneratedAt(formatGeneratedDate());
    onGenerated({ period: { old: r.p1, cur: r.p2 }, kpis: r.summary.kpis, cpasKpis: r.summary.cpasKpis, spend: r.summary.spend });
    autoSave.save(clientId, buildSavePayload(r), buildSaveFiles());
  }

  function reset() {
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
    setNbLane('retail');
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
  function analysisSections({
    prefix,
    period,
    rows,
    kind,
    campCol,
    ageCol,
    genderCol,
  }: {
    prefix: string;
    period: string;
    rows: SheetRow[];
    kind: 'sales' | 'b2b' | 'brand';
    campCol: string | null;
    ageCol: string | null;
    genderCol: string | null;
  }) {
    const adCol = rows.length ? findAdCol(rows) : null;
    const badge = `data ${period}`;
    const noAd = 'Bagian ini membandingkan performa per materi iklan. File yang diunggah tidak dipecah per Ad — export ulang dari Meta Ads Reporting dengan breakdown Ad name.';
    const noAge = 'File yang diunggah tidak memuat breakdown Age.';
    const noGender = 'File yang diunggah tidak memuat breakdown Gender.';
    if (kind === 'brand') {
      return (
        <>
          <SectionGroup label="Audience Analysis">
            <MetaCompareBars heading={`${prefix} · Age Breakdown`} badge={badge} rows={rows} kind="brand" menu={BRAND_AUDIENCE_METRICS} dimCol={ageCol} campCol={campCol} audience="none" sortable dimNoun="kelompok umur" emptyMessage={noAge} />
            {genderCol ? (
              <MetaBreakdownSection heading={`${prefix} · Gender Breakdown`} badge={badge} rows={rows} dimCol={genderCol} kind="brand" metrics={BRAND_AUDIENCE_METRICS} prefer="pies" />
            ) : (
              <MetaCompareBars heading={`${prefix} · Gender Breakdown`} badge={badge} rows={rows} kind="brand" menu={BRAND_AUDIENCE_METRICS} dimCol={null} campCol={null} audience="none" sortable={false} dimNoun="gender" emptyMessage={noGender} />
            )}
          </SectionGroup>
          <SectionGroup label="Creative Analysis">
            <MetaCompareBars heading={`${prefix} · Creative Performance`} badge={`per materi iklan · ${period}`} rows={rows} kind="brand" menu={BRAND_CREATIVE_METRICS} dimCol={adCol} campCol={campCol} audience="none" sortable copyLabels dimNoun="materi iklan" emptyMessage={noAd} />
          </SectionGroup>
        </>
      );
    }
    const sales = kind === 'sales';
    // The architecture sheet's four funnel charts, for both lanes; B2B reads
    // them through metaB2bMetrics (a lead stands in for a purchase).
    const funnels = [
      { title: 'Traffic Analysis', menu: sales ? SALES_TRAFFIC_METRICS : B2B_TRAFFIC_METRICS },
      { title: 'Conversion Rate', menu: sales ? SALES_CONVERSION_METRICS : B2B_CONVERSION_METRICS },
      { title: 'Click → ATC Rate', menu: sales ? SALES_CLICK_ATC_METRICS : B2B_CLICK_ATC_METRICS },
      { title: 'ATC → Purchase Rate', menu: sales ? SALES_ATC_PURCHASE_METRICS : B2B_ATC_PURCHASE_METRICS },
    ];
    return (
      <>
        <SectionGroup label="Audience Analysis">
          <MetaCompareBars
            heading={`${prefix} · Age Breakdown`}
            badge={`NV · RM · ${period}`}
            rows={rows}
            kind={kind}
            menu={sales ? SALES_AGE_METRICS : B2B_AGE_METRICS}
            dimCol={ageCol}
            campCol={campCol}
            audience="age"
            sortable={false}
            dimNoun="kelompok umur"
            emptyMessage={noAge}
          />
          {genderCol ? (
            <MetaBreakdownSection
              heading={`${prefix} · Gender Breakdown`}
              badge={`NV · RM · ${period}`}
              rows={rows}
              dimCol={genderCol}
              kind={kind}
              metrics={(sales ? SALES_AUDIENCE_METRICS : B2B_GENDER_METRICS) as typeof SALES_AUDIENCE_METRICS}
              prefer="pies"
              campCol={campCol}
            />
          ) : (
            <MetaCompareBars heading={`${prefix} · Gender Breakdown`} badge={badge} rows={rows} kind={kind} menu={SALES_AUDIENCE_METRICS} dimCol={null} campCol={null} audience="none" sortable={false} dimNoun="gender" emptyMessage={noGender} />
          )}
          {funnels.map((f) => (
            <MetaCompareBars
              key={f.title}
              heading={`${prefix} · ${f.title}`}
              badge={`per campaign · NV · RM · ${period}`}
              rows={rows}
              kind={kind}
              menu={f.menu}
              dimCol={campCol}
              campCol={campCol}
              audience="campaign"
              sortable
              copyLabels
              dimNoun="campaign"
              emptyMessage="File yang diunggah tidak memuat kolom Campaign name."
            />
          ))}
        </SectionGroup>
        <SectionGroup label="Creative Analysis">
          <MetaCompareBars
            heading={`${prefix} · Creative Traffic`}
            badge={`per materi iklan · ${period}`}
            rows={rows}
            kind={kind}
            menu={sales ? SALES_TRAFFIC_METRICS : B2B_TRAFFIC_METRICS}
            dimCol={adCol}
            campCol={campCol}
            audience="creative"
            sortable
            copyLabels
            dimNoun="materi iklan"
            emptyMessage={noAd}
          />
          <MetaCompareBars
            heading={`${prefix} · Creative Conversion`}
            badge={`per materi iklan · ${period}`}
            rows={rows}
            kind={kind}
            menu={sales ? SALES_CREATIVE_CONVERSION_METRICS : B2B_CREATIVE_CONVERSION_METRICS}
            dimCol={adCol}
            campCol={campCol}
            audience="creative"
            sortable
            copyLabels
            dimNoun="materi iklan"
            emptyMessage={noAd}
          />
        </SectionGroup>
      </>
    );
  }

  const steps: Step[] = [
    {
      label: 'Pilih file Meta Ads & industri',
      sub: metaSides.old && metaSides.cur ? `${metaSides.old.fileName} · ${metaSides.cur.fileName}` : undefined,
      status: metaRows && objectiveOk ? 'done' : 'current',
    },
    { label: 'Generate laporan', status: report ? 'done' : ready ? 'current' : 'todo' },
    { label: 'Lihat & unduh PDF', status: report ? 'current' : 'todo' },
  ];

  return (
    <div className={`panel${isActive ? ' active' : ''}`}>
      <HowTo>
        <HowToStep num={1} title="Download file dari Meta Ads Reporting — satu bulan per periode">
          Download <strong>dua file terpisah</strong> dari Meta Ads Reporting, masing-masing mencakup satu bulan/periode saja — satu untuk periode lalu, satu untuk periode ini. Gunakan kolom-kolom berikut sesuai jenis akun:
          <div className="empty-note" style={{ padding: '.4rem 0 0' }}>
            Meta Ads Reporting dapat memakai breakdown "Month" atau "Day". Jika memilih "Month", satu file = satu bulan penuh. Jika memilih "Day", tanggalnya bebas asal tidak melewati bulan yang dimaksud.
          </div>
          <div className="empty-note" style={{ padding: '.4rem 0 0' }}>
            <strong>Penting untuk hasil yang presisi:</strong> saat export, pilih format <strong>"Formatted data table (.xlsx)"</strong> (bukan "Raw data").
          </div>
          <div className="howto-cols">
            <div className="howto-col-block">
              <div className="howto-col-title">
                Main Ad Account <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '.62rem', textTransform: 'none', letterSpacing: 0 }}>· breakdown month, age, gender</span>
              </div>
              <ul className="howto-col-list">
                {['Campaign Name', 'Objective', 'Amount Spent', 'CTR', 'Cost per Click', 'Profile Visits', 'Cost per Profile Visit', 'View Content', 'Cost per View Content', 'View Content to ATC Ratio', 'Cost per ATC', 'ATC to Purchase Ratio', 'Purchase', 'Purchase Value', 'Cost per Purchase', 'ROAS', 'Custom conversions lain yang applicable'].map((c) => (
                  <li key={c} className={c === 'Objective' ? 'howto-col-req' : undefined}>
                    {c}
                    {c === 'Objective' && <span className="howto-col-note"> — dipakai untuk memecah Amount Spent per objective</span>}
                  </li>
                ))}
              </ul>
              <div className="empty-note" style={{ padding: '.35rem 0 0', fontSize: '.66rem' }}>
                Kolom <strong>Objective</strong> &amp; <strong>Campaign Name</strong> adalah kolom identitas (bukan metrik angka) — <strong>Objective</strong>{' '}
                sangat disarankan: dipakai untuk memecah Non-Boost per objective (Sales / Leads / Engagement / Traffic). Tanpa kolom ini, objective
                dibaca dari nama campaign (format MIL: <em>NV | Sales - VC | …</em>), lalu dari metrik hasilnya.
              </div>
            </div>
            <div className="howto-col-block">
              <div className="howto-col-title">
                CPAS Shopee <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: '.62rem', textTransform: 'none', letterSpacing: 0 }}>· breakdown month, age, gender</span>
              </div>
              <ul className="howto-col-list">
                {['Campaign Name', 'Amount Spent', 'CTR', 'Cost per Click', 'View Content with Shared Items', 'Cost per View Content', 'View Content to ATC Ratio', 'ATC with Shared Items', 'Cost per ATC', 'ATC to Purchase Ratio', 'Purchase with Shared Items', 'Purchase Value with Shared Items', 'ROAS', 'Cost per Purchase'].map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        </HowToStep>
        <HowToStep num={2} title="Pilih sumber & buat laporan">
          Pilih file Meta Ads untuk periode lalu dan periode ini dari Data Collection Hub (wajib). Pilih juga file CPAS jika tersedia. Klik <strong>Generate Laporan</strong> untuk melihat hasil.
        </HowToStep>
      </HowTo>

      <StepIndicator steps={steps} accent="var(--acc)" />

      {/* One board for every input of the comparison: periods across, sources
          down. Each period picks its source on the page itself — Upload,
          Perpustakaan, Arsip, or Rentang tanggal — and one stored pick fills
          that period's Meta Ads and CPAS together. */}
      <section className="setup-board" aria-label="Sumber data">
        <header className="setup-board-head">
          <h3>Sumber data</h3>
          <p>
            Meta Ads wajib, CPAS opsional. Pilihan <strong>Perpustakaan</strong>, <strong>Arsip</strong>, atau <strong>Rentang tanggal</strong> mengisi Meta Ads
            dan CPAS periode itu sekaligus; upload di satu baris hanya mengganti file baris itu.
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
              ? { title: pickedMonth.label, summary: formatChannelCoverage(pickedMonth.channels), metaLine: 'Perpustakaan Brand' }
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
                    metaLine: `Arsip Laporan · ${pickedRun.sourceComparison}`,
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
            <small className="is-req">wajib</small>
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
          sideLabel={pickerRole === 'old' ? 'Periode Lalu' : 'Periode Ini'}
          selectedMonth={(pickerRole === 'old' ? oldPickedMonth : curPickedMonth)?.month ?? null}
          selectedRun={
            (pickerRole === 'old' ? oldPickedRun : curPickedRun)
              ? { runId: (pickerRole === 'old' ? oldPickedRun : curPickedRun)!.runId, role: (pickerRole === 'old' ? oldPickedRun : curPickedRun)!.role }
              : null
          }
          onClose={() => setPickerRole(null)}
          onPickLibrary={handlePickMonth}
          onPickArchive={handlePickArchive}
          initialTab={pickerTab === 'range' ? 'library' : pickerTab}
        />
      )}

      {metaRows && (
        <section className="setup-board setup-board-split" aria-label="Industri dan objective">
          <header className="setup-board-head">
            <h3>Industri &amp; objective</h3>
            <p>
              Non-Boost dipetakan otomatis ke <strong>Retail</strong> atau <strong>B2B Leads</strong> per campaign (nama campaign, lalu objective
              {objectiveCol ? <> dari kolom “{objectiveCol}”</> : null}). Industri dipakai untuk campaign tanpa sinyal itu; Objective mengisi metrik headline
              bila file tidak punya kolom Objective.
            </p>
          </header>
          <div className="setup-fields">
            <div className="setup-field">
              <span className="setup-field-label">Industri</span>
              <div className={`setup-readonly${brandIndustry ? '' : ' is-empty'}`} aria-readonly="true">
                {brandIndustry === undefined ? 'Memuat…' : brandIndustry || 'Belum diatur'}
              </div>
              <span className="setup-field-hint">
                {brandIndustry && industry ? <>Dibaca sebagai {META_INDUSTRY_LABEL[industry]} · </> : null}
                {brandIndustry && !industry ? <>Kategori ini tidak dikenali report Meta · </> : null}
                {clientId ? <Link to={`/pengaturan-brand?detail=${clientId}`}>{brandIndustry ? 'Ubah' : 'Atur'} di Brand Setting</Link> : 'Diatur di Brand Setting'}
              </span>
            </div>
            <div className="setup-field">
              <span className="setup-field-label">Objective{objectiveCol ? ' · prefill dari file' : ''}</span>
              <SearchSelect
                options={OBJECTIVE_OPTIONS}
                value={objective}
                onChange={(id) => pickObjective(id as MetaObjectiveKey)}
                placeholder="— pilih —"
                searchable={false}
              />
              <span className="setup-field-hint">{objectiveCol ? 'Info dari file' : 'Metrik headline Non-Boost (file tanpa kolom Objective)'}</span>
            </div>
          </div>
        </section>
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
                  // Tab 1 of the architecture sheet: Special Moment, then each
                  // channel's table with its root cause beside it.
                  id: 'ads',
                  label: 'Ads Performance',
                  hidden: !report.boost && !report.nonBoostLanes?.length && !report.nonBoost && !report.cpas,
                  content: (() => {
                    const cpas = report.cpas;
                    const mainPeriods = [
                      oldRange ? { label: report.p1, ...oldRange } : null,
                      curRange ? { label: report.p2, ...curRange } : null,
                    ].filter(Boolean) as MomentPeriod[];
                    const cpasPeriods = [
                      cpasRanges.old ? { label: cpas?.p1 ?? '', start: cpasRanges.old.min, end: cpasRanges.old.max } : null,
                      cpasRanges.cur ? { label: cpas?.p2 ?? '', start: cpasRanges.cur.min, end: cpasRanges.cur.max } : null,
                    ].filter(Boolean) as MomentPeriod[];
                    const sources: MomentSource[] = [
                      { key: 'nonboost', label: 'Non-Boost', rows: nonBoostAllRows, dayCol, periods: mainPeriods },
                      { key: 'boost', label: 'Boost', rows: boostAllRows, dayCol, periods: mainPeriods },
                      { key: 'cpas', label: 'CPAS', rows: cpasAllRows, dayCol: cpasDayCol, periods: cpasPeriods },
                    ];
                    const rca = (f: MetaFunnel | undefined, p1: string, p2: string, title = 'Root Cause Analysis', badge = `${p1} → ${p2}`) =>
                      f?.hasData ? <SymptomTreePanel tree={f.tree} p1={p1} p2={p2} title={title} badge={badge} /> : undefined;
                    return (
                      <SectionAccordion>
                        <MetaSpecialMomentSection sources={sources} heading="Ads Performance · Special Moment" />
                        {report.boost && (
                          <SectionGroup label="Boost Post">
                            <OverviewDetailedCard
                              heading="Boost Post · Overall"
                              badge={report.boostObjective ? `objective ${report.boostObjective.label}${report.boostObjective.mixed ? ' (dominan)' : ''}` : 'Meta Ads'}
                              overviewRows={report.boost.overviewRows}
                              detailedRows={report.boost.detailedRows}
                              allCols={report.boost.allCols}
                              p1={report.p1}
                              p2={report.p2}
                              aside={rca(report.boostFunnel, report.p1, report.p2, 'Root Cause Analysis', 'Brand Consideration')}
                            />
                          </SectionGroup>
                        )}
                        {report.nonBoostLanes?.length ? (
                          <SectionGroup label="Non-Boost Post">
                            {report.nonBoostLanes.map((lane) => (
                              <OverviewDetailedCard
                                key={lane.key}
                                heading={`Non-Boost Post · ${lane.label}`}
                                badge={lane.objectives.length ? `objective ${lane.objectives.join(', ')}` : 'Meta Ads'}
                                overviewRows={lane.overview.overviewRows}
                                detailedRows={lane.overview.detailedRows}
                                allCols={lane.overview.allCols}
                                p1={report.p1}
                                p2={report.p2}
                                aside={rca(lane.funnel, report.p1, report.p2, lane.key === 'b2b' ? 'Root Cause Analysis · Leads' : 'Root Cause Analysis')}
                              />
                            ))}
                          </SectionGroup>
                        ) : null}
                        {cpas && (cpas.overall || cpas.nv || cpas.rm) && (
                          <SectionGroup label="CPAS Shopee">
                            {cpas.overall && (
                              <OverviewDetailedCard
                                heading="CPAS Shopee · Overall"
                                badge="Overall"
                                overviewRows={cpas.overall.overviewRows}
                                detailedRows={cpas.overall.detailedRows}
                                allCols={cpas.overall.allCols}
                                p1={cpas.p1}
                                p2={cpas.p2}
                                aside={rca(cpas.funnel, cpas.p1, cpas.p2)}
                              />
                            )}
                            {cpas.nv && (
                              <OverviewDetailedCard
                                heading="CPAS Shopee · NV"
                                badge="New Visitor"
                                overviewRows={cpas.nv.overviewRows}
                                detailedRows={cpas.nv.detailedRows}
                                allCols={cpas.nv.allCols}
                                p1={cpas.p1}
                                p2={cpas.p2}
                                aside={rca(cpas.nvFunnel, cpas.p1, cpas.p2, 'Root Cause Analysis · NV')}
                              />
                            )}
                            {cpas.rm && (
                              <OverviewDetailedCard
                                heading="CPAS Shopee · RM"
                                badge="Re-Marketing"
                                overviewRows={cpas.rm.overviewRows}
                                detailedRows={cpas.rm.detailedRows}
                                allCols={cpas.rm.allCols}
                                p1={cpas.p1}
                                p2={cpas.p2}
                                aside={rca(cpas.rmFunnel, cpas.p1, cpas.p2, 'Root Cause Analysis · RM')}
                              />
                            )}
                          </SectionGroup>
                        )}
                      </SectionAccordion>
                    );
                  })(),
                },
                {
                  id: 'cpas',
                  label: 'CPAS',
                  hidden: !report.cpas || !report.curRows?.cpas.length,
                  content: (() => {
                    const cpas = report.cpas;
                    const rows = report.curRows?.cpas ?? [];
                    if (!cpas || !rows.length) return null;
                    return (
                      <SectionAccordion>
                        {analysisSections({
                          prefix: 'CPAS Shopee',
                          period: cpas.p2,
                          rows,
                          kind: 'sales',
                          campCol: report.cols?.cpasCampaign ?? null,
                          ageCol: report.cols?.cpasAge ?? null,
                          genderCol: report.cols?.cpasGender ?? null,
                        })}
                      </SectionAccordion>
                    );
                  })(),
                },
                {
                  id: 'non-boost',
                  label: 'Non-Boost Post',
                  hidden: !report.nonBoostLanes?.length,
                  content: (() => {
                    const lanes = report.nonBoostLanes ?? [];
                    const lane = lanes.find((l) => l.key === nbLane) ?? lanes[0];
                    if (!lane) return null;
                    return (
                      <SectionAccordion key={lane.key}>
                        {lanes.length > 0 && <MetaLaneSwitch alwaysOpen lanes={lanes} active={lane.key} onPick={setNbLane} />}
                        {analysisSections({
                          prefix: `Non-Boost ${lane.label}`,
                          period: report.p2,
                          rows: lane.curRows,
                          kind: lane.key === 'retail' ? 'sales' : 'b2b',
                          campCol: lane.campCol,
                          ageCol: lane.ageCol,
                          genderCol: lane.genderCol,
                        })}
                      </SectionAccordion>
                    );
                  })(),
                },
                {
                  id: 'boost',
                  label: 'Boost Post',
                  hidden: !report.curRows?.boost.length,
                  content: (() => {
                    const rows = report.curRows?.boost ?? [];
                    if (!rows.length) return null;
                    return (
                      <SectionAccordion>
                        {analysisSections({
                          prefix: 'Boost Post',
                          period: report.p2,
                          rows,
                          kind: 'brand',
                          campCol: report.cols?.campaign ?? null,
                          ageCol: report.cols?.age ?? null,
                          genderCol: report.cols?.gender ?? null,
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
