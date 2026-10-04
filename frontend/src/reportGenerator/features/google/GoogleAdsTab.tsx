import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, Loader2, RotateCcw } from 'lucide-react';
import { DeltaPill } from '../../components/DeltaPill';
import { DownloadPdfButton } from '../../components/DownloadPdfButton';
import { HowTo, HowToStep } from '../../components/HowTo';
import { InlineNotice } from '../../components/InlineNotice';
import { KpiTable, type KpiRowDisplay } from '../../components/KpiTable';
import { PeriodCompareChip } from '../../components/PeriodCompareChip';
import { SetupBoard, SetupGrid, SetupRow, SetupTextInput } from '../../components/SetupBoard';
import { PieChartCanvas } from '../../components/PieChartCanvas';
import { ReportPages } from '../../components/ReportPages';
import { SectionAccordion } from '../../components/SectionAccordion';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SectionExcelButton } from '../../components/SectionExcelButton';
import { StepIndicator, type Step } from '../../components/StepIndicator';
import { usePeriodLabel } from '../../hooks/usePeriodLabel';
import { useScrollAfterGenerate } from '../../hooks/useScrollAfterGenerate';
import { computeDelta, deltaClassForSentiment } from '../../lib/delta';
import type { Sentiment } from '../../lib/types';
import { GoogleAdsTable, type GadsColumn } from './GoogleAdsTable';
import { GoogleDailyChart } from './GoogleDailyChart';
import { AuctionInsightsSection, ChangeHistorySection, aiKpis, aiNotes } from './GoogleAdsContext';
import {
  AdPerformanceSection, AlertsSection, CampaignIntelSection, ConversionSection, CostConversionChart, DeviceTimeSection, DiagnosticsSection,
  FreshnessLine, GoalOverviewSection, KeywordIntelSection, SearchTermIntelSection,
} from './GoogleAdsInsights';
import { AlertsPanel, ExperimentTracker, OptimizationCenter, type ExperimentDraft } from './GoogleAdsOptimization';
import { downloadGoogleAdsWorkbook } from './googleAdsExcel';
import { AiSummarySection } from '../ai/AiSummarySection';
import {
  PRESETS, channelLabel, fetchOverview, fetchReport, formatter, matchTypeLabel, rangeLabel,
  type Formatter, type GadsAdGroup, type GadsCampaign, type GadsCity, type GadsKeyword, type GadsMetrics,
  type GadsOverview, type GadsReport, type GadsSearchTerm, type PeriodPair,
} from './googleAds';
import './google.css';

interface GoogleAdsTabProps {
  isActive: boolean;
  clientId: number | null;
  onGenerated: () => void;
  onInvalidate: () => void;
}

type MetricKey = keyof GadsMetrics;

// Every table opens on its first 10 rows; the rest are behind "Tampilkan semua".
const TABLE_ROWS = 10;

// The KPI strip of Looker's "Overall Campaign Performance" page, in its order.
const KPI_CARDS: { key: MetricKey; label: string; kind: 'money' | 'int' | 'dec' | 'pct'; sentiment: Sentiment; short?: boolean }[] = [
  { key: 'cost', label: 'Cost', kind: 'money', sentiment: 'neutral', short: true },
  { key: 'impressions', label: 'Impressions', kind: 'int', sentiment: 'higher-better' },
  { key: 'clicks', label: 'Clicks', kind: 'int', sentiment: 'higher-better' },
  { key: 'ctr', label: 'CTR', kind: 'pct', sentiment: 'higher-better' },
  { key: 'avg_cpc', label: 'Avg. CPC', kind: 'money', sentiment: 'lower-better' },
  { key: 'conversions', label: 'Conversions', kind: 'dec', sentiment: 'higher-better' },
  { key: 'cost_per_conv', label: 'Cost / conv.', kind: 'money', sentiment: 'lower-better' },
];

// Every metric for the side-by-side table under the cards.
const SUMMARY_ROWS: { key: MetricKey; label: string; kind: 'money' | 'int' | 'dec' | 'pct' | 'x'; sentiment: Sentiment }[] = [
  ...KPI_CARDS.map(({ key, label, kind, sentiment }) => ({ key, label, kind, sentiment })),
  { key: 'avg_cpm', label: 'Avg. CPM', kind: 'money', sentiment: 'lower-better' },
  { key: 'cvr', label: 'Conv. rate', kind: 'pct', sentiment: 'higher-better' },
  { key: 'all_conversions', label: 'All conv.', kind: 'dec', sentiment: 'higher-better' },
  { key: 'conversions_value', label: 'Conv. value', kind: 'money', sentiment: 'higher-better' },
  { key: 'roas', label: 'Conv. value / cost', kind: 'x', sentiment: 'higher-better' },
];

