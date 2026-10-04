import { Chart } from 'chart.js/auto';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Loader2, Sparkles, X } from 'lucide-react';
import { DeltaPill } from '../../components/DeltaPill';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SectionExcelButton } from '../../components/SectionExcelButton';
import { SegmentedToggle } from '../../components/SegmentedToggle';
import { computeDelta, deltaClassForSentiment } from '../../lib/delta';
import type { Sentiment } from '../../lib/types';
import { GoogleAdsTable, type GadsColumn } from './GoogleAdsTable';
import {
  GOAL_LABELS, apiError, channelLabel, fetchAdCopy, matchTypeLabel, type GadsAdCopy, type PeriodPair,
  type Formatter, type GadsAd, type GadsCampaign, type GadsConversionAction, type GadsDay, type GadsFinding, type GadsKeywordDetail,
  type GadsLandingPage, type GadsMessageMatch, type GadsReport, type GadsTermDetail, type GoalKey, type KeywordClass, type Severity, type TermClass,
} from './googleAds';

// The report sections built on the datasets of migrations 040/041 and the
// backend's rule-based insights (googleAdsDiagnostics.js). The numbers and
// classes all come from the backend; this file only lays them out. Every
// section copes with an account whose script predates a dataset: it says
// the data is not there yet instead of showing zeros.

const TABLE_ROWS = 10;
const INTER = "'Inter', system-ui, sans-serif";

// ── shared bits ─────────────────────────────────────────────────────
export function Heading({ title, badge, excel = true }: { title: string; badge?: string; excel?: boolean }) {
  return (
    <div className="sec-heading google-heading">
      {title} {badge && <span className="sec-badge">{badge}</span>}
      {excel && <SectionExcelButton />}
      <SectionDownloadButton />
    </div>
  );
}

export function EmptyBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sec-block">
      <div className="sec-heading google-heading">{title}</div>
      <div className="empty-note" style={{ margin: '1.1rem 1.4rem 1.4rem' }}>{children}</div>
    </div>
  );
}

const NOT_YET = 'Data ini belum tersedia untuk akun ini — muncul setelah Google Ads Script terbaru berjalan di akun klien.';

type Tone = 'good' | 'bad' | 'warn' | 'neutral' | 'info';
function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`gads-tag is-${tone}`}>{children}</span>;
}

function Chips<T extends string>({ options, value, onChange, counts }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; counts?: Partial<Record<T, number>> }) {
  return (
    <div className="gads-chips" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={`gads-chip${o.value === value ? ' is-active' : ''}`} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}{counts?.[o.value] != null && <span className="gads-chip-count">{counts[o.value]}</span>}
        </button>
      ))}
    </div>
  );
}

function fmtKind(f: Formatter, kind: string, v: number | null | undefined): string {
  if (v == null) return '—';
  if (kind === 'money') return f.money(v);
  if (kind === 'int') return f.int(v);
  if (kind === 'pct') return f.pct(v);
  if (kind === 'x') return `${f.dec(v)}x`;
  return f.dec(v);
}

const humanEnum = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—');
const QUALITY_LABEL: Record<string, string> = { BELOW_AVERAGE: 'Di bawah rata-rata', AVERAGE: 'Rata-rata', ABOVE_AVERAGE: 'Di atas rata-rata' };
const qualityTone = (v: string | null): Tone => (v === 'BELOW_AVERAGE' ? 'bad' : v === 'ABOVE_AVERAGE' ? 'good' : 'neutral');

