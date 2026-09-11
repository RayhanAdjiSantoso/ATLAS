import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Compass, Database, Lightbulb, ShieldAlert, Sparkles, Target } from 'lucide-react';
import type { Platform } from '../reports/types';
import type { SummaryKpi } from '../../lib/summary';
import { generateAiSummary, saveAiSummaryEdit, type AiSummaryContent, type AiSummaryRecord } from '../reports/api';

type CompleteSummary = Required<AiSummaryContent>;
type ListField = Exclude<keyof CompleteSummary, 'diagnosis' | 'objective_alignment'>;

const INSIGHT_FIELDS: { key: ListField; title: string; hint: string; icon: typeof CheckCircle2; tone: string }[] = [
  { key: 'winning', title: 'What is working', hint: 'bukti yang layak dipertahankan', icon: CheckCircle2, tone: 'good' },
  { key: 'challenge', title: 'Core challenges', hint: 'hambatan paling material', icon: AlertTriangle, tone: 'warn' },
  { key: 'hypotheses', title: 'Hypotheses to validate', hint: 'dugaan dan cara membuktikannya', icon: Lightbulb, tone: 'idea' },
  { key: 'risks', title: 'Risks to monitor', hint: 'risiko dan sinyal awal', icon: ShieldAlert, tone: 'risk' },
];

const EDIT_FIELDS: { key: ListField; title: string }[] = [
  ...INSIGHT_FIELDS.map(({ key, title }) => ({ key, title })),
  { key: 'strategic_direction', title: 'Strategic Direction' },
  { key: 'action_items', title: 'Prioritized Action Plan' },
  { key: 'data_gaps', title: 'Data Gaps' },
];

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

function complete(content: AiSummaryContent): CompleteSummary {
  return {
    diagnosis: content.diagnosis ?? '',
    objective_alignment: content.objective_alignment ?? '',
    winning: content.winning ?? [],
    challenge: content.challenge ?? [],
    hypotheses: content.hypotheses ?? [],
    strategic_direction: content.strategic_direction ?? [],
    action_items: content.action_items ?? [],
    risks: content.risks ?? [],
    data_gaps: content.data_gaps ?? [],
  };
}

function toPlain(kpis: SummaryKpi[] | undefined) {
  return (kpis ?? []).map((k) => ({
    label: k.label, old: k.old, cur: k.cur, delta: k.delta, deltaNum: k.deltaNum,
    signal: k.cls === 'delta-good' ? 'positif' : k.cls === 'delta-bad' ? 'negatif' : 'netral',
  }));
}

function actionParts(item: string) {
  const [head = item, ...details] = item.split('|').map((part) => part.trim());
  const match = head.match(/^(P[123])\s*[·•-]\s*(.*?)\s*[—–]\s*(.+)$/i);
  return { priority: match?.[1]?.toUpperCase() ?? 'P', horizon: match?.[2]?.trim() ?? '', action: match?.[3]?.trim() ?? head, details };
}

