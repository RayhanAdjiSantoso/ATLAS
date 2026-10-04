import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { BellRing, Check, ClipboardList, FlaskConical, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import {
  apiError, optimizationApi, type ExpMetric, type Formatter, type GadsAlert, type GadsExperiment, type GadsRecommendation, type GadsReport,
  type PeriodPair, type RecStatus, type Severity,
} from './googleAds';
import { SEVERITY_LABEL } from './GoogleAdsInsights';

// AI Optimization Center, experiment tracker and alerts. Everything here is
// a record or a proposal: ATLAS never changes the Google Ads account, the
// team does, by hand, and records what it did.

type Tone = 'good' | 'bad' | 'warn' | 'neutral' | 'info';
const Tag = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => <span className={`gads-tag is-${tone}`}>{children}</span>;
const SEVERITY_TONE: Record<Severity, Tone> = { critical: 'bad', high: 'warn', medium: 'info', low: 'neutral' };
const dateText = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dayText = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—');

// ── Alerts ──────────────────────────────────────────────────────────
export function AlertsPanel({ clientId, compact = false }: { clientId: number; compact?: boolean }) {
  const [alerts, setAlerts] = useState<GadsAlert[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    setAlerts(null);
    optimizationApi.alerts(clientId).then(setAlerts).catch((err) => setError(apiError(err, 'Gagal memuat alert')));
  }, [clientId]);

  async function set(a: GadsAlert, status: GadsAlert['status']) {
    setBusy(a.id);
    try { setAlerts(await optimizationApi.setAlert(clientId, a.id, status)); } catch (err) { setError(apiError(err, 'Gagal menyimpan')); } finally { setBusy(null); }
  }

  if (error) return <p className="gads-footnote is-inline">{error}</p>;
  if (!alerts) return compact ? null : <p className="empty-note"><Loader2 size={13} className="rg-spin" /> Memuat alert…</p>;
  if (!alerts.length) return compact ? null : <p className="empty-note">Tidak ada alert aktif.</p>;
  return (
    <div className={`gads-alert-panel${compact ? ' is-compact' : ''}`}>
      {compact && <h4><BellRing size={14} aria-hidden /> Alert Google Ads ({alerts.length})</h4>}
      <ul>
        {alerts.map((a) => (
          <li key={a.id} className={a.status === 'acknowledged' ? 'is-ack' : ''}>
            <Tag tone={SEVERITY_TONE[a.severity]}>{SEVERITY_LABEL[a.severity]}</Tag>
            <div className="gads-alert-text">
              <strong>{a.title}</strong>
              <span>{a.message}</span>
              <small>Sejak {dateText(a.first_seen_at)}{a.status === 'acknowledged' ? ' · sudah dibaca' : ''}</small>
            </div>
            <div className="gads-alert-actions">
              {a.status === 'open' && <button type="button" className="btn btn-ghost dt-btn-sm" disabled={busy === a.id} onClick={() => set(a, 'acknowledged')}>Tandai dibaca</button>}
              <button type="button" className="btn btn-ghost dt-btn-sm" disabled={busy === a.id} onClick={() => set(a, 'resolved')}>Selesai</button>
            </div>
          </li>
        ))}
      </ul>
      {!compact && <p className="gads-footnote is-inline">Alert dievaluasi ulang setiap sinkron dan saat halaman ini dibuka. Alert yang ditandai selesai tidak muncul lagi selama 3 hari meski kondisinya masih terjadi.</p>}
    </div>
  );
}

// ── AI Optimization Center ──────────────────────────────────────────
export const REC_STATUS_LABEL: Record<RecStatus, string> = {
  new: 'Baru', reviewed: 'Ditinjau', planned: 'Direncanakan', in_progress: 'Dikerjakan', monitoring: 'Dipantau', completed: 'Selesai', dismissed: 'Diabaikan',
};
const CATEGORY_LABEL: Record<string, string> = {
  tracking: 'Tracking', budget: 'Budget', bidding: 'Bidding', keywords: 'Keyword', search_terms: 'Search term', ads: 'Iklan', landing_page: 'Landing page',
  targeting: 'Targeting', schedule: 'Jadwal', device: 'Device', structure: 'Struktur', other: 'Lainnya',
};
const CONFIDENCE_LABEL = { high: 'Keyakinan tinggi', medium: 'Keyakinan sedang', low: 'Keyakinan rendah' };
type RecFilter = 'active' | 'done' | 'dismissed';

