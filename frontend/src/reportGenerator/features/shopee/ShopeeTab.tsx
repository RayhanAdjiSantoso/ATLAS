import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import api from '../../../api/client.js';
import { LibraryFileSlot, type LibrarySelection } from '../reports/LibraryFileSlot';
import { ManualFileSlot } from '../reports/ManualFileSlot';
import { combineManualPeriods } from '../../lib/manualPeriod';
import { DownloadPdfButton } from '../../components/DownloadPdfButton';
import { HowTo, HowToStep } from '../../components/HowTo';
import { InlineNotice } from '../../components/InlineNotice';
import { OmzetField } from '../../components/OmzetField';
import { PeriodCompareChip } from '../../components/PeriodCompareChip';
import { PeriodInputRow } from '../../components/PeriodInputRow';
import { PeriodWarningBanner } from '../../components/PeriodWarningBanner';
import { StepIndicator, type Step } from '../../components/StepIndicator';
import { usePeriodLabel } from '../../hooks/usePeriodLabel';
import { useScrollAfterGenerate } from '../../hooks/useScrollAfterGenerate';
import { fromISODate, toISODate } from '../../lib/dateFmt';
import { parseShopeeCSV } from '../../lib/shopeeAds';
import { categorizeProdukRows, mergeProdukOtomatis, mergeProductMaster, parseProductMasterRows, type ProductMasterEntry } from '../../lib/shopeeDeepDive';
import { comparePeriodDays, daysBetweenInclusive, emptyParsedPeriod, type ParsedPeriod } from '../../lib/periodLabel';
import { periodFromOverviewFilename } from '../../lib/shopeeOverview';
import type { SheetRow } from '../../lib/types';
import { requireColumns, validateFileBasics } from '../../lib/validation';
import { readSpreadsheetFile } from '../../lib/xlsxUtils';
import type { PlatformResultData } from '../../lib/summary';
import { AiSummarySection } from '../ai/AiSummarySection';
import { SaveStatus } from '../reports/SaveStatus';
import { useAutoSave } from '../reports/useAutoSave';
import { getProductMaster, getSavedPeriod, getSavedPeriods, saveProductMasterEntry } from '../reports/api';
import { formatChannelCoverage } from '../reports/savedPeriodLabels';
import { mapShopeeRows, type ShopeeCategorization } from '../reports/rowMapping';
import { LibraryPeriodPicker, type LibraryMonth } from '../reports/LibraryPeriodPicker';
import { SavedSlotCard, SlotSourceTabs, type SlotSource } from '../../components/SlotSourceTabs';
import type { MetricSelection } from '../../lib/shopeeDeepDiveItemPivot';
import type { DailyTrendMetricSelection } from '../../lib/shopeeDeepDiveInsights';
import { DEFAULT_PARETO_RANGE, type ParetoRangeSelection, type PerfMetricVars, type ProductPerfMonth } from '../../lib/shopeeProductAnalysis';
import type { PeriodRole, RawFileEntry, SaveReportPayload } from '../reports/types';
import { ShopeeReportSections } from './ShopeeReportSections';
import { buildShopeeDeepDiveReport, type ShopeeDeepDiveReport } from './shopeeDeepDiveReport';
import { buildShopeeFunnelReport, type ShopeeFunnelReport } from './shopeeFunnelReport';
import { buildShopeeReport, type ShopeeReport } from './shopeeReport';

type AdsFileKey =
  | 'toko-old'
  | 'toko-cur'
  | 'produk-old'
  | 'produk-cur'
  | 'produk-otomatis-old'
  | 'produk-otomatis-cur'
  | 'toko-keyword-old'
  | 'toko-keyword-cur'
  | 'live-old'
  | 'live-cur';
type OverviewFileKey = 'overview-old' | 'overview-cur';

interface AdsFileState {
  rows: SheetRow[];
  fileName: string;
  // Absent when the rows came from "Pilih Periode" (the brand library)
  // instead of a fresh upload — nothing to re-archive, and raw_uploads
  // isn't used for reconstruction anyway.
  file?: File;
}

type PeriodSide = 'old' | 'cur';

interface DateRange {
  start: string | null;
  end: string | null;
}

const EMPTY_RANGE: DateRange = { start: null, end: null };

interface OverviewFileState {
  rows: SheetRow[];
  fileName: string;
  period: string;
}

interface ProductPerformanceFileState {
  mainRows: SheetRow[];
  tingkatkanRows: SheetRow[];
  fileName: string;
  // Absent when the rows came from the brand library via "Pilih Periode"
  // (see applyLibraryMonth) instead of a fresh upload — nothing to
  // re-archive then.
  file?: File;
}

type ProductPerformanceRole = 'old' | 'cur';

const EMPTY_ADS_FILES: Record<AdsFileKey, AdsFileState | null> = {
  'toko-old': null,
  'toko-cur': null,
  'produk-old': null,
  'produk-cur': null,
  'produk-otomatis-old': null,
  'produk-otomatis-cur': null,
  'toko-keyword-old': null,
  'toko-keyword-cur': null,
  'live-old': null,
  'live-cur': null,
};

const EMPTY_OVERVIEW_FILES: Record<OverviewFileKey, OverviewFileState | null> = {
  'overview-old': null,
  'overview-cur': null,
};

// Every Shopee library channel "Pilih Periode" knows how to apply — the
// picker only counts a month as available when it has a file in one of
// these (Referensi Kategori Produk has no period, so it's not here).
const SHOPEE_PERIOD_CHANNELS = ['produk', 'produk_otomatis', 'toko', 'toko_keyword', 'live', 'overview', 'product_performance'] as const;

interface LibraryFileMeta {
  id: number;
  platform: string;
  channel: string;
  original_filename: string;
  period_month: string | null;
  period_start: string | null;
  period_end: string | null;
}

async function downloadLibraryFile(clientId: number, file: LibraryFileMeta): Promise<File> {
  const { data } = await api.get(`/brands/${clientId}/library/${file.id}/download`, { responseType: 'blob' });
  return new File([data], file.original_filename, { type: (data as Blob).type });
}

