import { useState } from 'react';
import { Dropzone } from '../../components/Dropzone';
import { DownloadPdfButton } from '../../components/DownloadPdfButton';
import { HowTo, HowToStep } from '../../components/HowTo';
import { InlineNotice } from '../../components/InlineNotice';
import { KpiTable } from '../../components/KpiTable';
import { PeriodCompareChip } from '../../components/PeriodCompareChip';
import { PeriodInputRow } from '../../components/PeriodInputRow';
import { PeriodWarningBanner } from '../../components/PeriodWarningBanner';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { StepIndicator, type Step } from '../../components/StepIndicator';
import { useScrollAfterGenerate } from '../../hooks/useScrollAfterGenerate';
import { SlotSourceTabs, SavedSlotCard, type SlotSource } from '../../components/SlotSourceTabs';
import { usePeriodLabel } from '../../hooks/usePeriodLabel';
import { fromISODate, toISODate } from '../../lib/dateFmt';
import { daysBetweenInclusive } from '../../lib/periodLabel';
import { parseTiktokXLSX, periodFromTiktokFilename } from '../../lib/tiktok';
import type { SheetRow } from '../../lib/types';
import { requireColumns, validateFileBasics } from '../../lib/validation';
import type { PlatformResultData } from '../../lib/summary';
import { SaveStatus } from '../reports/SaveStatus';
import { useAutoSave } from '../reports/useAutoSave';
import { mapTiktokRows } from '../reports/rowMapping';
import { getSavedPeriod } from '../reports/api';
import { SavedPeriodPicker } from '../reports/SavedPeriodPicker';
import { formatChannelCoverage, formatSavedAt } from '../reports/savedPeriodLabels';
import type { SaveReportPayload, SavedPeriod } from '../reports/types';
import { buildTiktokReport, type TiktokReport } from './tiktokReport';

type FileKey = 'tiktok-old' | 'tiktok-cur';

interface FileState {
  rows: SheetRow[];
  fileName: string;
  // Absent when the slot's rows came from stored data (SavedPeriodPicker)
  // rather than a fresh upload — there's no File to re-archive then, and
  // raw_uploads isn't used for reconstruction anyway.
  file?: File;
}

interface DateRange {
  start: string | null;
  end: string | null;
}

const EMPTY_RANGE: DateRange = { start: null, end: null };