function fmtBy(f: Formatter, kind: string, v: number | null, short = false): string {
  if (kind === 'money') return short ? f.moneyShort(v) : f.money(v);
  if (kind === 'int') return f.int(v);
  if (kind === 'pct') return f.pct(v);
  if (kind === 'x') return v == null ? '—' : `${f.dec(v)}x`;
  return f.dec(v);
}

// Column sets shared by the tables, built against the report's currency.
function metricColumns<T extends GadsMetrics>(f: Formatter, keys: MetricKey[]): GadsColumn<T>[] {
  const spec: Record<string, { label: string; kind: string }> = {
    cost: { label: 'Cost', kind: 'money' },
    impressions: { label: 'Impressions', kind: 'int' },
    avg_cpm: { label: 'Avg. CPM', kind: 'money' },
    clicks: { label: 'Clicks', kind: 'int' },
    ctr: { label: 'CTR', kind: 'pct' },
    avg_cpc: { label: 'Avg. CPC', kind: 'money' },
    conversions: { label: 'Conversions', kind: 'dec' },
    cost_per_conv: { label: 'Cost / conv.', kind: 'money' },
    cvr: { label: 'CVR', kind: 'pct' },
    all_conversions: { label: 'All conv.', kind: 'dec' },
  };
  return keys.map((key) => ({
    key,
    label: spec[key].label,
    value: (r: T) => r[key] as number | null,
    render: (r: T) => fmtBy(f, spec[key].kind, r[key] as number | null),
  }));
}