function formatGeneratedDate(): string {
  return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface ShopeeTabProps {
  isActive: boolean;
  clientId: number | null;
  omzetOld: number | null;
  omzetCur: number | null;
  onOmzetOldChange: (v: number | null) => void;
  onOmzetCurChange: (v: number | null) => void;
  onGenerated: (data: PlatformResultData) => void;
  onInvalidate: () => void;
}

export function ShopeeTab({ isActive, clientId, omzetOld, omzetCur, onOmzetOldChange, onOmzetCurChange, onGenerated, onInvalidate }: ShopeeTabProps) {
  const periodOld = usePeriodLabel('Bulan Lalu');
  const periodCur = usePeriodLabel('Bulan Ini');

  const [adsFiles, setAdsFiles] = useState(EMPTY_ADS_FILES);
  // "Pilih dari data tersimpan" — per period side (lama / ini). When 'saved',
  // one pick fills every stored ad channel for that side at once; the user
  // can still drop a fresh file on any individual channel slot to override.
  const [overviewFiles, setOverviewFiles] = useState(EMPTY_OVERVIEW_FILES);
  // Product Performance is now a 2-slot upload (old & cur), like the other
  // channels — Traffic/Conversion Analysis compare periods. The "cur" file
  // also still drives the older single-snapshot insights (unadvertised
  // products, Tingkatkan dengan Iklan). Pareto Analysis instead uses every
  // Product Performance file already saved to this brand's library — see
  // productPerfAllMonths below — so it ranks lifetime contribution, not just
  // the newest month.
  const [productPerfFiles, setProductPerfFiles] = useState<Record<ProductPerformanceRole, ProductPerformanceFileState | null>>({ old: null, cur: null });
  // Every month's "Produk dengan Performa Terbaik" sheet already uploaded to
  // this brand's library (independent of the old/cur slots above), fetched
  // whenever the client changes. Feeds Pareto Analysis only — buildPareto
  // sums Sales (Confirmed Order) per product across whichever months
  // paretoRange below selects (default: all of them).
  const [productPerfAllMonths, setProductPerfAllMonths] = useState<ProductPerfMonth[]>([]);
  // "Semua Bulan" by default — see ParetoRangeControl in the Pareto sections.
  const [paretoRange, setParetoRange] = useState<ParetoRangeSelection>(DEFAULT_PARETO_RANGE);
  useEffect(() => {
    setProductPerfAllMonths([]);
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/brands/${clientId}/library`);
        const files = (data.files as LibraryFileMeta[]).filter((f) => f.platform === 'shopee' && f.channel === 'product_performance' && f.period_month);
        const months: ProductPerfMonth[] = [];
        for (const f of files) {
          if (cancelled) return;
          const { data: blob } = await api.get(`/brands/${clientId}/library/${f.id}/download`, { responseType: 'blob' });
          const wb = XLSX.read(new Uint8Array(await (blob as Blob).arrayBuffer()), { type: 'array' });
          const sheet = wb.Sheets['Produk dengan Performa Terbaik'];
          if (sheet) months.push({ month: f.period_month!.slice(0, 7), rows: XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: '' }) });
        }
        if (!cancelled) setProductPerfAllMonths(months);
      } catch {
        if (!cancelled) setProductPerfAllMonths([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);
  // The uploaded "Referensi Kategori Produk" file for this session. On upload
  // it's also persisted to the backend (full replace of this client's
  // product_master), so `productMasterRefSaved` tracks whether that succeeded.
  const [productMasterRef, setProductMasterRef] = useState<{ entries: ProductMasterEntry[]; fileName: string } | null>(null);
  const [productMasterRefSaved, setProductMasterRefSaved] = useState(false);

  // Fase 3 — Shopee Deep-Dive: category/series lookup for the current
  // client, fetched fresh whenever the client changes (a previously-uploaded
  // reference file lands here, so categorization survives across sessions).
  const [productMaster, setProductMaster] = useState<ProductMasterEntry[]>([]);
  useEffect(() => {
    setProductMasterRef(null);
    setProductMasterRefSaved(false);
    if (!clientId) {
      setProductMaster([]);
      return;
    }
    let cancelled = false;
    getProductMaster(clientId)
      .then((rows) => {
        if (!cancelled) setProductMaster(rows);
      })
      .catch(() => {
        if (!cancelled) setProductMaster([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // What categorization actually runs against: the client's stored mapping
  // with the uploaded reference file (if any) layered on top.
  const effectiveProductMaster = useMemo(
    () => mergeProductMaster(productMaster, productMasterRef?.entries ?? []),
    [productMaster, productMasterRef],
  );

  // Day counts of the last-parsed old/cur period (Fase 1) — used at Generate
  // time to warn when the two periods being compared aren't the same length.
  const [periodOldDays, setPeriodOldDays] = useState<number | null>(null);
  const [periodCurDays, setPeriodCurDays] = useState<number | null>(null);
  // Fase 2: the same period's actual start/end dates, kept alongside the day
  // count — needed to key a saved report_run's unique brand+platform+period
  // scope (the day count alone isn't enough to identify *which* period).
  const [periodOldRange, setPeriodOldRange] = useState<DateRange>(EMPTY_RANGE);
  const [periodCurRange, setPeriodCurRange] = useState<DateRange>(EMPTY_RANGE);

  // "Pilih Periode" — per period side, sourced straight from the brand
  // library (any month with files there, generated before or not — see
  // LibraryPeriodPicker), not from report_runs. One pick fills every
  // channel that has a file for that month (Iklan Produk/Produk Otomatis/
  // Toko/Keyword/Live/Overview/Product Performance); the user can still
  // drop a fresh file on any individual channel slot below to override just
  // that one channel. Total Omzet Toko is the one thing no file ever
  // carries — it only fills in when this exact month was already Generated
  // before (cross-checked against report_runs below), otherwise it's left
  // blank for manual entry.
  const [oldSource, setOldSource] = useState<SlotSource>('saved');
  const [curSource, setCurSource] = useState<SlotSource>('saved');
  const [oldPickedMonth, setOldPickedMonth] = useState<LibraryMonth | null>(null);
  const [curPickedMonth, setCurPickedMonth] = useState<LibraryMonth | null>(null);
  const [pickerRole, setPickerRole] = useState<PeriodRole | null>(null);
  const [applyingRole, setApplyingRole] = useState<PeriodRole | null>(null);

  async function applyLibraryMonth(targetRole: PeriodRole, month: LibraryMonth) {
    if (!clientId) return;
    setApplyingRole(targetRole);
    setUploadError(null);
    try {
      const { data } = await api.get(`/brands/${clientId}/library`);
      const files = (data.files as LibraryFileMeta[]).filter((f) => f.platform === 'shopee' && f.period_month?.slice(0, 7) === month.month);
      const byChannel = new Map<string, LibraryFileMeta[]>();
      for (const f of files) {
        (byChannel.get(f.channel) ?? byChannel.set(f.channel, []).get(f.channel)!).push(f);
      }
      const downloadAll = (list: LibraryFileMeta[]) => Promise.all(list.map((f) => downloadLibraryFile(clientId, f)));
      const parseAdsLike = async (parts: File[]) => (await Promise.all(parts.map(async (f) => (/\.csv$/i.test(f.name) ? parseShopeeCSV(await f.text()).rows : readSpreadsheetFile(f))))).flat();

      const adsChannelKeys: Record<string, AdsFileKey> = {
        produk: `produk-${targetRole}` as AdsFileKey,
        produk_otomatis: `produk-otomatis-${targetRole}` as AdsFileKey,
        toko: `toko-${targetRole}` as AdsFileKey,
        toko_keyword: `toko-keyword-${targetRole}` as AdsFileKey,
        live: `live-${targetRole}` as AdsFileKey,
      };
      const adsUpdates: Partial<Record<AdsFileKey, AdsFileState | null>> = {};
      for (const [channel, key] of Object.entries(adsChannelKeys)) {
        const list = byChannel.get(channel) ?? [];
        if (!list.length) {
          adsUpdates[key] = null;
          continue;
        }
        const rows = await parseAdsLike(await downloadAll(list));
        adsUpdates[key] = rows.length ? { rows, fileName: list.map((f) => f.original_filename).join(' · ') } : null;
      }
      setAdsFiles((prev) => ({ ...prev, ...adsUpdates }));

      const overviewList = byChannel.get('overview') ?? [];
      if (overviewList.length) {
        const rows = (await Promise.all((await downloadAll(overviewList)).map(readSpreadsheetFile))).flat();
        setOverviewFiles((prev) => ({ ...prev, [`overview-${targetRole}`]: rows.length ? { rows, fileName: overviewList.map((f) => f.original_filename).join(' · '), period: month.label } : null }));
      } else {
        setOverviewFiles((prev) => ({ ...prev, [`overview-${targetRole}`]: null }));
      }

      const perfList = byChannel.get('product_performance') ?? [];
      if (perfList.length) {
        const parts = await downloadAll(perfList);
        const mainRows: SheetRow[] = [];
        const tingkatkanRows: SheetRow[] = [];
        for (const file of parts) {
          const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
          const mainSheet = wb.Sheets['Produk dengan Performa Terbaik'];
          if (mainSheet) mainRows.push(...XLSX.utils.sheet_to_json<SheetRow>(mainSheet, { defval: '' }));
          const extraSheet = wb.Sheets['Tingkatkan dengan Iklan'];
          if (extraSheet) tingkatkanRows.push(...XLSX.utils.sheet_to_json<SheetRow>(extraSheet, { defval: '' }));
        }
        setProductPerfFiles((prev) => ({ ...prev, [targetRole]: mainRows.length ? { mainRows, tingkatkanRows, fileName: perfList.map((f) => f.original_filename).join(' · ') } : null }));
      } else {
        setProductPerfFiles((prev) => ({ ...prev, [targetRole]: null }));
      }

      const [y, mo] = month.month.split('-').map(Number);
      const calStart = `${month.month}-01`;
      const calEnd = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
      const rangeStart = month.start && month.start < calStart ? month.start : calStart;
      const rangeEnd = month.end && month.end > calEnd ? month.end : calEnd;
      (targetRole === 'old' ? periodOld : periodCur).autoFill(month.label);
      (targetRole === 'old' ? setPeriodOldRange : setPeriodCurRange)({ start: rangeStart, end: rangeEnd });
      (targetRole === 'old' ? setPeriodOldDays : setPeriodCurDays)(daysBetweenInclusive(fromISODate(rangeStart)!, fromISODate(rangeEnd)!));

      // Total Omzet Toko isn't in any file — it only carries over when this
      // exact month was already Generated before (a report_runs side whose
      // date range overlaps this month). No match => genuinely unknown =>
      // cleared for manual entry, not left holding a stale value.
      let omzetValue: number | null = null;
      try {
        const saved = await getSavedPeriods(clientId, 'shopee');
        const hit = saved.find((p) => p.start && p.end && p.start <= rangeEnd && p.end >= rangeStart);
        if (hit) {
          const detail = await getSavedPeriod(hit.runId, hit.role);
          const config = (detail.reportConfig ?? {}) as { omzetOld?: number; omzetCur?: number };
          omzetValue = (hit.role === 'old' ? config.omzetOld : config.omzetCur) ?? null;
        }
      } catch {
        /* Omzet cross-reference is best-effort — a lookup failure just leaves it blank */
      }
      (targetRole === 'old' ? onOmzetOldChange : onOmzetCurChange)(omzetValue);

      setReport(null);
      setDeepDive(null);
      setFunnelReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal memuat periode dari perpustakaan: ' + (err as Error).message);
      (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
    } finally {
      setApplyingRole(null);
    }
  }

  function handlePickMonth(month: LibraryMonth) {
    const targetRole = pickerRole;
    if (!targetRole) return;
    (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(month);
    (targetRole === 'old' ? setOldSource : setCurSource)('saved');
    applyLibraryMonth(targetRole, month);
  }

  function clearPickedPeriod(role: PeriodRole) {
    (role === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
    setAdsFiles((prev) => ({ ...prev, [`produk-${role}`]: null, [`produk-otomatis-${role}`]: null, [`toko-${role}`]: null, [`toko-keyword-${role}`]: null, [`live-${role}`]: null }));
    setOverviewFiles((prev) => ({ ...prev, [`overview-${role}`]: null }));
    setProductPerfFiles((prev) => ({ ...prev, [role]: null }));
    (role === 'old' ? onOmzetOldChange : onOmzetCurChange)(null);
    setReport(null);
    setDeepDive(null);
    setFunnelReport(null);
    onInvalidate();
  }

  const [report, setReport] = useState<ShopeeReport | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [deepDive, setDeepDive] = useState<ShopeeDeepDiveReport | null>(null);
  const [funnelReport, setFunnelReport] = useState<ShopeeFunnelReport | null>(null);
  const [itemPivotTab, setItemPivotTab] = useState<'produk' | 'keyword' | 'performa'>('produk');
  const [generatedAt, setGeneratedAt] = useState('');

  // Metric picker state for the item-level pivots: `null` selections mean
  // "use the report's own default" (auto-picked dominant metric for produk;
  // Biaya/Pesanan/CPP for keyword; Pengunjung+Penjualan for the daily trend)
  // until the user actually picks something. customMetrics holds every
  // custom-formula metric the user has defined this session, shared across
  // the produk/keyword pickers.
  const [produkSelections, setProdukSelections] = useState<MetricSelection[] | null>(null);
  const [keywordSelections, setKeywordSelections] = useState<MetricSelection[] | null>(null);
  const [customMetrics, setCustomMetrics] = useState<MetricSelection[]>([]);
  const [dailyTrendSelections, setDailyTrendSelections] = useState<DailyTrendMetricSelection[] | null>(null);
  const [performanceSelections, setPerformanceSelections] = useState<(keyof PerfMetricVars)[] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // "Data tambahan (opsional)" — the 7 optional upload cards collapse into one
  // <details> so the page isn't a wall of dropzones. Auto-opens the moment any
  // optional slot actually has data (uploaded or filled from a saved report).
  const [optOpen, setOptOpen] = useState(false);
  // Per-slot notes from combining manual files (a date gap, an unreadable period).
  const [manualWarnings, setManualWarnings] = useState<Record<string, string | null>>({});

  // ── Manual upload ("Upload file baru") ─────────────────────────────────
  // Files never reach the brand library. Each Iklan CSV states its own range
  // on its "Periode" line, so several files are combined only after checking
  // their ranges join up (see lib/manualPeriod.ts); the existing handlers then
  // read them exactly as they read library parts.
  const sideSource = (side: PeriodRole) => (side === 'old' ? oldSource : curSource);

  async function shopeeFilePeriod(file: File): Promise<ParsedPeriod> {
    return /\.csv$/i.test(file.name) ? parseShopeeCSV(await file.text()).period : emptyParsedPeriod();
  }

  async function handleManualAds(files: File[], key: AdsFileKey) {
    const periods = await Promise.all(files.map(async (f) => ({ name: f.name, period: await shopeeFilePeriod(f) })));
    const { selection, warning } = combineManualPeriods(periods);
    await handleAdsFile(files, key, selection);
    setManualWarnings((prev) => ({ ...prev, [key]: warning }));
  }

  function invalidateReport() {
    setReport(null);
    setDeepDive(null);
    setFunnelReport(null);
    onInvalidate();
  }

  function clearAdsChannel(key: AdsFileKey) {
    setAdsFiles((prev) => ({ ...prev, [key]: null }));
    setManualWarnings((prev) => ({ ...prev, [key]: null }));
    invalidateReport();
  }

  function clearOverviewChannel(key: OverviewFileKey) {
    setOverviewFiles((prev) => ({ ...prev, [key]: null }));
    invalidateReport();
  }

  function clearProductPerformance(role: ProductPerformanceRole) {
    setProductPerfFiles((prev) => ({ ...prev, [role]: null }));
    invalidateReport();
  }

  async function handleAdsFile(input: File[], key: AdsFileKey, selection: LibrarySelection) {
    const file = input[0];
    const basics = validateFileBasics(file, ['.csv', '.xlsx', '.xls']);
    if (!basics.ok) {
      throw new Error(basics.message || 'File tidak valid.');
    }
    try {
      const batches = await Promise.all(input.map(async f => /\.csv$/i.test(f.name)
        ? parseShopeeCSV(await f.text()).rows : await readSpreadsheetFile(f)));
      const rows = batches.flat();
      const period = { label: selection.label, start: selection.start ? fromISODate(selection.start) : null, end: selection.end ? fromISODate(selection.end) : null, days: selection.start && selection.end ? daysBetweenInclusive(fromISODate(selection.start)!, fromISODate(selection.end)!) : null };
      if (!rows.length) {
        throw new Error('File kosong atau format tidak dikenali.');
      }
      const cols = requireColumns(rows, [{ label: 'Biaya', kw: ['biaya'] }]);
      if (!cols.ok) {
        throw new Error(cols.message || 'Kolom wajib tidak ditemukan.');
      }
      setUploadError(null);
      setAdsFiles((prev) => ({ ...prev, [key]: { rows, fileName: input.map(f => f.name).join(' · ') } }));
      const isOld = key.endsWith('-old');
      (isOld ? periodOld : periodCur).autoFill(period.label);
      if (period.days != null) (isOld ? setPeriodOldDays : setPeriodCurDays)(period.days);
      (isOld ? setPeriodOldRange : setPeriodCurRange)({ start: toISODate(period.start), end: toISODate(period.end) });
      setReport(null);
      setDeepDive(null);
      setFunnelReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal membaca isi file: ' + (err as Error).message);
      throw err;
    }
  }

  async function handleOverviewFile(input: File[], key: OverviewFileKey) {
    const file = input[0];
    const basics = validateFileBasics(file, ['.csv', '.xlsx', '.xls']);
    if (!basics.ok) {
      throw new Error(basics.message || 'File tidak valid.');
    }
    try {
      const rows = (await Promise.all(input.map(readSpreadsheetFile))).flat();
      if (!rows.length) {
        throw new Error('File kosong.');
      }
      const cols = requireColumns(rows, [{ label: 'Kunjungan', kw: ['kunjungan'] }]);
      if (!cols.ok) {
        throw new Error(cols.message || 'Kolom wajib tidak ditemukan.');
      }
      setUploadError(null);
      const period = periodFromOverviewFilename(file.name);
      setOverviewFiles((prev) => ({ ...prev, [key]: { rows, fileName: file.name, period } }));
      setReport(null);
      setDeepDive(null);
      setFunnelReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal membaca isi file: ' + (err as Error).message);
      throw err;
    }
  }

  async function handleProductPerformanceFile(input: File[], role: ProductPerformanceRole) {
    const file = input[0];
    const basics = validateFileBasics(file, ['.xlsx', '.xls']);
    if (!basics.ok) {
      throw new Error(basics.message || 'File tidak valid.');
    }
    try {
      const mainRows: SheetRow[] = [];
      const tingkatkanRows: SheetRow[] = [];
      for (const part of input) {
        const wb = XLSX.read(new Uint8Array(await part.arrayBuffer()), { type: 'array' });
        const mainSheet = wb.Sheets['Produk dengan Performa Terbaik'];
        if (!mainSheet) throw new Error(`Sheet Produk dengan Performa Terbaik tidak ditemukan: ${part.name}`);
        mainRows.push(...XLSX.utils.sheet_to_json<SheetRow>(mainSheet, { defval: '' }));
        const extra = wb.Sheets['Tingkatkan dengan Iklan'];
        if (extra) tingkatkanRows.push(...XLSX.utils.sheet_to_json<SheetRow>(extra, { defval: '' }));
      }
      setUploadError(null);
      setProductPerfFiles((prev) => ({ ...prev, [role]: { mainRows, tingkatkanRows, fileName: input.map(f => f.name).join(' · '), file } }));
      setReport(null);
      setDeepDive(null);
      setFunnelReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal membaca isi file: ' + (err as Error).message);
      throw err;
    }
  }

  async function handleProductMasterRefFile(input: File[]) {
    const file = input[0];
    const basics = validateFileBasics(file, ['.csv', '.xlsx', '.xls']);
    if (!basics.ok) {
      throw new Error(basics.message || 'File tidak valid.');
    }
    try {
      const rows = (await Promise.all(input.map(readSpreadsheetFile))).flat();
      const parsed = parseProductMasterRows(rows);
      if (!parsed.entries.length) {
        throw new Error(
          parsed.nameColumn && parsed.categoryColumn
            ? 'File referensi kategori terbaca, tetapi tidak ada baris yang valid (nama produk + Category harus terisi).'
            : 'File referensi kategori butuh minimal satu kolom nama produk dan satu kolom Category/Kategori.',
        );
      }
      setUploadError(null);
      setProductMasterRef({ entries: parsed.entries, fileName: file.name });
      setProductMasterRefSaved(false);
      setReport(null);
      setDeepDive(null);
      setFunnelReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal membaca isi file: ' + (err as Error).message);
      throw err;
    }
  }

  // Wajib: klien, Total Omzet Toko, dan Iklan Produk (2 periode). Semua
  // channel/file lain — Iklan Toko, Produk Otomatis, Toko-Keyword, Live,
  // Product Overview, Product Performance — opsional, insight tambahan saja.
  const hasProduk = Boolean(adsFiles['produk-old'] && adsFiles['produk-cur']);
  const ready = hasProduk && (omzetOld ?? 0) > 0 && (omzetCur ?? 0) > 0 && Boolean(clientId);
  // Whether each optional channel actually has anything uploaded — used to
  // hide that channel's whole report section rather than showing an
  // all-zero pivot for a channel the user never touched.
  const hasTokoData = Boolean(adsFiles['toko-old'] || adsFiles['toko-cur']);
  const hasLiveData = Boolean(adsFiles['live-old'] || adsFiles['live-cur']);
  const hasTokoKeywordData = Boolean(adsFiles['toko-keyword-old'] || adsFiles['toko-keyword-cur']);
  // Shown right in the upload area too (not just after Generate), as soon as
  // both periods' day counts are known from whichever file(s) were uploaded.
  const uploadPeriodWarning = comparePeriodDays(periodOldDays, periodCurDays);

  const autoSave = useAutoSave('shopee');
  const armReportScroll = useScrollAfterGenerate('report-shopee', report);

  function generate() {
    const r = buildShopeeReport({
      p1: periodOld.label,
      p2: periodCur.label,
      periodOldDays,
      periodCurDays,
      tokoOld: adsFiles['toko-old']?.rows ?? [],
      tokoCur: adsFiles['toko-cur']?.rows ?? [],
      produkOld: adsFiles['produk-old']?.rows ?? [],
      produkCur: adsFiles['produk-cur']?.rows ?? [],
      omzetOld: omzetOld ?? 0,
      omzetCur: omzetCur ?? 0,
      overviewOldRows: overviewFiles['overview-old']?.rows ?? null,
      overviewCurRows: overviewFiles['overview-cur']?.rows ?? null,
    });
    const dd = buildShopeeDeepDiveReport({
      produkOld: adsFiles['produk-old']?.rows ?? [],
      produkCur: adsFiles['produk-cur']?.rows ?? [],
      produkOtomatisOld: adsFiles['produk-otomatis-old']?.rows ?? [],
      produkOtomatisCur: adsFiles['produk-otomatis-cur']?.rows ?? [],
      tokoOld: adsFiles['toko-old']?.rows ?? [],
      tokoCur: adsFiles['toko-cur']?.rows ?? [],
      tokoKeywordOld: adsFiles['toko-keyword-old']?.rows ?? [],
      tokoKeywordCur: adsFiles['toko-keyword-cur']?.rows ?? [],
      liveOld: adsFiles['live-old']?.rows ?? [],
      liveCur: adsFiles['live-cur']?.rows ?? [],
      productPerformanceRows: productPerfFiles.cur?.mainRows ?? null,
      productPerformanceOldRows: productPerfFiles.old?.mainRows ?? null,
      tingkatkanDenganIklanRows: productPerfFiles.cur?.tingkatkanRows ?? null,
      overviewOldRows: overviewFiles['overview-old']?.rows ?? null,
      overviewCurRows: overviewFiles['overview-cur']?.rows ?? null,
      productMaster: effectiveProductMaster,
      omzetOld: omzetOld ?? 0,
      omzetCur: omzetCur ?? 0,
      produkSelections,
      keywordSelections,
      dailyTrendSelections,
      performanceSelections,
    });
    // Fundamental / Pareto / Traffic / Conversion — the 4 "manual report"
    // sections. Iklan Produk Otomatis is folded into the produk rows first,
    // matching how the rest of the Shopee flow (and the reference workbook's
    // "Iklan Produk" totals) treats it.
    const funnel = buildShopeeFunnelReport({
      produkOld: mergeProdukOtomatis(adsFiles['produk-old']?.rows ?? [], adsFiles['produk-otomatis-old']?.rows ?? []),
      produkCur: mergeProdukOtomatis(adsFiles['produk-cur']?.rows ?? [], adsFiles['produk-otomatis-cur']?.rows ?? []),
      tokoOld: adsFiles['toko-old']?.rows ?? [],
      tokoCur: adsFiles['toko-cur']?.rows ?? [],
      liveOld: adsFiles['live-old']?.rows ?? [],
      liveCur: adsFiles['live-cur']?.rows ?? [],
      omzetOld: omzetOld ?? 0,
      omzetCur: omzetCur ?? 0,
      productPerfOld: productPerfFiles.old?.mainRows ?? null,
      productPerfCur: productPerfFiles.cur?.mainRows ?? null,
      productPerfAllMonths,
      paretoRange,
    });
    // Only default the open tab to the dominant channel on the very first
    // Generate — a later regenerate (metric change, uncategorized-mapping
    // save) shouldn't yank the user back to a tab they've since switched
    // away from.
    if (!report) setItemPivotTab(dd.dominantChannel === 'toko' ? 'keyword' : 'produk');
    setReport(r);
    setDeepDive(dd);
    setFunnelReport(funnel);
    setGeneratedAt(formatGeneratedDate());
    onGenerated({ period: { old: r.p1, cur: r.p2 }, kpis: r.summary.kpis, spend: r.summary.spend });
    autoSave.save(clientId, buildSavePayload(), buildSaveFiles());
  }

  // Re-runs Generate after the user completes an "Uncategorized" mapping or
  // changes an item-pivot metric selection, so the report (and its
  // autosave) stay in sync without a manual re-click. Guarded so this never
  // fires before the first real Generate.
  useEffect(() => {
    if (report && deepDive) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveProductMaster, produkSelections, keywordSelections, dailyTrendSelections, performanceSelections, paretoRange]);

  async function handleSaveCategory(name: string, category: string, series: string) {
    if (!clientId) return;
    await saveProductMasterEntry(clientId, { namaProdukClean: name, category, series });
    setProductMaster((prev) => [...prev.filter((p) => p.namaProdukClean !== name), { namaProdukClean: name, category, series }]);
  }

  function reset() {
    periodOld.reset();
    periodCur.reset();
    onOmzetOldChange(null);
    onOmzetCurChange(null);
    setAdsFiles(EMPTY_ADS_FILES);
    setOverviewFiles(EMPTY_OVERVIEW_FILES);
    setProductPerfFiles({ old: null, cur: null });
    setOldSource('saved');
    setCurSource('saved');
    setManualWarnings({});
    setOldPickedMonth(null);
    setCurPickedMonth(null);
    setProductMasterRef(null);
    setProductMasterRefSaved(false);
    setPeriodOldDays(null);
    setPeriodCurDays(null);
    setPeriodOldRange(EMPTY_RANGE);
    setPeriodCurRange(EMPTY_RANGE);
    setReport(null);
    setDeepDive(null);
    setFunnelReport(null);
    setProdukSelections(null);
    setKeywordSelections(null);
    setCustomMetrics([]);
    setDailyTrendSelections(null);
    setUploadError(null);
    onInvalidate();
  }

  function buildSavePayload(): Omit<SaveReportPayload, 'brandId' | 'platform'> {
    const produkMergedOld = mergeProdukOtomatis(adsFiles['produk-old']?.rows ?? [], adsFiles['produk-otomatis-old']?.rows ?? []);
    const produkMergedCur = mergeProdukOtomatis(adsFiles['produk-cur']?.rows ?? [], adsFiles['produk-otomatis-cur']?.rows ?? []);
    const catOld = categorizeProdukRows(produkMergedOld, 'Nama Iklan', effectiveProductMaster);
    const catCur = categorizeProdukRows(produkMergedCur, 'Nama Iklan', effectiveProductMaster);
    const catMapOld: ShopeeCategorization = new Map(catOld.rows.map((cr) => [cr.row, { cleanName: cr.cleanName, category: cr.category, series: cr.series }]));
    const catMapCur: ShopeeCategorization = new Map(catCur.rows.map((cr) => [cr.row, { cleanName: cr.cleanName, category: cr.category, series: cr.series }]));

    return {
      period: { oldStart: periodOldRange.start, oldEnd: periodOldRange.end, curStart: periodCurRange.start, curEnd: periodCurRange.end, oldLabel: periodOld.label, curLabel: periodCur.label },
      reportConfig: { omzetOld: omzetOld ?? 0, omzetCur: omzetCur ?? 0 },
      rows: {
        shopee: [
          ...mapShopeeRows(produkMergedOld, 'produk', 'old', catMapOld),
          ...mapShopeeRows(produkMergedCur, 'produk', 'cur', catMapCur),
          ...mapShopeeRows(adsFiles['toko-old']?.rows ?? [], 'toko', 'old'),
          ...mapShopeeRows(adsFiles['toko-cur']?.rows ?? [], 'toko', 'cur'),
          ...mapShopeeRows(adsFiles['toko-keyword-old']?.rows ?? [], 'toko_keyword', 'old'),
          ...mapShopeeRows(adsFiles['toko-keyword-cur']?.rows ?? [], 'toko_keyword', 'cur'),
          ...mapShopeeRows(adsFiles['live-old']?.rows ?? [], 'live', 'old'),
          ...mapShopeeRows(adsFiles['live-cur']?.rows ?? [], 'live', 'cur'),
        ],
        // Persisted per-day into a brand-scoped store (keyed by tanggal) —
        // sending rows sourced from stored data is harmless (upsert is
        // idempotent).
        shopeeOverview: [...(overviewFiles['overview-old']?.rows ?? []), ...(overviewFiles['overview-cur']?.rows ?? [])],
      },
    };
  }

  // Original source files already live in the brand library. Save parsed report rows only.
  function buildSaveFiles(): RawFileEntry[] { return []; }


  function adsDropzone(key: AdsFileKey, tag: string) {
    const f = adsFiles[key];
    if (sideSource(key.endsWith('-old') ? 'old' : 'cur') === 'upload') {
      return (
        <ManualFileSlot
          tag={tag} accept=".csv,.xlsx,.xls"
          loaded={Boolean(f)} fileName={f?.fileName} infoText={f ? `${f.rows.length} baris` : undefined}
          warning={manualWarnings[key]}
          onFiles={(files) => handleManualAds(files, key)}
          onClear={() => clearAdsChannel(key)}
        />
      );
    }
    return (
      <LibraryFileSlot clientId={clientId} platform="shopee"
        tag={tag}
        accept=".csv,.xlsx,.xls"
        channel={key.replace(/-(old|cur)$/, '').replaceAll('-', '_')} onFiles={(files, selection) => handleAdsFile(files, key, selection)}
        loaded={Boolean(f)}
        fileName={f?.fileName}
        infoText={f ? `${f.rows.length} baris` : undefined}
        className="shopee-dz"
      />
    );
  }

  function overviewDropzone(key: OverviewFileKey) {
    const f = overviewFiles[key];
    if (sideSource(key === 'overview-old' ? 'old' : 'cur') === 'upload') {
      return (
        <ManualFileSlot
          tag={key === 'overview-old' ? 'Periode Lalu' : 'Periode Ini'} accept=".csv,.xlsx,.xls"
          loaded={Boolean(f)} fileName={f?.fileName}
          infoText={f ? `${f.rows.length} hari${f.period ? ' · ' + f.period : ''}` : undefined}
          onFiles={(files) => handleOverviewFile(files, key)}
          onClear={() => clearOverviewChannel(key)}
        />
      );
    }
    return (
      <LibraryFileSlot clientId={clientId} platform="shopee"
        tag={key === 'overview-old' ? 'Periode Lalu' : 'Periode Ini'}
        accept=".csv,.xlsx,.xls"
        channel="overview" onFiles={(files) => handleOverviewFile(files, key)}
        loaded={Boolean(f)}
        fileName={f?.fileName}
        infoText={f ? `${f.rows.length} hari${f.period ? ' · ' + f.period : ''}` : undefined}
        className="shopee-dz"
        icon="📊"
      />
    );
  }

  const steps: Step[] = [
    {
      label: 'Isi Total Omzet Toko & pilih Iklan Produk',
      sub: hasProduk ? 'Iklan Produk 2 periode sudah terbaca' : undefined,
      status: hasProduk && (omzetOld ?? 0) > 0 && (omzetCur ?? 0) > 0 ? 'done' : 'current',
    },
    { label: 'Generate laporan', status: report ? 'done' : ready ? 'current' : 'todo' },
    { label: 'Lihat & unduh PDF', status: report ? 'current' : 'todo' },
  ];

  const optionalCount = [
    adsFiles['produk-otomatis-old'] || adsFiles['produk-otomatis-cur'],
    productMasterRef,
    adsFiles['toko-old'] || adsFiles['toko-cur'],
    adsFiles['toko-keyword-old'] || adsFiles['toko-keyword-cur'],
    adsFiles['live-old'] || adsFiles['live-cur'],
    overviewFiles['overview-old'] || overviewFiles['overview-cur'],
    productPerfFiles.old || productPerfFiles.cur,
  ].filter(Boolean).length;
  useEffect(() => {
    if (optionalCount > 0) setOptOpen(true);
  }, [optionalCount]);

  return (
    <div className={`panel${isActive ? ' active' : ''}`}>
      <HowTo>
        <HowToStep num={1} numClassName="shopee-num" title="Download report Iklan Produk">
          Dari dashboard Shopee Seller Center, buka menu <strong>Iklan Saya</strong> dan download laporan <strong>Iklan Produk</strong> dan iklan lainnya (jika tersedia), untuk periode lalu dan periode ini.
        </HowToStep>
        <HowToStep num={2} numClassName="shopee-num" title="Catat Total Omzet Toko dari dashboard">
          Buka halaman <strong>Performa Toko</strong> di Shopee Seller Center dan pilih status <strong>'Pesanan Dibuat'</strong>. Angka ini tidak tersedia di dalam file sehingga perlu diisi manual.
        </HowToStep>
        <HowToStep num={3} numClassName="shopee-num" title="(Opsional) Upload data untuk analisis mendalam">
          Untuk analisis lebih dalam, tambahkan juga Iklan Produk Otomatis, Iklan Toko - Keyword (jika menggunakan iklan toko), Referensi Kategori Produk, Product Overview & Product Performance untuk insight tambahan. Semuanya opsional, laporan tetap bisa dibuat tanpanya.
        </HowToStep>
        <HowToStep num={4} numClassName="shopee-num" title="Pilih sumber & buat laporan">
          Isi kolom Total Omzet, upload Iklan Produk, lalu klik <strong>Generate Laporan</strong>.
        </HowToStep>
      </HowTo>

      <StepIndicator steps={steps} accent="var(--shopee-700)" />

      <PeriodInputRow
        colorClass="shopee-period"
        oldValue={periodOld.inputValue}
        curValue={periodCur.inputValue}
        onOldChange={periodOld.onInput}
        onCurChange={periodCur.onInput}
        oldPlaceholder="cth: Apr 2026 / W1 Mei"
        curPlaceholder="cth: Mei 2026 / W2 Mei"
      />
      <PeriodWarningBanner message={uploadPeriodWarning} />
      {uploadError && <InlineNotice title="File ini belum kebaca">{uploadError}</InlineNotice>}

      <div className="source-block">
        <div className="source-header">
          <div className="source-label shopee-label">Pilih Periode</div>
          <span className="sec-badge">isi Iklan Produk/Toko/Keyword/Live/Overview/Product Performance sekaligus dari Pengaturan Brand</span>
        </div>
        <div className="empty-note" style={{ padding: '0 1.4rem .6rem' }}>
          Bisa memilih bulan mana pun yang sudah diunggah di Pengaturan Brand, walau belum pernah di-Generate. Total Omzet Toko hanya ikut terisi kalau bulan itu sudah pernah di-Generate sebelumnya — kalau belum, isi manual di bawah.
        </div>
        <div className="dz-grid-4">
          {(['old', 'cur'] as const).map((role) => {
            const picked = role === 'old' ? oldPickedMonth : curPickedMonth;
            const source = role === 'old' ? oldSource : curSource;
            return (
              <div key={role}>
                <SlotSourceTabs
                  savedFirst
                  value={source}
                  onChange={(v) => {
                    (role === 'old' ? setOldSource : setCurSource)(v);
                    if (v === 'saved' && !picked) setPickerRole(role);
                  }}
                  disabledSavedReason={!clientId ? 'Pilih klien terlebih dahulu' : null}
                />
                {source === 'upload' && (
                  <div className="manual-mode-note">
                    <strong>{role === 'old' ? 'Periode Lalu' : 'Periode Ini'} memakai file manual.</strong> Unggah langsung di setiap bagian di bawah — file hanya dibaca untuk laporan ini dan tidak disimpan ke Pengaturan Brand. Beberapa file yang rentangnya bersambung (mis. 1–7 dan 8–12) dijumlahkan otomatis.
                  </div>
                )}
                {source === 'saved' &&
                  (applyingRole === role ? (
                    <div className="empty-note">Menerapkan periode…</div>
                  ) : (
                    <SavedSlotCard
                      picked={
                        picked && {
                          title: picked.label,
                          sourceComparison: '',
                          savedAt: '',
                          summary: formatChannelCoverage(picked.channels),
                          metaLine: '',
                        }
                      }
                      onOpen={() => setPickerRole(role)}
                      onClear={() => clearPickedPeriod(role)}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>

      {pickerRole && clientId && (
        <LibraryPeriodPicker clientId={clientId} platform="shopee" periodChannels={SHOPEE_PERIOD_CHANNELS} onClose={() => setPickerRole(null)} onPick={handlePickMonth} />
      )}

      <div className="source-block">
        <div className="source-header">
          <div className="source-label shopee-label">Total Omzet Toko (Pesanan Dibuat)</div>
        </div>
        <div className="omzet-row">
          <OmzetField
            label="Bulan Lalu"
            value={omzetOld}
            onChange={(v) => {
              onOmzetOldChange(v);
              setReport(null);
              setDeepDive(null);
              setFunnelReport(null);
              onInvalidate();
            }}
          />
          <OmzetField
            label="Bulan Ini"
            value={omzetCur}
            onChange={(v) => {
              onOmzetCurChange(v);
              setReport(null);
              setDeepDive(null);
              setFunnelReport(null);
              onInvalidate();
            }}
          />
        </div>
      </div>

      <div className="empty-note">Pilih file dari Pengaturan Brand untuk masing-masing periode. Semua bagian ekspor dapat dipilih bersama; data tambahan tetap opsional.</div>

      <div className="source-block">
        <div className="source-header">
          <div className="source-label shopee-label">Iklan Produk</div>
        </div>
        <div className="dz-grid-4">
          {adsDropzone('produk-old', 'Periode Lalu')}
          {adsDropzone('produk-cur', 'Periode Ini')}
        </div>
      </div>

      <details className="opt-group" open={optOpen} onToggle={(e) => setOptOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="opt-group-head">
          <span className="opt-group-title">
            Data tambahan <span className="opt-group-tag">opsional</span>
            {optionalCount > 0 && <span className="opt-group-count">{optionalCount} terisi</span>}
          </span>
          <span className="opt-group-sub">
            Iklan Produk Otomatis, Toko, Keyword, Live, Referensi Kategori, Product Overview &amp; Performance — untuk analisis lebih dalam. Laporan tetap bisa dibuat tanpanya.
          </span>
          <span className="opt-group-chevron" aria-hidden>
            ▾
          </span>
        </summary>
        <div className="opt-group-body">

      <div className="source-block">
        <div className="source-header">
          <div className="source-label shopee-label">Iklan Produk Otomatis</div>
          <span className="sec-badge">opsional — untuk analisis per produk</span>
        </div>
        <div className="dz-grid-4">
          {adsDropzone('produk-otomatis-old', 'Periode Lalu')}
          {adsDropzone('produk-otomatis-cur', 'Periode Ini')}
        </div>
      </div>

      <div className="source-block">
        <div className="source-header">
          <div className="source-label shopee-label">Referensi Kategori Produk</div>
          <span className="sec-badge">opsional — memetakan nama produk ke Category &amp; Series</span>
        </div>
        <div className="empty-note" style={{ padding: '0 1.4rem .6rem' }}>
          Satu file berisi kolom <strong>nama produk</strong>, <strong>Category</strong>, dan <strong>Series</strong> — dipakai untuk mengelompokkan produk di "Analisis Per Item". Pilih referensi dari <strong>Pengaturan Brand</strong> untuk digunakan pada laporan ini. Pemetaan yang sudah tersimpan tetap dipakai sebagai dasar.
        </div>
        <div className="dz-grid-4">
          <LibraryFileSlot clientId={clientId} platform="shopee"
            tag="1 file · nama produk → Category / Series"
            accept=".csv,.xlsx,.xls"
            channel="product_master" onFiles={handleProductMasterRefFile}
            loaded={Boolean(productMasterRef)}
            fileName={productMasterRef?.fileName}
            infoText={
              productMasterRef
                ? `${productMasterRef.entries.length} produk terpetakan${productMasterRefSaved ? ' · referensi terpasang' : clientId ? '' : ' · sesi ini saja (pilih klien untuk menyimpan)'}`
                : undefined
            }
            className="shopee-dz"
            icon="🏷️"
          />
        </div>
        {!productMasterRef && productMaster.length > 0 && (
          <div className="empty-note" style={{ padding: '.2rem 1.4rem 0', color: 'var(--shopee)' }}>
            {productMaster.length} produk sudah terpetakan di database untuk klien ini — dipakai otomatis saat generate. Perbarui referensi melalui Pengaturan Brand.
          </div>
        )}
      </div>

      <div className="source-block">
        <div className="source-header">
          <div className="source-label shopee-label">Iklan Toko</div>
          <span className="sec-badge">opsional</span>
        </div>
        <div className="dz-grid-4">
          {adsDropzone('toko-old', 'Periode Lalu')}
          {adsDropzone('toko-cur', 'Periode Ini')}
        </div>
      </div>

      <div className="source-block">
        <div className="source-header">
          <div className="source-label shopee-label">Iklan Toko - Keyword</div>
          <span className="sec-badge">opsional — untuk analisis per keyword</span>
        </div>
        <div className="dz-grid-4">
          {adsDropzone('toko-keyword-old', 'Periode Lalu')}
          {adsDropzone('toko-keyword-cur', 'Periode Ini')}
        </div>
      </div>

      <div className="source-block">
        <div className="source-header">
          <div className="source-label shopee-label">Iklan Live</div>
          <span className="sec-badge">opsional</span>
        </div>
        <div className="dz-grid-4">
          {adsDropzone('live-old', 'Periode Lalu')}
          {adsDropzone('live-cur', 'Periode Ini')}
        </div>
      </div>

      <div className="source-block">
        <div className="source-header">
          <div className="source-label shopee-label">Product Overview (Toko)</div>
          <span className="sec-badge">opsional — untuk tren harian</span>
        </div>
        <div className="dz-grid-4">
          {overviewDropzone('overview-old')}
          {overviewDropzone('overview-cur')}
        </div>
      </div>

      <div className="source-block">
        <div className="source-header">
          <div className="source-label shopee-label">Product Performance</div>
          <span className="sec-badge">opsional — untuk Pareto / Traffic / Conversion Analysis</span>
        </div>
        <div className="empty-note" style={{ padding: '0 1.4rem .6rem' }}>
          Pilih <strong>2 periode</strong> untuk Traffic &amp; Conversion Analysis (perbandingan antar periode). Pareto Analysis cukup pakai periode ini saja — slot periode lalu boleh dikosongkan.
        </div>
        <div className="empty-note" style={{ padding: '0 1.4rem .6rem' }}>
          Saat mengunduh file ini dari Shopee Seller Center, gunakan status <strong>"Siap Dikirim"</strong>.
        </div>
        <div className="dz-grid-4">
          {(['old', 'cur'] as const).map((role) => {
            const perf = productPerfFiles[role];
            const tag = role === 'old' ? 'Periode Lalu' : 'Periode Ini';
            return sideSource(role) === 'upload' ? (
              <ManualFileSlot
                key={role} tag={tag} accept=".xlsx,.xls"
                loaded={Boolean(perf)} fileName={perf?.fileName} infoText={perf ? `${perf.mainRows.length} baris` : undefined}
                onFiles={(files) => handleProductPerformanceFile(files, role)}
                onClear={() => clearProductPerformance(role)}
              />
            ) : (
              <LibraryFileSlot key={role} clientId={clientId} platform="shopee"
                tag={tag}
                accept=".xlsx,.xls"
                channel="product_performance" onFiles={(files) => handleProductPerformanceFile(files, role)}
                loaded={Boolean(perf)}
                fileName={perf?.fileName}
                infoText={perf ? `${perf.mainRows.length} baris` : undefined}
                className="shopee-dz"
                icon="📦"
              />
            );
          })}
        </div>
      </div>

        </div>
      </details>

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
              ✦ Generate Laporan
            </button>
            <button className="btn btn-ghost" onClick={reset}>
              ↺ Reset
            </button>
          </div>
        </div>
      )}

      {report && (
        <div id="report-shopee">
          <div className="report-top">
            <div className="report-title">Performance Report</div>
            <div className="report-period">
              <PeriodCompareChip old={report.p1} cur={report.p2} onBrand />
            </div>
            <div className="report-meta num">Generated {generatedAt}</div>
          </div>
          {/* SectionNav removed — ShopeeReportSections now pages the report into
              its own tab bar, so a sticky scroll-to-anchor nav is redundant. */}
          <div data-role="r-body" ref={bodyRef}>
            {deepDive && (
              <ShopeeReportSections
                report={report}
                deepDive={deepDive}
                funnelReport={funnelReport}
                hasTokoData={hasTokoData}
                hasLiveData={hasLiveData}
                hasTokoKeywordData={hasTokoKeywordData}
                customMetrics={customMetrics}
                onAddCustomMetric={(sel) => setCustomMetrics((prev) => [...prev, sel])}
                onProdukSelectionsChange={setProdukSelections}
                onKeywordSelectionsChange={setKeywordSelections}
                onDailyTrendSelectionsChange={setDailyTrendSelections}
                onPerformanceSelectionsChange={setPerformanceSelections}
                paretoRange={paretoRange}
                onParetoRangeChange={setParetoRange}
                itemPivotTab={itemPivotTab}
                onItemPivotTabChange={setItemPivotTab}
                onSaveCategory={handleSaveCategory}
              />
            )}
          </div>
          <AiSummarySection
              clientId={clientId}
              platform="shopee"
              period={{ old: report.p1, cur: report.p2 }}
              periodDates={{ oldStart: periodOldRange.start, oldEnd: periodOldRange.end, curStart: periodCurRange.start, curEnd: periodCurRange.end }}
              kpis={report.summary.kpis}
              periodWarning={report.periodWarning}
            />
          <div className="action-row" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
            <DownloadPdfButton targetId="report-shopee" filename="Performance Report - Shopee Ads.pdf" />
            <button className="btn btn-ghost" onClick={reset}>
              ↺ Ganti Sumber Data
            </button>
          </div>
          <SaveStatus status={autoSave.status} message={autoSave.message} />
        </div>
      )}
    </div>
  );
}
