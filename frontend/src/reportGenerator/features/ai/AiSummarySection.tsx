import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, Check, CheckCircle2, ClipboardCopy, Compass, Database, Lightbulb, Loader2,
  PencilLine, RefreshCw, ShieldAlert, Sparkles, Target, TrendingDown, TrendingUp, Minus,
} from 'lucide-react';
import type { Platform } from '../reports/types';
import type { SummaryKpi } from '../../lib/summary';
import { generateAiSummary, getAiEngine, saveAiSummaryEdit, type AiSummaryContent, type AiSummaryRecord } from '../reports/api';
import { useAuth } from '../../../contexts/AuthContext.jsx';
import './consultantBrief.css';

// AI Consultant Brief — the generated reading of a report, laid out the way a
// consulting deliverable is: the answer first (verdict + one-sentence
// headline), the evidence beside the diagnosis, what works and what does
// not, then decisions and a prioritised action plan, and finally what limits
// the conclusion and when to look again. Every part tolerates an older
// (Gemini) brief that lacks the newer fields.

type ListField = 'winning' | 'challenge' | 'hypotheses' | 'risks' | 'strategic_direction' | 'action_items' | 'data_gaps';
type Content = AiSummaryContent & { [K in ListField]: string[] };

const INSIGHTS: { key: ListField; title: string; hint: string; icon: typeof CheckCircle2; tone: string }[] = [
  { key: 'winning', title: 'Yang bekerja', hint: 'Layak dipertahankan', icon: CheckCircle2, tone: 'good' },
  { key: 'challenge', title: 'Tantangan utama', hint: 'Hambatan paling material', icon: AlertTriangle, tone: 'warn' },
  { key: 'hypotheses', title: 'Hipotesis', hint: 'Dugaan & cara memvalidasi', icon: Lightbulb, tone: 'idea' },
  { key: 'risks', title: 'Risiko dipantau', hint: 'Risiko & sinyal awal', icon: ShieldAlert, tone: 'risk' },
];

const VERDICT = {
  on_track: { label: 'On track', note: 'Bergerak ke target', Icon: TrendingUp },
  watch: { label: 'Perlu perhatian', note: 'Campuran / ada risiko material', Icon: Minus },
  off_track: { label: 'Off track', note: 'Menjauh dari target', Icon: TrendingDown },
} as const;

const EDIT_LISTS: { key: ListField; title: string }[] = [
  { key: 'winning', title: 'Yang bekerja' },
  { key: 'challenge', title: 'Tantangan utama' },
  { key: 'hypotheses', title: 'Hipotesis' },
  { key: 'risks', title: 'Risiko dipantau' },
  { key: 'strategic_direction', title: 'Arah strategis' },
  { key: 'action_items', title: 'Action plan (format: P1 · horizon — tindakan | Alasan: … | Ukur: …)' },
  { key: 'data_gaps', title: 'Data gaps' },
];

const STEPS = ['Membaca konteks & arah brand', 'Membandingkan dengan target dan penjualan nyata', 'Menimbang bukti & menguji hipotesis', 'Menyusun keputusan dan action plan'];

interface AiSummarySectionProps {
  clientId: number | null;
  platform: Platform;
  period: { old: string; cur: string };
  periodDates?: { oldStart?: string | null; oldEnd?: string | null; curStart?: string | null; curEnd?: string | null };
  kpis: SummaryKpi[];
  cpasKpis?: SummaryKpi[];
  periodWarning?: string | null;
  notes?: string[];
}

function complete(c: AiSummaryContent): Content {
  return {
    ...c,
    diagnosis: c.diagnosis ?? '',
    objective_alignment: c.objective_alignment ?? '',
    winning: c.winning ?? [],
    challenge: c.challenge ?? [],
    hypotheses: c.hypotheses ?? [],
    strategic_direction: c.strategic_direction ?? [],
    action_items: c.action_items ?? [],
    risks: c.risks ?? [],
    data_gaps: c.data_gaps ?? [],
    key_metrics: c.key_metrics ?? [],
  };
}

function toPlain(kpis: SummaryKpi[] | undefined) {
  return (kpis ?? []).map((k) => ({
    label: k.label, old: k.old, cur: k.cur, delta: k.delta, deltaNum: k.deltaNum,
    signal: k.cls === 'delta-good' ? 'positif' : k.cls === 'delta-bad' ? 'negatif' : 'netral',
  }));
}