function formatGeneratedDate(): string {
  return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

interface TiktokTabProps {
  isActive: boolean;
  clientId: number | null;
  onGenerated: (data: PlatformResultData) => void;
  onInvalidate: () => void;
}

export function TiktokTab({ isActive, clientId, onGenerated, onInvalidate }: TiktokTabProps) {
  const periodOld = usePeriodLabel('Bulan Lalu');
  const periodCur = usePeriodLabel('Bulan Ini');

  const [files, setFiles] = useState<Record<FileKey, FileState | null>>({ 'tiktok-old': null, 'tiktok-cur': null });
  const [fileErrors, setFileErrors] = useState<Record<FileKey, string | null>>({ 'tiktok-old': null, 'tiktok-cur': null });
  const [srcMode, setSrcMode] = useState<Record<FileKey, SlotSource>>({ 'tiktok-old': 'upload', 'tiktok-cur': 'upload' });
  const [savedPick, setSavedPick] = useState<Record<FileKey, SavedPeriod | null>>({ 'tiktok-old': null, 'tiktok-cur': null });
  const [pickerOpen, setPickerOpen] = useState<FileKey | null>(null);
  const [periodOldDays, setPeriodOldDays] = useState<number | null>(null);
  const [periodCurDays, setPeriodCurDays] = useState<number | null>(null);
  const [periodOldRange, setPeriodOldRange] = useState<DateRange>(EMPTY_RANGE);
  const [periodCurRange, setPeriodCurRange] = useState<DateRange>(EMPTY_RANGE);
  const [report, setReport] = useState<TiktokReport | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');

  async function handleFile(file: File, key: FileKey) {
    const basics = validateFileBasics(file, ['.xlsx', '.xls', '.csv']);
    if (!basics.ok) {
      setFileErrors((prev) => ({ ...prev, [key]: basics.message || 'File tidak valid.' }));
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseTiktokXLSX(buffer);
      if (!rows.length) {
        setFileErrors((prev) => ({ ...prev, [key]: 'File kosong atau format tidak dikenali.' }));
        return;
      }
      const cols = requireColumns(rows, [{ label: 'Cost', kw: ['cost'] }]);
      if (!cols.ok) {
        setFileErrors((prev) => ({ ...prev, [key]: cols.message || 'Kolom wajib tidak ditemukan.' }));
        return;
      }
      setFileErrors((prev) => ({ ...prev, [key]: null }));
      setFiles((prev) => ({ ...prev, [key]: { rows, fileName: file.name, file } }));
      const period = periodFromTiktokFilename(file.name);
      const isOld = key === 'tiktok-old';
      (isOld ? periodOld : periodCur).autoFill(period.label);
      if (period.days != null) (isOld ? setPeriodOldDays : setPeriodCurDays)(period.days);
      (isOld ? setPeriodOldRange : setPeriodCurRange)({ start: toISODate(period.start), end: toISODate(period.end) });
      setReport(null);
      onInvalidate();
    } catch (err) {
      setFileErrors((prev) => ({ ...prev, [key]: 'Gagal membaca isi file: ' + (err as Error).message }));
    }
  }

  function switchMode(key: FileKey, mode: SlotSource) {
    setSrcMode((prev) => ({ ...prev, [key]: mode }));
    setFiles((prev) => ({ ...prev, [key]: null }));
    setSavedPick((prev) => ({ ...prev, [key]: null }));
    setFileErrors((prev) => ({ ...prev, [key]: null }));
    setReport(null);
    onInvalidate();
  }

  async function applySavedPeriod(key: FileKey, p: SavedPeriod) {
    const isOld = key === 'tiktok-old';
    try {
      const detail = await getSavedPeriod(p.runId, p.role);
      const rows = detail.channels.tiktok ?? [];
      setFiles((prev) => ({ ...prev, [key]: { rows, fileName: `Data tersimpan · ${p.label ?? detail.period.label ?? ''}`.trim() } }));
      setSavedPick((prev) => ({ ...prev, [key]: p }));
      setFileErrors((prev) => ({ ...prev, [key]: null }));
      (isOld ? periodOld : periodCur).autoFill(p.label ?? detail.period.label ?? '');
      const start = detail.period.start ?? p.start;
      const end = detail.period.end ?? p.end;
      (isOld ? setPeriodOldRange : setPeriodCurRange)({ start, end });
      const sd = start ? fromISODate(start) : null;
      const ed = end ? fromISODate(end) : null;
      (isOld ? setPeriodOldDays : setPeriodCurDays)(sd && ed ? daysBetweenInclusive(sd, ed) : null);
      setReport(null);
      onInvalidate();
    } catch (err) {
      setFileErrors((prev) => ({ ...prev, [key]: 'Gagal memuat data tersimpan: ' + (err as Error).message }));
    }
  }

  const ready = Boolean(files['tiktok-old'] && files['tiktok-cur'] && clientId);

  const autoSave = useAutoSave('tiktok');
  const armReportScroll = useScrollAfterGenerate('report-tiktok', report);

  function generate() {
    const r = buildTiktokReport(periodOld.label, periodCur.label, periodOldDays, periodCurDays, files['tiktok-old']?.rows ?? [], files['tiktok-cur']?.rows ?? []);
    setReport(r);
    setGeneratedAt(formatGeneratedDate());
    onGenerated({ period: { old: r.p1, cur: r.p2 }, kpis: r.summary.kpis, spend: r.summary.spend });
    autoSave.save(clientId, buildSavePayload(), buildSaveFiles());
  }

  function reset() {
    periodOld.reset();
    periodCur.reset();
    setFiles({ 'tiktok-old': null, 'tiktok-cur': null });
    setFileErrors({ 'tiktok-old': null, 'tiktok-cur': null });
    setSrcMode({ 'tiktok-old': 'upload', 'tiktok-cur': 'upload' });
    setSavedPick({ 'tiktok-old': null, 'tiktok-cur': null });
    setPickerOpen(null);
    setPeriodOldDays(null);
    setPeriodCurDays(null);
    setPeriodOldRange(EMPTY_RANGE);
    setPeriodCurRange(EMPTY_RANGE);
    setReport(null);
    onInvalidate();
  }

  function buildSavePayload(): Omit<SaveReportPayload, 'brandId' | 'platform'> {
    return {
      period: { oldStart: periodOldRange.start, oldEnd: periodOldRange.end, curStart: periodCurRange.start, curEnd: periodCurRange.end, oldLabel: periodOld.label, curLabel: periodCur.label },
      reportConfig: null,
      rows: {
        tiktok: [...mapTiktokRows(files['tiktok-old']?.rows ?? [], 'old'), ...mapTiktokRows(files['tiktok-cur']?.rows ?? [], 'cur')],
      },
    };
  }

  function buildSaveFiles() {
    return [
      files['tiktok-old']?.file ? { file: files['tiktok-old']!.file!, channel: 'tiktok', periodRole: 'old' as const } : null,
      files['tiktok-cur']?.file ? { file: files['tiktok-cur']!.file!, channel: 'tiktok', periodRole: 'cur' as const } : null,
    ].filter((f): f is { file: File; channel: string; periodRole: 'old' | 'cur' } => f !== null);
  }

  function dropzone(key: FileKey) {
    const f = files[key];
    const pick = savedPick[key];
    return (
      <div>
        <SlotSourceTabs
          value={srcMode[key]}
          onChange={(m) => switchMode(key, m)}
          disabledSavedReason={clientId ? null : 'Pilih klien dulu di bagian atas halaman'}
        />
        {srcMode[key] === 'upload' ? (
          <Dropzone
            tag={key === 'tiktok-old' ? 'Periode Lalu' : 'Periode Ini'}
            accept=".xlsx,.xls,.csv"
            onFile={(file) => handleFile(file, key)}
            loaded={Boolean(f)}
            fileName={f?.fileName}
            infoText={f ? `${f.rows.length} campaigns` : undefined}
          />
        ) : (
          <SavedSlotCard
            picked={
              pick
                ? {
                    title: pick.label || 'Tanpa label',
                    sourceComparison: pick.sourceComparison,
                    savedAt: formatSavedAt(pick.savedAt),
                    summary: f ? `${f.rows.length} campaigns · ${formatChannelCoverage(pick.channels)}` : '',
                  }
                : null
            }
            onOpen={() => setPickerOpen(key)}
            onClear={() => switchMode(key, 'saved')}
          />
        )}
        {fileErrors[key] && <InlineNotice title="File ini belum kebaca">{fileErrors[key]}</InlineNotice>}
      </div>
    );
  }

  const steps: Step[] = [
    {
      label: 'Upload file GMV Max — Periode Lalu & Ini',
      sub: files['tiktok-old'] && files['tiktok-cur'] ? `${files['tiktok-old'].fileName} · ${files['tiktok-cur'].fileName}` : undefined,
      status: files['tiktok-old'] && files['tiktok-cur'] ? 'done' : 'current',
    },
    {
      label: 'Beri label periode',
      status: !(files['tiktok-old'] && files['tiktok-cur']) ? 'todo' : periodOld.inputValue && periodCur.inputValue ? 'done' : 'current',
    },
    { label: 'Generate laporan', status: report ? 'done' : ready ? 'current' : 'todo' },
    { label: 'Lihat & unduh PDF', status: report ? 'current' : 'todo' },
  ];

  return (
    <div className={`panel${isActive ? ' active' : ''}`}>
      <HowTo>
        <HowToStep num={1} numClassName="tiktok-num" title="Download report dari TikTok Ads Manager">
          Buka TikTok Ads Manager → <strong>Reporting</strong> → pilih level <strong>Campaign</strong>. Set rentang tanggal untuk periode lalu dan periode ini secara terpisah, lalu download masing-masing sebagai file Excel (.xlsx). Pastikan kolom yang tersedia meliputi: Campaign Name, Cost, SKU Orders, Cost per Order, Gross Revenue, dan ROI.
        </HowToStep>
        <HowToStep num={2} numClassName="tiktok-num" title="Upload file & generate laporan">
          Upload file periode lalu dan periode ini, lalu klik <strong>Generate Laporan</strong>. Semua metrik (Cost, Order, Cost per Order, Gross Revenue, AOV, ROI) dihitung otomatis dari data campaign.
        </HowToStep>
      </HowTo>

      <StepIndicator steps={steps} accent="var(--tiktok)" />

      <PeriodInputRow
        colorClass="tiktok-period"
        oldValue={periodOld.inputValue}
        curValue={periodCur.inputValue}
        onOldChange={periodOld.onInput}
        onCurChange={periodCur.onInput}
        oldPlaceholder="cth: Apr 2026 / W1–W2 Jun"
        curPlaceholder="cth: Mei 2026 / W3–W4 Jun"
      />

      <div className="source-block">
        <div className="source-header">
          <div className="source-label" style={{ color: 'var(--tiktok)' }}>
            TikTok GMV Max
          </div>
        </div>
        <div className="dz-grid-4">
          {dropzone('tiktok-old')}
          {dropzone('tiktok-cur')}
        </div>
      </div>

      {pickerOpen && clientId && (
        <SavedPeriodPicker
          clientId={clientId}
          platform="tiktok"
          variant="period"
          onClose={() => setPickerOpen(null)}
          onPick={((key) => (p: SavedPeriod) => applySavedPeriod(key, p))(pickerOpen)}
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
              ✦ Generate Laporan
            </button>
            <button className="btn btn-ghost" onClick={reset}>
              ↺ Reset
            </button>
          </div>
        </div>
      )}

      {report && (
        <div id="report-tiktok">
          <div className="report-top">
            <div className="report-title">Performance Report</div>
            <div className="report-period">
              <PeriodCompareChip old={report.p1} cur={report.p2} onBrand />
            </div>
            <div className="report-meta num">Generated {generatedAt}</div>
          </div>
          <div data-role="r-body">
            <PeriodWarningBanner message={report.periodWarning} />
            <div className="sec-block">
              <div className="sec-heading tiktok-heading">
                TikTok GMV Max <span className="sec-badge">Overall</span>
                <SectionDownloadButton />
              </div>
              <div style={{ padding: '0 1.4rem 1.4rem' }}>
                <KpiTable rows={report.rows} p1={report.p1} p2={report.p2} />
              </div>
            </div>
          </div>
          <div className="action-row" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
            <DownloadPdfButton targetId="report-tiktok" filename="Performance Report - TikTok GMV Max.pdf" />
            <button className="btn btn-ghost" onClick={reset}>
              ↺ Upload Data Baru
            </button>
          </div>
          <SaveStatus status={autoSave.status} message={autoSave.message} />
        </div>
      )}
    </div>
  );
}