export function AiSummarySection({ clientId, platform, period, periodDates, kpis, cpasKpis, periodWarning, notes }: AiSummarySectionProps) {
  const [record, setRecord] = useState<AiSummaryRecord | null>(null);
  const [cached, setCached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<CompleteSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const rawContent = record ? record.edited_summary ?? record.summary : null;
  const content = rawContent ? complete(rawContent) : null;
  const pulse = useMemo(() => {
    const rows = [...kpis, ...(cpasKpis ?? [])]
      .filter((k) => k.deltaNum != null && Number.isFinite(k.deltaNum))
      .sort((a, b) => Math.abs(b.deltaNum ?? 0) - Math.abs(a.deltaNum ?? 0)).slice(0, 5);
    const max = Math.max(1, ...rows.map((k) => Math.abs(k.deltaNum ?? 0)));
    return rows.map((k) => ({ ...k, width: Math.max(8, Math.abs(k.deltaNum ?? 0) / max * 100) }));
  }, [kpis, cpasKpis]);
  const inputSignature = useMemo(
    () => JSON.stringify([clientId, platform, period, periodDates, toPlain(kpis), toPlain(cpasKpis)]),
    [clientId, platform, period, periodDates, kpis, cpasKpis],
  );

  useEffect(() => {
    setRecord(null);
    setCached(false);
    setDraft(null);
    setError(null);
  }, [inputSignature]);

  async function run(refresh: boolean) {
    if (!clientId) return;
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
    if (!record || !clientId || !draft) return;
    setSaving(true); setError(null);
    try { setRecord(await saveAiSummaryEdit(record.id, clientId, draft)); setDraft(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Gagal menyimpan suntingan.'); }
    finally { setSaving(false); }
  }

  return (
    <section className="sec-block ai-sum">
      <div className="sec-heading ai-sum-heading">
        <span className="ai-sum-title"><Sparkles size={16} /> AI Consultant Brief</span>
        <span className="ai-sum-tools">
          {content && !draft && <><button className="btn btn-ghost ai-sum-btn" onClick={() => setDraft(content)} disabled={busy}>Edit</button><button className="btn btn-ghost ai-sum-btn" onClick={() => run(true)} disabled={busy}>{busy ? 'Menganalisis…' : '↻ Analisis ulang'}</button></>}
          {draft && <><button className="btn btn-ghost ai-sum-btn" onClick={() => setDraft(null)} disabled={saving}>Batal</button><button className="btn ai-sum-btn" onClick={saveEdit} disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan suntingan'}</button></>}
        </span>
      </div>

      <div className="ai-sum-contextbar">
        <span><Database size={13} /> Brand Context + Current Direction</span>
        <span><BarChart3 size={13} /> {period.old} vs {period.cur}</span>
        <span className="ai-sum-context-note">Analisis menggabungkan konteks Pengaturan Brand dengan data dalam periode terpilih.</span>
      </div>

      <div className="ai-sum-body">
        {!content && !error && <div className="ai-sum-empty">
          <div className="ai-sum-empty-icon"><Sparkles size={24} /></div>
          <div><h4>Ubah angka menjadi arahan keputusan</h4><p>AI akan menguji performa terhadap objective, prioritas, constraint, dan pembelajaran brand, lalu menyusun diagnosis, hipotesis, risiko, dan action plan terukur.</p></div>
          {!clientId && <p className="ai-sum-warn">Pilih brand dulu di bagian atas halaman.</p>}
          <button className="btn ai-sum-cta" onClick={() => run(false)} disabled={!clientId || busy || !kpis.length}>{busy ? 'Menyusun consultant brief…' : 'Generate Consultant Brief'}</button>
        </div>}

        {error && <div className="ai-sum-error"><strong>Ringkasan gagal dibuat.</strong><span>{error}</span><button className="btn btn-ghost ai-sum-btn" onClick={() => run(true)} disabled={busy}>{busy ? 'Mencoba…' : 'Coba lagi'}</button><small>Laporan di atas tidak terpengaruh dan tetap bisa diunduh.</small></div>}

        {content && !draft && <>
          <div className="ai-sum-lead-grid">
            <article className="ai-sum-diagnosis">
              <span className="ai-sum-eyebrow"><Sparkles size={13} /> Executive diagnosis</span>
              <p>{content.diagnosis || '—'}</p>
              {content.objective_alignment && <div className="ai-sum-alignment"><h4><Target size={15} /> Alignment with brand direction</h4><p>{content.objective_alignment}</p></div>}
            </article>
            <aside className="ai-sum-pulse">
              <div className="ai-sum-pulse-head"><span>Performance pulse</span><small>perubahan KPI terbesar</small></div>
              {pulse.length ? pulse.map((k) => <div className="ai-sum-pulse-row" key={`${k.key ?? k.label}-${k.delta}`}><div><span>{k.label}</span><strong className={k.cls}>{k.delta}</strong></div><div className="ai-sum-pulse-track"><i className={k.cls} style={{ width: `${k.width}%` }} /></div></div>) : <p className="ai-sum-none">Delta KPI belum tersedia.</p>}
              <small className="ai-sum-pulse-note">Panjang bar menunjukkan besarnya perubahan, bukan skor kualitas.</small>
            </aside>
          </div>

          <div className="ai-sum-grid">{INSIGHT_FIELDS.map((field) => { const Icon = field.icon; return <article className={`ai-sum-card ai-sum-card-${field.tone}`} key={field.key}><h4><Icon size={15} /><span>{field.title}<small>{field.hint}</small></span></h4>{content[field.key].length ? <ul>{content[field.key].map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="ai-sum-none">Tidak ada catatan material.</p>}</article>; })}</div>

          <div className="ai-sum-decision-grid">
            <article className="ai-sum-direction"><h4><Compass size={17} /> Strategic direction</h4>{content.strategic_direction.length ? <ol>{content.strategic_direction.map((item, i) => <li key={i}><b>{String(i + 1).padStart(2, '0')}</b><span>{item}</span></li>)}</ol> : <p className="ai-sum-none">Belum ada arahan.</p>}</article>
            <article className="ai-sum-actions"><h4>Prioritized action plan <small>siap dibawa ke weekly review</small></h4>{content.action_items.length ? content.action_items.map((item, i) => { const part = actionParts(item); return <div className="ai-sum-action" key={i}><span className={`ai-sum-priority ${part.priority.toLowerCase()}`}>{part.priority}</span><div><div className="ai-sum-action-head"><strong>{part.action}</strong>{part.horizon && <small>{part.horizon}</small>}</div>{part.details.map((detail, d) => <p key={d}>{detail}</p>)}</div></div>; }) : <p className="ai-sum-none">Belum ada action plan.</p>}</article>
          </div>

          {!!content.data_gaps.length && <div className="ai-sum-gaps"><Database size={15} /><div><strong>Data gaps yang membatasi kesimpulan</strong><ul>{content.data_gaps.map((item, i) => <li key={i}>{item}</li>)}</ul></div></div>}
        </>}

        {draft && <div className="ai-sum-edit">
          <label><span>Executive Diagnosis</span><textarea rows={5} value={draft.diagnosis} onChange={(e) => setDraft({ ...draft, diagnosis: e.target.value })} /></label>
          <label><span>Alignment with Brand Direction</span><textarea rows={4} value={draft.objective_alignment} onChange={(e) => setDraft({ ...draft, objective_alignment: e.target.value })} /></label>
          {EDIT_FIELDS.map((field) => <label key={field.key}><span>{field.title} <small>satu poin per baris</small></span><textarea rows={4} value={draft[field.key].join('\n')} onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value.split('\n') })} /></label>)}
        </div>}

        {record && <div className="ai-sum-foot"><span>{record.model} · {new Date(record.updated_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{cached && ' · dari cache (data belum berubah)'}{record.edited_summary && ` · disunting${record.edited_by_name ? ` oleh ${record.edited_by_name}` : ''}`}</span><span className="ai-sum-disclaimer">Draft AI — validasi sebelum dikirim ke klien. Hasil tersimpan sebagai pembelajaran periode berikutnya.</span></div>}
      </div>
    </section>
  );
}
