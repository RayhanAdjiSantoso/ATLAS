import { useState } from 'react';
import { LibraryFileSlot, type LibrarySelection } from '../reports/LibraryFileSlot';
import { ManualFileSlot } from '../reports/ManualFileSlot';
import { combineManualPeriods } from '../../lib/manualPeriod';
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
import { getSavedPeriod } from '../reports/api';
import { formatChannelCoverage, formatSavedAt } from '../reports/savedPeriodLabels';
import { PeriodSourcePicker, type LibraryMonth } from '../reports/PeriodSourcePicker';
import api from '../../../api/client.js';
import type { LibraryFile } from '../reports/LibraryFileSlot';
import { SavedSlotCard, SlotSourceTabs, type SlotSource } from '../../components/SlotSourceTabs';
import type { PeriodRole, RawFileEntry, SaveReportPayload, SavedPeriod } from '../reports/types';
import { buildTiktokReport, type TiktokReport } from './tiktokReport';

type FileKey = 'tiktok-old' | 'tiktok-cur';

// Library channels that count as "this month has TikTok data".
const TIKTOK_PERIOD_CHANNELS = ['tiktok'] as const;

interface FileState {
  rows: SheetRow[];
  fileName: string;
  // Absent when the slot's rows came from stored data (PeriodSourcePicker)
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

  // "Pilih dari data tersimpan" — per period side, fills that side's file
  // straight from a previously saved report_run instead of re-uploading.
  const [oldSource, setOldSource] = useState<SlotSource>('saved');
  const [curSource, setCurSource] = useState<SlotSource>('saved');
  // Two stored sources now: a month from the brand library, and a period from
  // a report already generated.
  const [oldPickedMonth, setOldPickedMonth] = useState<LibraryMonth | null>(null);
  const [curPickedMonth, setCurPickedMonth] = useState<LibraryMonth | null>(null);
  const [oldPicked, setOldPicked] = useState<SavedPeriod | null>(null);
  const [curPicked, setCurPicked] = useState<SavedPeriod | null>(null);
  const [pickerRole, setPickerRole] = useState<PeriodRole | null>(null);
  const [applyingRole, setApplyingRole] = useState<PeriodRole | null>(null);
  // Per-slot notes from combining manual files (a date gap, an unreadable period).
  const [manualWarnings, setManualWarnings] = useState<Record<FileKey, string | null>>({ 'tiktok-old': null, 'tiktok-cur': null });

  async function applySavedPeriod(targetRole: PeriodRole, period: SavedPeriod) {
    const key: FileKey = targetRole === 'old' ? 'tiktok-old' : 'tiktok-cur';
    setApplyingRole(targetRole);
    setFileErrors((prev) => ({ ...prev, [key]: null }));
    try {
      const detail = await getSavedPeriod(period.runId, period.role);
      const rows = detail.channels.tiktok ?? [];
      if (!rows.length) throw new Error('Periode ini tidak memiliki data campaign yang tersimpan.');
      setFiles((prev) => ({ ...prev, [key]: { rows, fileName: 'Dari laporan tersimpan' } }));
      (targetRole === 'old' ? periodOld : periodCur).autoFill(detail.period.label);
      if (detail.period.start && detail.period.end) {
        (targetRole === 'old' ? setPeriodOldRange : setPeriodCurRange)({ start: detail.period.start, end: detail.period.end });
        (targetRole === 'old' ? setPeriodOldDays : setPeriodCurDays)(daysBetweenInclusive(fromISODate(detail.period.start)!, fromISODate(detail.period.end)!));
      }
      setReport(null);
      onInvalidate();
    } catch (err) {
      setFileErrors((prev) => ({ ...prev, [key]: 'Gagal memuat periode tersimpan: ' + (err as Error).message }));
      (targetRole === 'old' ? setOldPicked : setCurPicked)(null);
    } finally {
      setApplyingRole(null);
    }
  }