export function GoogleAdsTab({ isActive, clientId, onGenerated, onInvalidate }: GoogleAdsTabProps) {
  const periodOld = usePeriodLabel('Periode Lalu');
  const periodCur = usePeriodLabel('Periode Ini');
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [range, setRange] = useState<PeriodPair>(() => PRESETS[0].build(new Date()));
  const [overview, setOverview] = useState<GadsOverview | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [report, setReport] = useState<GadsReport | null>(null);
  const [labels, setLabels] = useState({ p1: '', p2: '' });
  const [reportRange, setReportRange] = useState<PeriodPair | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const armReportScroll = useScrollAfterGenerate('report-google', report);

  useEffect(() => {
    if (!clientId || !isActive || overview) return;
    fetchOverview(clientId)
      .then(setOverview)
      .catch((err) => setOverviewError(err.response?.data?.message || 'Gagal memeriksa koneksi Google Ads'));
  }, [clientId, isActive, overview]);

  // Period labels follow the dates until the user types their own.
  useEffect(() => {
    periodOld.autoFill(rangeLabel(range.oldStart, range.oldEnd));
    periodCur.autoFill(rangeLabel(range.curStart, range.curEnd));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  function changeRange(next: Partial<PeriodPair>) {
    setRange((r) => ({ ...r, ...next }));
    setPreset('custom');
    setReport(null);
    onInvalidate();
  }

  function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    setRange(p.build(new Date()));
    setReport(null);
    onInvalidate();
  }

  const accounts = overview?.accounts ?? [];
  const connected = accounts.length > 0;
  const validRange = range.oldStart <= range.oldEnd && range.curStart <= range.curEnd;
  const ready = Boolean(clientId && connected && validRange);

  async function generate() {
    if (!clientId) return;
    setLoading(true);
    setError('');
    try {
      const data = await fetchReport(clientId, range);
      setReport(data);
      setLabels({ p1: periodOld.label, p2: periodCur.label });
      setReportRange(range);
      setGeneratedAt(new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }));
      onGenerated();
      armReportScroll();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e.response?.data?.message || e.message || 'Gagal menyusun laporan');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    periodOld.reset();
    periodCur.reset();
    applyPreset(PRESETS[0].id);
    setError('');
  }

  const steps: Step[] = [
    { label: 'Hubungkan akun Google Ads di Data Brand', sub: connected ? `${accounts.length} akun terhubung` : undefined, status: connected ? 'done' : 'current' },
    { label: 'Pilih periode', sub: validRange ? `${rangeLabel(range.oldStart, range.oldEnd)} → ${rangeLabel(range.curStart, range.curEnd)}` : undefined, status: !connected ? 'todo' : validRange ? 'done' : 'current' },
    { label: 'Generate laporan', status: report ? 'done' : ready ? 'current' : 'todo' },
    { label: 'Lihat & unduh PDF', status: report ? 'current' : 'todo' },
  ];

  const coverageText = useMemo(() => {
    const withData = accounts.filter((a) => a.coverage);
    if (!withData.length) return null;
    const first = withData.map((a) => a.coverage!.first_date).sort()[0];
    const last = withData.map((a) => a.coverage!.last_date).sort().slice(-1)[0];
    const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Data tersedia ${day(first)} – ${day(last)}`;
  }, [accounts]);

  function rangeCell(role: 'old' | 'cur', title: string) {
    return (
      <div className="setup-range-inputs">
        <input type="date" className="setup-input" aria-label={`${title} mulai`} value={range[`${role}Start`]} max={range[`${role}End`]}
          onChange={(e) => e.target.value && changeRange({ [`${role}Start`]: e.target.value } as Partial<PeriodPair>)} />
        <span aria-hidden>–</span>
        <input type="date" className="setup-input" aria-label={`${title} akhir`} value={range[`${role}End`]} min={range[`${role}Start`]}
          onChange={(e) => e.target.value && changeRange({ [`${role}End`]: e.target.value } as Partial<PeriodPair>)} />
      </div>
    );
  }

  return (
    <div className={`panel${isActive ? ' active' : ''}`}>
      <HowTo>
        <HowToStep num={1} numClassName="google-num" title="Hubungkan akun di Data Brand">
          Buka <strong>Data Brand › Google Ads</strong>, tambahkan Customer ID akun Google Ads brand ini. Data harian ditarik otomatis setiap hari
          oleh Google Ads Script yang dipasang di akun Google Ads klien — tidak ada file yang perlu diunduh atau diunggah.
        </HowToStep>
        <HowToStep num={2} numClassName="google-num" title="Pilih periode & buat laporan">
          Pilih preset atau isi tanggal Periode Lalu dan Periode Ini sendiri, lalu klik <strong>Generate Laporan</strong>. Kartu KPI dibandingkan dengan
          Periode Lalu; tabel campaign, keyword, search term, dan kota menampilkan Periode Ini.
        </HowToStep>
      </HowTo>

      <StepIndicator steps={steps} accent="var(--google)" />

      {!clientId ? (
        <InlineNotice title="Pilih brand terlebih dahulu" tone="info">Laporan Google Ads disusun dari akun yang terhubung ke brand yang dipilih di atas.</InlineNotice>
      ) : overviewError ? (
        <InlineNotice title="Koneksi Google Ads tidak dapat diperiksa">{overviewError}</InlineNotice>
      ) : !overview ? (
        <div className="empty-note"><Loader2 size={13} className="rg-spin" aria-hidden /> Memeriksa koneksi Google Ads…</div>
      ) : !connected ? (
        <InlineNotice title="Brand ini belum terhubung ke Google Ads" tone="info">
          Tambahkan Customer ID di <Link to="/data-brand">Data Brand › Google Ads</Link>. Data mulai tersedia setelah Google Ads Script jalan berikutnya.
        </InlineNotice>
      ) : (
        <>
          {clientId && <AlertsPanel clientId={clientId} compact />}
          <SetupBoard title="Periode" note={<>Data ditarik otomatis dari akun Google Ads yang terhubung — {coverageText ?? 'menunggu sinkron pertama'}.</>}>
            <SetupGrid>
              <SetupRow
                label="Preset"
                sub="isi kedua periode sekaligus"
                both={
                  <div className="gads-presets" role="group" aria-label="Preset periode">
                    {PRESETS.map((p) => (
                      <button key={p.id} type="button" className={`gads-preset${preset === p.id ? ' is-active' : ''}`} aria-pressed={preset === p.id} onClick={() => applyPreset(p.id)}>
                        {p.label}
                      </button>
                    ))}
                    <span className={`gads-preset is-static${preset === 'custom' ? ' is-active' : ''}`}>Kustom</span>
                  </div>
                }
              />
              <SetupRow
                label="Rentang tanggal"
                req
                old={rangeCell('old', 'Periode Lalu')}
                cur={rangeCell('cur', 'Periode Ini')}
              />
              <SetupRow
                label="Label periode"
                sub="tampil di laporan"
                old={<SetupTextInput label="Label Periode Lalu" value={periodOld.inputValue} onChange={periodOld.onInput} placeholder="cth: Agu 2026" />}
                cur={<SetupTextInput label="Label Periode Ini" value={periodCur.inputValue} onChange={periodCur.onInput} placeholder="cth: Sep 2026" />}
              />
            </SetupGrid>
          </SetupBoard>

          {error && <InlineNotice title="Laporan belum dapat disusun">{error}</InlineNotice>}

          {ready && (
            <div id="cta" style={{ marginTop: '1rem' }}>
              <div className="action-row">
                <button className="btn btn-primary" onClick={generate} disabled={loading}>
                  {loading && <Loader2 size={15} className="rg-spin" aria-hidden />} Generate Laporan
                </button>
                <button className="btn btn-ghost" onClick={reset}>
                  <RotateCcw size={15} aria-hidden /> Reset
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {report && reportRange && (
        <GoogleAdsReportView report={report} clientId={clientId} range={reportRange} p1={labels.p1} p2={labels.p2} generatedAt={generatedAt} onReset={reset} />
      )}
    </div>
  );
}

interface ReportViewProps { report: GadsReport; clientId: number | null; range: PeriodPair; p1: string; p2: string; generatedAt: string; onReset: () => void }

function GoogleAdsReportView({ report, clientId, range, p1, p2, generatedAt, onReset }: ReportViewProps) {
  const f = formatter(report.currency);
  const [draft, setDraft] = useState<ExperimentDraft | null>(null);
  const [excelBusy, setExcelBusy] = useState(false);
  const { old, cur } = report;
  const empty = cur.totals.impressions === 0 && cur.totals.cost === 0;

  const summaryRows: KpiRowDisplay[] = SUMMARY_ROWS.map((m) => {
    const vOld = old.totals[m.key] as number | null;
    const vCur = cur.totals[m.key] as number | null;
    const d = computeDelta(vOld, vCur);
    return { id: m.key, label: m.label, old: fmtBy(f, m.kind, vOld), cur: fmtBy(f, m.kind, vCur), delta: d.deltaStr, cls: deltaClassForSentiment(d.deltaNum, m.sentiment) };
  });

  const spend = [...cur.campaigns].filter((c) => c.cost > 0).sort((a, b) => b.cost - a.cost);
  const searchCities = cur.cities;
  const oldCities = new Map(old.cities.map((c) => [c.city, c]));
  const coverageEnd = report.coverage.map((c) => c.last_date).sort().at(-1) ?? null;
  const urgent = (report.diagnostics ?? []).filter((x) => x.severity === 'critical' || x.severity === 'high').length;
  const wasted = cur.searchTerms.filter((t) => t.conversions === 0 && t.cost > 0);

  const campaignCols: GadsColumn<GadsCampaign>[] = [
    { key: 'campaign_name', label: 'Campaign', align: 'left', value: (r) => r.campaign_name },
    { key: 'channel_type', label: 'Tipe', align: 'left', value: (r) => channelLabel(r.channel_type) },
    { key: 'budget', label: 'Budget / hari', value: (r) => r.budget, render: (r) => f.money(r.budget) },
    ...metricColumns<GadsCampaign>(f, ['cost', 'impressions', 'avg_cpm', 'clicks', 'avg_cpc', 'conversions', 'cost_per_conv', 'all_conversions']),
  ];
  const adGroupCols: GadsColumn<GadsAdGroup>[] = [
    { key: 'ad_group_name', label: 'Ad group', align: 'left', value: (r) => r.ad_group_name },
    { key: 'campaign_name', label: 'Campaign', align: 'left', value: (r) => r.campaign_name },
    ...metricColumns<GadsAdGroup>(f, ['cost', 'impressions', 'avg_cpm', 'clicks', 'avg_cpc', 'conversions', 'cost_per_conv', 'all_conversions']),
  ];
  const keywordCols: GadsColumn<GadsKeyword>[] = [
    { key: 'keyword', label: 'Search keyword', align: 'left', value: (r) => r.keyword },
    ...metricColumns<GadsKeyword>(f, ['cost', 'impressions', 'avg_cpm']),
    { key: 'abs_top', label: 'Impr. (Abs. Top) %', value: (r) => r.abs_top_impression_pct, render: (r) => f.pct(r.abs_top_impression_pct) },
    { key: 'lost_top', label: 'Search Lost Top IS (rank)', value: (r) => r.search_lost_top_is_rank, render: (r) => f.pct(r.search_lost_top_is_rank) },
    ...metricColumns<GadsKeyword>(f, ['clicks', 'avg_cpc', 'conversions', 'cost_per_conv']),
  ];
  const termCols: GadsColumn<GadsSearchTerm>[] = [
    { key: 'search_term', label: 'Search term', align: 'left', value: (r) => r.search_term },
    { key: 'match_type', label: 'Match type', align: 'left', value: (r) => matchTypeLabel(r.match_type) },
    ...metricColumns<GadsSearchTerm>(f, ['cost', 'impressions', 'avg_cpm', 'clicks', 'avg_cpc', 'conversions', 'cost_per_conv', 'cvr']),
  ];
  const wastedCols = termCols.filter((c) => !['cost_per_conv', 'cvr'].includes(c.key));
  const cityCols: GadsColumn<GadsCity>[] = [
    { key: 'city', label: 'City', align: 'left', value: (r) => r.city },
    ...metricColumns<GadsCity>(f, ['cost', 'impressions', 'avg_cpm', 'clicks', 'avg_cpc', 'conversions', 'cost_per_conv']),
    {
      key: 'conv_change', label: `Konversi vs ${p1}`, value: (r) => oldCities.get(r.city)?.conversions ?? null,
      render: (r) => { const d = computeDelta(oldCities.get(r.city)?.conversions ?? null, r.conversions); return <DeltaPill cls={deltaClassForSentiment(d.deltaNum, 'higher-better')} size="sm">{d.deltaStr}</DeltaPill>; },
    },
  ];

  const heading = (title: string, badge?: string, excel = true) => (
    <div className="sec-heading google-heading">
      {title} {badge && <span className="sec-badge">{badge}</span>}
      {excel && <SectionExcelButton />}
      <SectionDownloadButton />
    </div>
  );

  return (
    <div id="report-google" style={{ '--band-a': '#1a73e8', '--band-b': '#1557b0', '--band-c': '#34a853' } as CSSProperties}>
      <div className="report-top">
        <div className="report-title">Google Ads Performance Report</div>
        <div className="report-period"><PeriodCompareChip old={p1} cur={p2} onBrand /></div>
        <div className="report-meta num">
          Generated {generatedAt} · {report.accounts.map((a) => a.name || a.label || a.customerId).join(', ')}
        </div>
        <FreshnessLine report={report} coverageEnd={coverageEnd} />
      </div>
      <div data-role="r-body">
        {report.mixedCurrency && (
          <InlineNotice title="Akun memakai mata uang berbeda" tone="info">
            Brand ini terhubung ke akun Google Ads dengan mata uang berbeda; angka biaya dijumlahkan apa adanya tanpa konversi kurs.
          </InlineNotice>
        )}
        {empty && (
          <InlineNotice title="Tidak ada data Google Ads pada Periode Ini" tone="info">
            Periksa rentang tanggal, atau tunggu sinkron berikutnya bila akun baru saja dihubungkan. Status sinkron ada di Data Brand › Google Ads.
          </InlineNotice>
        )}
        <ReportPages
          accent="var(--google)"
          accentInk="var(--google-700)"
          pages={[
            {
              id: 'overall',
              label: 'Overall',
              content: (
                <SectionAccordion>
                  <div className="sec-block">
                    {heading('Overall Campaign Performance', `${p1} → ${p2}`, false)}
                    <div className="sec-inner">
                      <div className="gads-kpis">
                        {KPI_CARDS.map((k) => {
                          const vOld = old.totals[k.key] as number | null;
                          const vCur = cur.totals[k.key] as number | null;
                          const d = computeDelta(vOld, vCur);
                          return (
                            <div key={k.key} className="gads-kpi">
                              <span className="gads-kpi-label">{k.label}</span>
                              <strong className="gads-kpi-value num" title={fmtBy(f, k.kind, vCur)}>{fmtBy(f, k.kind, vCur, k.short)}</strong>
                              <DeltaPill cls={deltaClassForSentiment(d.deltaNum, k.sentiment)} size="sm">{d.deltaStr}</DeltaPill>
                              <span className="gads-kpi-old">{p1}: {fmtBy(f, k.kind, vOld, k.short)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="gads-overall-grid">
                        <div className="gads-card">
                          <h4>Impressions &amp; Clicks harian · {p2}</h4>
                          {cur.daily.length ? <GoogleDailyChart days={cur.daily} /> : <div className="empty-note">Tidak ada data harian.</div>}
                        </div>
                        <div className="gads-card">
                          <h4>Cost &amp; Conversions harian · {p2}</h4>
                          {cur.daily.length ? <CostConversionChart days={cur.daily} /> : <div className="empty-note">Tidak ada data harian.</div>}
                        </div>
                        <div className="gads-card">
                          <h4>Total Budget Terpakai</h4>
                          {spend.length ? (
                            <PieChartCanvas labels={spend.map((c) => c.campaign_name)} values={spend.map((c) => c.cost)} format={(v) => f.money(v)} centerTitle="Cost" legend />
                          ) : <div className="empty-note">Belum ada biaya pada periode ini.</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <GoalOverviewSection report={report} f={f} p1={p1} p2={p2} />
                  <AlertsSection report={report} f={f} p2={p2} />
                  <div className="sec-block">
                    {heading('Ringkasan Periode', 'semua metrik')}
                    <KpiTable rows={summaryRows} p1={p1} p2={p2} padded />
                  </div>
                </SectionAccordion>
              ),
            },
            {
              id: 'diagnostics',
              label: urgent ? `Diagnostics (${urgent})` : 'Diagnostics',
              hidden: !report.diagnostics,
              content: (
                <SectionAccordion>
                  <DiagnosticsSection report={report} p1={p1} p2={p2} />
                </SectionAccordion>
              ),
            },
            {
              id: 'search-terms',
              label: 'Search Terms',
              hidden: !cur.searchTerms.length,
              content: (
                <SectionAccordion>
                  <div className="sec-block">
                    {heading('Top Search Terms', `berdasarkan cost · ${p2}${cur.searchTermsSource === 'upload' ? ' · file unggahan' : cur.searchTermsSource === 'mixed' ? ' · sebagian file unggahan' : ''}`)}
                    <GoogleAdsTable columns={termCols} rows={cur.searchTerms} sortKey="cost" limit={TABLE_ROWS} />
                  </div>
                  <div className="sec-block">
                    {heading('Search Term Wasted Spend', `cost tanpa konversi · ${p2}`)}
                    <GoogleAdsTable columns={wastedCols} rows={wasted} sortKey="cost" limit={TABLE_ROWS}
                      emptyMessage="Tidak ada search term yang mengeluarkan biaya tanpa konversi pada periode ini." />
                    <p className="gads-footnote">Biaya tanpa konversi yang teramati — belum tentu pemborosan. Klasifikasi per search term ada di Search Term Intelligence.</p>
                  </div>
                  <SearchTermIntelSection report={report} f={f} p2={p2} />
                </SectionAccordion>
              ),
            },
            {
              id: 'campaigns',
              label: 'Campaign & Ad Group',
              hidden: !cur.campaigns.length,
              content: (
                <SectionAccordion>
                  <CampaignIntelSection report={report} f={f} p1={p1} p2={p2} />
                  <div className="sec-block">
                    {heading('Campaign Performance', `urut cost · ${p2}`)}
                    <GoogleAdsTable columns={campaignCols} rows={cur.campaigns} sortKey="cost" limit={TABLE_ROWS} />
                  </div>
                  <div className="sec-block">
                    {heading('Ad Group Performance', `urut cost · ${p2}`)}
                    <GoogleAdsTable columns={adGroupCols} rows={cur.adGroups} sortKey="cost" limit={TABLE_ROWS} />
                  </div>
                </SectionAccordion>
              ),
            },
            {
              id: 'keywords',
              label: 'Keyword',
              hidden: !cur.keywords.length,
              content: (
                <SectionAccordion>
                  <div className="sec-block">
                    {heading('Best Performing Keyword', `berdasarkan konversi · ${p2}`)}
                    <GoogleAdsTable columns={keywordCols} rows={cur.keywords} sortKey="conversions" limit={TABLE_ROWS} />
                  </div>
                  {cur.keywordDetail ? (
                    <KeywordIntelSection report={report} f={f} p2={p2} />
                  ) : (
                    <div className="sec-block">
                      {heading('Low Performing Keyword', `berdasarkan Avg. CPC · ${p2}`)}
                      <GoogleAdsTable columns={keywordCols} rows={cur.keywords.filter((k) => k.clicks > 0)} sortKey="avg_cpc" sortDir="asc" limit={TABLE_ROWS} />
                      <p className="gads-footnote">
                        Impr. (Abs. Top) % dan Search Lost Top IS dihitung dari data harian, dibobot dengan impressions — bisa sedikit berbeda dari angka satu periode di Google Ads.
                      </p>
                    </div>
                  )}
                </SectionAccordion>
              ),
            },
            {
              id: 'ads',
              label: 'Ad Performance',
              hidden: !cur.ads,
              content: (
                <SectionAccordion>
                  <AdPerformanceSection report={report} f={f} p2={p2} copy={clientId ? { clientId, range } : undefined} />
                </SectionAccordion>
              ),
            },
            {
              id: 'conversions',
              label: 'Konversi',
              hidden: !cur.conversionActions,
              content: (
                <SectionAccordion>
                  <ConversionSection report={report} f={f} p1={p1} p2={p2} />
                </SectionAccordion>
              ),
            },
            {
              id: 'device-time',
              label: 'Device & Waktu',
              hidden: !cur.devices && !cur.schedule,
              content: (
                <SectionAccordion>
                  <DeviceTimeSection report={report} f={f} p2={p2} />
                </SectionAccordion>
              ),
            },
            {
              id: 'cities',
              label: 'Kota',
              hidden: !searchCities.length,
              content: (
                <SectionAccordion>
                  <div className="sec-block">
                    {heading('Search Campaign · City Performance', `urut konversi · ${p2}`)}
                    <GoogleAdsTable columns={cityCols} rows={searchCities} sortKey="conversions" limit={TABLE_ROWS} numbered />
                  </div>
                </SectionAccordion>
              ),
            },
            {
              id: 'auction',
              label: 'Auction Insights',
              content: (
                <SectionAccordion>
                  <AuctionInsightsSection data={report.auctionInsights} p1={p1} p2={p2} />
                </SectionAccordion>
              ),
            },
            {
              id: 'changes',
              label: 'Change History',
              content: (
                <SectionAccordion>
                  <ChangeHistorySection data={report.changeHistory} settingChanges={report.campaignSettingChanges ?? []} p2={p2} />
                </SectionAccordion>
              ),
            },
            {
              id: 'optimization',
              label: 'Optimasi',
              hidden: !clientId,
              content: clientId ? (
                <SectionAccordion>
                  <OptimizationCenter clientId={clientId} range={range}
                    onExperiment={(r) => {
                      const c = r.entity_type === 'campaign' ? report.cur.campaigns.find((x) => x.campaign_id === r.entity_id) : undefined;
                      setDraft({ hypothesis: r.title, planned_action: r.recommended_action, recommendation_id: r.id, campaign: c ? `${c.customer_id}|${c.campaign_id}` : '' });
                    }} />
                  <ExperimentTracker clientId={clientId} report={report} f={f} draft={draft} onDraftUsed={() => setDraft(null)} />
                  <div className="sec-block">
                    <div className="sec-heading google-heading">Alert Aktif <span className="sec-badge">rule-based</span></div>
                    <div className="sec-inner"><AlertsPanel clientId={clientId} /></div>
                  </div>
                </SectionAccordion>
              ) : null,
            },
          ]}
        />
      </div>
      <AiSummarySection
        clientId={clientId}
        platform="google"
        period={{ old: p1, cur: p2 }}
        periodDates={range}
        kpis={aiKpis(report, f)}
        notes={aiNotes(report, f)}
      />
      <div className="action-row" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
        <DownloadPdfButton targetId="report-google" filename="Performance Report - Google Ads.pdf" />
        <button className="btn btn-ghost" disabled={excelBusy} onClick={async () => {
          setExcelBusy(true);
          try { await downloadGoogleAdsWorkbook(report, { p1, p2, brand: report.accounts.map((a) => a.name || a.label || a.customerId).join(', ') }); } finally { setExcelBusy(false); }
        }}>
          {excelBusy ? <Loader2 size={15} className="rg-spin" aria-hidden /> : <FileSpreadsheet size={15} aria-hidden />} Download Excel (semua tabel)
        </button>
        <button className="btn btn-ghost" onClick={onReset}>
          <RotateCcw size={15} aria-hidden /> Ganti Periode
        </button>
      </div>
    </div>
  );
}
