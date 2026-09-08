import { useState } from 'react';
import type { Platform } from '../reports/types';
import type { SummaryKpi } from '../../lib/summary';
import { generateAiSummary, saveAiSummaryEdit, type AiSummaryContent, type AiSummaryRecord } from '../reports/api';

// AI Summary — kartu terakhir di tiap laporan platform.
//
// Sengaja manual (tombol, bukan otomatis saat laporan jadi): satu laporan
// bisa di-generate berkali-kali sambil pengguna menukar file dan metrik, dan
// memanggil model tiap kali itu terjadi membakar kuota untuk jawaban yang
// belum tentu dibaca. Backend menyimpan cache per isi payload, jadi menekan
// tombol dua kali pada data yang sama tidak memanggil model dua kali.
//
// Kegagalannya berdiri sendiri: apa pun yang terjadi di sini, laporan di
// atasnya tetap utuh dan tetap bisa diunduh.

const FIELDS: { key: keyof Omit<AiSummaryContent, 'diagnosis'>; title: string; hint: string }[] = [
  { key: 'winning', title: 'Winning', hint: 'yang terbukti bekerja' },
  { key: 'challenge', title: 'Challenge', hint: 'masalah nyata periode ini' },
  { key: 'strategic_direction', title: 'Strategic Direction', hint: 'arah periode berikutnya' },
  { key: 'action_items', title: 'Action Items', hint: 'langkah konkret' },
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

function toPlain(kpis: SummaryKpi[] | undefined) {
  return (kpis ?? []).map((k) => ({ label: k.label, old: k.old, cur: k.cur, delta: k.delta }));
}

export function AiSummarySection({ clientId, platform, period, periodDates, kpis, cpasKpis, periodWarning, notes }: AiSummarySectionProps) {
  const [record, setRecord] = useState<AiSummaryRecord | null>(null);
  const [cached, setCached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AiSummaryContent | null>(null);
  const [saving, setSaving] = useState(false);

  const content = record ? record.edited_summary ?? record.summary : null;

  async function run(refresh: boolean) {
    if (!clientId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await generateAiSummary({
        clientId,
        platform,
        period: {
          oldLabel: period.old,
          curLabel: period.cur,
          oldStart: periodDates?.oldStart ?? null,
          oldEnd: periodDates?.oldEnd ?? null,
          curStart: periodDates?.curStart ?? null,
          curEnd: periodDates?.curEnd ?? null,
        },
        performance: {
          period,
          kpis: toPlain(kpis),
          cpasKpis: cpasKpis?.length ? toPlain(cpasKpis) : undefined,
          periodWarning: periodWarning ?? null,
          notes,
        },
        refresh,
      });
      setRecord(res.summary);
      setCached(res.cached);
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat ringkasan.');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!record || !clientId || !draft) return;
    setSaving(true);
    setError(null);
    try {
      setRecord(await saveAiSummaryEdit(record.id, clientId, draft));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan suntingan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sec-block ai-sum">
      <div className="sec-heading ai-sum-heading">
        <span>AI Summary</span>
        <span className="ai-sum-tools">
          {content && !draft && (
            <>
              <button className="btn btn-ghost ai-sum-btn" onClick={() => setDraft({ ...content })} disabled={busy}>
                Edit
              </button>
              <button className="btn btn-ghost ai-sum-btn" onClick={() => run(true)} disabled={busy}>
                {busy ? 'Membuat…' : '↻ Generate ulang'}
              </button>
            </>
          )}
          {draft && (
            <>
              <button className="btn btn-ghost ai-sum-btn" onClick={() => setDraft(null)} disabled={saving}>
                Batal
              </button>
              <button className="btn ai-sum-btn" onClick={saveEdit} disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan suntingan'}
              </button>
            </>
          )}
        </span>
      </div>

      <div className="ai-sum-body">
        {!content && !error && (
          <div className="ai-sum-empty">
            <p>
              Ringkasan analisis dari data di atas, dibaca bersama Brand Context dan Current Direction brand ini
              (dari halaman Pengaturan Brand) serta ringkasan periode-periode sebelumnya.
            </p>
            {!clientId && <p className="ai-sum-warn">Pilih brand dulu di bagian atas halaman.</p>}
            <button className="btn ai-sum-cta" onClick={() => run(false)} disabled={!clientId || busy || !kpis.length}>
              {busy ? 'Menganalisis…' : '✨ Generate AI Summary'}
            </button>
          </div>
        )}

        {error && (
          <div className="ai-sum-error">
            <strong>Ringkasan gagal dibuat.</strong>
            <span>{error}</span>
            <button className="btn btn-ghost ai-sum-btn" onClick={() => run(true)} disabled={busy}>
              {busy ? 'Mencoba…' : 'Coba lagi'}
            </button>
            <small>Laporan di atas tidak terpengaruh dan tetap bisa diunduh.</small>
          </div>
        )}

        {content && !draft && (
          <>
            <div className="ai-sum-diagnosis">
              <h4>Diagnosis</h4>
              <p>{content.diagnosis || '—'}</p>
            </div>
            <div className="ai-sum-grid">
              {FIELDS.map((f) => (
                <div className="ai-sum-card" key={f.key}>
                  <h4>{f.title} <small>{f.hint}</small></h4>
                  {content[f.key].length ? (
                    <ul>{content[f.key].map((item, i) => <li key={i}>{item}</li>)}</ul>
                  ) : (
                    <p className="ai-sum-none">Tidak ada catatan.</p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {draft && (
          <div className="ai-sum-edit">
            <label>
              <span>Diagnosis</span>
              <textarea rows={4} value={draft.diagnosis} onChange={(e) => setDraft({ ...draft, diagnosis: e.target.value })} />
            </label>
            {FIELDS.map((f) => (
              <label key={f.key}>
                <span>{f.title} <small>satu poin per baris</small></span>
                <textarea
                  rows={4}
                  value={draft[f.key].join('\n')}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value.split('\n') })}
                />
              </label>
            ))}
          </div>
        )}

        {record && (
          <div className="ai-sum-foot">
            <span>
              {record.model}
              {' · '}
              {new Date(record.updated_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {cached && ' · dari cache (data belum berubah)'}
              {record.edited_summary && ` · disunting${record.edited_by_name ? ` oleh ${record.edited_by_name}` : ''}`}
            </span>
            <span className="ai-sum-disclaimer">
              Draft AI — periksa sebelum dikirim ke klien. Tersimpan sebagai konteks periode untuk laporan berikutnya.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