  function handlePickPeriod(period: SavedPeriod) {
    const targetRole = pickerRole;
    if (!targetRole) return;
    (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
    (targetRole === 'old' ? setOldPicked : setCurPicked)(period);
    (targetRole === 'old' ? setOldSource : setCurSource)('saved');
    applySavedPeriod(targetRole, period);
  }

  // A month straight from Pengaturan Brand — usable before any report has
  // ever been generated for it, which the archive by definition cannot offer.
  async function applyLibraryMonth(targetRole: PeriodRole, month: LibraryMonth) {
    if (!clientId) return;
    const key: FileKey = targetRole === 'old' ? 'tiktok-old' : 'tiktok-cur';
    setApplyingRole(targetRole);
    setFileErrors((prev) => ({ ...prev, [key]: null }));
    try {
      const { data } = await api.get(`/brands/${clientId}/library`);
      const list = (data.files as LibraryFile[]).filter((f) => f.platform === 'tiktok' && f.channel === 'tiktok' && f.period_month?.slice(0, 7) === month.month);
      if (!list.length) throw new Error('Bulan ini tidak punya file campaign TikTok di Pengaturan Brand.');
      const buffers = await Promise.all(
        list.map(async (f) => {
          const res = await api.get(`/brands/${clientId}/library/${f.id}/download`, { responseType: 'arraybuffer' });
          return res.data as ArrayBuffer;
        }),
      );
      const rows = (await Promise.all(buffers.map((b) => parseTiktokXLSX(b)))).flat();
      if (!rows.length) throw new Error('File bulan ini kosong atau formatnya tidak dikenali.');
      setFiles((prev) => ({ ...prev, [key]: { rows, fileName: list.map((f) => f.original_filename).join(' · ') } }));
      (targetRole === 'old' ? periodOld : periodCur).autoFill(month.label);
      if (month.start && month.end) {
        (targetRole === 'old' ? setPeriodOldRange : setPeriodCurRange)({ start: month.start.slice(0, 10), end: month.end.slice(0, 10) });
        (targetRole === 'old' ? setPeriodOldDays : setPeriodCurDays)(daysBetweenInclusive(fromISODate(month.start.slice(0, 10))!, fromISODate(month.end.slice(0, 10))!));
      }
      setReport(null);
      onInvalidate();
    } catch (err) {
      setFileErrors((prev) => ({ ...prev, [key]: 'Gagal memuat periode dari perpustakaan: ' + (err as Error).message }));
      (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
    } finally {
      setApplyingRole(null);
    }
  }

  function handlePickMonth(month: LibraryMonth) {
    const targetRole = pickerRole;
    if (!targetRole) return;
    (targetRole === 'old' ? setOldPicked : setCurPicked)(null);
    (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(month);
    (targetRole === 'old' ? setOldSource : setCurSource)('saved');
    applyLibraryMonth(targetRole, month);
  }

  function clearPickedPeriod(role: PeriodRole) {
    const key: FileKey = role === 'old' ? 'tiktok-old' : 'tiktok-cur';
    (role === 'old' ? setOldPicked : setCurPicked)(null);
    (role === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
    setFiles((prev) => ({ ...prev, [key]: null }));
    setReport(null);
    onInvalidate();
  }

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

  // ── Manual upload ("Upload file baru") ─────────────────────────────────
  // Not stored in the brand library. TikTok names its exports with their date
  // range, which is where each file's period comes from; ranges must join up
  // before the files are summed (see lib/manualPeriod.ts).
  async function handleManualFile(input: File[], key: FileKey) {
    const { selection, warning } = combineManualPeriods(input.map((f) => ({ name: f.name, period: periodFromTiktokFilename(f.name) })));
    await handleFile(input, key, selection);
    setManualWarnings((prev) => ({ ...prev, [key]: warning }));
  }

  function clearManualFile(key: FileKey) {
    setFiles((prev) => ({ ...prev, [key]: null }));
    setManualWarnings((prev) => ({ ...prev, [key]: null }));
    setReport(null);
    onInvalidate();
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
    setOldSource('saved');
    setCurSource('saved');
    setManualWarnings({ 'tiktok-old': null, 'tiktok-cur': null });
    setOldPicked(null);
    setCurPicked(null);
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


  // No wrapping <div> here — librarySource.css's `.dz-grid-4:has(> .library-slot)`
  // rule (which stretches a LibraryFileSlot to the grid's full width instead
  // of squeezing 2 of its own wide internal columns into a half-width grid
  // cell) only matches when .library-slot is a DIRECT child of .dz-grid-4.
  // A wrapper div here breaks that match and the slot overflows its column.
  function dropzone(key: FileKey) {
    const f = files[key];
    if ((key === 'tiktok-old' ? oldSource : curSource) === 'upload') {
      return (
        <ManualFileSlot
          tag={key === 'tiktok-old' ? 'Periode Lalu' : 'Periode Ini'} accept=".xlsx,.xls,.csv"
          loaded={Boolean(f)} fileName={f?.fileName} infoText={f ? `${f.rows.length} kampanye` : undefined}
          warning={manualWarnings[key]}
          onFiles={(input) => handleManualFile(input, key)}
          onClear={() => clearManualFile(key)}
        />
      );
    }
    return (
      <LibraryFileSlot clientId={clientId} platform="tiktok" channel="tiktok"
        tag={key === 'tiktok-old' ? 'Periode Lalu' : 'Periode Ini'}
        onFiles={(input, selection) => handleFile(input, key, selection)} loaded={Boolean(f)}
        fileName={f?.fileName} infoText={f ? `${f.rows.length} kampanye` : undefined} />
    );
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
          Pilih file perpustakaan untuk periode lalu dan periode ini — atau pilih <strong>Upload file baru</strong> untuk rentang khusus yang tidak disimpan — lalu klik <strong>Generate Laporan</strong>. Semua metrik (Cost, Order, Cost per Order, Gross Revenue, AOV, ROI) dihitung otomatis dari data campaign.
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
            Pilih Periode
          </div>
          <span className="sec-badge">Perpustakaan Brand &amp; Arsip Laporan</span>
        </div>
        <div className="dz-grid-4">
          {(['old', 'cur'] as const).map((role) => {
            const pickedRun = role === 'old' ? oldPicked : curPicked;
            const pickedMonth = role === 'old' ? oldPickedMonth : curPickedMonth;
            const picked = pickedMonth
              ? { title: pickedMonth.label, sourceComparison: '', savedAt: '', summary: formatChannelCoverage(pickedMonth.channels), metaLine: 'Perpustakaan Brand' }
              : pickedRun
                ? {
                    title: pickedRun.label || 'Tanpa label',
                    sourceComparison: pickedRun.sourceComparison,
                    savedAt: formatSavedAt(pickedRun.savedAt),
                    summary: formatChannelCoverage(pickedRun.channels),
                    metaLine: 'Arsip Laporan',
                  }
                : null;
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
                    <strong>{role === 'old' ? 'Periode Lalu' : 'Periode Ini'} memakai file manual.</strong> Unggah di bagian TikTok GMV Max di bawah — file tidak disimpan ke Pengaturan Brand. Beberapa file yang rentangnya bersambung (mis. 1–7 dan 8–12) dijumlahkan otomatis; periode dibaca dari nama file ekspor TikTok.
                  </div>
                )}
                {source === 'saved' &&
                  (applyingRole === role ? (
                    <div className="empty-note">Menerapkan periode…</div>
                  ) : (
                    <SavedSlotCard picked={picked}
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
        <PeriodSourcePicker
          clientId={clientId}
          platform="tiktok"
          periodChannels={TIKTOK_PERIOD_CHANNELS}
          sideLabel={pickerRole === 'old' ? 'Periode Lalu' : 'Periode Ini'}
          selectedMonth={(pickerRole === 'old' ? oldPickedMonth : curPickedMonth)?.month ?? null}
          selectedRun={
            (pickerRole === 'old' ? oldPicked : curPicked)
              ? { runId: (pickerRole === 'old' ? oldPicked : curPicked)!.runId, role: (pickerRole === 'old' ? oldPicked : curPicked)!.role }
              : null
          }
          onClose={() => setPickerRole(null)}
          onPickLibrary={handlePickMonth}
          onPickArchive={handlePickPeriod}
        />
      )}

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
        {fileErrors['tiktok-old'] && <InlineNotice title="Sumber Periode Lalu belum dapat dibaca">{fileErrors['tiktok-old']}</InlineNotice>}
        {fileErrors['tiktok-cur'] && <InlineNotice title="Sumber Periode Ini belum dapat dibaca">{fileErrors['tiktok-cur']}</InlineNotice>}
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
