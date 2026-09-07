import { useEffect, useRef, useState } from 'react';
import { Dropzone } from '../../components/Dropzone';
import { ReportPages } from '../../components/ReportPages';
import { useScrollAfterGenerate } from '../../hooks/useScrollAfterGenerate';
import { DemoBreakdownCard } from '../../components/DemoBreakdownCard';
import { HowTo, HowToStep } from '../../components/HowTo';
import { InlineNotice } from '../../components/InlineNotice';
import { SearchSelect } from '../../components/SearchSelect';
import {
  META_OBJECTIVE_CHOICES,
  defaultMetaDayRanges,
  detectMetaObjectiveCol,
  dominantMetaObjective,
  metaDayRange,
  type MetaIndustry,
  type MetaObjectiveKey,
} from '../../lib/meta';
import { findCol } from '../../lib/columns';
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
import { SlotSourceTabs, SavedSlotCard, type SlotSource } from '../../components/SlotSourceTabs';
import type { PlatformResultData } from '../../lib/summary';
import { SaveStatus } from '../reports/SaveStatus';
import { useAutoSave } from '../reports/useAutoSave';
import { getReportDetail } from '../reports/api';
import { SavedPeriodPicker } from '../reports/SavedPeriodPicker';
import { formatSavedAt } from '../reports/savedPeriodLabels';
import { mapMetaCpasRows, mapMetaMainRows } from '../reports/rowMapping';
import type { RawFileEntry, SaveReportPayload, SavedPeriod } from '../reports/types';
import { buildMetaReport, type MetaReport } from './metaReport';

// Meta's export uses either a "Month" breakdown or a "Day" breakdown column
// as the period dimension — either satisfies the requirement.
const REQUIRED_COLS = [
  { label: 'Amount Spent', kw: ['amount spent'] },
  { label: 'Month/Day', kw: ['month', 'day'] },
  { label: 'Campaign Name', kw: ['campaign'] },
];