// ── KPI card ────────────────────────────────────────────────────────
interface KpiSpec { label: string; kind: string; old: number | null | undefined; cur: number | null | undefined; sentiment: Sentiment; note?: string }
function KpiCards({ items, f, p1 }: { items: KpiSpec[]; f: Formatter; p1: string }) {
  return (
    <div className="gads-kpis">
      {items.map((k) => {
        const d = computeDelta(k.old ?? null, k.cur ?? null);
        return (
          <div key={k.label} className="gads-kpi">
            <span className="gads-kpi-label">{k.label}</span>
            <strong className="gads-kpi-value num">{fmtKind(f, k.kind, k.cur)}</strong>
            <DeltaPill cls={deltaClassForSentiment(d.deltaNum, k.sentiment)} size="sm">{d.deltaStr}</DeltaPill>
            <span className="gads-kpi-old">{p1}: {fmtKind(f, k.kind, k.old)}</span>
            {k.note && <span className="gads-kpi-note">{k.note}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Overall: business goal ──────────────────────────────────────────
type GoalView = 'all' | 'purchase' | 'lead';

export function GoalOverviewSection({ report, f, p1, p2 }: { report: GadsReport; f: Formatter; p1: string; p2: string }) {
  const [view, setView] = useState<GoalView>('all');
  const g = report.cur.goals;
  const o = report.old.goals;
  if (!g) return <EmptyBlock title="Performa per Tujuan Bisnis">{NOT_YET}</EmptyBlock>;
  const totals = report.cur.totals;
  const oldTotals = report.old.totals;
  const secondaryOnly = (k: GoalKey) => g[k].conversions === 0 && g[k].all_conversions > 0;
  const unverified = (['purchase', 'lead', 'micro', 'other'] as GoalKey[]).reduce((a, k) => a + g[k].unverified, 0);

  let items: KpiSpec[];
  if (view === 'purchase') {
    items = [
      { label: 'Purchase', kind: 'dec', old: o?.purchase.conversions, cur: g.purchase.conversions, sentiment: 'higher-better', note: secondaryOnly('purchase') ? `Hanya tercatat sebagai konversi sekunder (${f.dec(g.purchase.all_conversions)})` : undefined },
      { label: 'Cost / Purchase', kind: 'money', old: o?.purchase.blended_cost_per_result, cur: g.purchase.blended_cost_per_result, sentiment: 'lower-better', note: 'Seluruh biaya akun ÷ purchase' },
      { label: 'Cost / Purchase (campaign Purchase)', kind: 'money', old: o?.purchase.focus_cost_per_result, cur: g.purchase.focus_cost_per_result, sentiment: 'lower-better', note: `${g.purchase.focus_campaigns ?? 0} campaign yang menargetkan Purchase` },
      { label: 'Purchase value', kind: 'money', old: o?.purchase.conversions_value, cur: g.purchase.conversions_value, sentiment: 'higher-better' },
      { label: 'Purchase ROAS', kind: 'x', old: o?.purchase.blended_roas, cur: g.purchase.blended_roas, sentiment: 'higher-better' },
      { label: 'Purchase CVR', kind: 'pct', old: oldTotals.clicks ? (o?.purchase.conversions ?? 0) / oldTotals.clicks : null, cur: totals.clicks ? g.purchase.conversions / totals.clicks : null, sentiment: 'higher-better' },
    ];
  } else if (view === 'lead') {
    items = [
      { label: 'Leads', kind: 'dec', old: o?.lead.conversions, cur: g.lead.conversions, sentiment: 'higher-better', note: secondaryOnly('lead') ? `Hanya tercatat sebagai konversi sekunder (${f.dec(g.lead.all_conversions)})` : undefined },
      { label: 'Cost / Lead', kind: 'money', old: o?.lead.blended_cost_per_result, cur: g.lead.blended_cost_per_result, sentiment: 'lower-better', note: 'Seluruh biaya akun ÷ lead' },
      { label: 'Cost / Lead (campaign Lead)', kind: 'money', old: o?.lead.focus_cost_per_result, cur: g.lead.focus_cost_per_result, sentiment: 'lower-better', note: `${g.lead.focus_campaigns ?? 0} campaign yang menargetkan Lead` },
      { label: 'Lead CVR', kind: 'pct', old: oldTotals.clicks ? (o?.lead.conversions ?? 0) / oldTotals.clicks : null, cur: totals.clicks ? g.lead.conversions / totals.clicks : null, sentiment: 'higher-better' },
    ];
  } else {
    items = [
      { label: 'Cost', kind: 'money', old: oldTotals.cost, cur: totals.cost, sentiment: 'neutral' },
      { label: 'Purchase', kind: 'dec', old: o?.purchase.conversions, cur: g.purchase.conversions, sentiment: 'higher-better', note: secondaryOnly('purchase') ? 'Hanya sekunder' : undefined },
      { label: 'Leads', kind: 'dec', old: o?.lead.conversions, cur: g.lead.conversions, sentiment: 'higher-better', note: secondaryOnly('lead') ? 'Hanya sekunder' : undefined },
      { label: 'Micro conversions', kind: 'dec', old: o?.micro.all_conversions, cur: g.micro.all_conversions, sentiment: 'higher-better', note: 'All conv. (sekunder)' },
      { label: 'Purchase value', kind: 'money', old: o?.purchase.conversions_value, cur: g.purchase.conversions_value, sentiment: 'higher-better' },
      { label: 'Purchase ROAS', kind: 'x', old: o?.purchase.blended_roas, cur: g.purchase.blended_roas, sentiment: 'higher-better' },
    ];
  }
  const mixed = g.purchase.conversions > 0 && g.lead.conversions > 0;
  return (
    <div className="sec-block">
      <Heading title="Performa per Tujuan Bisnis" badge={`${p1} → ${p2}`} excel={false} />
      <div className="sec-inner">
        <SegmentedToggle label="Tujuan" value={view} onChange={setView} accent="var(--google)"
          options={[{ value: 'all', label: 'Semua campaign' }, { value: 'purchase', label: 'Purchase' }, { value: 'lead', label: 'Leads' }]} />
        <KpiCards items={items} f={f} p1={p1} />
        {mixed && view === 'all' && (
          <p className="gads-footnote is-inline">
            Kolom Conversions Google Ads ({f.dec(totals.conversions)}) menggabungkan {f.dec(g.purchase.conversions)} purchase dan {f.dec(g.lead.conversions)} lead
            {g.other.conversions ? ` serta ${f.dec(g.other.conversions)} konversi lain` : ''} — keduanya dinilai terpisah di sini.
          </p>
        )}
        {unverified > 0 && (
          <p className="gads-footnote is-inline">
            {unverified} conversion action masih memakai pemetaan bawaan dari kategori Google dan perlu diverifikasi di Data Brand › Google Ads › Conversion goals.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Overall: cost & conversions over time ────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const dayLabel = (s: string) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`;

export function CostConversionChart({ days }: { days: GadsDay[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const chart = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: days.map((d) => dayLabel(d.date)),
        datasets: [
          { type: 'bar', label: 'Cost', data: days.map((d) => d.cost), backgroundColor: 'rgba(26,115,232,.28)', borderColor: '#1a73e8', borderWidth: 0, yAxisID: 'y', order: 2 },
          { type: 'line', label: 'Conversions', data: days.map((d) => d.conversions), borderColor: '#15803d', backgroundColor: '#15803d', yAxisID: 'y1', tension: 0.3, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2, order: 1 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduce ? false : { duration: 600 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { font: { family: INTER, size: 12 }, boxWidth: 18, boxHeight: 8 } },
          tooltip: { backgroundColor: '#202e45', padding: 10, cornerRadius: 10, titleFont: { family: INTER, weight: 700 }, bodyFont: { family: INTER } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: INTER, size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
          y: { position: 'left', beginAtZero: true, title: { display: true, text: 'Cost', font: { family: INTER, size: 11 } }, ticks: { font: { family: INTER, size: 11 } } },
          y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'Conversions', font: { family: INTER, size: 11 } }, ticks: { font: { family: INTER, size: 11 } } },
        },
      },
    });
    return () => chart.destroy();
  }, [days]);
  return <div className="gads-line-wrap"><canvas ref={canvasRef} /></div>;
}

// ── Overall: freshness, alerts, opportunities ────────────────────────
const DATASET_LABEL: Record<string, string> = {
  ads: 'Iklan', conversions: 'Konversi per action', competitive: 'Impression share', devices: 'Device', hourly: 'Per jam',
  landing_pages: 'Landing page', keyword_quality: 'Quality Score', campaign_settings: 'Setting campaign', conversion_actions: 'Conversion action', ad_assets: 'Teks iklan',
};

export function FreshnessLine({ report, coverageEnd }: { report: GadsReport; coverageEnd: string | null }) {
  const a = report.dataAvailability;
  const missing = a ? Object.keys(DATASET_LABEL).filter((k) => !a[k]?.last_date && !a[k]?.fetched_at) : [];
  const fetched = a ? Object.values(a).map((x) => x.fetched_at).filter(Boolean).sort().at(-1) : null;
  return (
    <p className="gads-freshness">
      Data harian sampai <strong>{coverageEnd ?? '—'}</strong>
      {fetched && <> · sinkron terakhir {new Date(fetched).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
      {missing.length > 0 && <> · belum tersedia: {missing.map((k) => DATASET_LABEL[k]).join(', ')}</>}
    </p>
  );
}

export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Kritis', high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };
const SEVERITY_TONE: Record<Severity, Tone> = { critical: 'bad', high: 'warn', medium: 'info', low: 'neutral' };
const CONFIDENCE_LABEL = { high: 'keyakinan tinggi', medium: 'keyakinan sedang', low: 'keyakinan rendah' };
export const FINDING_LABEL: Record<string, string> = {
  tracking_no_primary_conversion: 'Tidak ada konversi primer yang dihitung',
  conversions_stopped: 'Konversi berhenti',
  cpa_increase: 'CPA naik',
  conversion_volume_drop: 'Volume konversi turun',
  cvr_drop: 'Conversion rate turun',
  cpc_increase: 'CPC naik',
  ctr_drop: 'CTR turun',
  cost_up_without_results: 'Biaya naik tanpa hasil sepadan',
  lost_is_budget: 'Kehilangan impresi karena budget',
  lost_is_rank: 'Kehilangan impresi karena Ad Rank',
  budget_underused: 'Budget kurang terpakai',
  restrictive_target: 'Target bidding mungkin terlalu ketat',
  budget_limited: 'Budget hampir selalu habis',
  quality_landing_page_experience: 'Landing page experience lemah di banyak keyword',
  quality_ad_relevance: 'Ad relevance lemah di banyak keyword',
  quality_expected_ctr: 'Expected CTR lemah di banyak keyword',
};

function FindingCard({ x }: { x: GadsFinding }) {
  return (
    <article className={`gads-finding is-${x.severity}`}>
      <header>
        <Tag tone={SEVERITY_TONE[x.severity]}>{SEVERITY_LABEL[x.severity]}</Tag>
        <strong>{FINDING_LABEL[x.type] ?? humanEnum(x.type)}</strong>
        <span className="gads-finding-entity">{x.entity_type === 'account' ? 'Seluruh akun' : x.entity_name}</span>
        <span className="gads-finding-conf">{CONFIDENCE_LABEL[x.confidence]}</span>
      </header>
      <div className="gads-finding-body">
        <div><h5>Fakta</h5><ul>{x.facts.map((t) => <li key={t}>{t}</li>)}</ul></div>
        <div><h5>Kemungkinan penyebab</h5><ul>{x.possible_causes.map((t) => <li key={t}>{t}</li>)}</ul></div>
        <div><h5>Langkah berikutnya</h5><ul>{x.next_steps.map((t) => <li key={t}>{t}</li>)}</ul></div>
      </div>
    </article>
  );
}

export function AlertsSection({ report, f, p2 }: { report: GadsReport; f: Formatter; p2: string }) {
  const findings = report.diagnostics ?? [];
  const urgent = findings.filter((x) => x.severity === 'critical' || x.severity === 'high');
  const anomalies = report.anomalies?.anomalies ?? [];
  const kw = report.cur.keywordSummary;
  const terms = report.cur.searchTermSummary;
  const opportunities: string[] = [];
  if (kw?.high_potential) opportunities.push(`${kw.high_potential} keyword berpotensi tinggi (CPA efisien, volume kecil atau masih kehilangan impresi)`);
  if (terms?.by_class.new_keyword_opportunity.terms) opportunities.push(`${terms.by_class.new_keyword_opportunity.terms} search term berkonversi yang belum menjadi keyword`);
  for (const x of findings.filter((y) => y.type === 'lost_is_budget' && y.severity === 'high')) opportunities.push(`${x.entity_name}: ${x.facts[0]}`);
  if (terms?.potentially_irrelevant_spend) opportunities.push(`${f.money(terms.potentially_irrelevant_spend)} biaya search term berpotensi tidak relevan untuk direview`);
  if (!report.diagnostics) return null;
  return (
    <div className="sec-block">
      <Heading title="Perlu Perhatian & Peluang" badge={p2} excel={false} />
      <div className="sec-inner gads-alerts">
        <div>
          <h4>Peringatan ({urgent.length})</h4>
          {urgent.length ? <ul className="gads-alert-list">{urgent.slice(0, 6).map((x) => (
            <li key={x.id}><Tag tone={SEVERITY_TONE[x.severity]}>{SEVERITY_LABEL[x.severity]}</Tag> <strong>{FINDING_LABEL[x.type] ?? humanEnum(x.type)}</strong> — {x.entity_type === 'account' ? 'seluruh akun' : x.entity_name}. {x.facts[0]}</li>
          ))}</ul> : <p className="empty-note">Tidak ada temuan kritis atau tinggi.</p>}
          {urgent.length > 6 && <p className="gads-footnote is-inline">+{urgent.length - 6} temuan lain di halaman Diagnostics.</p>}
        </div>
        <div>
          <h4>Peluang</h4>
          {opportunities.length ? <ul className="gads-alert-list">{opportunities.slice(0, 6).map((t) => <li key={t}>{t}</li>)}</ul> : <p className="empty-note">Belum ada peluang yang didukung data cukup.</p>}
          {anomalies.length > 0 && (
            <>
              <h4 style={{ marginTop: '1rem' }}>Hari tidak biasa</h4>
              <ul className="gads-alert-list">{anomalies.slice(0, 5).map((a) => (
                <li key={`${a.date}-${a.metric}`}>{dayLabel(a.date)}: {ANOMALY_METRIC[a.metric]} {a.direction === 'up' ? 'jauh di atas' : 'jauh di bawah'} biasanya ({a.metric === 'cost' || a.metric === 'cpa' ? f.money(a.value) : f.dec(a.value)} vs ±{a.metric === 'cost' || a.metric === 'cpa' ? f.money(a.expected) : f.dec(a.expected)})</li>
              ))}</ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
const ANOMALY_METRIC = { cost: 'Biaya', clicks: 'Klik', conversions: 'Konversi', cpa: 'CPA' };

// ── Diagnostics page ────────────────────────────────────────────────
export function DiagnosticsSection({ report, p1, p2 }: { report: GadsReport; p1: string; p2: string }) {
  const [sev, setSev] = useState<'all' | Severity>('all');
  const findings = report.diagnostics ?? [];
  if (!report.diagnostics) return <EmptyBlock title="Diagnostics">{NOT_YET}</EmptyBlock>;
  const counts = { all: findings.length, ...Object.fromEntries((['critical', 'high', 'medium', 'low'] as Severity[]).map((s) => [s, findings.filter((x) => x.severity === s).length])) } as Record<'all' | Severity, number>;
  const shown = sev === 'all' ? findings : findings.filter((x) => x.severity === sev);
  return (
    <div className="sec-block">
      <Heading title="Diagnostics Campaign" badge={`${p1} → ${p2}`} excel={false} />
      <div className="sec-inner">
        <Chips value={sev} onChange={setSev} counts={counts} options={[
          { value: 'all', label: 'Semua' }, { value: 'critical', label: 'Kritis' }, { value: 'high', label: 'Tinggi' }, { value: 'medium', label: 'Sedang' }, { value: 'low', label: 'Rendah' },
        ]} />
        {shown.length ? <div className="gads-findings">{shown.map((x) => <FindingCard key={x.id} x={x} />)}</div>
          : <p className="empty-note">Tidak ada temuan pada tingkat ini.</p>}
        <p className="gads-footnote is-inline">
          Temuan dihasilkan aturan berbasis data dengan batas volume minimum. "Fakta" adalah angka; "kemungkinan penyebab" adalah hipotesis yang perlu diperiksa —
          perubahan di akun pada periode yang sama dicantumkan sebagai konteks, bukan bukti sebab-akibat.
        </p>
      </div>
    </div>
  );
}

// ── Search terms ────────────────────────────────────────────────────
export const TERM_LABEL: Record<TermClass, string> = {
  high_intent: 'High intent', new_keyword_opportunity: 'Peluang keyword baru', potential_negative: 'Potensi negative', informational: 'Informasional',
  competitor: 'Kompetitor', location_mismatch: 'Lokasi tidak sesuai', requires_review: 'Perlu review', monitoring: 'Pantau',
};
const TERM_TONE: Record<TermClass, Tone> = {
  high_intent: 'good', new_keyword_opportunity: 'good', potential_negative: 'bad', informational: 'warn', competitor: 'warn',
  location_mismatch: 'warn', requires_review: 'info', monitoring: 'neutral',
};

export function SearchTermIntelSection({ report, f, p2 }: { report: GadsReport; f: Formatter; p2: string }) {
  const [cls, setCls] = useState<'all' | TermClass>('all');
  const [campaign, setCampaign] = useState('');
  const rows = report.cur.searchTermDetail;
  const s = report.cur.searchTermSummary;
  if (!rows || !s) return null;
  const campaigns = [...new Set(rows.map((r) => r.campaign_name).filter(Boolean))].sort();
  const shown = rows.filter((r) => (cls === 'all' || r.classification === cls) && (!campaign || r.campaign_name === campaign));
  const counts = { all: rows.length, ...Object.fromEntries(Object.keys(TERM_LABEL).map((k) => [k, rows.filter((r) => r.classification === k).length])) } as Record<'all' | TermClass, number>;
  const columns: GadsColumn<GadsTermDetail>[] = [
    { key: 'search_term', label: 'Search term', align: 'left', value: (r) => r.search_term },
    { key: 'campaign_name', label: 'Campaign', align: 'left', value: (r) => r.campaign_name || '—' },
    { key: 'ad_group_name', label: 'Ad group', align: 'left', value: (r) => r.ad_group_name || '—' },
    { key: 'match_type', label: 'Match type', align: 'left', value: (r) => matchTypeLabel(r.match_type) },
    { key: 'cost', label: 'Cost', value: (r) => r.cost, render: (r) => f.money(r.cost) },
    { key: 'clicks', label: 'Clicks', value: (r) => r.clicks, render: (r) => f.int(r.clicks) },
    { key: 'conversions', label: 'Conv.', value: (r) => r.conversions, render: (r) => f.dec(r.conversions) },
    { key: 'cost_per_conv', label: 'CPA', value: (r) => r.cost_per_conv, render: (r) => f.money(r.cost_per_conv) },
    { key: 'classification', label: 'Klasifikasi', align: 'left', value: (r) => TERM_LABEL[r.classification], render: (r) => <Tag tone={TERM_TONE[r.classification]}>{TERM_LABEL[r.classification]}</Tag> },
    { key: 'action', label: 'Saran', align: 'left', value: (r) => r.suggested_action, render: (r) => <span className="gads-why" title={r.reasons.join(' · ')}>{r.suggested_action}</span> },
  ];
  return (
    <>
      <div className="sec-block">
        <Heading title="Search Term Intelligence" badge={`${p2}${s.total_terms && s.listed && s.total_terms > s.listed ? ` · ${s.listed} dari ${s.total_terms} term berbiaya terbesar` : ''}`} />
        <div className="sec-inner">
          <div className="gads-stat-row">
            <div className="gads-stat"><span>Biaya tanpa konversi (teramati)</span><strong>{f.money(s.observed_no_conversion_spend)}</strong><small>Belum tentu pemborosan</small></div>
            <div className="gads-stat"><span>Berpotensi tidak relevan</span><strong>{f.money(s.potentially_irrelevant_spend)}</strong><small>Ditandai aturan — perlu review</small></div>
            <div className="gads-stat"><span>Terkonfirmasi tidak relevan</span><strong>{s.confirmed_irrelevant_spend == null ? 'N/A' : f.money(s.confirmed_irrelevant_spend)}</strong><small>Belum ada review manual</small></div>
            <div className="gads-stat"><span>Cakupan search term</span><strong>{f.pct(s.coverage)}</strong><small>dari biaya campaign Search/Shopping</small></div>
          </div>
          {s.coverage_warning && <p className="gads-footnote is-inline">{s.coverage_warning}</p>}
          <div className="gads-filter-row">
            <Chips value={cls} onChange={setCls} counts={counts} options={[{ value: 'all', label: 'Semua' }, ...Object.entries(TERM_LABEL).map(([value, label]) => ({ value: value as TermClass, label }))]} />
            {campaigns.length > 1 && (
              <select className="gads-select" value={campaign} onChange={(e) => setCampaign(e.target.value)} aria-label="Filter campaign">
                <option value="">Semua campaign</option>
                {campaigns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>
        </div>
        <GoogleAdsTable columns={columns} rows={shown} sortKey="cost" limit={TABLE_ROWS} emptyMessage="Tidak ada search term pada filter ini." />
      </div>
      <NegativeCandidates report={report} f={f} />
    </>
  );
}

function NegativeCandidates({ report, f }: { report: GadsReport; f: Formatter }) {
  const list = report.cur.searchTermSummary?.negative_candidates ?? [];
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  if (!list.length) return null;
  const toggle = (t: string) => setPicked((p) => { const n = new Set(p); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  async function copy() {
    await navigator.clipboard.writeText([...picked].join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="sec-block">
      <Heading title="Kandidat Negative Keyword" badge="review sebelum dipakai" excel={false} />
      <div className="sec-inner">
        <p className="gads-footnote is-inline" style={{ marginBottom: '.6rem' }}>
          Search term tanpa konversi yang ditandai aturan. Centang yang sudah Anda review, lalu salin dan tempel manual di Google Ads — ATLAS tidak mengubah akun.
        </p>
        <ul className="gads-neg-list">
          {list.slice(0, 50).map((n) => (
            <li key={n.text}>
              <label>
                <input type="checkbox" checked={picked.has(n.text)} onChange={() => toggle(n.text)} />
                <span className="gads-neg-text">{n.text}</span>
                <Tag tone={TERM_TONE[n.classification]}>{TERM_LABEL[n.classification]}</Tag>
                <span className="gads-neg-meta">{f.money(n.cost)}{n.campaign_name ? ` · ${n.campaign_name}` : ''}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="action-row" style={{ marginTop: '.8rem' }}>
          <button type="button" className="btn btn-ghost" disabled={!picked.size} onClick={copy}>
            {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />} {copied ? 'Tersalin' : `Salin ${picked.size || ''} negative keyword`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Campaigns: settings, impression share, diagnosis + drawer ────────
interface CampaignIntel {
  c: GadsCampaign;
  key: string;
  goal: string;
  strategy: string;
  target: string;
  actual: string;
  budget: number | null;
  utilization: number | null;
  is: number | null;
  lostBudget: number | null;
  lostRank: number | null;
  shareEstimate: boolean;
  status: string;
  findings: GadsFinding[];
}

export function useCampaignIntel(report: GadsReport, f: Formatter): CampaignIntel[] {
  return useMemo(() => {
    const settings = new Map((report.campaignSettings ?? []).map((s) => [`${s.customer_id}|${s.campaign_id}`, s]));
    const shares = new Map((report.cur.competitive?.campaigns ?? []).map((s) => [`${s.customer_id}|${s.campaign_id}`, s]));
    return report.cur.campaigns.map((c) => {
      const key = `${c.customer_id}|${c.campaign_id}`;
      const s = settings.get(key);
      const sh = shares.get(key);
      const goal = report.cur.campaignGoals?.[key];
      const budget = s?.budget_amount ?? c.budget;
      return {
        c, key,
        goal: goal ? GOAL_LABELS[goal.goal] : '—',
        strategy: s?.bidding_strategy_type ? humanEnum(s.bidding_strategy_type) : '—',
        target: s?.target_cpa ? `CPA ${f.money(s.target_cpa)}` : s?.target_roas ? `ROAS ${f.dec(s.target_roas)}x` : s?.target_impression_share ? `IS ${f.pct(s.target_impression_share)}` : '—',
        actual: s?.target_roas ? `${f.dec(c.roas)}x` : f.money(c.cost_per_conv),
        budget,
        utilization: budget && c.active_days ? c.cost / c.active_days / budget : null,
        is: sh?.search_impression_share ?? null,
        lostBudget: sh?.search_budget_lost_is ?? null,
        lostRank: sh?.search_rank_lost_is ?? null,
        shareEstimate: sh?.granularity === 'daily_estimate',
        status: s?.status ? humanEnum(s.status) : '—',
        findings: (report.diagnostics ?? []).filter((x) => x.entity_type === 'campaign' && x.entity_id === c.campaign_id),
      };
    });
  }, [report, f]);
}

export function CampaignIntelSection({ report, f, p1, p2 }: { report: GadsReport; f: Formatter; p1: string; p2: string }) {
  const intel = useCampaignIntel(report, f);
  const [open, setOpen] = useState<CampaignIntel | null>(null);
  if (!report.campaignSettings) return null;
  const columns: GadsColumn<CampaignIntel>[] = [
    { key: 'name', label: 'Campaign', align: 'left', value: (r) => r.c.campaign_name, render: (r) => <button type="button" className="gads-link" onClick={() => setOpen(r)}>{r.c.campaign_name}</button> },
    { key: 'status', label: 'Status', align: 'left', value: (r) => r.status },
    { key: 'goal', label: 'Tujuan', align: 'left', value: (r) => r.goal },
    { key: 'strategy', label: 'Bidding', align: 'left', value: (r) => r.strategy },
    { key: 'target', label: 'Target', align: 'left', value: (r) => r.target },
    { key: 'actual', label: 'Aktual', value: (r) => r.c.cost_per_conv, render: (r) => r.actual },
    { key: 'budget', label: 'Budget/hari', value: (r) => r.budget, render: (r) => f.money(r.budget) },
    { key: 'util', label: 'Pemakaian budget', value: (r) => r.utilization, render: (r) => f.pct(r.utilization) },
    { key: 'is', label: 'Search IS', value: (r) => r.is, render: (r) => <>{f.pct(r.is)}{r.shareEstimate && r.is != null ? '*' : ''}</> },
    { key: 'lost_budget', label: 'Lost IS (budget)', value: (r) => r.lostBudget, render: (r) => f.pct(r.lostBudget) },
    { key: 'lost_rank', label: 'Lost IS (rank)', value: (r) => r.lostRank, render: (r) => f.pct(r.lostRank) },
    {
      key: 'diag', label: 'Diagnosis', align: 'left', value: (r) => r.findings.length,
      render: (r) => (r.findings.length ? <><Tag tone={SEVERITY_TONE[r.findings[0].severity]}>{SEVERITY_LABEL[r.findings[0].severity]}</Tag> {FINDING_LABEL[r.findings[0].type] ?? r.findings[0].type}{r.findings.length > 1 ? ` +${r.findings.length - 1}` : ''}</> : '—'),
    },
  ];
  const estimated = intel.some((r) => r.shareEstimate && r.is != null);
  return (
    <div className="sec-block">
      <Heading title="Campaign Settings & Diagnosis" badge={`${p2} · klik nama campaign untuk detail`} />
      <GoogleAdsTable columns={columns} rows={intel} sortKey="util" limit={TABLE_ROWS} />
      <p className="gads-footnote">
        Pemakaian budget = rata-rata biaya per hari aktif ÷ budget harian saat ini. "Aktual" adalah CPA (atau ROAS bila targetnya ROAS) periode ini.
        {estimated && ' * Impression share diestimasi dari data harian karena periode ini tidak sama persis dengan rentang yang ditarik dari Google.'}
      </p>
      {open && <CampaignDrawer intel={open} report={report} f={f} p1={p1} p2={p2} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CampaignDrawer({ intel, report, f, p1, p2, onClose }: { intel: CampaignIntel; report: GadsReport; f: Formatter; p1: string; p2: string; onClose: () => void }) {
  const { c } = intel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const old = report.old.campaigns.find((x) => x.customer_id === c.customer_id && x.campaign_id === c.campaign_id);
  const s = (report.campaignSettings ?? []).find((x) => x.customer_id === c.customer_id && x.campaign_id === c.campaign_id);
  const adGroups = report.cur.adGroups.filter((g) => g.campaign_name === c.campaign_name).sort((a, b) => b.cost - a.cost).slice(0, 8);
  const keywords = (report.cur.keywordDetail ?? []).filter((k) => k.campaign_id === c.campaign_id).sort((a, b) => b.cost - a.cost).slice(0, 8);
  const changes = report.changeHistory.rows.filter((r) => r.campaign_name === c.campaign_name).slice(0, 10);
  const settingChanges = (report.campaignSettingChanges ?? []).filter((x) => x.campaign_id === c.campaign_id);
  const metrics: [string, string, number | null | undefined, number | null | undefined, Sentiment][] = [
    ['Cost', 'money', old?.cost, c.cost, 'neutral'], ['Clicks', 'int', old?.clicks, c.clicks, 'higher-better'], ['CTR', 'pct', old?.ctr, c.ctr, 'higher-better'],
    ['Avg. CPC', 'money', old?.avg_cpc, c.avg_cpc, 'lower-better'], ['Conversions', 'dec', old?.conversions, c.conversions, 'higher-better'],
    ['CPA', 'money', old?.cost_per_conv, c.cost_per_conv, 'lower-better'], ['CVR', 'pct', old?.cvr, c.cvr, 'higher-better'], ['ROAS', 'x', old?.roas, c.roas, 'higher-better'],
  ];
  return (
    <div className="gads-drawer-overlay" role="presentation" onClick={onClose}>
      <aside className="gads-drawer" role="dialog" aria-modal="true" aria-label={c.campaign_name} onClick={(e) => e.stopPropagation()}>
        <header className="gads-drawer-head">
          <div><span className="gads-kpi-label">{channelLabel(c.channel_type)} · {intel.status}</span><h3>{c.campaign_name}</h3></div>
          <button type="button" className="gads-icon-btn" onClick={onClose} aria-label="Tutup"><X size={18} /></button>
        </header>
        <section>
          <h4>Performa {p1} → {p2}</h4>
          <table className="kpi-table gads-mini-table"><tbody>
            {metrics.map(([label, kind, a, b, sentiment]) => {
              const d = computeDelta(a ?? null, b ?? null);
              return <tr key={label}><td className="is-left">{label}</td><td>{fmtKind(f, kind, a)}</td><td>{fmtKind(f, kind, b)}</td><td><DeltaPill cls={deltaClassForSentiment(d.deltaNum, sentiment)} size="sm">{d.deltaStr}</DeltaPill></td></tr>;
            })}
          </tbody></table>
        </section>
        <section>
          <h4>Setting</h4>
          {s ? (
            <dl className="gads-dl">
              <dt>Bidding</dt><dd>{intel.strategy}{s.bidding_strategy_source === 'PORTFOLIO' ? ` (portfolio${s.bidding_strategy_name ? `: ${s.bidding_strategy_name}` : ''})` : ''}</dd>
              <dt>Target</dt><dd>{intel.target}</dd>
              <dt>Budget harian</dt><dd>{f.money(s.budget_amount)}{s.budget_shared ? ' (shared)' : ''}</dd>
              <dt>Tujuan konversi</dt><dd>{s.conversion_goals == null ? 'Tidak terbaca' : s.conversion_goals.length ? s.conversion_goals.map((g) => humanEnum(g.category)).join(', ') : 'Default akun'}</dd>
              <dt>Lokasi</dt><dd>{s.locations_included == null ? 'Tidak terbaca' : s.locations_included.length ? s.locations_included.join(', ') : 'Semua lokasi'}{s.locations_excluded?.length ? ` · kecuali ${s.locations_excluded.join(', ')}` : ''}</dd>
              {s.unavailable.length > 0 && <><dt>Tidak terbaca</dt><dd>{s.unavailable.join(', ')}</dd></>}
            </dl>
          ) : <p className="empty-note">Setting campaign belum tersedia.</p>}
        </section>
        {intel.findings.length > 0 && <section><h4>Diagnosis</h4>{intel.findings.map((x) => <FindingCard key={x.id} x={x} />)}</section>}
        {adGroups.length > 0 && (
          <section>
            <h4>Ad group (urut cost)</h4>
            <table className="kpi-table gads-mini-table"><thead><tr><th className="is-left">Ad group</th><th>Cost</th><th>Conv.</th><th>CPA</th></tr></thead><tbody>
              {adGroups.map((g) => <tr key={g.ad_group_id}><td className="is-left">{g.ad_group_name}</td><td>{f.money(g.cost)}</td><td>{f.dec(g.conversions)}</td><td>{f.money(g.cost_per_conv)}</td></tr>)}
            </tbody></table>
          </section>
        )}
        {keywords.length > 0 && (
          <section>
            <h4>Keyword utama</h4>
            <table className="kpi-table gads-mini-table"><thead><tr><th className="is-left">Keyword</th><th>Cost</th><th>Conv.</th><th>QS</th><th className="is-left">Kelas</th></tr></thead><tbody>
              {keywords.map((k) => <tr key={`${k.ad_group_id}-${k.keyword}-${k.match_type}`}><td className="is-left">{k.keyword} <small>({matchTypeLabel(k.match_type)})</small></td><td>{f.money(k.cost)}</td><td>{f.dec(k.conversions)}</td><td>{k.quality_score ?? 'N/A'}</td><td className="is-left"><Tag tone={KEYWORD_TONE[k.classification]}>{KEYWORD_LABEL[k.classification]}</Tag></td></tr>)}
            </tbody></table>
          </section>
        )}
        {(settingChanges.length > 0 || changes.length > 0) && (
          <section>
            <h4>Perubahan</h4>
            <ul className="gads-alert-list">
              {settingChanges.map((x) => <li key={x.valid_from}>{new Date(x.valid_from).toLocaleDateString('id-ID')}: {x.changed_fields.map((cf) => `${cf.field.replace(/_/g, ' ')} ${String(cf.from ?? '—')} → ${String(cf.to ?? '—')}`).join('; ')}</li>)}
              {changes.map((x) => <li key={`${x.changed_at}-${x.changes}`}>{x.changed_at}{x.user_email ? ` · ${x.user_email}` : ''}: {x.changes}</li>)}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

// ── Keywords ────────────────────────────────────────────────────────
export const KEYWORD_LABEL: Record<KeywordClass, string> = {
  performing: 'Performing', high_potential: 'High potential', underperforming: 'Underperforming', no_conversion: 'No conversion', insufficient_data: 'Insufficient data',
};
const KEYWORD_TONE: Record<KeywordClass, Tone> = { performing: 'good', high_potential: 'info', underperforming: 'bad', no_conversion: 'warn', insufficient_data: 'neutral' };

export function KeywordIntelSection({ report, f, p2 }: { report: GadsReport; f: Formatter; p2: string }) {
  const [cls, setCls] = useState<'all' | KeywordClass>('all');
  const rows = report.cur.keywordDetail;
  if (!rows) return null;
  const counts = { all: rows.length, ...report.cur.keywordSummary } as Record<'all' | KeywordClass, number>;
  const shown = cls === 'all' ? rows : rows.filter((r) => r.classification === cls);
  const columns: GadsColumn<GadsKeywordDetail>[] = [
    { key: 'keyword', label: 'Keyword', align: 'left', value: (r) => r.keyword },
    { key: 'match_type', label: 'Match', align: 'left', value: (r) => matchTypeLabel(r.match_type) },
    { key: 'ad_group_name', label: 'Ad group', align: 'left', value: (r) => r.ad_group_name },
    { key: 'cost', label: 'Cost', value: (r) => r.cost, render: (r) => f.money(r.cost) },
    { key: 'clicks', label: 'Clicks', value: (r) => r.clicks, render: (r) => f.int(r.clicks) },
    { key: 'conversions', label: 'Conv.', value: (r) => r.conversions, render: (r) => f.dec(r.conversions) },
    { key: 'cost_per_conv', label: 'CPA', value: (r) => r.cost_per_conv, render: (r) => f.money(r.cost_per_conv) },
    { key: 'is', label: 'Search IS', value: (r) => r.search_impression_share, render: (r) => f.pct(r.search_impression_share) },
    { key: 'qs', label: 'QS', value: (r) => r.quality_score, render: (r) => (r.quality_score == null ? 'N/A' : r.quality_score) },
    { key: 'ectr', label: 'Exp. CTR', align: 'left', value: (r) => r.expected_ctr, render: (r) => (r.expected_ctr ? <Tag tone={qualityTone(r.expected_ctr)}>{QUALITY_LABEL[r.expected_ctr]}</Tag> : 'N/A') },
    { key: 'rel', label: 'Ad relevance', align: 'left', value: (r) => r.ad_relevance, render: (r) => (r.ad_relevance ? <Tag tone={qualityTone(r.ad_relevance)}>{QUALITY_LABEL[r.ad_relevance]}</Tag> : 'N/A') },
    { key: 'lpe', label: 'LP experience', align: 'left', value: (r) => r.landing_page_experience, render: (r) => (r.landing_page_experience ? <Tag tone={qualityTone(r.landing_page_experience)}>{QUALITY_LABEL[r.landing_page_experience]}</Tag> : 'N/A') },
    { key: 'classification', label: 'Klasifikasi', align: 'left', value: (r) => KEYWORD_LABEL[r.classification], render: (r) => <Tag tone={KEYWORD_TONE[r.classification]}>{KEYWORD_LABEL[r.classification]}</Tag> },
    { key: 'action', label: 'Saran', align: 'left', value: (r) => r.suggested_action, render: (r) => <span className="gads-why" title={[...r.reasons, ...r.quality_flags].join(' · ')}>{r.suggested_action}</span> },
  ];
  const qDate = rows.find((r) => r.quality_date)?.quality_date;
  return (
    <div className="sec-block">
      <Heading title="Keyword Diagnostics" badge={`${p2} · per ad group & match type`} />
      <div className="sec-inner">
        <Chips value={cls} onChange={setCls} counts={counts} options={[{ value: 'all', label: 'Semua' }, ...Object.entries(KEYWORD_LABEL).map(([value, label]) => ({ value: value as KeywordClass, label }))]} />
      </div>
      <GoogleAdsTable columns={columns} rows={shown} sortKey="cost" limit={TABLE_ROWS} emptyMessage="Tidak ada keyword pada kelas ini." />
      <p className="gads-footnote">
        Klasifikasi membandingkan CPA keyword dengan target CPA campaign, atau — tanpa target — CPA rata-rata campaign periode ini (baseline historis, bukan batas profitabilitas).
        Konversi keyword adalah semua konversi primer (Purchase dan Lead belum dipisah di level keyword).
        {qDate && ` Quality Score adalah penilaian Google per ${qDate}, bukan rata-rata periode; N/A = Google belum memberi skor.`}
      </p>
    </div>
  );
}

// ── Ad performance ──────────────────────────────────────────────────
const STRENGTH_TONE: Record<string, Tone> = { EXCELLENT: 'good', GOOD: 'good', AVERAGE: 'warn', POOR: 'bad' };

export interface CopyContext { clientId: number; range: PeriodPair }

export function AdPerformanceSection({ report, f, p2, copy }: { report: GadsReport; f: Formatter; p2: string; copy?: CopyContext }) {
  const [open, setOpen] = useState<string | null>(null);
  const ads = report.cur.ads;
  if (!ads) return <EmptyBlock title="Ad Performance">{NOT_YET}</EmptyBlock>;
  if (!ads.length) return <EmptyBlock title="Ad Performance">Tidak ada iklan dengan impresi pada periode ini.</EmptyBlock>;
  const columns: GadsColumn<GadsAd>[] = [
    {
      key: 'ad', label: 'Iklan', align: 'left', value: (r) => r.headlines?.[0]?.text ?? r.ad_id,
      render: (r) => (
        <button type="button" className="gads-link" onClick={() => setOpen(open === r.ad_id ? null : r.ad_id)}>
          {r.headlines?.slice(0, 2).map((h) => h.text).join(' | ') || `${humanEnum(r.ad_type)} #${r.ad_id}`}
        </button>
      ),
    },
    { key: 'ad_group_name', label: 'Ad group', align: 'left', value: (r) => r.ad_group_name },
    { key: 'strength', label: 'Ad strength', align: 'left', value: (r) => r.ad_strength, render: (r) => (r.ad_strength && r.ad_strength !== 'UNSPECIFIED' ? <Tag tone={STRENGTH_TONE[r.ad_strength] ?? 'neutral'}>{humanEnum(r.ad_strength)}</Tag> : '—') },
    { key: 'cost', label: 'Cost', value: (r) => r.cost, render: (r) => f.money(r.cost) },
    { key: 'ctr', label: 'CTR', value: (r) => r.ctr, render: (r) => f.pct(r.ctr) },
    { key: 'clicks', label: 'Clicks', value: (r) => r.clicks, render: (r) => f.int(r.clicks) },
    { key: 'conversions', label: 'Conv.', value: (r) => r.conversions, render: (r) => f.dec(r.conversions) },
    { key: 'cvr', label: 'CVR', value: (r) => r.cvr, render: (r) => f.pct(r.cvr) },
    { key: 'cost_per_conv', label: 'CPA', value: (r) => r.cost_per_conv, render: (r) => f.money(r.cost_per_conv) },
    { key: 'flags', label: 'Catatan', align: 'left', value: (r) => (r.flags ?? []).join(', '), render: (r) => (r.flags ?? []).join(' · ') || '—' },
  ];
  const detail = ads.find((a) => a.ad_id === open);
  return (
    <>
      <div className="sec-block">
        <Heading title="Ad Performance" badge={`${p2} · klik iklan untuk melihat headline`} />
        <GoogleAdsTable columns={columns} rows={ads} sortKey="cost" limit={TABLE_ROWS} />
        {detail && <AdDetail ad={detail} copy={copy} />}
        <p className="gads-footnote">
          Iklan dibandingkan dengan iklan lain di ad group yang sama. Label aset (Best/Good/Low) adalah penilaian Google — Google tidak memberi konversi per headline, jadi ATLAS tidak mengklaimnya.
        </p>
      </div>
      <MessageMatchSection rows={report.cur.messageMatch ?? []} f={f} />
      <LandingPageSection report={report} f={f} p2={p2} />
    </>
  );
}

function AssetList({ title, items }: { title: string; items: { text: string; pinned: string | null; label: string | null }[] }) {
  const [copied, setCopied] = useState('');
  async function copy(t: string) {
    await navigator.clipboard.writeText(t);
    setCopied(t);
    window.setTimeout(() => setCopied(''), 1500);
  }
  return (
    <div>
      <h5>{title} ({items.length})</h5>
      <ul className="gads-assets">
        {items.map((a) => (
          <li key={a.text}>
            <span>{a.text}</span>
            <span className="gads-asset-meta">{a.text.length} kar.{a.pinned ? ` · pin ${a.pinned.replace(/_/g, ' ').toLowerCase()}` : ''}{a.label && a.label !== 'UNSPECIFIED' && a.label !== 'UNKNOWN' ? ` · ${humanEnum(a.label)}` : ''}</span>
            <button type="button" className="gads-icon-btn" onClick={() => copy(a.text)} aria-label={`Salin ${a.text}`}>{copied === a.text ? <Check size={13} /> : <Copy size={13} />}</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AdDetail({ ad, copy }: { ad: GadsAd; copy?: CopyContext }) {
  return (
    <div className="sec-inner gads-ad-detail">
      {copy && <AdCopySuggestions key={`${ad.customer_id}|${ad.ad_group_id}`} ad={ad} copy={copy} />}
      <p className="gads-kpi-label">{ad.campaign_name} › {ad.ad_group_name}{ad.final_urls?.[0] ? ` · ${ad.final_urls[0]}` : ''}{ad.path1 ? ` · /${ad.path1}${ad.path2 ? `/${ad.path2}` : ''}` : ''}</p>
      {ad.headlines?.length || ad.descriptions?.length ? (
        <div className="gads-ad-grid">
          <AssetList title="Headline" items={ad.headlines ?? []} />
          <AssetList title="Description" items={ad.descriptions ?? []} />
        </div>
      ) : <p className="empty-note">Teks iklan tidak tersedia (bukan Responsive Search Ad, atau iklan sudah dihapus).</p>}
    </div>
  );
}

// Gemini's headline/description ideas for the ad's ad group, already
// checked against Google's limits by the backend. Copy-and-paste only.
function AdCopySuggestions({ ad, copy }: { ad: GadsAd; copy: CopyContext }) {
  const [data, setData] = useState<GadsAdCopy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  async function run() {
    setBusy(true); setError('');
    try { setData(await fetchAdCopy(copy.clientId, ad, copy.range)); } catch (err) { setError(apiError(err, 'Gagal membuat saran copy')); } finally { setBusy(false); }
  }
  async function put(t: string) {
    await navigator.clipboard.writeText(t);
    setCopied(t);
    window.setTimeout(() => setCopied(''), 1500);
  }
  const list = (title: string, items: GadsAdCopy['headlines'], max: number) => (
    <div>
      <h5>{title} ({items.length})<button type="button" className="gads-link gads-copy-all" onClick={() => put(items.map((i) => i.text).join('\n'))}>{copied === items.map((i) => i.text).join('\n') ? 'Tersalin' : 'Salin semua'}</button></h5>
      <ul className="gads-assets">
        {items.map((i) => (
          <li key={i.text} title={i.rationale ?? undefined}>
            <span>{i.text}{i.rationale && <small className="gads-copy-why">{i.rationale}</small>}</span>
            <span className="gads-asset-meta">{i.length}/{max}{i.has_keyword ? ' · memuat keyword' : ''}</span>
            <button type="button" className="gads-icon-btn" onClick={() => put(i.text)} aria-label={`Salin ${i.text}`}>{copied === i.text ? <Check size={13} /> : <Copy size={13} />}</button>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="gads-copy-box">
      <div className="gads-opt-bar" style={{ marginBottom: data ? '.7rem' : 0 }}>
        <span className="gads-kpi-label">Saran copy AI · ad group {ad.ad_group_name}</span>
        <button type="button" className="btn btn-ghost dt-btn-sm" onClick={run} disabled={busy}>
          {busy ? <Loader2 size={13} className="rg-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />} {data ? 'Buat ulang' : 'Buat saran headline & description'}
        </button>
      </div>
      {error && <p className="gads-error">{error}</p>}
      {data && (
        <>
          <div className="gads-ad-grid">
            {list('Headline baru', data.headlines, 30)}
            {list('Description baru', data.descriptions, 90)}
          </div>
          {data.notes.length > 0 && <ul className="gads-alert-list" style={{ marginTop: '.7rem' }}>{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
          <p className="gads-footnote is-inline">
            Disusun Gemini dari keyword, search term yang berkonversi, dan aset iklan ad group ini; batas karakter dan aturan tanda seru sudah dicek.
            {data.dropped.length > 0 && ` ${data.dropped.length} usulan dibuang (${[...new Set(data.dropped.map((d) => d.reason))].join(', ')}).`}
            {' '}Tidak ada klaim performa per headline. Tempel manual di Google Ads setelah direview.
          </p>
        </>
      )}
    </div>
  );
}

function MessageMatchSection({ rows, f }: { rows: GadsMessageMatch[]; f: Formatter }) {
  if (!rows.length) return null;
  const columns: GadsColumn<GadsMessageMatch>[] = [
    { key: 'ad_group_name', label: 'Ad group', align: 'left', value: (r) => r.ad_group_name },
    { key: 'campaign_name', label: 'Campaign', align: 'left', value: (r) => r.campaign_name },
    { key: 'cost', label: 'Cost keyword', value: (r) => r.cost, render: (r) => f.money(r.cost) },
    { key: 'headline_match', label: 'Keyword di headline', value: (r) => r.headline_match, render: (r) => f.pct(r.headline_match) },
    { key: 'url_match', label: 'Keyword di URL', value: (r) => r.url_match, render: (r) => f.pct(r.url_match) },
    { key: 'missing', label: 'Belum ada di headline', align: 'left', value: (r) => r.missing_in_headlines.join(', ') || '—' },
    { key: 'flag', label: 'Catatan', align: 'left', value: (r) => r.flag ?? '—' },
  ];
  return (
    <div className="sec-block">
      <Heading title="Kecocokan Keyword · Iklan · Landing Page" badge="dibobot biaya keyword" />
      <GoogleAdsTable columns={columns} rows={rows} sortKey="cost" limit={TABLE_ROWS} />
      <p className="gads-footnote">Pemeriksaan teks: kata keyword dicari di headline dan di path URL tujuan. ATLAS tidak membaca isi halaman, jadi skor URL rendah adalah ajakan memeriksa halaman, bukan penilaian halaman.</p>
    </div>
  );
}

function LandingPageSection({ report, f, p2 }: { report: GadsReport; f: Formatter; p2: string }) {
  const lp = report.cur.landingPages;
  if (!lp) return null;
  if (!lp.pages.length) return <EmptyBlock title="Landing Page">Tidak ada data landing page pada periode ini.</EmptyBlock>;
  const columns: GadsColumn<GadsLandingPage>[] = [
    { key: 'url', label: 'Landing page', align: 'left', value: (r) => r.url, render: (r) => <span className="gads-url">{r.url.replace(/^https?:\/\//, '')}{r.variants > 1 ? <small> · {r.variants} varian URL</small> : null}</span> },
    { key: 'clicks', label: 'Clicks', value: (r) => r.clicks, render: (r) => f.int(r.clicks) },
    { key: 'cost', label: 'Cost', value: (r) => r.cost, render: (r) => f.money(r.cost) },
    { key: 'ctr', label: 'CTR', value: (r) => r.ctr, render: (r) => f.pct(r.ctr) },
    ...(lp.conversions_available ? [
      { key: 'conversions', label: 'Conv.', value: (r: GadsLandingPage) => r.conversions, render: (r: GadsLandingPage) => f.dec(r.conversions) },
      { key: 'cvr', label: 'CVR', value: (r: GadsLandingPage) => r.cvr, render: (r: GadsLandingPage) => f.pct(r.cvr) },
      { key: 'cost_per_conv', label: 'CPA', value: (r: GadsLandingPage) => r.cost_per_conv, render: (r: GadsLandingPage) => f.money(r.cost_per_conv) },
    ] : []),
    { key: 'flags', label: 'Catatan', align: 'left', value: (r) => r.flags.join(', ') || '—' },
  ];
  return (
    <div className="sec-block">
      <Heading title="Landing Page" badge={`${p2} · ${lp.totals.pages} halaman`} />
      <GoogleAdsTable columns={columns} rows={lp.pages} sortKey="clicks" limit={TABLE_ROWS} />
      <p className="gads-footnote">
        URL digabung tanpa parameter (varian produk, UTM).{lp.others ? ` ${lp.others.pages} halaman lain (${f.int(lp.others.clicks)} klik, ${f.money(lp.others.cost)}) tidak dicantumkan satu per satu.` : ''}
        {lp.note ? ` ${lp.note}` : ''}{!lp.speed_available ? ' Google tidak mengirim speed score — uji kecepatan di PageSpeed Insights.' : ''}
      </p>
    </div>
  );
}

// ── Conversion analysis ─────────────────────────────────────────────
const GOAL_TONE: Record<GoalKey, Tone> = { purchase: 'good', lead: 'info', micro: 'neutral', other: 'warn', ignore: 'neutral' };

export function ConversionSection({ report, f, p1, p2 }: { report: GadsReport; f: Formatter; p1: string; p2: string }) {
  const [openAction, setOpenAction] = useState<string | null>(null);
  const actions = report.cur.conversionActions;
  const g = report.cur.goals;
  if (!actions || !g) return <EmptyBlock title="Conversion Analysis">{NOT_YET}</EmptyBlock>;
  if (!actions.length) return <EmptyBlock title="Conversion Analysis">Tidak ada konversi tercatat pada periode ini.</EmptyBlock>;
  const oldBy = new Map((report.old.conversionActions ?? []).map((a) => [`${a.customer_id}|${a.conversion_action_id}`, a]));
  const cost = report.cur.totals.cost;
  const totalAll = actions.reduce((a, x) => a + x.all_conversions, 0);
  const columns: GadsColumn<GadsConversionAction>[] = [
    { key: 'name', label: 'Conversion action', align: 'left', value: (r) => r.name, render: (r) => <button type="button" className="gads-link" onClick={() => setOpenAction(openAction === r.conversion_action_id ? null : r.conversion_action_id)}>{r.name}</button> },
    { key: 'category', label: 'Kategori', align: 'left', value: (r) => humanEnum(r.category) },
    { key: 'goal', label: 'Tujuan', align: 'left', value: (r) => GOAL_LABELS[r.goal], render: (r) => <><Tag tone={GOAL_TONE[r.goal]}>{GOAL_LABELS[r.goal]}</Tag>{r.goal_source === 'default' && <small className="gads-unverified" title="Pemetaan bawaan dari kategori Google — verifikasi di Data Brand"> belum diverifikasi</small>}</> },
    { key: 'primary', label: 'Dihitung di Conversions', align: 'left', value: (r) => (r.primary == null ? '—' : r.primary ? 'Primer' : 'Sekunder') },
    { key: 'conversions', label: 'Conversions', value: (r) => r.conversions, render: (r) => f.dec(r.conversions) },
    { key: 'old', label: `vs ${p1}`, value: (r) => oldBy.get(`${r.customer_id}|${r.conversion_action_id}`)?.all_conversions ?? null, render: (r) => { const o = oldBy.get(`${r.customer_id}|${r.conversion_action_id}`); const d = computeDelta(o?.all_conversions ?? null, r.all_conversions); return <DeltaPill cls={deltaClassForSentiment(d.deltaNum, 'higher-better')} size="sm">{d.deltaStr}</DeltaPill>; } },
    { key: 'all_conversions', label: 'All conv.', value: (r) => r.all_conversions, render: (r) => f.dec(r.all_conversions) },
    { key: 'share', label: 'Porsi all conv.', value: (r) => (totalAll ? r.all_conversions / totalAll : null), render: (r) => f.pct(totalAll ? r.all_conversions / totalAll : null) },
    { key: 'value', label: 'Nilai', value: (r) => r.all_conversions_value, render: (r) => f.money(r.all_conversions_value) },
    { key: 'cpa', label: 'Biaya akun / action', value: (r) => (r.all_conversions ? cost / r.all_conversions : null), render: (r) => f.money(r.all_conversions ? cost / r.all_conversions : null) },
  ];
  const detail = actions.find((a) => a.conversion_action_id === openAction);
  const goalCards: [GoalKey, string][] = [['purchase', 'Purchase'], ['lead', 'Leads'], ['micro', 'Micro conversions']];
  return (
    <div className="sec-block">
      <Heading title="Conversion Analysis" badge={`${p2} · per conversion action`} />
      <div className="sec-inner">
        <div className="gads-stat-row">
          {goalCards.map(([k, label]) => (
            <div key={k} className="gads-stat">
              <span>{label}</span>
              <strong>{f.dec(k === 'micro' ? g[k].all_conversions : g[k].conversions)}</strong>
              <small>{k === 'micro' ? 'all conv. (sekunder)' : g[k].conversions === 0 && g[k].all_conversions > 0 ? `0 primer · ${f.dec(g[k].all_conversions)} sekunder` : `${f.money(g[k].blended_cost_per_result ?? null)} per hasil`}</small>
            </div>
          ))}
        </div>
      </div>
      <GoogleAdsTable columns={columns} rows={actions} sortKey="all_conversions" limit={TABLE_ROWS} />
      {detail && (
        <div className="sec-inner">
          <h5 className="gads-sub">Kontribusi campaign · {detail.name}</h5>
          <table className="kpi-table gads-mini-table"><thead><tr><th className="is-left">Campaign</th><th>Conversions</th><th>All conv.</th><th>Nilai</th></tr></thead><tbody>
            {[...detail.campaigns].sort((a, b) => b.all_conversions - a.all_conversions).map((c) => <tr key={c.campaign_id}><td className="is-left">{c.campaign_name}</td><td>{f.dec(c.conversions)}</td><td>{f.dec(c.all_conversions)}</td><td>{f.money(c.conversions_value)}</td></tr>)}
          </tbody></table>
        </div>
      )}
      <p className="gads-footnote">
        "Primer" = dihitung di kolom Conversions Google Ads pada periode ini; "Sekunder" = hanya di All conversions. "Biaya akun / action" membagi seluruh biaya akun dengan action itu — bukan biaya yang khusus dikeluarkan untuknya.
        Angka adalah jumlah event; ATLAS tidak menghitung funnel per pengguna.
      </p>
    </div>
  );
}

// ── Device & time ───────────────────────────────────────────────────
const DEVICE_LABEL: Record<string, string> = { MOBILE: 'Mobile', DESKTOP: 'Desktop', TABLET: 'Tablet', CONNECTED_TV: 'TV', OTHER: 'Lainnya', UNKNOWN: 'Tidak diketahui' };
const DOW = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
type HeatMetric = 'clicks' | 'conversions' | 'cost';

export function DeviceTimeSection({ report, f, p2 }: { report: GadsReport; f: Formatter; p2: string }) {
  const [metric, setMetric] = useState<HeatMetric>('clicks');
  const dev = report.cur.devices;
  const sched = report.cur.schedule;
  if (!dev && !sched) return <EmptyBlock title="Device & Waktu">{NOT_YET}</EmptyBlock>;
  const oldDev = new Map((report.old.devices?.devices ?? []).map((d) => [d.device, d]));
  const devCols = [
    { key: 'device', label: 'Device', align: 'left' as const, value: (r: NonNullable<typeof dev>['devices'][number]) => DEVICE_LABEL[r.device] ?? r.device },
    { key: 'cost', label: 'Cost', value: (r: NonNullable<typeof dev>['devices'][number]) => r.cost, render: (r: NonNullable<typeof dev>['devices'][number]) => f.money(r.cost) },
    { key: 'cost_share', label: 'Porsi cost', value: (r: NonNullable<typeof dev>['devices'][number]) => r.cost_share, render: (r: NonNullable<typeof dev>['devices'][number]) => f.pct(r.cost_share) },
    { key: 'conversion_share', label: 'Porsi konversi', value: (r: NonNullable<typeof dev>['devices'][number]) => r.conversion_share, render: (r: NonNullable<typeof dev>['devices'][number]) => f.pct(r.conversion_share) },
    { key: 'clicks', label: 'Clicks', value: (r: NonNullable<typeof dev>['devices'][number]) => r.clicks, render: (r: NonNullable<typeof dev>['devices'][number]) => f.int(r.clicks) },
    { key: 'ctr', label: 'CTR', value: (r: NonNullable<typeof dev>['devices'][number]) => r.ctr, render: (r: NonNullable<typeof dev>['devices'][number]) => f.pct(r.ctr) },
    { key: 'avg_cpc', label: 'Avg. CPC', value: (r: NonNullable<typeof dev>['devices'][number]) => r.avg_cpc, render: (r: NonNullable<typeof dev>['devices'][number]) => f.money(r.avg_cpc) },
    { key: 'cvr', label: 'CVR', value: (r: NonNullable<typeof dev>['devices'][number]) => r.cvr, render: (r: NonNullable<typeof dev>['devices'][number]) => f.pct(r.cvr) },
    { key: 'cost_per_conv', label: 'CPA', value: (r: NonNullable<typeof dev>['devices'][number]) => r.cost_per_conv, render: (r: NonNullable<typeof dev>['devices'][number]) => f.money(r.cost_per_conv) },
    {
      key: 'cpa_change', label: 'CPA vs periode lalu', value: (r: NonNullable<typeof dev>['devices'][number]) => r.cost_per_conv,
      render: (r: NonNullable<typeof dev>['devices'][number]) => { const d = computeDelta(oldDev.get(r.device)?.cost_per_conv ?? null, r.cost_per_conv); return <DeltaPill cls={deltaClassForSentiment(d.deltaNum, 'lower-better')} size="sm">{d.deltaStr}</DeltaPill>; },
    },
    { key: 'flags', label: 'Catatan', align: 'left' as const, value: (r: NonNullable<typeof dev>['devices'][number]) => r.flags.join(', ') || '—' },
  ];
  const max = sched ? Math.max(0, ...sched.grid.map((c) => c[metric])) : 0;
  const cell = (dow: number, hour: number) => sched?.grid.find((c) => c.dow === dow && c.hour === hour);
  return (
    <>
      {dev && (
        <div className="sec-block">
          <Heading title="Performa per Device" badge={p2} />
          <GoogleAdsTable columns={devCols} rows={dev.devices} sortKey="cost" />
          {dev.bid_adjustment_note && <p className="gads-footnote">{dev.bid_adjustment_note}</p>}
        </div>
      )}
      {sched && (
        <div className="sec-block">
          <Heading title="Hari × Jam" badge={`${p2} · zona waktu akun`} excel={false} />
          <div className="sec-inner">
            <SegmentedToggle label="Warna menurut" value={metric} onChange={setMetric} accent="var(--google)"
              options={[{ value: 'clicks', label: 'Clicks' }, { value: 'conversions', label: 'Conversions' }, { value: 'cost', label: 'Cost' }]} />
            <div className="gads-heat-scroll">
              <table className="gads-heat">
                <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {DOW.map((d, i) => (
                    <tr key={d}>
                      <th>{d}</th>
                      {Array.from({ length: 24 }, (_, h) => {
                        const c = cell(i + 1, h);
                        const v = c?.[metric] ?? 0;
                        const a = max ? v / max : 0;
                        return (
                          <td key={h} style={v ? { background: `rgba(26,115,232,${0.08 + a * 0.82})`, color: a > 0.55 ? '#fff' : undefined } : undefined}
                            title={`${d} ${h}:00 — ${f.int(c?.clicks ?? 0)} klik, ${f.dec(c?.conversions ?? 0)} konversi, ${f.money(c?.cost ?? 0)}`}>
                            {v ? (metric === 'cost' ? f.moneyShort(v) : f.dec(v)) : ''}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="gads-stat-row" style={{ marginTop: '1rem' }}>
              <div className="gads-stat"><span>Jam traffic tertinggi</span><strong>{sched.top_by_clicks.map((h) => `${h}:00`).join(', ') || '—'}</strong></div>
              <div className="gads-stat"><span>Jam konversi terbanyak</span><strong>{sched.top_by_conversions.map((h) => `${h}:00`).join(', ') || '—'}</strong></div>
              <div className="gads-stat">
                <span>Jam kurang efisien</span>
                <strong>{sched.data_sufficient ? (sched.underperforming_hours.map((h) => `${h.hour}:00`).join(', ') || 'Tidak ada') : '—'}</strong>
                <small>{sched.support.conversions.toLocaleString('id-ID', { maximumFractionDigits: 1 })} konversi · {sched.support.days} hari data</small>
              </div>
            </div>
            {sched.note && <p className="gads-footnote is-inline">{sched.note}</p>}
          </div>
        </div>
      )}
    </>
  );
}