// "P1 · minggu ini — tindakan | Alasan: … | Ukur: …"
function actionParts(item: string) {
  const [head = item, ...details] = item.split('|').map((part) => part.trim());
  const match = head.match(/^(P[123])\s*[·•-]\s*(.*?)\s*[—–]\s*(.+)$/i);
  const take = (label: string) => details.find((d) => d.toLowerCase().startsWith(label))?.replace(/^[^:]+:\s*/, '') ?? '';
  return {
    priority: match?.[1]?.toUpperCase() ?? 'P2',
    horizon: match?.[2]?.trim() ?? '',
    action: match?.[3]?.trim() ?? head,
    rationale: take('alasan'),
    measure: take('ukur'),
    other: details.filter((d) => !/^(alasan|ukur)\s*:/i.test(d)),
  };
}

// A prose field as sentences, so a long paragraph can read as a lead and
// points instead of one block.
function sentences(text?: string | null): string[] {
  if (!text) return [];
  return text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).map((t) => t.trim()).filter(Boolean);
}

// Figures are what a reader scans for in running text; set them apart.
const FIGURE = /((?:Rp\s?)\d[\d.,]*(?:\s?(?:jt|juta|rb|ribu|M|miliar))?|[+−-]?\d[\d.,]*\s?%|\d[\d.,]*x\b|\b\d{1,3}(?:[.,]\d+)+\b)/g;
function Rich({ text }: { text: string }) {
  return <>{text.split(FIGURE).map((part, i) => (i % 2 ? <b key={i} className="cb-num">{part}</b> : part))}</>;
}

// Lead sentence, then the rest as points; a single sentence stays a line.
function Prose({ text, lead = true }: { text: string; lead?: boolean }) {
  const list = sentences(text);
  if (list.length <= 1) return <p className="cb-prose-lead"><Rich text={text} /></p>;
  const rest = lead ? list.slice(1) : list;
  return (
    <div className="cb-prose">
      {lead && <p className="cb-prose-lead"><Rich text={list[0]} /></p>}
      <ul className="cb-points">{rest.map((t, i) => <li key={i}><Rich text={t} /></li>)}</ul>
    </div>
  );
}

function asText(c: Content, period: { old: string; cur: string }) {
  const block = (title: string, items: string[]) => (items.length ? `\n${title}\n${items.map((i) => `• ${i}`).join('\n')}` : '');
  return [
    `AI Consultant Brief · ${period.cur} vs ${period.old}`,
    c.verdict ? `Status: ${VERDICT[c.verdict].label}${c.verdict_reason ? ` — ${c.verdict_reason}` : ''}` : '',
    c.headline ? `\n${c.headline}` : '',
    `\nDiagnosis\n${c.diagnosis}`,
    c.objective_alignment ? `\nKeselarasan dengan arah brand\n${c.objective_alignment}` : '',
    c.key_metrics?.length ? `\nBukti utama\n${c.key_metrics.map((k) => `• ${k.metric}: ${k.movement} — ${k.reading}`).join('\n')}` : '',
    block('Yang bekerja', c.winning),
    block('Tantangan utama', c.challenge),
    block('Arah strategis', c.strategic_direction),
    block('Action plan', c.action_items),
    block('Risiko dipantau', c.risks),
    c.next_review ? `\nReview berikutnya: ${c.next_review}` : '',
  ].filter(Boolean).join('\n');
}

