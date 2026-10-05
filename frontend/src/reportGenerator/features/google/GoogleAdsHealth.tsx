import { createContext, useContext, useState, type ReactNode } from 'react';
import { Check, Info } from 'lucide-react';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { SectionExcelButton } from '../../components/SectionExcelButton';
import { GoogleAdsTable, type GadsColumn } from './GoogleAdsTable';
import { apiError, optimizationApi, type DqStatus, type FeedbackVerdict, type Formatter, type GadsReport } from './googleAds';

// Production-hardening pieces of the Google Ads report: the internal /
// client view switch, confidence badges, feedback for rule calibration,
// account / tracking / data health, and the landing-page experience view.

// ── view & report context ───────────────────────────────────────────
// Internal: confidence, rule versions, possible causes, data-quality
// detail, feedback buttons. Client: findings, impact, next action and
// monitoring plan, in hedged language — important limitations stay.
export type ReportView = 'internal' | 'client';
export interface ReportCtxValue { view: ReportView; clientId: number | null; period: { start: string; end: string } | null; rulesetVersion?: string }
export const ReportCtx = createContext<ReportCtxValue>({ view: 'internal', clientId: null, period: null });
export const useReportCtx = () => useContext(ReportCtx);

type Tone = 'good' | 'bad' | 'warn' | 'neutral' | 'info';
const Tag = ({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) => <span className={`gads-tag is-${tone}`} title={title}>{children}</span>;

// ── confidence ──────────────────────────────────────────────────────
const CONF_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;
const CONF_TONE = { high: 'good', medium: 'info', low: 'warn' } as const;
export const CONFIDENCE_HELP = 'Confidence menunjukkan seberapa kuat data mendukung diagnosis ini.';

export function ConfidenceBadge({ level, score, reasons, monitoring }: { level?: 'high' | 'medium' | 'low'; score?: number; reasons?: string[]; monitoring?: boolean }) {
  if (monitoring) {
    return <Tag tone="neutral" title={[CONFIDENCE_HELP, ...(reasons ?? [])].join('\n')}>Needs more data</Tag>;
  }
  if (!level) return null;
  return (
    <Tag tone={CONF_TONE[level]} title={[CONFIDENCE_HELP, score != null ? `Skor ${score}/100` : '', ...(reasons ?? [])].filter(Boolean).join('\n')}>
      {CONF_LABEL[level]}{score != null ? ` · ${score}` : ''}
    </Tag>
  );
}

// ── feedback (internal only) ─────────────────────────────────────────
const VERDICTS: [FeedbackVerdict, string][] = [['useful', 'Useful'], ['not_useful', 'Not useful'], ['false_positive', 'False positive'], ['needs_more_data', 'Needs more data']];

export function FeedbackButtons({ targetType, targetKey, ruleType }: { targetType: 'finding' | 'recommendation' | 'alert'; targetKey: string; ruleType: string }) {
  const { view, clientId, period, rulesetVersion } = useReportCtx();
  const [saved, setSaved] = useState<FeedbackVerdict | null>(null);
  const [error, setError] = useState('');
  if (view !== 'internal' || !clientId) return null;
  async function send(verdict: FeedbackVerdict) {
    setError('');
    try {
      await optimizationApi.feedback(clientId as number, { target_type: targetType, target_key: targetKey, rule_type: ruleType, verdict, period_start: period?.start, period_end: period?.end });
      setSaved(verdict);
    } catch (err) { setError(apiError(err, 'Gagal menyimpan')); }
  }
  return (
    <div className="gads-feedback" title={`Feedback internal untuk kalibrasi aturan ${rulesetVersion ?? ''}`}>
      <span>Review:</span>
      {VERDICTS.map(([v, l]) => (
        <button key={v} type="button" className={`gads-feedback-btn${saved === v ? ' is-on' : ''}`} onClick={() => send(v)} disabled={Boolean(saved)}>
          {saved === v && <Check size={11} aria-hidden />} {l}
        </button>
      ))}
      {error && <small className="gads-error">{error}</small>}
    </div>
  );
}

// ── health & data quality ───────────────────────────────────────────
const DQ_TONE: Record<DqStatus, Tone> = { VALID: 'good', PARTIAL: 'warn', STALE: 'warn', INCONSISTENT: 'bad', MISSING: 'neutral', UNVERIFIED: 'info' };
const DQ_LABEL: Record<DqStatus, string> = { VALID: 'Valid', PARTIAL: 'Sebagian', STALE: 'Usang', INCONSISTENT: 'Tidak konsisten', MISSING: 'Tidak ada', UNVERIFIED: 'Belum terverifikasi' };
export const DATASET_NAME: Record<string, string> = {
  campaign: 'Campaign', ad_group: 'Ad group', ad_groups: 'Ad group', keyword: 'Keyword', search_term: 'Search term', city: 'Kota', ads: 'Iklan',
  conversions: 'Konversi per action', competitive: 'Impression share', devices: 'Device', hourly: 'Per jam', landing_pages: 'Landing page',
  change_history: 'Change history', campaign_settings: 'Setting campaign', conversion_actions: 'Conversion action', keyword_quality: 'Quality Score',
  ad_assets: 'Teks iklan', auction_insights: 'Auction insights (unggah manual)',
};
const PART_LABEL: Record<string, string> = { tracking: 'Tracking konversi', freshness: 'Kesegaran data', sync: 'Keandalan sinkron', configuration: 'Konfigurasi konversi', diagnostics: 'Tingkat temuan', alerts: 'Alert kritis terbuka' };
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const dayText = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—');

export function HealthSection({ report, f }: { report: GadsReport; f: Formatter }) {
  const { view } = useReportCtx();
  const ah = report.accountHealth;
  const th = report.trackingHealth;
  const dq = report.dataQuality;
  if (!ah || !th || !dq) return null;
  const tone: Tone = ah.score >= 80 ? 'good' : ah.score >= 60 ? 'warn' : 'bad';
  if (view === 'client') {
    // Clients see the limitations that change how to read the report, not the machinery.
    const limits: string[] = [
      ...(!th.account.healthy ? ['Tracking konversi perlu diperbaiki — angka konversi di laporan ini belum dapat dipercaya penuh.'] : []),
      ...(dq.summary.conversionIssue ? [dq.summary.conversionIssue] : []),
    ];
    // Partial (dates missing) and inconsistent (totals disagree) say different things.
    const named = (st: DqStatus[]) => Object.entries(dq.datasets).filter(([d, v]) => st.includes(v) && !(d === 'conversions' && dq.summary.conversionIssue)).map(([d]) => DATASET_NAME[d] ?? d);
    const partial = named(['PARTIAL', 'MISSING']);
    const inconsistent = named(['INCONSISTENT']);
    if (partial.length) limits.push(`Data ${partial.join(', ')} belum mencakup seluruh periode.`);
    if (inconsistent.length) limits.push(`Total ${inconsistent.join(', ')} belum cocok dengan total campaign — analisis berdasarkan data tersebut bersifat indikatif.`);
    if (!limits.length) return null;
    return (
      <div className="sec-block">
        <div className="sec-heading google-heading">Catatan Data</div>
        <div className="sec-inner"><ul className="gads-alert-list">{limits.map((l) => <li key={l}>{l}</li>)}</ul></div>
      </div>
    );
  }
  const checks = dq.checks.filter((c) => c.check_key.startsWith('cost:') || c.check_key.startsWith('conversions:'));
  const fresh = Object.values(report.freshness ?? {});
  return (
    <div className="sec-block">
      <div className="sec-heading google-heading">Kesehatan Akun &amp; Data <span className="sec-badge">internal · {report.rulesetVersion}</span><SectionDownloadButton /></div>
      <div className="sec-inner">
        <div className="gads-health-grid">
          <div className={`gads-health-score is-${tone}`}>
            <span>Account Health</span>
            <strong>{ah.score}<small>/100</small></strong>
            <Tag tone={tone}>{ah.label}</Tag>
            <ul>{Object.entries(ah.parts).map(([k, v]) => <li key={k}><span>{PART_LABEL[k] ?? k}</span><b>{v}</b><i style={{ width: `${v}%` }} /></li>)}</ul>
            <p className="gads-footnote is-inline">Ringkasan internal, bukan dasar keputusan tunggal — lihat rinciannya.</p>
          </div>
          <div>
            <h4>Conversion Tracking Health · {th.account.score}/100 <Tag tone={th.account.healthy ? 'good' : 'bad'}>{th.account.healthy ? 'Sehat' : 'Bermasalah'}</Tag></h4>
            {th.account.deductions.length ? <ul className="gads-alert-list">{th.account.deductions.map((d) => <li key={d.reason}>−{d.points} · {d.reason}</li>)}</ul> : <p className="empty-note">Tidak ada aturan tracking yang terpicu.</p>}
            {th.campaigns.filter((c) => !c.healthy).length > 0 && (
              <table className="kpi-table gads-mini-table" style={{ marginTop: '.6rem' }}><thead><tr><th className="is-left">Campaign</th><th className="is-left">Bidding</th><th>Skor</th><th className="is-left">Alasan</th></tr></thead><tbody>
                {th.campaigns.filter((c) => !c.healthy).map((c) => <tr key={c.campaign_id}><td className="is-left">{c.campaign_name}</td><td className="is-left">{c.bidding ?? '—'}</td><td>{c.score}</td><td className="is-left">{c.deductions.map((d) => d.reason).join('; ')}</td></tr>)}
              </tbody></table>
            )}
            <h4 style={{ marginTop: '1rem' }}>Rekonsiliasi data periode ini</h4>
            {checks.length ? (
              <table className="kpi-table gads-mini-table"><thead><tr><th className="is-left">Pemeriksaan</th><th>Campaign</th><th>Dataset</th><th>Selisih</th><th className="is-left">Status</th></tr></thead><tbody>
                {checks.map((c) => (
                  <tr key={c.check_key} title={c.note ?? undefined}>
                    <td className="is-left">{DATASET_NAME[c.dataset] ?? c.dataset} · {c.check_key.startsWith('cost') ? 'biaya' : 'konversi'}</td>
                    <td>{c.check_key.startsWith('cost') ? f.money(c.expected) : f.dec(c.expected)}</td>
                    <td>{c.observed == null ? '—' : c.check_key.startsWith('cost') ? f.money(c.observed) : f.dec(c.observed)}</td>
                    <td>{c.rel_diff == null ? '—' : `${(c.rel_diff * 100).toFixed(2)}%`}</td>
                    <td className="is-left"><Tag tone={DQ_TONE[c.status]}>{DQ_LABEL[c.status]}</Tag></td>
                  </tr>
                ))}
              </tbody></table>
            ) : <p className="empty-note">Belum ada dataset untuk direkonsiliasi pada periode ini.</p>}
            {dq.mixedCurrency && <p className="gads-error">Akun memakai lebih dari satu mata uang — total dan CPA gabungan tidak dihitung.</p>}
          </div>
        </div>
        <h4 style={{ marginTop: '1.1rem' }}>Kesegaran data per dataset</h4>
        <div className="gads-fresh-grid">
          {fresh.map((x) => (
            <div key={x.dataset} className="gads-fresh">
              <span>{DATASET_NAME[x.dataset] ?? x.dataset}</span>
              <b>{x.kind === 'manual' ? `Unggah ${dt(x.fetched_at)}` : x.last_date ? `s.d. ${dayText(x.last_date)}` : dt(x.fetched_at)}</b>
              <small>{x.kind === 'manual' ? `periode ${dayText(x.last_date)}` : `diperbarui ${dt(x.fetched_at)}`}</small>
              <Tag tone={DQ_TONE[x.status]}>{DQ_LABEL[x.status]}</Tag>
            </div>
          ))}
        </div>
        <p className="gads-footnote is-inline">
          <Info size={11} aria-hidden /> Toleransi: ≤ 1% dianggap variasi pelaporan Google, 1–5% belum terverifikasi, &gt; 5% tidak konsisten. Data tidak dinormalisasi agar cocok —
          selisih ditampilkan apa adanya dan menurunkan confidence diagnosis yang bergantung padanya.
        </p>
      </div>
    </div>
  );
}

// ── landing page experience by final URL ─────────────────────────────
type LpRow = NonNullable<GadsReport['cur']['landingPageQuality']>['pages'][number];

export function LandingPageOpportunity({ report, f }: { report: GadsReport; f: Formatter }) {
  const q = report.cur.landingPageQuality;
  if (!q || !q.summary.scored) return null;
  const columns: GadsColumn<LpRow>[] = [
    { key: 'url', label: 'Final URL', align: 'left', value: (r) => r.url, render: (r) => <span className="gads-url">{r.url.replace(/^https?:\/\//, '')}</span> },
    { key: 'keywords', label: 'Keyword ber-QS', value: (r) => r.keywords },
    { key: 'below', label: 'Di bawah rata-rata', value: (r) => r.below },
    { key: 'average', label: 'Rata-rata', value: (r) => r.average },
    { key: 'above', label: 'Di atas rata-rata', value: (r) => r.above },
    { key: 'cost', label: 'Cost keyword', value: (r) => r.cost, render: (r) => f.money(r.cost) },
    { key: 'opp', label: 'Catatan', align: 'left', value: (r) => (r.opportunity ? 1 : 0), render: (r) => (r.opportunity ? <Tag tone="warn">Landing Page Opportunity</Tag> : '—') },
    { key: 'examples', label: 'Contoh keyword', align: 'left', value: (r) => r.examples.join(', ') || '—' },
  ];
  const s = q.summary;
  return (
    <div className="sec-block">
      <div className="sec-heading google-heading">Landing Page Experience per URL <span className="sec-badge">{s.below} dari {s.scored} keyword di bawah rata-rata</span><SectionExcelButton /><SectionDownloadButton /></div>
      <div className="sec-inner">
        <div className="gads-stat-row">
          <div className="gads-stat"><span>Keyword ber-Quality Score</span><strong>{s.scored}</strong><small>{s.unscored} belum punya skor</small></div>
          <div className="gads-stat"><span>Di bawah rata-rata</span><strong>{s.below}</strong></div>
          <div className="gads-stat"><span>Rata-rata</span><strong>{s.average}</strong></div>
          <div className="gads-stat"><span>Di atas rata-rata</span><strong>{s.above}</strong></div>
        </div>
      </div>
      <GoogleAdsTable columns={columns} rows={q.pages} sortKey="below" limit={10} />
      <p className="gads-footnote">
        Banyak keyword yang mengarah ke halaman bertanda "Landing Page Opportunity" memiliki Landing Page Experience di bawah rata-rata menurut Google Ads.
        Ini penilaian Google, bukan audit teknis halaman — perlu diperiksa kecepatan, kecocokan isi dengan keyword, dan kemudahan memesan.
      </p>
    </div>
  );
}