export function OptimizationCenter({ clientId, range, onExperiment }: { clientId: number; range: PeriodPair; onExperiment: (r: GadsRecommendation) => void }) {
  const [recs, setRecs] = useState<GadsRecommendation[] | null>(null);
  const [filter, setFilter] = useState<RecFilter>('active');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<{ inserted: number; refreshed: number; skipped: number; data_limitations: string[] } | null>(null);

  useEffect(() => {
    optimizationApi.recommendations(clientId).then(setRecs).catch((err) => setError(apiError(err, 'Gagal memuat rekomendasi')));
  }, [clientId]);

  async function generate() {
    setBusy('generate'); setError('');
    try {
      const res = await optimizationApi.generate(clientId, range);
      setRecs(res.recommendations);
      setResult(res);
      setFilter('active');
    } catch (err) { setError(apiError(err, 'Gagal membuat rekomendasi')); } finally { setBusy(''); }
  }

  const replace = (r: GadsRecommendation) => setRecs((list) => (list ?? []).map((x) => (x.id === r.id ? r : x)));
  async function patch(r: GadsRecommendation, body: { status?: RecStatus; notes?: string | null }) {
    setBusy(`r${r.id}`); setError('');
    try { replace(await optimizationApi.updateRecommendation(clientId, r.id, body)); } catch (err) { setError(apiError(err, 'Gagal menyimpan')); } finally { setBusy(''); }
  }
  async function toTask(r: GadsRecommendation, pic: string) {
    setBusy(`t${r.id}`); setError('');
    try { replace(await optimizationApi.toTask(clientId, r.id, pic)); } catch (err) { setError(apiError(err, 'Gagal membuat tugas')); } finally { setBusy(''); }
  }

  const list = (recs ?? []).filter((r) => (filter === 'active' ? !['completed', 'dismissed'].includes(r.status) : filter === 'done' ? r.status === 'completed' : r.status === 'dismissed'));
  const count = (f: RecFilter) => (recs ?? []).filter((r) => (f === 'active' ? !['completed', 'dismissed'].includes(r.status) : f === 'done' ? r.status === 'completed' : r.status === 'dismissed')).length;
  return (
    <div className="sec-block">
      <div className="sec-heading google-heading">AI Optimization Center <span className="sec-badge">rencana optimasi</span><SectionDownloadButton /></div>
      <div className="sec-inner">
        <div className="gads-opt-bar">
          <div className="gads-chips" role="group">
            {(['active', 'done', 'dismissed'] as RecFilter[]).map((f) => (
              <button key={f} type="button" className={`gads-chip${filter === f ? ' is-active' : ''}`} onClick={() => setFilter(f)}>
                {f === 'active' ? 'Aktif' : f === 'done' ? 'Selesai' : 'Diabaikan'}<span className="gads-chip-count">{count(f)}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={generate} disabled={busy === 'generate'}>
            {busy === 'generate' ? <Loader2 size={15} className="rg-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />} Buat rekomendasi AI untuk periode ini
          </button>
        </div>
        {error && <p className="gads-error">{error}</p>}
        {result && (
          <p className="gads-footnote is-inline">
            {result.inserted} rekomendasi baru, {result.refreshed} diperbarui (sudah ada sebelumnya){result.skipped ? `, ${result.skipped} dilewati karena baru diabaikan` : ''}.
            {result.data_limitations.length > 0 && ` Keterbatasan data: ${result.data_limitations.join(' · ')}`}
          </p>
        )}
        {!recs ? <p className="empty-note"><Loader2 size={13} className="rg-spin" /> Memuat…</p> : list.length === 0 ? (
          <p className="empty-note">{filter === 'active' ? 'Belum ada rekomendasi aktif. Tekan "Buat rekomendasi AI" — AI membaca diagnostics dan data yang sudah dihitung ATLAS, bukan data mentah.' : 'Tidak ada.'}</p>
        ) : (
          <div className="gads-recs">{list.map((r) => <RecCard key={r.id} r={r} busy={busy} onPatch={patch} onTask={toTask} onExperiment={onExperiment} />)}</div>
        )}
        <p className="gads-footnote is-inline">
          Rekomendasi disusun Gemini dari temuan terstruktur ATLAS dan divalidasi backend. Semua tindakan dijalankan manual di Google Ads — ATLAS tidak mengubah akun.
          Rekomendasi yang sama (entity + kategori) tidak dibuat dua kali: yang sudah ada diperbarui.
        </p>
      </div>
    </div>
  );
}

function RecCard({ r, busy, onPatch, onTask, onExperiment }: {
  r: GadsRecommendation; busy: string;
  onPatch: (r: GadsRecommendation, b: { status?: RecStatus; notes?: string | null }) => void;
  onTask: (r: GadsRecommendation, pic: string) => void;
  onExperiment: (r: GadsRecommendation) => void;
}) {
  const [notes, setNotes] = useState(r.notes ?? '');
  const [pic, setPic] = useState('');
  const [asking, setAsking] = useState(false);
  return (
    <article className={`gads-finding is-${r.priority}`}>
      <header>
        <Tag tone={SEVERITY_TONE[r.priority]}>{SEVERITY_LABEL[r.priority]}</Tag>
        <strong>{r.title}</strong>
        <span className="gads-finding-entity">{r.entity_name ?? 'Seluruh akun'} · {CATEGORY_LABEL[r.category] ?? r.category}</span>
        <span className="gads-finding-conf">{CONFIDENCE_LABEL[r.confidence]}{r.times_seen > 1 ? ` · muncul ${r.times_seen}×` : ''}</span>
      </header>
      <div className="gads-finding-body">
        <div>
          <h5>Temuan</h5>
          <p>{r.finding}</p>
          <ul>{r.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
          {r.possible_cause && <><h5>Kemungkinan penyebab</h5><p>{r.possible_cause}</p></>}
        </div>
        <div>
          <h5>Tindakan</h5>
          <p>{r.recommended_action}</p>
          {r.expected_direction && <><h5>Arah yang diharapkan</h5><p>{r.expected_direction}</p></>}
        </div>
        <div>
          {r.risk && <><h5>Risiko</h5><p>{r.risk}</p></>}
          {r.success_metric && <><h5>Ukuran berhasil</h5><p>{r.success_metric}{r.monitoring_period ? ` · pantau ${r.monitoring_period}` : ''}</p></>}
        </div>
      </div>
      <footer className="gads-rec-foot">
        <label className="gads-rec-status">Status
          <select className="gads-select" value={r.status} disabled={busy === `r${r.id}`} onChange={(e) => onPatch(r, { status: e.target.value as RecStatus })}>
            {Object.entries(REC_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <span className="gads-rec-status-print">Status: {REC_STATUS_LABEL[r.status]}</span>
        {r.task_key ? (
          <Tag tone={r.task_done ? 'good' : 'info'}>{r.task_done ? <><Check size={11} /> Selesai di MOM</> : `Tugas di MOM ${dayText(r.task_meeting_date)}`}</Tag>
        ) : asking ? (
          <form className="gads-inline-form" onSubmit={(e) => { e.preventDefault(); if (pic.trim()) onTask(r, pic.trim()); }}>
            <input className="gads-select" placeholder="PIC (nama)" value={pic} onChange={(e) => setPic(e.target.value)} autoFocus maxLength={60} />
            <button type="submit" className="btn btn-ghost dt-btn-sm" disabled={!pic.trim() || busy === `t${r.id}`}>{busy === `t${r.id}` ? <Loader2 size={13} className="rg-spin" /> : 'Tambah ke MOM'}</button>
          </form>
        ) : (
          <button type="button" className="btn btn-ghost dt-btn-sm" onClick={() => setAsking(true)}><ClipboardList size={13} aria-hidden /> Jadikan tugas MOM</button>
        )}
        <button type="button" className="btn btn-ghost dt-btn-sm" onClick={() => onExperiment(r)}><FlaskConical size={13} aria-hidden /> Catat eksperimen</button>
        <textarea className="gads-rec-notes" placeholder="Catatan tim…" value={notes} rows={1}
          onChange={(e) => setNotes(e.target.value)} onBlur={() => { if ((r.notes ?? '') !== notes) onPatch(r, { notes: notes || null }); }} />
      </footer>
    </article>
  );
}

// ── Experiment tracker ──────────────────────────────────────────────
export const METRIC_LABEL: Record<ExpMetric, string> = {
  cpa: 'CPA', conversions: 'Konversi / hari', cvr: 'Conversion rate', ctr: 'CTR', cpc: 'Avg. CPC', roas: 'ROAS', cost: 'Biaya / hari',
  conversions_value: 'Nilai konversi / hari', impressions: 'Impresi / hari', clicks: 'Klik / hari',
};
const RESULT_TONE = { improved: 'good', declined: 'bad', inconclusive: 'neutral' } as const;
const RESULT_LABEL = { improved: 'Membaik', declined: 'Memburuk', inconclusive: 'Belum konklusif' };
const EXP_STATUS = { planned: 'Direncanakan', running: 'Berjalan', evaluating: 'Dievaluasi', completed: 'Selesai', cancelled: 'Dibatalkan' };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

export interface ExperimentDraft { hypothesis: string; planned_action: string; campaign: string; recommendation_id: number | null }

export function ExperimentTracker({ clientId, report, f, draft, onDraftUsed }: { clientId: number; report: GadsReport; f: Formatter; draft: ExperimentDraft | null; onDraftUsed: () => void }) {
  const [list, setList] = useState<GadsExperiment[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [related, setRelated] = useState<Record<number, { changed_at: string; changes: string | null; user_email: string | null }[]>>({});
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => optimizationApi.experiments(clientId).then(setList).catch((err) => setError(apiError(err, 'Gagal memuat eksperimen'))), [clientId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (draft) setShowForm(true); }, [draft]);

  async function evaluate(e: GadsExperiment) {
    setBusy(`e${e.id}`); setError('');
    try {
      const res = await optimizationApi.evaluate(clientId, e.id);
      setList((l) => (l ?? []).map((x) => (x.id === e.id ? res.experiment : x)));
      setRelated((r) => ({ ...r, [e.id]: res.related_changes }));
      setOpen(e.id);
    } catch (err) { setError(apiError(err, 'Gagal mengevaluasi')); } finally { setBusy(''); }
  }
  async function setStatus(e: GadsExperiment, status: GadsExperiment['status']) {
    try { const x = await optimizationApi.updateExperiment(clientId, e.id, { status }); setList((l) => (l ?? []).map((y) => (y.id === e.id ? x : y))); } catch (err) { setError(apiError(err, 'Gagal menyimpan')); }
  }
  async function remove(e: GadsExperiment) {
    if (!window.confirm(`Hapus eksperimen "${e.hypothesis}"?`)) return;
    try { await optimizationApi.deleteExperiment(clientId, e.id); setList((l) => (l ?? []).filter((x) => x.id !== e.id)); } catch (err) { setError(apiError(err, 'Gagal menghapus')); }
  }
  const fmtMetric = (metric: ExpMetric, m: Record<string, number | null> | null | undefined, days?: number) => {
    if (!m) return '—';
    const pick: Record<ExpMetric, [string, string]> = { cpa: ['cost_per_conv', 'money'], cvr: ['cvr', 'pct'], ctr: ['ctr', 'pct'], cpc: ['avg_cpc', 'money'], roas: ['roas', 'x'], conversions: ['conversions', 'dec'], cost: ['cost', 'money'], conversions_value: ['conversions_value', 'money'], impressions: ['impressions', 'int'], clicks: ['clicks', 'int'] };
    const [key, kind] = pick[metric];
    const v = m[key];
    if (v == null) return '—';
    const per = days && ['conversions', 'cost', 'conversions_value', 'impressions', 'clicks'].includes(metric) ? v / days : v;
    return kind === 'money' ? f.money(per) : kind === 'pct' ? f.pct(per) : kind === 'x' ? `${f.dec(per)}x` : kind === 'int' ? f.int(per) : f.dec(per);
  };
  const days = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 864e5) + 1;

  return (
    <div className="sec-block">
      <div className="sec-heading google-heading">Experiment Tracker <span className="sec-badge">sebelum vs sesudah perubahan</span><SectionDownloadButton /></div>
      <div className="sec-inner">
        <div className="gads-opt-bar">
          <span className="gads-footnote is-inline" style={{ padding: 0 }}>Catat perubahan yang sengaja dilakukan, lalu evaluasi hasilnya setelah periode evaluasi lewat.</span>
          {!showForm && <button type="button" className="btn btn-ghost" onClick={() => setShowForm(true)}><FlaskConical size={15} aria-hidden /> Catat eksperimen</button>}
        </div>
        {error && <p className="gads-error">{error}</p>}
        {showForm && (
          <ExperimentForm clientId={clientId} report={report} draft={draft}
            onCancel={() => { setShowForm(false); onDraftUsed(); }}
            onSaved={(x) => { setList((l) => [x, ...(l ?? [])]); setShowForm(false); onDraftUsed(); }} />
        )}
        {!list ? <p className="empty-note"><Loader2 size={13} className="rg-spin" /> Memuat…</p> : list.length === 0 ? <p className="empty-note">Belum ada eksperimen tercatat.</p> : (
          <div className="gads-table-scroll">
            <table className="kpi-table metric-wide-table gads-table">
              <thead><tr><th className="is-left">Hipotesis</th><th className="is-left">Campaign</th><th className="is-left">Metrik</th><th className="is-left">Mulai</th><th className="is-left">Baseline → Evaluasi</th><th className="is-left">Status</th><th className="is-left">Hasil</th><th /></tr></thead>
              <tbody>
                {list.map((e) => (
                  <Fragment key={e.id}>
                    <tr>
                      <td className="is-left gads-exp-hypo"><button type="button" className="gads-link" onClick={() => setOpen(open === e.id ? null : e.id)}>{e.hypothesis}</button>{e.pic && <small> · PIC {e.pic}</small>}</td>
                      <td className="is-left">{e.campaign_name ?? 'Seluruh akun'}</td>
                      <td className="is-left">{METRIC_LABEL[e.success_metric]} {e.expected_direction === 'decrease' ? '↓' : '↑'}</td>
                      <td className="is-left">{dayText(e.start_date)}</td>
                      <td className="is-left">{dayText(e.baseline_start)}–{dayText(e.baseline_end)} → {dayText(e.eval_start)}–{dayText(e.eval_end)}</td>
                      <td className="is-left">
                        <select className="gads-select" value={e.status} onChange={(ev) => setStatus(e, ev.target.value as GadsExperiment['status'])}>
                          {Object.entries(EXP_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="is-left">{e.result ? <Tag tone={RESULT_TONE[e.result]}>{RESULT_LABEL[e.result]}</Tag> : '—'}</td>
                      <td className="is-left gads-row-actions">
                        <button type="button" className="btn btn-ghost dt-btn-sm" disabled={busy === `e${e.id}`} onClick={() => evaluate(e)}>{busy === `e${e.id}` ? <Loader2 size={13} className="rg-spin" /> : 'Evaluasi'}</button>
                        <button type="button" className="gads-icon-btn" aria-label="Hapus" onClick={() => remove(e)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                    {open === e.id && (
                      <tr className="gads-exp-detail"><td colSpan={8} className="is-left">
                        <div className="gads-exp-grid">
                          <div>
                            <h5>Rencana</h5><p>{e.planned_action || '—'}</p>
                            <h5>Perubahan aktual</h5><p>{e.actual_change || '—'}</p>
                            {e.notes && <><h5>Catatan</h5><p>{e.notes}</p></>}
                          </div>
                          <div>
                            <h5>Hasil terakhir</h5>
                            {e.last_result ? (
                              <>
                                <p>
                                  {METRIC_LABEL[e.success_metric]}: {fmtMetric(e.success_metric, e.last_result.baseline as unknown as Record<string, number>, days(e.baseline_start, e.baseline_end))} →{' '}
                                  {fmtMetric(e.success_metric, e.last_result.evaluation as unknown as Record<string, number>, days(e.eval_start, e.eval_end))}
                                  {e.last_result.change != null && ` (${e.last_result.change >= 0 ? '+' : ''}${(e.last_result.change * 100).toFixed(1)}%)`} — <strong>{RESULT_LABEL[e.last_result.verdict]}</strong>
                                </p>
                                <small>Dievaluasi {dateText(e.last_result.evaluated_at)}</small>
                                <h5>Keterbatasan</h5><ul>{e.last_result.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
                              </>
                            ) : <p>Belum dievaluasi.</p>}
                          </div>
                          <div>
                            <h5>Perubahan di Change History selama evaluasi</h5>
                            {related[e.id] ? (related[e.id].length ? <ul>{related[e.id].slice(0, 10).map((c) => <li key={`${c.changed_at}${c.changes}`}>{c.changed_at}{c.user_email ? ` · ${c.user_email}` : ''}: {c.changes}</li>)}</ul> : <p>Tidak ada.</p>) : <p>Tekan Evaluasi untuk memuat.</p>}
                          </div>
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="gads-footnote is-inline">Hasil adalah pengamatan sebelum–sesudah, bukan bukti sebab-akibat. "Belum konklusif" bila volume kurang atau perubahan di bawah 10%.</p>
      </div>
    </div>
  );
}

function ExperimentForm({ clientId, report, draft, onCancel, onSaved }: { clientId: number; report: GadsReport; draft: ExperimentDraft | null; onCancel: () => void; onSaved: (x: GadsExperiment) => void }) {
  const today = iso(new Date());
  const [form, setForm] = useState({
    campaign: draft?.campaign ?? '', hypothesis: draft?.hypothesis ?? '', planned_action: draft?.planned_action ?? '', actual_change: '', pic: '',
    start_date: today, baseline_start: shift(today, -14), baseline_end: shift(today, -1), eval_start: today, eval_end: shift(today, 13),
    success_metric: 'cpa' as ExpMetric, expected_direction: 'decrease' as 'increase' | 'decrease', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => {
    const next = { ...f, [k]: v };
    // Moving the start moves both windows: 14 days before, 14 days from it.
    if (k === 'start_date' && v) Object.assign(next, { baseline_start: shift(v, -14), baseline_end: shift(v, -1), eval_start: v, eval_end: shift(v, 13) });
    return next;
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const c = report.cur.campaigns.find((x) => `${x.customer_id}|${x.campaign_id}` === form.campaign);
    try {
      onSaved(await optimizationApi.createExperiment(clientId, {
        ...form, campaign: undefined, customer_id: c?.customer_id ?? null, campaign_id: c?.campaign_id ?? null, campaign_name: c?.campaign_name ?? null,
        recommendation_id: draft?.recommendation_id ?? null, status: form.start_date > today ? 'planned' : 'running',
      } as Partial<GadsExperiment>));
    } catch (err) { setError(apiError(err, 'Gagal menyimpan')); } finally { setBusy(false); }
  }
  return (
    <form className="gads-exp-form" onSubmit={submit}>
      <label className="is-wide">Hipotesis<input className="gads-select" required value={form.hypothesis} onChange={(e) => set('hypothesis', e.target.value)} placeholder="Menguji Phrase Match untuk keyword Dried Flowers agar pencarian lebih relevan" /></label>
      <label>Campaign
        <select className="gads-select" value={form.campaign} onChange={(e) => set('campaign', e.target.value)}>
          <option value="">Seluruh akun</option>
          {report.cur.campaigns.map((c) => <option key={c.campaign_id} value={`${c.customer_id}|${c.campaign_id}`}>{c.campaign_name}</option>)}
        </select>
      </label>
      <label>PIC<input className="gads-select" value={form.pic} onChange={(e) => set('pic', e.target.value)} maxLength={60} /></label>
      <label className="is-wide">Rencana tindakan<input className="gads-select" value={form.planned_action} onChange={(e) => set('planned_action', e.target.value)} /></label>
      <label className="is-wide">Perubahan aktual<input className="gads-select" value={form.actual_change} onChange={(e) => set('actual_change', e.target.value)} placeholder="Diisi setelah perubahan dijalankan" /></label>
      <label>Tanggal perubahan<input type="date" className="gads-select" required value={form.start_date} onChange={(e) => set('start_date', e.target.value)} /></label>
      <label>Metrik keberhasilan
        <select className="gads-select" value={form.success_metric} onChange={(e) => set('success_metric', e.target.value)}>
          {Object.entries(METRIC_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label>Arah yang diharapkan
        <select className="gads-select" value={form.expected_direction} onChange={(e) => set('expected_direction', e.target.value)}>
          <option value="decrease">Turun</option><option value="increase">Naik</option>
        </select>
      </label>
      <label>Baseline<span className="gads-date-pair"><input type="date" className="gads-select" required value={form.baseline_start} onChange={(e) => set('baseline_start', e.target.value)} />–<input type="date" className="gads-select" required value={form.baseline_end} onChange={(e) => set('baseline_end', e.target.value)} /></span></label>
      <label>Evaluasi<span className="gads-date-pair"><input type="date" className="gads-select" required value={form.eval_start} onChange={(e) => set('eval_start', e.target.value)} />–<input type="date" className="gads-select" required value={form.eval_end} onChange={(e) => set('eval_end', e.target.value)} /></span></label>
      <label className="is-wide">Catatan<input className="gads-select" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      {error && <p className="gads-error is-wide">{error}</p>}
      <div className="action-row is-wide">
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy && <Loader2 size={15} className="rg-spin" />} Simpan eksperimen</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Batal</button>
      </div>
    </form>
  );
}