export function AiSummarySection({ clientId, platform, period, periodDates, kpis, cpasKpis, periodWarning, notes }: AiSummarySectionProps) {
  const { isViewOnly } = useAuth();
  const [record, setRecord] = useState<AiSummaryRecord | null>(null);
  const [cached, setCached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Content | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [engine, setEngine] = useState<{ engine: 'claude' | 'gemini'; model: string } | null>(null);

  useEffect(() => { getAiEngine().then(setEngine); }, []);

  const raw = record ? record.edited_summary ?? record.summary : null;
  const content = raw ? complete(raw) : null;

  // Older briefs have no key metrics: the biggest KPI moves stand in.
  const pulse = useMemo(() => {
    const rows = [...kpis, ...(cpasKpis ?? [])]
      .filter((k) => k.deltaNum != null && Number.isFinite(k.deltaNum))
      .sort((a, b) => Math.abs(b.deltaNum ?? 0) - Math.abs(a.deltaNum ?? 0)).slice(0, 5);
    return rows.map((k) => ({
      metric: k.label, movement: `${k.old} → ${k.cur} (${k.delta})`, reading: '',
      tone: (k.cls === 'delta-good' ? 'positive' : k.cls === 'delta-bad' ? 'negative' : 'neutral') as 'positive' | 'negative' | 'neutral',
    }));
  }, [kpis, cpasKpis]);

  const inputSignature = useMemo(
    () => JSON.stringify([clientId, platform, period, periodDates, toPlain(kpis), toPlain(cpasKpis)]),
    [clientId, platform, period, periodDates, kpis, cpasKpis],
  );
  useEffect(() => { setRecord(null); setCached(false); setDraft(null); setError(null); }, [inputSignature]);

  // The progress steps advance while the model works (30–50 s on Claude).
  useEffect(() => {
    if (!busy) { setStep(0); return undefined; }
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 9000);
    return () => clearInterval(t);
  }, [busy]);

  async function run(refresh: boolean) {
    if (!clientId || isViewOnly) return;
    setBusy(true); setError(null);
    try {
      const res = await generateAiSummary({
        clientId, platform,
        period: { oldLabel: period.old, curLabel: period.cur, oldStart: periodDates?.oldStart ?? null, oldEnd: periodDates?.oldEnd ?? null, curStart: periodDates?.curStart ?? null, curEnd: periodDates?.curEnd ?? null },
        performance: { period, kpis: toPlain(kpis), cpasKpis: cpasKpis?.length ? toPlain(cpasKpis) : undefined, periodWarning: periodWarning ?? null, notes },
        refresh,
      });
      setRecord(res.summary); setCached(res.cached); setDraft(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal membuat ringkasan.'); }
    finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!record || !clientId || !draft || isViewOnly) return;
    setSaving(true); setError(null);
    try { setRecord(await saveAiSummaryEdit(record.id, clientId, draft)); setDraft(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Gagal menyimpan suntingan.'); }
    finally { setSaving(false); }
  }

  async function copy() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(asText(content, period));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked: nothing to do */ }
  }

  const modelLabel = (m?: string) => (m ? m.replace(/^claude-/, 'Claude ').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/opus/i, 'Opus').replace(/sonnet/i, 'Sonnet').replace(/haiku/i, 'Haiku') : '');
  const evidence = content?.key_metrics?.length ? content.key_metrics : pulse;
  const verdict = content?.verdict ? VERDICT[content.verdict] : null;
  // An older brief has no headline: its diagnosis' first sentence is its
  // conclusion, so it leads the brief and leaves the diagnosis.
  const diag = sentences(content?.diagnosis);
  const headline = content?.headline || (diag.length > 2 ? diag[0] : null);
  const diagnosisText = content?.headline ? content.diagnosis : diag.slice(headline ? 1 : 0).join(' ');

  return (
    <section className="sec-block ai-sum cb">
      <header className="cb-head">
        <div className="cb-title">
          <span className="cb-title-ico" aria-hidden="true"><Sparkles size={17} /></span>
          <div>
            <h3>AI Consultant Brief</h3>
            <p>{period.cur} dibanding {period.old}</p>
          </div>
          {engine && <span className={`cb-engine is-${engine.engine}`} title="Model yang menyusun brief berikutnya">{engine.engine === 'claude' ? modelLabel(engine.model) : 'Gemini'}</span>}
        </div>
        <div className="cb-tools">
          {content && !draft && <button type="button" className="cb-btn" onClick={copy}>{copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied ? 'Tersalin' : 'Salin'}</button>}
          {content && !draft && !isViewOnly && <button type="button" className="cb-btn" onClick={() => setDraft(content)} disabled={busy}><PencilLine size={14} /> Edit</button>}
          {content && !draft && !isViewOnly && <button type="button" className="cb-btn" onClick={() => run(true)} disabled={busy}><RefreshCw size={14} className={busy ? 'cb-spin' : ''} /> {busy ? 'Menganalisis…' : 'Analisis ulang'}</button>}
          {draft && !isViewOnly && <><button type="button" className="cb-btn" onClick={() => setDraft(null)} disabled={saving}>Batal</button><button type="button" className="cb-btn is-primary" onClick={saveEdit} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan suntingan'}</button></>}
        </div>
      </header>

      <div className="cb-context" aria-label="Konteks yang dibaca">
        {['Brand context', 'Current direction', 'Brand Tracking', 'Target bulanan', 'Minutes of Meeting', 'Brief periode lalu'].map((c) => <span key={c}><Database size={12} aria-hidden="true" /> {c}</span>)}
      </div>

      {!content && !error && !busy && (
        <div className="cb-empty">
          <div className="cb-empty-copy">
            <h4>Ubah angka laporan menjadi keputusan</h4>
            <p>AI menilai periode ini terhadap objective, target bulanan, penjualan nyata, dan keputusan meeting brand — lalu menyusun verdict, bukti, hipotesis, dan action plan terukur dengan standar consultant.</p>
            <ul>
              <li><Target size={14} /> Verdict & kesimpulan satu kalimat</li>
              <li><TrendingUp size={14} /> Bukti metrik paling material</li>
              <li><Compass size={14} /> Arah strategis & action plan berprioritas</li>
            </ul>
          </div>
          {!clientId && <p className="cb-warn">Pilih brand dulu di bagian atas halaman.</p>}
          <button type="button" className="cb-cta" onClick={() => run(false)} disabled={isViewOnly || !clientId || !kpis.length}>
            <Sparkles size={16} /> Generate Consultant Brief
          </button>
        </div>
      )}

      {busy && !content && (
        <div className="cb-loading" role="status">
          <div className="cb-loading-orb" aria-hidden="true"><Sparkles size={22} /></div>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}>
                {i < step ? <Check size={14} /> : i === step ? <Loader2 size={14} className="cb-spin" /> : <span />} {s}
              </li>
            ))}
          </ol>
          <small>Biasanya 20–50 detik. Laporan di atas tetap bisa dipakai.</small>
        </div>
      )}

      {error && (
        <div className="cb-error" role="alert">
          <AlertTriangle size={18} />
          <div><strong>Brief gagal dibuat</strong><span>{error}</span><small>Laporan di atas tidak terpengaruh dan tetap bisa diunduh.</small></div>
          <button type="button" className="cb-btn" onClick={() => run(true)} disabled={busy}>{busy ? 'Mencoba…' : 'Coba lagi'}</button>
        </div>
      )}

      {content && !draft && (
        <div className={`cb-body${busy ? ' is-refreshing' : ''}`}>
          {(headline || verdict) && (
            <div className={`cb-verdict is-${content.verdict ?? 'none'}`}>
              {verdict ? (
                <span className="cb-verdict-pill"><verdict.Icon size={15} /> {verdict.label}</span>
              ) : <span className="cb-eyebrow">Kesimpulan utama</span>}
              {headline && <h4>{headline}</h4>}
              {content.verdict_reason && <p><Rich text={content.verdict_reason} /></p>}
            </div>
          )}

          <div className="cb-lead">
            <article className="cb-card cb-diagnosis">
              <span className="cb-eyebrow">Executive diagnosis</span>
              {diagnosisText ? <Prose text={diagnosisText} /> : <p className="cb-none">—</p>}
              {content.objective_alignment && (
                <div className="cb-align">
                  <span className="cb-eyebrow"><Target size={13} /> Keselarasan dengan arah brand</span>
                  <Prose text={content.objective_alignment} lead={false} />
                </div>
              )}
            </article>
            <aside className="cb-card cb-evidence">
              <span className="cb-eyebrow">{content.key_metrics?.length ? 'Bukti utama' : 'Perubahan KPI terbesar'}</span>
              {evidence.length ? evidence.map((k, i) => (
                <div key={`${k.metric}-${i}`} className={`cb-metric is-${k.tone}`}>
                  <div className="cb-metric-top">
                    <strong>{k.metric}</strong>
                    {k.tone === 'positive' ? <TrendingUp size={14} /> : k.tone === 'negative' ? <TrendingDown size={14} /> : <Minus size={14} />}
                  </div>
                  <span className="cb-metric-move">{k.movement}</span>
                  {k.reading && <p><Rich text={k.reading} /></p>}
                </div>
              )) : <p className="cb-none">Belum ada metrik untuk ditampilkan.</p>}
            </aside>
          </div>

          <div className="cb-insights">
            {INSIGHTS.map(({ key, title, hint, icon: Icon, tone }) => (
              <article key={key} className={`cb-card cb-insight is-${tone}`}>
                <h5><span className="cb-insight-ico"><Icon size={15} /></span><span>{title}<small>{hint}</small></span></h5>
                {content[key].length ? <ul>{content[key].map((item, i) => <li key={i}><Rich text={item} /></li>)}</ul> : <p className="cb-none">Tidak ada catatan material.</p>}
              </article>
            ))}
          </div>

          <div className="cb-decide">
            <article className="cb-card cb-direction">
              <span className="cb-eyebrow"><Compass size={13} /> Arah strategis</span>
              {content.strategic_direction.length ? (
                <ol>{content.strategic_direction.map((d, i) => <li key={i}><b>{String(i + 1).padStart(2, '0')}</b><span><Rich text={d} /></span></li>)}</ol>
              ) : <p className="cb-none">Belum ada arahan.</p>}
            </article>
            <article className="cb-card cb-actions">
              <span className="cb-eyebrow">Action plan berprioritas <small>siap dibawa ke weekly review</small></span>
              {content.action_items.length ? (
                <div className="cb-action-list">
                  {content.action_items.map((item, i) => {
                    const a = actionParts(item);
                    return (
                      <div key={i} className="cb-action">
                        <span className={`cb-prio is-${a.priority.toLowerCase()}`}>{a.priority}</span>
                        <div className="cb-action-main">
                          <div className="cb-action-head"><strong>{a.action}</strong>{a.horizon && <em><CalendarClock size={12} /> {a.horizon}</em>}</div>
                          {(a.rationale || a.measure) && (
                            <dl>
                              {a.rationale && <div><dt>Alasan</dt><dd><Rich text={a.rationale} /></dd></div>}
                              {a.measure && <div><dt>Ukur</dt><dd><Rich text={a.measure} /></dd></div>}
                            </dl>
                          )}
                          {a.other.map((o, j) => <p key={j}>{o}</p>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <p className="cb-none">Belum ada action plan.</p>}
            </article>
          </div>

          {(content.data_gaps.length > 0 || content.next_review) && (
            <div className="cb-close">
              {content.data_gaps.length > 0 && (
                <div className="cb-gaps"><Database size={15} /><div><strong>Data yang membatasi kesimpulan</strong><ul>{content.data_gaps.map((g, i) => <li key={i}><Rich text={g} /></li>)}</ul></div></div>
              )}
              {content.next_review && (
                <div className="cb-next"><CalendarClock size={15} /><div><strong>Review berikutnya</strong><p>{content.next_review}</p></div></div>
              )}
            </div>
          )}
        </div>
      )}

      {draft && (
        <div className="cb-edit">
          <label><span>Kesimpulan (headline)</span><input value={draft.headline ?? ''} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} /></label>
          <label><span>Alasan verdict</span><textarea rows={2} value={draft.verdict_reason ?? ''} onChange={(e) => setDraft({ ...draft, verdict_reason: e.target.value })} /></label>
          <label><span>Executive diagnosis</span><textarea rows={5} value={draft.diagnosis} onChange={(e) => setDraft({ ...draft, diagnosis: e.target.value })} /></label>
          <label><span>Keselarasan dengan arah brand</span><textarea rows={3} value={draft.objective_alignment ?? ''} onChange={(e) => setDraft({ ...draft, objective_alignment: e.target.value })} /></label>
          {EDIT_LISTS.map(({ key, title }) => (
            <label key={key}><span>{title} <small>satu poin per baris</small></span><textarea rows={4} value={draft[key].join('\n')} onChange={(e) => setDraft({ ...draft, [key]: e.target.value.split('\n') })} /></label>
          ))}
          <label><span>Review berikutnya</span><input value={draft.next_review ?? ''} onChange={(e) => setDraft({ ...draft, next_review: e.target.value })} /></label>
        </div>
      )}

      {record && (
        <footer className="cb-foot">
          <span>
            {modelLabel(record.model) || record.model} · {new Date(record.updated_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            {cached && ' · dari cache (data belum berubah)'}
            {record.edited_summary && ` · disunting${record.edited_by_name ? ` oleh ${record.edited_by_name}` : ''}`}
          </span>
          <span className="cb-disclaimer">Draft AI — validasi sebelum dikirim ke klien. Brief tersimpan sebagai pembelajaran periode berikutnya.</span>
        </footer>
      )}
    </section>
  );
}