const INDUSTRY_OPTIONS = [
  { id: 'b2b', name: 'B2B / Services' },
  { id: 'retail', name: 'Retail' },
];
const OBJECTIVE_OPTIONS = META_OBJECTIVE_CHOICES.map((o) => ({ id: o.key, name: o.label }));

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
  const [metaRows, setMetaRows] = useState<SheetRow[] | null>(null);
  const [metaHeaders, setMetaHeaders] = useState<string[]>([]);
  const [metaFileName, setMetaFileName] = useState('');
  const [metaFile, setMetaFile] = useState<File | null>(null);

  const [cpasRows, setCpasRows] = useState<SheetRow[] | null>(null);
  const [cpasHeaders, setCpasHeaders] = useState<string[]>([]);
  const [cpasFileName, setCpasFileName] = useState('');
  const [cpasFile, setCpasFile] = useState<File | null>(null);

  // B2B / Retail — manual, not in the export. Objective — Meta's ODAX
  // objective; auto-prefilled from the file's "Objective" column when present,
  // still overridable.
  const [industry, setIndustry] = useState<MetaIndustry>(null);
  // Legacy — the "Custom Conversion" column picker is gone; kept so old saved
  // report configs still round-trip.
  const [customResultsCol, setCustomResultsCol] = useState<string | null>(null);
  const [objective, setObjective] = useState<MetaObjectiveKey | null>(null);
  // True once the objective was auto-prefilled for the current file, so the
  // prefill effect doesn't keep stomping a manual change.
  const objectivePrefilledFor = useRef<string>('');

  // Day-breakdown support: when the uploaded file has a "Day" column instead
  // of "Month" (a real per-day export, not a bucketed calendar month), the
  // user picks exact old/cur sub-ranges instead of relying on Meta's own
  // month-bucket boundaries — see lib/meta.ts's splitByDayRange.
  const [dayCol, setDayCol] = useState<string | null>(null);
  const [dayBounds, setDayBounds] = useState<{ min: Date; max: Date } | null>(null);
  const [oldRange, setOldRange] = useState<{ start: Date; end: Date } | null>(null);
  const [curRange, setCurRange] = useState<{ start: Date; end: Date } | null>(null);

  const [report, setReport] = useState<MetaReport | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  // "Pilih dari data tersimpan" — Meta uploads one file spanning both
  // periods, so the picker reuses a whole previously-saved comparison
  // (both periods + industry/header config), not an independent period.
  const [srcMode, setSrcMode] = useState<SlotSource>('upload');
  const [savedPick, setSavedPick] = useState<SavedPeriod | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function handleUpload(file: File, target: 'meta' | 'cpas') {
    const basics = validateFileBasics(file, ['.csv', '.xlsx', '.xls']);
    if (!basics.ok) {
      setUploadError(basics.message || 'File tidak valid.');
      return;
    }
    try {
      const rows = await readSpreadsheetFile(file);
      if (!rows.length) {
        setUploadError('File kosong.');
        return;
      }
      const cols = requireColumns(rows, REQUIRED_COLS);
      if (!cols.ok) {
        setUploadError(cols.message || 'Kolom wajib tidak ditemukan.');
        return;
      }
      setUploadError(null);
      const headers = Object.keys(rows[0]);
      if (target === 'meta') {
        setMetaRows(rows);
        setMetaHeaders(headers);
        setMetaFileName(file.name);
        setMetaFile(file);
        const dCol = findCol(rows, ['day']);
        const bounds = dCol ? metaDayRange(rows, dCol) : null;
        setDayCol(dCol);
        setDayBounds(bounds);
        if (bounds) {
          const defaults = defaultMetaDayRanges(bounds.min, bounds.max);
          setOldRange(defaults.old);
          setCurRange(defaults.cur);
        } else {
          setOldRange(null);
          setCurRange(null);
        }
      } else {
        setCpasRows(rows);
        setCpasHeaders(headers);
        setCpasFileName(file.name);
        setCpasFile(file);
      }
      setReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal membaca isi file: ' + (err as Error).message);
    }
  }

  function pickIndustry(ind: MetaIndustry) {
    setIndustry(ind);
    setReport(null);
    onInvalidate();
  }
  function pickObjective(obj: MetaObjectiveKey | null) {
    setObjective(obj);
    setReport(null);
    onInvalidate();
  }

  function switchMode(mode: SlotSource) {
    setSrcMode(mode);
    setSavedPick(null);
    setMetaRows(null);
    setMetaHeaders([]);
    setMetaFileName('');
    setMetaFile(null);
    setCpasRows(null);
    setCpasHeaders([]);
    setCpasFileName('');
    setCpasFile(null);
    setIndustry(null);
    setCustomResultsCol(null);
    setObjective(null);
    objectivePrefilledFor.current = '';
    setDayCol(null);
    setDayBounds(null);
    setOldRange(null);
    setCurRange(null);
    setReport(null);
    setUploadError(null);
    onInvalidate();
  }

  // Rehydrate a whole saved comparison into tab state — same shape
  // reconstructMetaReport() derives, but left editable so Generate + autosave
  // run normally (the autosave upserts back onto the same period pair).
  async function applySavedComparison(p: SavedPeriod) {
    try {
      const detail = await getReportDetail(p.runId);
      const cfg = (detail.report.reportConfig ?? {}) as {
        industry?: MetaIndustry;
        customResultsCol?: string | null;
        objective?: MetaObjectiveKey | null;
        metaHeaders?: string[];
        cpasHeaders?: string[];
      };
      const extraOf = (r: Record<string, unknown>): SheetRow => (r.extra as SheetRow | null) ?? {};
      const mainRows = detail.rows.filter((r) => r.channel === 'boost' || r.channel === 'nonboost').map(extraOf);
      const cpasRowsAll = detail.rows.filter((r) => r.channel === 'cpas_overall').map(extraOf);
      if (!mainRows.length) {
        setUploadError('Data Meta tersimpan tidak memuat baris Boost / Non-Boost.');
        return;
      }
      setUploadError(null);
      setMetaRows(mainRows);
      setMetaHeaders(cfg.metaHeaders ?? Object.keys(mainRows[0] ?? {}));
      setMetaFileName(`Data tersimpan · ${detail.report.periodCurLabel ?? '?'} vs ${detail.report.periodOldLabel ?? '?'}`);
      setMetaFile(null);
      if (cpasRowsAll.length) {
        setCpasRows(cpasRowsAll);
        setCpasHeaders(cfg.cpasHeaders ?? Object.keys(cpasRowsAll[0] ?? {}));
        setCpasFileName('Data tersimpan');
        setCpasFile(null);
      } else {
        setCpasRows(null);
        setCpasHeaders([]);
        setCpasFileName('');
        setCpasFile(null);
      }
      setIndustry(cfg.industry ?? null);
      setCustomResultsCol(cfg.customResultsCol ?? null);
      setObjective(cfg.objective ?? null);
      // Respect a saved objective; otherwise let the prefill effect fill it in.
      objectivePrefilledFor.current = cfg.objective ? 'saved' : '';
      setSavedPick(p);

      const dCol = findCol(mainRows, ['day']);
      setDayCol(dCol);
      const oS = detail.report.periodOldStart ? fromISODate(detail.report.periodOldStart) : null;
      const oE = detail.report.periodOldEnd ? fromISODate(detail.report.periodOldEnd) : null;
      const cS = detail.report.periodCurStart ? fromISODate(detail.report.periodCurStart) : null;
      const cE = detail.report.periodCurEnd ? fromISODate(detail.report.periodCurEnd) : null;
      if (dCol && oS && oE && cS && cE) {
        setDayBounds({ min: oS, max: cE });
        setOldRange({ start: oS, end: oE });
        setCurRange({ start: cS, end: cE });
      } else {
        setDayBounds(null);
        setOldRange(null);
        setCurRange(null);
      }
      setReport(null);
      onInvalidate();
    } catch (err) {
      setUploadError('Gagal memuat data tersimpan: ' + (err as Error).message);
    }
  }

  // When the export carries an "Objective" column, Non-Boost is split per
  // objective automatically; the Objective dropdown is prefilled but purely
  // informational then. Without the column, the Objective pick is the single
  // Non-Boost headline.
  const objectiveCol = metaRows ? detectMetaObjectiveCol(metaHeaders) : null;

  // Prefill the Objective dropdown from the file's dominant (highest-spend)
  // objective, once per file — a manual change afterwards sticks.
  useEffect(() => {
    if (!metaRows || !objectiveCol) return;
    const fileKey = objectiveCol + '·' + metaRows.length;
    if (objectivePrefilledFor.current === fileKey) return;
    objectivePrefilledFor.current = fileKey;
    const spentCol = metaHeaders.find((h) => h.toLowerCase().includes('amount spent')) ?? null;
    const dom = dominantMetaObjective(metaRows, objectiveCol, spentCol);
    if (dom && dom !== 'other') setObjective(dom);
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
    setReport(r);
    setGeneratedAt(formatGeneratedDate());
    onGenerated({ period: { old: r.p1, cur: r.p2 }, kpis: r.summary.kpis, cpasKpis: r.summary.cpasKpis, spend: r.summary.spend });
    autoSave.save(clientId, buildSavePayload(r), buildSaveFiles());
  }

  function reset() {
    setMetaRows(null);
    setMetaHeaders([]);
    setMetaFileName('');
    setMetaFile(null);
    setCpasRows(null);
    setCpasHeaders([]);
    setCpasFileName('');
    setCpasFile(null);
    setIndustry(null);
    setCustomResultsCol(null);
    setObjective(null);
    objectivePrefilledFor.current = '';
    setDayCol(null);
    setDayBounds(null);
    setOldRange(null);
    setCurRange(null);
    setReport(null);
    setUploadError(null);
    setSrcMode('upload');
    setSavedPick(null);
    setPickerOpen(false);
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

  function buildSaveFiles(): RawFileEntry[] {
    const entries: (RawFileEntry | null)[] = [
      metaFile ? { file: metaFile, channel: 'meta', periodRole: 'old' } : null,
      cpasFile ? { file: cpasFile, channel: 'cpas', periodRole: 'old' } : null,
    ];
    return entries.filter((f): f is RawFileEntry => f !== null);
  }

  const hasAnySection = Boolean(
    report && (report.boost || report.nonBoost || report.boostAgeDemo || report.boostGenderDemo || report.ageDemo || report.genderDemo || (report.cpas && Object.keys(report.cpas).length)),
  );

  const steps: Step[] = [
    {
      label: 'Upload file Meta Ads & pilih industri',
      sub: metaFileName || undefined,
      status: metaRows && objectiveOk ? 'done' : 'current',
    },
    { label: 'Generate laporan', status: report ? 'done' : ready ? 'current' : 'todo' },
    { label: 'Lihat & unduh PDF', status: report ? 'current' : 'todo' },
  ];

  return (
    <div className={`panel${isActive ? ' active' : ''}`}>
      <HowTo>
        <HowToStep num={1} title="Download file dari Meta Ads Reporting">
          Download satu file yang mencakup rentang dua periode (periode lalu &amp; periode ini) langsung dari Meta Ads Reporting. Gunakan kolom-kolom berikut sesuai jenis akun:
          <div className="empty-note" style={{ padding: '.4rem 0 0' }}>
            Meta Ads Reporting dapat memakai breakdown "Month" atau "Day", rentang tanggalnya bebas (tidak harus 1 bulan penuh). Namun, jika memilih "Month", diharapkan bulan penuh. Jika memilih "Day", tanggalnya dapat disesuaikan.
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
                wajib kalau mau breakdown Amount Spent per objective (Sales / Leads / Traffic) di section Non-Boost. Tanpa kolom ini, Non-Boost
                digabung jadi satu.
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
        <HowToStep num={2} title="Upload file & generate laporan">
          Upload file Meta Ads (wajib). Upload juga file CPAS jika ada. Klik <strong>Generate Laporan</strong> untuk melihat hasil.
        </HowToStep>
      </HowTo>

      <StepIndicator steps={steps} accent="var(--acc)" />

      <div className="source-block">
        <div className="source-header">
          <div className="source-label">Meta Ads</div>
        </div>
        <SlotSourceTabs
          value={srcMode}
          onChange={switchMode}
          disabledSavedReason={clientId ? null : 'Pilih klien dulu di bagian atas halaman'}
        />
        {srcMode === 'upload' ? (
          <Dropzone
            tag="1 file · berisi 2 periode · Boost + Non-boost"
            accept=".csv,.xlsx,.xls"
            onFile={(f) => handleUpload(f, 'meta')}
            loaded={Boolean(metaRows)}
            fileName={metaFileName}
            infoText={metaRows ? `${metaRows.length} baris` : undefined}
          />
        ) : (
          <SavedSlotCard
            picked={
              savedPick
                ? {
                    title: savedPick.sourceComparison,
                    sourceComparison: savedPick.sourceComparison,
                    savedAt: formatSavedAt(savedPick.savedAt),
                    summary: metaRows ? `${metaRows.length} baris${cpasRows ? ` · CPAS ${cpasRows.length}` : ''}` : '',
                    metaLine: `disimpan ${formatSavedAt(savedPick.savedAt)} · industri & kolom Results ikut dimuat`,
                  }
                : null
            }
            onOpen={() => setPickerOpen(true)}
            onClear={() => switchMode('saved')}
            hint="Memuat 1 perbandingan Meta yang pernah disimpan (kedua periode sekaligus)"
          />
        )}
        {uploadError && <InlineNotice title="File ini belum kebaca">{uploadError}</InlineNotice>}
      </div>

      {pickerOpen && clientId && (
        <SavedPeriodPicker
          clientId={clientId}
          platform="meta"
          variant="comparison"
          onClose={() => setPickerOpen(false)}
          onPick={applySavedComparison}
        />
      )}

      {metaRows && (
        <div className="industry-selector visible">
          <div className="industry-label">Industri &amp; Objective</div>
          {objectiveCol && (
            <InlineNotice tone="info" title={`Kolom "${objectiveCol}" terdeteksi di file`}>
              Lajur <strong>Non-Boost</strong> otomatis dipecah per objective (Sales / Leads / Traffic / dst) — tiap objective punya headline &amp;
              Cost per X sendiri, plus baris <strong>Blended</strong> + <strong>Amount Spent per objective</strong> di atasnya. Dropdown Objective
              di bawah cuma prefill dari file (boleh diubah, nggak ngaruh ke hasil split).
            </InlineNotice>
          )}
          <div className="dual-select">
            <div className="dual-select-field">
              <span className="dual-select-label">Industri</span>
              <SearchSelect
                options={INDUSTRY_OPTIONS}
                value={industry === 'b2b' || industry === 'retail' ? industry : null}
                onChange={(id) => pickIndustry(id as MetaIndustry)}
                placeholder="— pilih —"
                searchable={false}
              />
              <span className="dual-select-hint">Manual — tidak ada di export Meta</span>
            </div>
            <div className="dual-select-field">
              <span className="dual-select-label">Objective{objectiveCol ? ' · prefill dari file' : ''}</span>
              <SearchSelect
                options={OBJECTIVE_OPTIONS}
                value={objective}
                onChange={(id) => pickObjective(id as MetaObjectiveKey)}
                placeholder="— pilih —"
                searchable={false}
              />
              <span className="dual-select-hint">
                {objectiveCol ? 'Info dari file — split tetap per objective' : 'Metrik headline Non-Boost (file tanpa kolom Objective)'}
              </span>
            </div>
          </div>
        </div>
      )}

      {dayCol && dayBounds && (
        <div className="source-block">
          <div className="source-header">
            <div className="source-label">Rentang Tanggal yang Dibandingkan</div>
          </div>
          <div className="empty-note" style={{ paddingTop: 0, paddingBottom: '.6rem' }}>
            File ini pakai breakdown harian — tersedia data {formatPeriodLabel(dayBounds.min, dayBounds.max)}. Rentang di bawah sudah disarankan otomatis, bebas diubah selama masih dalam data yang tersedia.
          </div>
          {daysBetweenInclusive(dayBounds.min, dayBounds.max) > LONG_DAY_RANGE_WARNING_THRESHOLD && (
            <InlineNotice tone="info" title="Rentang data ini cukup panjang — pastikan ini yang dimaksud">
              File yang diupload mencakup {daysBetweenInclusive(dayBounds.min, dayBounds.max)} hari breakdown harian. Tidak masalah untuk digenerate, tapi kalau ini bukan rentang yang dimaksud, cek kembali file yang diexport dari Meta Ads Reporting.
            </InlineNotice>
          )}
          <div className="period-input-row">
            <div className="period-input-field">
              <label>Periode Lalu</label>
              <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                <input
                  type="date"
                  className="period-text-input"
                  value={toISODate(oldRange?.start ?? null) ?? ''}
                  min={toISODate(dayBounds.min) ?? undefined}
                  max={toISODate(dayBounds.max) ?? undefined}
                  onChange={(e) => {
                    const d = fromISODate(e.target.value);
                    if (d) setOldRange((prev) => ({ start: d, end: prev?.end ?? d }));
                    setReport(null);
                    onInvalidate();
                  }}
                />
                <span style={{ color: 'var(--muted)' }}>–</span>
                <input
                  type="date"
                  className="period-text-input"
                  value={toISODate(oldRange?.end ?? null) ?? ''}
                  min={toISODate(dayBounds.min) ?? undefined}
                  max={toISODate(dayBounds.max) ?? undefined}
                  onChange={(e) => {
                    const d = fromISODate(e.target.value);
                    if (d) setOldRange((prev) => ({ start: prev?.start ?? d, end: d }));
                    setReport(null);
                    onInvalidate();
                  }}
                />
              </div>
              {oldRange && (
                <div className="num" style={{ fontSize: '.65rem', color: 'var(--muted)', fontWeight: 600, marginTop: '.3rem' }}>
                  {formatPeriodLabel(oldRange.start, oldRange.end)} · {daysBetweenInclusive(oldRange.start, oldRange.end)} hari
                </div>
              )}
            </div>
            <div className="period-input-field">
              <label>Periode Ini</label>
              <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                <input
                  type="date"
                  className="period-text-input"
                  value={toISODate(curRange?.start ?? null) ?? ''}
                  min={toISODate(dayBounds.min) ?? undefined}
                  max={toISODate(dayBounds.max) ?? undefined}
                  onChange={(e) => {
                    const d = fromISODate(e.target.value);
                    if (d) setCurRange((prev) => ({ start: d, end: prev?.end ?? d }));
                    setReport(null);
                    onInvalidate();
                  }}
                />
                <span style={{ color: 'var(--muted)' }}>–</span>
                <input
                  type="date"
                  className="period-text-input"
                  value={toISODate(curRange?.end ?? null) ?? ''}
                  min={toISODate(dayBounds.min) ?? undefined}
                  max={toISODate(dayBounds.max) ?? undefined}
                  onChange={(e) => {
                    const d = fromISODate(e.target.value);
                    if (d) setCurRange((prev) => ({ start: prev?.start ?? d, end: d }));
                    setReport(null);
                    onInvalidate();
                  }}
                />
              </div>
              {curRange && (
                <div className="num" style={{ fontSize: '.65rem', color: 'var(--muted)', fontWeight: 600, marginTop: '.3rem' }}>
                  {formatPeriodLabel(curRange.start, curRange.end)} · {daysBetweenInclusive(curRange.start, curRange.end)} hari
                </div>
              )}
            </div>
          </div>
          {oldRange && curRange && Math.abs(daysBetweenInclusive(oldRange.start, oldRange.end) - daysBetweenInclusive(curRange.start, curRange.end)) > 1 && (
            <div className="period-warning" style={{ marginTop: '.8rem', marginBottom: 0 }}>
              Panjang periode berbeda: {daysBetweenInclusive(oldRange.start, oldRange.end)} hari vs {daysBetweenInclusive(curRange.start, curRange.end)} hari — bandingkan dengan hati-hati.
            </div>
          )}
        </div>
      )}

      <div className="source-block">
        <div className="source-header">
          <div className="source-label">CPAS</div>
          <span className="sec-badge">opsional — kosongkan jika tidak ada data CPAS</span>
        </div>
        <Dropzone
          tag="1 file · berisi 2 periode"
          accept=".csv,.xlsx,.xls"
          onFile={(f) => handleUpload(f, 'cpas')}
          loaded={Boolean(cpasRows)}
          fileName={cpasFileName}
          infoText={cpasRows ? `${cpasRows.length} baris` : undefined}
        />
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
                  id: 'boost',
                  label: 'Boost Post',
                  hidden: !report.boost && !report.boostAgeDemo && !report.boostGenderDemo,
                  content: (
                    <>
                      {report.boost && (
                        <OverviewDetailedCard heading="Boost Post" badge="Meta Ads" overviewRows={report.boost.overviewRows} detailedRows={report.boost.detailedRows} allCols={report.boost.allCols} p1={report.p1} p2={report.p2} />
                      )}
                      {report.boostAgeDemo && (
                        <DemoBreakdownCard
                          heading="Boost Post · Age Breakdown"
                          badge={`data ${report.p2}`}
                          rows={report.boostAgeDemo.rows}
                          dimCol={report.boostAgeDemo.dimCol}
                          allCols={report.boostAgeDemo.allCols}
                          defaultCols={report.boostAgeDemo.defaultCols}
                        />
                      )}
                      {report.boostGenderDemo && (
                        <DemoBreakdownCard
                          heading="Boost Post · Gender Breakdown"
                          badge={`data ${report.p2}`}
                          rows={report.boostGenderDemo.rows}
                          dimCol={report.boostGenderDemo.dimCol}
                          allCols={report.boostGenderDemo.allCols}
                          defaultCols={report.boostGenderDemo.defaultCols}
                        />
                      )}
                    </>
                  ),
                },
                {
                  id: 'nonboost',
                  label: 'Non-Boost Post',
                  hidden: !report.nonBoost && !report.ageDemo && !report.genderDemo,
                  content: (
                    <>
                      {report.nonBoost && report.nonBoostSegments ? (
                        <>
                          <OverviewDetailedCard
                            heading="Non-Boost Post · Blended"
                            badge={report.nonBoostObjectiveSource === 'column' ? 'total + Amount Spent per objective' : 'objective dari nama campaign'}
                            overviewRows={report.nonBoost.overviewRows}
                            detailedRows={report.nonBoost.detailedRows}
                            allCols={report.nonBoost.allCols}
                            p1={report.p1}
                            p2={report.p2}
                          />
                          {report.nonBoostSegments.map((seg) => (
                            <OverviewDetailedCard
                              key={seg.key}
                              heading={`Non-Boost Post · ${seg.label}`}
                              badge="Meta Ads"
                              overviewRows={seg.overview.overviewRows}
                              detailedRows={seg.overview.detailedRows}
                              allCols={seg.overview.allCols}
                              p1={report.p1}
                              p2={report.p2}
                            />
                          ))}
                        </>
                      ) : (
                        report.nonBoost && (
                          <OverviewDetailedCard heading="Non-Boost Post" badge="Meta Ads" overviewRows={report.nonBoost.overviewRows} detailedRows={report.nonBoost.detailedRows} allCols={report.nonBoost.allCols} p1={report.p1} p2={report.p2} />
                        )
                      )}
                      {report.ageDemo && (
                        <DemoBreakdownCard heading="Non-Boost Post · Age Breakdown" badge={`data ${report.p2}`} rows={report.ageDemo.rows} dimCol={report.ageDemo.dimCol} allCols={report.ageDemo.allCols} defaultCols={report.ageDemo.defaultCols} />
                      )}
                      {report.genderDemo && (
                        <DemoBreakdownCard heading="Non-Boost Post · Gender Breakdown" badge={`data ${report.p2}`} rows={report.genderDemo.rows} dimCol={report.genderDemo.dimCol} allCols={report.genderDemo.allCols} defaultCols={report.genderDemo.defaultCols} />
                      )}
                    </>
                  ),
                },
                {
                  id: 'cpas',
                  label: 'CPAS Marketplace',
                  hidden: !report.cpas || !Object.keys(report.cpas).length,
                  content: (
                    <>
                      {report.cpas?.overall && (
                        <OverviewDetailedCard heading="CPAS Marketplace" badge="Overall" overviewRows={report.cpas.overall.overviewRows} detailedRows={report.cpas.overall.detailedRows} allCols={report.cpas.overall.allCols} p1={report.cpas.p1} p2={report.cpas.p2} />
                      )}
                      {report.cpas?.ageDemo && (
                        <DemoBreakdownCard heading="CPAS Marketplace · Age Breakdown" badge={`data ${report.cpas.p2}`} rows={report.cpas.ageDemo.rows} dimCol={report.cpas.ageDemo.dimCol} allCols={report.cpas.ageDemo.allCols} defaultCols={report.cpas.ageDemo.defaultCols} />
                      )}
                      {report.cpas?.genderDemo && (
                        <DemoBreakdownCard heading="CPAS Marketplace · Gender Breakdown" badge={`data ${report.cpas.p2}`} rows={report.cpas.genderDemo.rows} dimCol={report.cpas.genderDemo.dimCol} allCols={report.cpas.genderDemo.allCols} defaultCols={report.cpas.genderDemo.defaultCols} />
                      )}
                      {report.cpas?.nv && (
                        <OverviewDetailedCard heading="CPAS Marketplace · NV" badge="New Visitor" overviewRows={report.cpas.nv.overviewRows} detailedRows={report.cpas.nv.detailedRows} allCols={report.cpas.nv.allCols} p1={report.cpas.p1} p2={report.cpas.p2} />
                      )}
                      {report.cpas?.rm && (
                        <OverviewDetailedCard heading="CPAS Marketplace · RM" badge="Retargeting" overviewRows={report.cpas.rm.overviewRows} detailedRows={report.cpas.rm.detailedRows} allCols={report.cpas.rm.allCols} p1={report.cpas.p1} p2={report.cpas.p2} />
                      )}
                    </>
                  ),
                },
              ]}
            />
          </div>
          <div className="action-row" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
            <DownloadPdfButton targetId="report-meta" filename="Performance Report - Meta Ads.pdf" />
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
