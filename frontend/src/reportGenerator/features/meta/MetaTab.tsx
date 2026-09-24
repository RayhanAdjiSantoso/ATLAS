import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../../../api/client.js';
import { LibraryFileSlot } from '../reports/LibraryFileSlot';
import { ManualFileSlot } from '../reports/ManualFileSlot';
import { ReportPages } from '../../components/ReportPages';
import { useScrollAfterGenerate } from '../../hooks/useScrollAfterGenerate';
import { HowTo, HowToStep } from '../../components/HowTo';
import { InlineNotice } from '../../components/InlineNotice';
import { SearchSelect } from '../../components/SearchSelect';
import {
  META_OBJECTIVE_CHOICES,
  splitMonths,
  detectMetaObjectiveCol,
  dominantMetaObjective,
  metaDayRange,
  stripCampaignSubtotals,
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
import type { PlatformResultData } from '../../lib/summary';
import { AiSummarySection } from '../ai/AiSummarySection';
import { SymptomTreePanel } from '../shopee/AnalysisSections';
import { MetaSpecialMomentSection } from './MetaSpecialMomentSection';
import { MetaBreakdownSection } from './MetaBreakdownSection';
import { BRAND_AUDIENCE_METRICS, BRAND_CREATIVE_METRICS, SALES_AUDIENCE_METRICS, SALES_CREATIVE_METRICS, findAdCol } from '../../lib/metaAudience';
import { SaveStatus } from '../reports/SaveStatus';
import { useAutoSave } from '../reports/useAutoSave';
import { mapMetaCpasRows, mapMetaMainRows } from '../reports/rowMapping';
import { LibraryPeriodPicker, type LibraryMonth } from '../reports/LibraryPeriodPicker';
import { formatChannelCoverage } from '../reports/savedPeriodLabels';
import { SavedSlotCard, SlotSourceTabs, type SlotSource } from '../../components/SlotSourceTabs';
import type { PeriodRole, RawFileEntry, SaveReportPayload } from '../reports/types';
import { buildMetaReport, isBoostRow, type MetaReport } from './metaReport';

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

const META_PERIOD_CHANNELS = ['meta', 'cpas'] as const;

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

  const metaRows = useMemo(() => (metaSides.old || metaSides.cur ? [...(metaSides.old?.rows ?? []), ...(metaSides.cur?.rows ?? [])] : null), [metaSides]);
  const metaHeaders = useMemo(() => (metaRows?.length ? Object.keys(metaRows[0]) : []), [metaRows]);
  const cpasRows = useMemo(() => (cpasSides.old || cpasSides.cur ? [...(cpasSides.old?.rows ?? []), ...(cpasSides.cur?.rows ?? [])] : null), [cpasSides]);
  const cpasHeaders = useMemo(() => (cpasRows?.length ? Object.keys(cpasRows[0]) : []), [cpasRows]);

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
  const [pickerRole, setPickerRole] = useState<PeriodRole | null>(null);
  const [applyingRole, setApplyingRole] = useState<PeriodRole | null>(null);

  async function applyLibraryMonth(targetRole: PeriodRole, month: LibraryMonth) {
    if (!clientId) return;
    setApplyingRole(targetRole);
    setUploadError(null);
    try {
      const { data } = await api.get(`/brands/${clientId}/library`);
      const files = (data.files as LibraryFileMeta[]).filter((f) => f.platform === 'meta' && f.period_month?.slice(0, 7) === month.month);
      const metaList = files.filter((f) => f.channel === 'meta');
      const cpasList = files.filter((f) => f.channel === 'cpas');

      async function downloadAndParse(list: LibraryFileMeta[]): Promise<SheetRow[]> {
        const parts = await Promise.all(list.map((f) => downloadLibraryFile(clientId!, f)));
        return (await Promise.all(parts.map(readSpreadsheetFile))).flat();
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
    (targetRole === 'old' ? setOldPickedMonth : setCurPickedMonth)(month);
    (targetRole === 'old' ? setOldSource : setCurSource)('saved');
    applyLibraryMonth(targetRole, month);
  }

  function clearPickedPeriod(role: PeriodRole) {
    (role === 'old' ? setOldPickedMonth : setCurPickedMonth)(null);
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
        channel={target}
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
      const rows = (await Promise.all(input.map(readSpreadsheetFile))).flat();
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
    setMetaSides(EMPTY_META_SIDES);
    setCpasSides(EMPTY_META_SIDES);
    setOldSource('upload');
    setCurSource('upload');
    setOldPickedMonth(null);
    setCurPickedMonth(null);
    setIndustry(null);
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
    report && (report.boost || report.nonBoost || report.boostAgeDemo || report.boostGenderDemo || report.ageDemo || report.genderDemo || (report.cpas && Object.keys(report.cpas).length)),
  );

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
        <HowToStep num={2} title="Pilih sumber & buat laporan">
          Pilih file Meta Ads untuk periode lalu dan periode ini dari Pengaturan Brand (wajib). Pilih juga file CPAS jika tersedia. Klik <strong>Generate Laporan</strong> untuk melihat hasil.
        </HowToStep>
      </HowTo>

      <StepIndicator steps={steps} accent="var(--acc)" />

      <div className="source-block">
        <div className="source-header">
          <div className="source-label">Pilih Periode</div>
          <span className="sec-badge">isi Meta Ads &amp; CPAS sekaligus dari Pengaturan Brand</span>
        </div>
        <div className="empty-note" style={{ padding: '0 1.4rem .6rem' }}>
          Bisa memilih bulan mana pun yang sudah diunggah di Pengaturan Brand — satu bulan per slot Periode Lalu/Periode Ini.
        </div>
        <div className="dz-grid-4">
          {(['old', 'cur'] as const).map((role) => {
            const picked = role === 'old' ? oldPickedMonth : curPickedMonth;
            const source = role === 'old' ? oldSource : curSource;
            return (
              <div key={role}>
                <SlotSourceTabs
                  value={source}
                  onChange={(v) => {
                    (role === 'old' ? setOldSource : setCurSource)(v);
                    if (v === 'saved' && !picked) setPickerRole(role);
                  }}
                  disabledSavedReason={!clientId ? 'Pilih klien terlebih dahulu' : null}
                />
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
        <LibraryPeriodPicker clientId={clientId} platform="meta" periodChannels={META_PERIOD_CHANNELS} onClose={() => setPickerRole(null)} onPick={handlePickMonth} />
      )}

      <div className="source-block">
        <div className="source-header">
          <div className="source-label">Meta Ads</div>
        </div>
        <div className="dz-grid-4">
          {metaDropzone('meta', 'old', 'Periode Lalu')}
          {metaDropzone('meta', 'cur', 'Periode Ini')}
        </div>
        {uploadError && <InlineNotice title="File ini belum kebaca">{uploadError}</InlineNotice>}
      </div>

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

      {dayCol && (oldDayBounds || curDayBounds) && (
        <div className="source-block">
          <div className="source-header">
            <div className="source-label">Rentang Tanggal yang Dibandingkan</div>
          </div>
          <div className="empty-note" style={{ paddingTop: 0, paddingBottom: '.6rem' }}>
            File ini pakai breakdown harian — rentang di bawah sudah diambil otomatis dari masing-masing file, bebas diubah selama masih dalam data yang tersedia di file itu.
          </div>
          <div className="period-input-row">
            <div className="period-input-field">
              <label>Periode Lalu</label>
              {oldDayBounds ? (
                <>
                  <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                    <input
                      type="date"
                      className="period-text-input"
                      value={toISODate(oldRange?.start ?? null) ?? ''}
                      min={toISODate(oldDayBounds.min) ?? undefined}
                      max={toISODate(oldDayBounds.max) ?? undefined}
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
                      min={toISODate(oldDayBounds.min) ?? undefined}
                      max={toISODate(oldDayBounds.max) ?? undefined}
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
                </>
              ) : (
                <div className="empty-note" style={{ padding: '.3rem 0 0' }}>Belum ada file Periode Lalu.</div>
              )}
            </div>
            <div className="period-input-field">
              <label>Periode Ini</label>
              {curDayBounds ? (
                <>
                  <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                    <input
                      type="date"
                      className="period-text-input"
                      value={toISODate(curRange?.start ?? null) ?? ''}
                      min={toISODate(curDayBounds.min) ?? undefined}
                      max={toISODate(curDayBounds.max) ?? undefined}
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
                      min={toISODate(curDayBounds.min) ?? undefined}
                      max={toISODate(curDayBounds.max) ?? undefined}
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
                </>
              ) : (
                <div className="empty-note" style={{ padding: '.3rem 0 0' }}>Belum ada file Periode Ini.</div>
              )}
            </div>
          </div>
          {(oldDayBounds ? daysBetweenInclusive(oldDayBounds.min, oldDayBounds.max) : 0) > LONG_DAY_RANGE_WARNING_THRESHOLD ||
          (curDayBounds ? daysBetweenInclusive(curDayBounds.min, curDayBounds.max) : 0) > LONG_DAY_RANGE_WARNING_THRESHOLD ? (
            <InlineNotice tone="info" title="Salah satu file breakdown harian ini cukup panjang — pastikan ini yang dimaksud">
              Tidak masalah untuk digenerate, tapi kalau ini bukan rentang yang dimaksud, cek kembali file yang diexport dari Meta Ads Reporting.
            </InlineNotice>
          ) : null}
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
        <div className="dz-grid-4">
          {metaDropzone('cpas', 'old', 'Periode Lalu')}
          {metaDropzone('cpas', 'cur', 'Periode Ini')}
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
                  id: 'cpas',
                  label: 'CPAS',
                  hidden: !report.cpas || !Object.keys(report.cpas).length,
                  content: (() => {
                    const cpas = report.cpas;
                    if (!cpas) return null;
                    const cur = report.curRows;
                    const cpasAd = cur?.cpas.length ? findAdCol(cur.cpas) : null;
                    return (
                      <>
                        <MetaSpecialMomentSection
                          rows={cpasAllRows}
                          dayCol={cpasDayCol}
                          heading="CPAS Shopee · Special Moment"
                          periods={[
                            cpasRanges.old ? { label: cpas.p1, ...cpasRanges.old } : null,
                            cpasRanges.cur ? { label: cpas.p2, ...cpasRanges.cur } : null,
                          ].filter(Boolean) as { label: string; start: Date; end: Date }[]}
                        />
                        {cpas.overall && (
                          <OverviewDetailedCard
                            heading="CPAS Shopee"
                            badge="Overall"
                            overviewRows={cpas.overall.overviewRows}
                            detailedRows={cpas.overall.detailedRows}
                            allCols={cpas.overall.allCols}
                            p1={cpas.p1}
                            p2={cpas.p2}
                            aside={
                              cpas.funnel?.hasData ? (
                                <SymptomTreePanel tree={cpas.funnel.tree} p1={cpas.p1} p2={cpas.p2} title="Root Cause Analysis" badge={`${cpas.p1} → ${cpas.p2}`} />
                              ) : undefined
                            }
                          />
                        )}
                        {cpas.nv && (
                          <OverviewDetailedCard heading="CPAS Shopee · NV" badge="New Visitor" overviewRows={cpas.nv.overviewRows} detailedRows={cpas.nv.detailedRows} allCols={cpas.nv.allCols} p1={cpas.p1} p2={cpas.p2} />
                        )}
                        {cpas.rm && (
                          <OverviewDetailedCard heading="CPAS Shopee · RM" badge="Re-Marketing" overviewRows={cpas.rm.overviewRows} detailedRows={cpas.rm.detailedRows} allCols={cpas.rm.allCols} p1={cpas.p1} p2={cpas.p2} />
                        )}
                        {cpas.ageDemo && (
                          <MetaBreakdownSection
                            heading="CPAS Shopee · Age Breakdown"
                            badge={`data ${cpas.p2}`}
                            rows={cpas.ageDemo.rows}
                            dimCol={cpas.ageDemo.dimCol}
                            kind="sales"
                            metrics={SALES_AUDIENCE_METRICS}
                            prefer="bar"
                          />
                        )}
                        {cpas.genderDemo && (
                          <MetaBreakdownSection
                            heading="CPAS Shopee · Gender Breakdown"
                            badge={`data ${cpas.p2}`}
                            rows={cpas.genderDemo.rows}
                            dimCol={cpas.genderDemo.dimCol}
                            kind="sales"
                            metrics={SALES_AUDIENCE_METRICS}
                            prefer="pie"
                          />
                        )}
                        {cpasAd && cur ? (
                          <MetaBreakdownSection
                            heading="CPAS Shopee · Creative Performance"
                            badge={`per materi iklan · ${cpas.p2}`}
                            rows={cur.cpas}
                            dimCol={cpasAd}
                            kind="sales"
                            metrics={SALES_CREATIVE_METRICS}
                            prefer="bar"
                          />
                        ) : (
                          <div className="sec-block">
                            <div className="sec-heading">CPAS Shopee · Creative Performance</div>
                            <div className="empty-note" style={{ margin: '1.1rem 1.4rem 1.4rem' }}>
                              Bagian ini membandingkan performa per materi iklan. File CPAS yang diunggah dipecah per campaign, bukan per <strong>Ad</strong> — export
                              ulang dari Meta Ads Reporting dengan breakdown Ad disertakan.
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })(),
                },
                {
                  id: 'non-boost',
                  label: 'Non-Boost Post',
                  hidden: !report.nonBoost && !report.ageDemo && !report.genderDemo,
                  content: (() => {
                    const cur = report.curRows;
                    const nbAd = cur?.nonBoost.length ? findAdCol(cur.nonBoost) : null;
                    return (
                      <>
                        <MetaSpecialMomentSection
                          rows={nonBoostAllRows}
                          dayCol={dayCol}
                          heading="Non-Boost Post · Special Moment"
                          periods={[
                            oldRange ? { label: report.p1, ...oldRange } : null,
                            curRange ? { label: report.p2, ...curRange } : null,
                          ].filter(Boolean) as { label: string; start: Date; end: Date }[]}
                        />
                        {report.nonBoost && (
                          <OverviewDetailedCard
                            heading={report.nonBoostSegments ? 'Non-Boost Post · Blended' : 'Non-Boost Post'}
                            badge={
                              report.nonBoostSegments
                                ? report.nonBoostObjectiveSource === 'column'
                                  ? 'total + Amount Spent per objective'
                                  : 'objective dari nama campaign'
                                : 'Meta Ads'
                            }
                            overviewRows={report.nonBoost.overviewRows}
                            detailedRows={report.nonBoost.detailedRows}
                            allCols={report.nonBoost.allCols}
                            p1={report.p1}
                            p2={report.p2}
                            aside={
                              report.nonBoostFunnel?.hasData ? (
                                <SymptomTreePanel tree={report.nonBoostFunnel.tree} p1={report.p1} p2={report.p2} title="Root Cause Analysis" badge={`${report.p1} → ${report.p2}`} />
                              ) : undefined
                            }
                          />
                        )}
                        {report.nonBoostSegments?.map((seg) => (
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
                        {report.ageDemo && (
                          <MetaBreakdownSection
                            heading="Non-Boost Post · Age Breakdown"
                            badge={`data ${report.p2}`}
                            rows={report.ageDemo.rows}
                            dimCol={report.ageDemo.dimCol}
                            kind="sales"
                            metrics={SALES_AUDIENCE_METRICS}
                            prefer="bar"
                          />
                        )}
                        {report.genderDemo && (
                          <MetaBreakdownSection
                            heading="Non-Boost Post · Gender Breakdown"
                            badge={`data ${report.p2}`}
                            rows={report.genderDemo.rows}
                            dimCol={report.genderDemo.dimCol}
                            kind="sales"
                            metrics={SALES_AUDIENCE_METRICS}
                            prefer="pie"
                          />
                        )}
                        {nbAd && cur ? (
                          <MetaBreakdownSection
                            heading="Non-Boost Post · Creative Performance"
                            badge={`per materi iklan · ${report.p2}`}
                            rows={cur.nonBoost}
                            dimCol={nbAd}
                            kind="sales"
                            metrics={SALES_CREATIVE_METRICS}
                            prefer="bar"
                          />
                        ) : (
                          <div className="sec-block">
                            <div className="sec-heading">Non-Boost Post · Creative Performance</div>
                            <div className="empty-note" style={{ margin: '1.1rem 1.4rem 1.4rem' }}>
                              Bagian ini membandingkan performa per materi iklan. File yang diunggah dipecah per campaign, bukan per <strong>Ad</strong> — export ulang
                              dari Meta Ads Reporting dengan breakdown Ad disertakan.
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })(),
                },
                {
                  id: 'boost',
                  label: 'Boost Post',
                  hidden: !report.boost && !report.boostAgeDemo && !report.boostGenderDemo,
                  content: (() => {
                    const cur = report.curRows;
                    const boostAd = cur?.boost.length ? findAdCol(cur.boost) : null;
                    return (
                      <>
                        {report.boost && (
                          <OverviewDetailedCard
                            heading="Boost Post"
                            badge="Meta Ads"
                            overviewRows={report.boost.overviewRows}
                            detailedRows={report.boost.detailedRows}
                            allCols={report.boost.allCols}
                            p1={report.p1}
                            p2={report.p2}
                            aside={
                              report.boostFunnel?.hasData ? (
                                <SymptomTreePanel tree={report.boostFunnel.tree} p1={report.p1} p2={report.p2} title="Root Cause Analysis" badge="Brand Consideration" />
                              ) : undefined
                            }
                          />
                        )}
                        {report.boostAgeDemo && (
                          <MetaBreakdownSection
                            heading="Boost Post · Age Breakdown"
                            badge={`data ${report.p2}`}
                            rows={report.boostAgeDemo.rows}
                            dimCol={report.boostAgeDemo.dimCol}
                            kind="brand"
                            metrics={BRAND_AUDIENCE_METRICS}
                            prefer="bar"
                          />
                        )}
                        {report.boostGenderDemo && (
                          <MetaBreakdownSection
                            heading="Boost Post · Gender Breakdown"
                            badge={`data ${report.p2}`}
                            rows={report.boostGenderDemo.rows}
                            dimCol={report.boostGenderDemo.dimCol}
                            kind="brand"
                            metrics={BRAND_AUDIENCE_METRICS}
                            prefer="pie"
                          />
                        )}
                        {boostAd && cur ? (
                          <MetaBreakdownSection
                            heading="Boost Post · Creative Performance"
                            badge={`per materi iklan · ${report.p2}`}
                            rows={cur.boost}
                            dimCol={boostAd}
                            kind="brand"
                            metrics={BRAND_CREATIVE_METRICS}
                            prefer="bar"
                          />
                        ) : (
                          <div className="sec-block">
                            <div className="sec-heading">Boost Post · Creative Performance</div>
                            <div className="empty-note" style={{ margin: '1.1rem 1.4rem 1.4rem' }}>
                              Bagian ini membandingkan performa per materi iklan. File yang diunggah dipecah per campaign, bukan per <strong>Ad</strong> — export ulang
                              dari Meta Ads Reporting dengan breakdown Ad disertakan.
                            </div>
                          </div>
                        )}
                      </>
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
              ↺ Ganti Sumber Data
            </button>
          </div>
          <SaveStatus status={autoSave.status} message={autoSave.message} />
        </div>
      )}
    </div>
  );
}
