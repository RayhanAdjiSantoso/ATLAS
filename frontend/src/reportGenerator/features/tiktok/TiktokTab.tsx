import { useState } from 'react';
import { LibraryFileSlot, type LibrarySelection } from '../reports/LibraryFileSlot';
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
import { usePeriodLabel } from '../../hooks/usePeriodLabel';
import { fromISODate, toISODate } from '../../lib/dateFmt';
import { daysBetweenInclusive } from '../../lib/periodLabel';
import { parseTiktokXLSX, periodFromTiktokFilename } from '../../lib/tiktok';
import type { SheetRow } from '../../lib/types';
import { requireColumns, validateFileBasics } from '../../lib/validation';
import type { PlatformResultData } from '../../lib/summary';
import { AiSummarySection } from '../ai/AiSummarySection';
import { SaveStatus } from '../reports/SaveStatus';
import { useAutoSave } from '../reports/useAutoSave';
import { mapTiktokRows } from '../reports/rowMapping';
import { formatChannelCoverage, formatSavedAt } from '../reports/savedPeriodLabels';
import type { RawFileEntry, SaveReportPayload } from '../reports/types';
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
  const [periodOldDays, setPeriodOldDays] = useState<number | null>(null);
  const [periodCurDays, setPeriodCurDays] = useState<number | null>(null);
  const [periodOldRange, setPeriodOldRange] = useState<DateRange>(EMPTY_RANGE);
  const [periodCurRange, setPeriodCurRange] = useState<DateRange>(EMPTY_RANGE);
  const [report, setReport] = useState<TiktokReport | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');

  async function handleFile(input: File[], key: FileKey, selection: LibrarySelection) {
    const file = input[0];
    const basics = validateFileBasics(file, ['.xlsx', '.xls', '.csv']);
    if (!basics.ok) {
      throw new Error(basics.message || 'File tidak valid.');
    }
    try {
      const rows = (await Promise.all(input.map(async f => parseTiktokXLSX(await f.arrayBuffer())))).flat();
      if (!rows.length) {
        throw new Error('File kosong atau format tidak dikenali.');
      }
      const cols = requireColumns(rows, [{ label: 'Cost', kw: ['cost'] }]);
      if (!cols.ok) {
        throw new Error(cols.message || 'Kolom wajib tidak ditemukan.');
      }
      setFileErrors((prev) => ({ ...prev, [key]: null }));
      setFiles((prev) => ({ ...prev, [key]: { rows, fileName: input.map(f => f.name).join(' · ') } }));
      const period = { label: selection.label, start: selection.start ? fromISODate(selection.start) : null, end: selection.end ? fromISODate(selection.end) : null, days: selection.start && selection.end ? daysBetweenInclusive(fromISODate(selection.start)!, fromISODate(selection.end)!) : null };
      const isOld = key === 'tiktok-old';
      (isOld ? periodOld : periodCur).autoFill(period.label);
      if (period.days != null) (isOld ? setPeriodOldDays : setPeriodCurDays)(period.days);
      (isOld ? setPeriodOldRange : setPeriodCurRange)({ start: toISODate(period.start), end: toISODate(period.end) });
      setReport(null);
      onInvalidate();
    } catch (err) {
      setFileErrors((prev) => ({ ...prev, [key]: 'Gagal membaca isi file: ' + (err as Error).message }));
      throw err;
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

  // Original source files already live in the brand library. Save parsed report rows only.
  function buildSaveFiles(): RawFileEntry[] { return []; }


  function dropzone(key: FileKey) {
    const f = files[key];
    return <div><LibraryFileSlot clientId={clientId} platform="tiktok" channel="tiktok"
      tag={key === 'tiktok-old' ? 'Periode Lalu' : 'Periode Ini'}
      onFiles={(input, selection) => handleFile(input, key, selection)} loaded={Boolean(f)}
      fileName={f?.fileName} infoText={f ? `${f.rows.length} kampanye` : undefined} />
      {fileErrors[key] && <InlineNotice title="Sumber belum dapat dibaca">{fileErrors[key]}</InlineNotice>}</div>;
  }

  const steps: Step[] = [
    {
      label: 'Pilih file GMV Max — Periode Lalu & Ini',
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
        <HowToStep num={2} numClassName="tiktok-num" title="Pilih sumber & buat laporan">
          Pilih file perpustakaan untuk periode lalu dan periode ini, lalu klik <strong>Generate Laporan</strong>. Semua metrik (Cost, Order, Cost per Order, Gross Revenue, AOV, ROI) dihitung otomatis dari data campaign.
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
          <AiSummarySection
              clientId={clientId}
              platform="tiktok"
              period={{ old: report.p1, cur: report.p2 }}
              periodDates={{ oldStart: periodOldRange.start, oldEnd: periodOldRange.end, curStart: periodCurRange.start, curEnd: periodCurRange.end }}
              kpis={report.summary.kpis}
              periodWarning={report.periodWarning}
            />
          <div className="action-row" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
            <DownloadPdfButton targetId="report-tiktok" filename="Performance Report - TikTok GMV Max.pdf" />
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
