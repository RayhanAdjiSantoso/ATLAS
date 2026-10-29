import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Check, History, Loader2, PencilLine, Target, X } from 'lucide-react';
import api from '../../api/client.js';
import { fmtRp, fmtRpShort } from '../../dailyTracking/lib/summary.js';
import { presetBrandTracking } from '../common/brandSettingsLink.js';
import MonthBars from './MonthBars.jsx';
import UpdateTargetDialog from './UpdateTargetDialog.jsx';
import {
  MONTH_LONG, MONTH_SHORT, changeFromOriginal, digits, monthLong, pct, signedPct, splitEqual, thousands,
} from './annualModel.js';
import './annualTarget.css';

// Brand Setting › Target tahunan. The year's sales target and ad budget for
// one brand: the current figures against the target awal, how far the year's
// sales have got, the 12 months as Brand Tracking holds them, and every
// version ever set.
//
// The first save is the target awal, split evenly. Later changes are typed
// here and confirmed in UpdateTargetDialog, which asks how they reach the
// months (even over 12, or only the running month on) and can mark a
// wrongly entered target awal as corrected. Nothing is ever erased: the
// history keeps every version.

const ratioX = (s, b) => (s && b ? `${(s / b).toLocaleString('id-ID', { maximumFractionDigits: 2 })}x` : '—');
// Cost per Revenue = budget ÷ sales, as the Report Generator reads it.
const costPct = (s, b) => (s && b != null ? pct(b / s, 2) : '—');

// Blended ROAS and Cost per Revenue are the same figure seen two ways
// (CPR = 100% ÷ ROAS), so the editor keeps one exact ratio — budget ÷ sales —
// and the budget follows from it. Typing either field rewrites the other;
// "4,5" and "4.5" both read as four and a half.
const fmtDec = (v) => v.toLocaleString('id-ID', { maximumFractionDigits: 2 });
const parseDec = (s) => {
  const n = Number(String(s).replace(',', '.'));
  return String(s).trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
};
const ratioFields = (ratio) => (ratio ? { roas: fmtDec(1 / ratio), cpr: fmtDec(ratio * 100), ratio } : { roas: '', cpr: '', ratio: null });
const spendOf = (form) => (form.ratio && Number(form.sales) > 0 ? Math.round(Number(form.sales) * form.ratio) : null);

function RatioField({ label, unit, value, onChange, previous, placeholder }) {
  return (
    <label className="at-field">
      <span>{label}<small>opsional</small></span>
      <div className="at-money"><input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={placeholder} /><b>{unit}</b></div>
      {previous && <small className="at-field-prev">Sekarang {previous}</small>}
    </label>
  );
}
const dateId = (d) => new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const chipTone = (v) => (v == null ? '' : v > 0 ? 'is-up' : v < 0 ? 'is-down' : 'is-flat');

function MoneyField({ label, optional, value, onChange, previous, placeholder, autoFocus }) {
  const change = previous && Number(value) > 0 ? changeFromOriginal(Number(value), previous) : null;
  return (
    <label className="at-field">
      <span>{label}{optional && <small>opsional</small>}</span>
      <div className="at-money"><b>Rp</b><input inputMode="numeric" value={thousands(value)} onChange={(e) => onChange(digits(e.target.value))} placeholder={placeholder} autoFocus={autoFocus} /></div>
      {previous != null && (
        <small className="at-field-prev">
          Sekarang {fmtRpShort(previous)}
          {change != null && change !== 0 && <i className={`at-chip ${chipTone(change)}`}>{signedPct(change)}</i>}
        </small>
      )}
    </label>
  );
}

export default function AnnualTargetCard({ brandId, canEdit }) {
  const reduce = useReducedMotion();
  const today = new Date();
  const thisYear = today.getFullYear();
  const [year, setYear] = useState(thisYear);
  const [state, setState] = useState({ status: 'loading', data: null });
  const [form, setForm] = useState(null); // { mode: 'create' | 'update', sales, roas, cpr, ratio, note }
  const [dialog, setDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState(null);
  const [message, setMessage] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null });
    setForm(null);
    setDialog(false);
    setMessage(null);
    api.get('/daily-tracking/annual-targets', { params: { brandId, year } })
      .then(({ data }) => alive && setState({ status: 'ready', data }))
      .catch((err) => alive && setState({ status: 'error', error: err.response?.data?.message || 'Target tahunan tidak dapat dimuat' }));
    return () => { alive = false; };
  }, [brandId, year]);

  const data = state.data;
  const annual = data?.annual;
  const original = data?.original;
  const revisions = useMemo(() => data?.revisions ?? [], [data]);
  const updates = data?.updates ?? 0;
  const corrected = Boolean(data?.corrected);
  const baseLabel = corrected ? 'target awal (dikoreksi)' : 'target awal';

  // Where the year stands: months up to the running one (all of a past year,
  // none of a later one).
  const currentIdx = year === thisYear ? today.getMonth() : -1;
  const throughIdx = year < thisYear ? 11 : year > thisYear ? -1 : today.getMonth();
  const progress = useMemo(() => {
    if (!data || !annual) return null;
    const upTo = data.months.slice(0, throughIdx + 1);
    const actual = upTo.reduce((a, m) => a + (m.actualSales ?? 0), 0);
    const target = upTo.reduce((a, m) => a + (m.targetSales ?? 0), 0);
    return {
      actual, target,
      ofYear: annual.targetSales ? actual / annual.targetSales : 0,
      pace: annual.targetSales ? target / annual.targetSales : 0,
      ofPace: target ? actual / target : null,
    };
  }, [data, annual, throughIdx]);

  // The versions as they read in the history: Target awal, Update n, Koreksi,
  // each with how far it moved from the one before. Newest first.
  const history = useMemo(() => {
    let n = 0;
    return revisions.map((r, i) => {
      const label = r.kind === 'original' ? 'Target awal' : r.kind === 'correction' ? 'Koreksi' : `Update ${(n += 1)}`;
      const prev = revisions[i - 1];
      return { ...r, label, change: prev ? changeFromOriginal(r.targetSales, prev.targetSales) : null };
    }).reverse();
  }, [revisions]);

  const startCreate = () => { setMessage(null); setForm({ mode: 'create', sales: '', ...ratioFields(null), note: '' }); };
  const startUpdate = () => {
    setMessage(null);
    const ratio = annual.targetSales && annual.targetSpend != null ? annual.targetSpend / annual.targetSales : null;
    setForm({ mode: 'update', sales: String(annual.targetSales ?? ''), ...ratioFields(ratio), note: '' });
  };
  // The typed field keeps exactly what was typed; the other is recomputed.
  const setRoas = (text) => {
    const v = parseDec(text);
    setForm((f) => ({ ...f, roas: text, cpr: v ? fmtDec(100 / v) : '', ratio: v ? 1 / v : null }));
  };
  const setCpr = (text) => {
    const v = parseDec(text);
    setForm((f) => ({ ...f, cpr: text, roas: v ? fmtDec(100 / v) : '', ratio: v ? v / 100 : null }));
  };
  const draftSpend = form ? spendOf(form) : null;

  // A change this size usually means the target awal was a typo (a month's
  // figure as the year's) — the dialog then suggests option A as a correction.
  const typo = Boolean(form?.mode === 'update' && original?.targetSales && Number(form.sales) > 0
    && (Number(form.sales) >= original.targetSales * 3 || Number(form.sales) <= original.targetSales / 3));

  const invalid = (() => {
    if (!form) return null;
    if (!(Number(form.sales) > 0)) return 'Isi target sales tahunan.';
    if ((form.roas.trim() || form.cpr.trim()) && !form.ratio) return 'Blended ROAS dan Cost per Revenue harus lebih dari 0.';
    // Same figures are allowed: re-splitting evenly, or marking a wrong
    // target awal as corrected, are updates in their own right.
    if (form.mode === 'update') {
      if (!form.note.trim()) return 'Tulis alasan update agar riwayatnya jelas.';
    }
    return null;
  })();

  const put = (extra) => api.put('/daily-tracking/annual-targets', {
    brandId, year,
    targetSales: Number(form.sales),
    targetSpend: draftSpend,
    note: form.note || undefined,
    ...extra,
  });

  const create = async () => {
    if (invalid) return;
    setSaving(true);
    setMessage(null);
    try {
      const { data: next } = await put({});
      setState({ status: 'ready', data: next });
      setMessage({ tone: 'ok', text: `Target ${year} tersimpan dan dibagi rata ke 12 bulan di Brand Tracking.` });
      setForm(null);
    } catch (err) {
      setMessage({ tone: 'error', text: err.response?.data?.message || 'Target tahunan gagal disimpan' });
    } finally {
      setSaving(false);
    }
  };

  const confirmUpdate = async ({ split, correction }) => {
    setSaving(true);
    setDialogError(null);
    try {
      const { data: next } = await put({ split, correction });
      setState({ status: 'ready', data: next });
      setDialog(false);
      setForm(null);
      setMessage({
        tone: 'ok',
        text: correction ? `Target awal ${year} dikoreksi dan 12 bulan dibagi rata. Angka lama tetap ada di riwayat.`
          : split === 'even' ? `Target ${year} diperbarui dan dibagi rata ke 12 bulan. Target awal tetap tersimpan.`
            : `Target ${year} diperbarui untuk bulan berjalan dan berikutnya. Bulan yang sudah lewat tetap.`,
      });
    } catch (err) {
      setDialogError(err.response?.data?.message || 'Target tahunan gagal disimpan');
    } finally {
      setSaving(false);
    }
  };

  const openTracking = () => {
    presetBrandTracking({ brandId, view: 'target' });
    navigate('/brand-tracking');
  };

  const salesChange = changeFromOriginal(annual?.targetSales, original?.targetSales);
  const spendChange = changeFromOriginal(annual?.targetSpend, original?.targetSpend);
  const ease = [0.23, 1, 0.32, 1];
  const swap = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } };
  const createSplit = form?.mode === 'create' && Number(form.sales) > 0 ? splitEqual(Number(form.sales)) : null;

  return (
    <section className="at-card" data-feature="target-tahunan" aria-label="Target tahunan">
      <header className="at-head">
        <div>
          <h3><Target size={16} aria-hidden="true" /> Target tahunan</h3>
          <p>Target sales dan budget iklan setahun. Brand Tracking membaginya ke 12 bulan.</p>
        </div>
        <div className="at-years" role="tablist" aria-label="Tahun target">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <button key={y} type="button" role="tab" aria-selected={y === year} className={y === year ? 'is-on' : ''} onClick={() => setYear(y)} disabled={saving}>
              {y}{y === thisYear && <i aria-hidden="true" />}
            </button>
          ))}
        </div>
      </header>

      <AnimatePresence initial={false}>
        {message && (
          <motion.p key={message.text} className={`at-msg is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'} {...swap} transition={{ duration: 0.2 }}>
            {message.tone === 'ok' && <Check size={14} aria-hidden="true" />}{message.text}
          </motion.p>
        )}
      </AnimatePresence>

      {state.status === 'loading' && <div className="at-skeleton" role="status" aria-label={`Memuat target ${year}`}><i /><i /><i /></div>}
      {state.status === 'error' && <p className="at-state is-error">{state.error}</p>}

      {state.status === 'ready' && (
        <AnimatePresence mode="wait" initial={false}>
          {form ? (
            <motion.div key="editor" className="at-editor" {...swap} transition={{ duration: 0.22, ease }}>
              <header className="at-editor-head">
                <span className="at-eyebrow">{form.mode === 'create' ? `Target ${year}` : `Update target ${year}`}</span>
                <p>{form.mode === 'create'
                  ? 'Angka ini jadi target awal dan dibagi rata ke 12 bulan. Pembagiannya bisa diatur di Brand Tracking.'
                  : 'Isi angka baru. Setelah ini Anda memilih cara membaginya ke bulan — target awal tetap tersimpan.'}</p>
              </header>
              <div className="at-editor-grid">
                <MoneyField label={`Target sales ${year}`} value={form.sales} onChange={(v) => setForm({ ...form, sales: v })} previous={form.mode === 'update' ? annual.targetSales : null} placeholder="4.000.000.000" autoFocus />
                <RatioField label="Blended ROAS" unit="x" value={form.roas} onChange={setRoas} placeholder="5,5"
                  previous={form.mode === 'update' && annual.targetSpend ? ratioX(annual.targetSales, annual.targetSpend) : null} />
                <RatioField label="Cost per Revenue" unit="%" value={form.cpr} onChange={setCpr} placeholder="18"
                  previous={form.mode === 'update' && annual.targetSpend != null ? costPct(annual.targetSales, annual.targetSpend) : null} />
                <div className="at-roas"><span>Budget iklan</span><strong>{draftSpend != null ? fmtRpShort(draftSpend) : '—'}</strong><small>sales ÷ ROAS</small></div>
              </div>
              {form.mode === 'update' && (
                <label className="at-field">
                  <span>Alasan update <small>wajib</small></span>
                  <input className="at-text" value={form.note} maxLength={1000} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="mis. Q4 dinaikkan untuk campaign 12.12, atau target awal salah input" />
                </label>
              )}
              {createSplit && (
                <div className="at-editor-preview">
                  <MonthBars values={createSplit} height={56} />
                  <p>±{fmtRp(createSplit[0])} sales{draftSpend > 0 ? ` · ±${fmtRp(splitEqual(draftSpend)[0])} budget` : ''} per bulan. <b>Pastikan ini angka setahun, bukan sebulan.</b> Target bulanan {year} yang sudah ada diganti; alokasi channel tetap.</p>
                </div>
              )}
              {invalid && (form.sales !== '' || form.mode === 'update') && <p className="at-hint">{invalid}</p>}
              <footer className="at-actions">
                <button type="button" className="bp-ghost" onClick={() => setForm(null)} disabled={saving}><X size={15} aria-hidden="true" /> Batal</button>
                {form.mode === 'create' ? (
                  <button type="button" className="bp-primary" onClick={create} disabled={saving || Boolean(invalid)}>
                    {saving ? <Loader2 size={15} className="brand-spin" /> : <Check size={15} />} Simpan target
                  </button>
                ) : (
                  <button type="button" className="bp-primary" onClick={() => { setDialogError(null); setDialog(true); }} disabled={Boolean(invalid)}>
                    Lanjut · pilih pembagian <ArrowRight size={15} aria-hidden="true" />
                  </button>
                )}
              </footer>
            </motion.div>
          ) : !annual ? (
            <motion.div key="empty" className="at-empty" {...swap} transition={{ duration: 0.2 }}>
              <div className="at-empty-bars" aria-hidden="true">{MONTH_SHORT.map((m) => <i key={m} />)}</div>
              <div className="at-empty-copy">
                <p>Belum ada target tahunan untuk {year}.</p>
                <small>{canEdit ? 'Isi sekali setahun — Brand Tracking membaginya ke 12 bulan.' : 'Target diisi oleh tim MIL Digital.'}</small>
              </div>
              {canEdit && <button type="button" className="bp-primary" onClick={startCreate}><PencilLine size={15} aria-hidden="true" /> Isi target {year}</button>}
            </motion.div>
          ) : (
            <motion.div key="hero" className="at-hero" {...swap} transition={{ duration: 0.22, ease }}>
              <div className="at-hero-main">
                <div className="at-hero-top">
                  <span className="at-eyebrow">Target sales {year}</span>
                  <span className="at-hero-avg">±{fmtRpShort(annual.targetSales / 12)} / bulan</span>
                </div>
                <strong className="at-hero-num">{fmtRp(annual.targetSales)}</strong>
                <p className="at-hero-sub">
                  {updates > 0
                    ? <><i className={`at-chip ${chipTone(salesChange)}`}>{signedPct(salesChange)}</i> dari {baseLabel} {fmtRpShort(original.targetSales)}</>
                    : <i className="at-chip is-flat">{corrected ? 'Target awal (dikoreksi)' : 'Target awal'}</i>}
                </p>
                {progress && (
                  <div className="at-progress">
                    <div className="at-progress-bar" role="img" aria-label={`Realisasi ${pct(progress.ofYear)} dari target setahun`}>
                      <i style={{ transform: `scaleX(${Math.min(progress.ofYear, 1)})` }} />
                      {throughIdx >= 0 && throughIdx < 11 && <b style={{ left: `${Math.min(progress.pace, 1) * 100}%` }} title={`Target s.d. ${MONTH_SHORT[throughIdx]}`} />}
                    </div>
                    <div className="at-progress-meta">
                      <span><strong>{pct(progress.ofYear)}</strong> tercapai · {fmtRpShort(progress.actual)}</span>
                      <span>
                        {throughIdx < 0 ? `${year} belum berjalan`
                          : year < thisYear ? `${pct(progress.ofPace)} dari target ${year}`
                            : <>Target s.d. {MONTH_SHORT[throughIdx]} {fmtRpShort(progress.target)} · <b className={progress.ofPace >= 1 ? 'is-up' : progress.ofPace >= 0.9 ? '' : 'is-down'}>{pct(progress.ofPace)}</b></>}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <dl className="at-hero-side">
                <div>
                  <dt>Budget iklan</dt>
                  <dd>{annual.targetSpend != null ? fmtRp(annual.targetSpend) : '—'}</dd>
                  <small>{annual.targetSpend == null ? 'Belum diisi'
                    : updates > 0 && original.targetSpend != null && spendChange !== 0 ? <><i className={`at-chip ${chipTone(spendChange)}`}>{signedPct(spendChange)}</i> dari {fmtRpShort(original.targetSpend)}</>
                      : `±${fmtRpShort(annual.targetSpend / 12)} / bulan`}</small>
                </div>
                <div>
                  <dt>Blended ROAS</dt>
                  <dd>{ratioX(annual.targetSales, annual.targetSpend)}</dd>
                  <small>{annual.targetSpend ? `Cost per Revenue ${costPct(annual.targetSales, annual.targetSpend)}` : 'sales ÷ budget'}</small>
                </div>
                {canEdit && (
                  <button type="button" className="bp-primary at-hero-cta" onClick={startUpdate}><PencilLine size={15} aria-hidden="true" /> Update target</button>
                )}
              </dl>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {state.status === 'ready' && annual && (
        <>
          <section className="at-panel" aria-label="Pembagian per bulan">
            <header className="at-panel-head">
              <h4>Pembagian per bulan</h4>
              <div className="at-legend">
                <span><i className="is-target" /> Target</span>
                <span><i className="is-real" /> Realisasi</span>
              </div>
              <button type="button" className="at-link" onClick={openTracking}>Atur di Brand Tracking <ArrowUpRight size={13} aria-hidden="true" /></button>
            </header>
            <MonthBars
              values={data.months.map((m) => m.targetSales ?? 0)}
              actual={data.months.map((m) => m.actualSales)}
              currentIdx={currentIdx}
              doneBefore={year < thisYear ? 12 : Math.max(currentIdx, 0)}
              height={120}
              tip={(i) => {
                const m = data.months[i];
                return (
                  <>
                    <b>{MONTH_LONG[i]} {year}</b>
                    <span>Target {fmtRpShort(m.targetSales)}</span>
                    <span>Realisasi {m.actualSales != null ? fmtRpShort(m.actualSales) : '—'}{m.actualSales != null && m.targetSales ? ` · ${pct(m.actualSales / m.targetSales, 0)}` : ''}</span>
                    {m.targetSpend != null && <small>Budget {fmtRpShort(m.targetSpend)}</small>}
                  </>
                );
              }}
            />
          </section>

          <section className="at-panel" aria-label="Riwayat target">
            <header className="at-panel-head">
              <h4><History size={14} aria-hidden="true" /> Riwayat target</h4>
              <span className="at-panel-note">{revisions.length} versi · target awal tidak pernah dihapus</span>
            </header>
            <ol className="at-tl">
              {history.map((r, i) => (
                <motion.li
                  key={r.version}
                  className={`is-${r.kind}${r.superseded ? ' is-superseded' : ''}${i === 0 ? ' is-latest' : ''}`}
                  initial={reduce ? false : { opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.24, delay: reduce ? 0 : i * 0.04, ease }}
                >
                  <span className="at-tl-dot" aria-hidden="true" />
                  <div className="at-tl-row">
                    <span className={`at-ver is-${r.kind}`}>{r.label}</span>
                    {i === 0 && <span className="at-tl-now">berlaku</span>}
                    <span className="at-tl-fig">{fmtRp(r.targetSales)}</span>
                    {r.change != null && r.change !== 0 && <i className={`at-chip ${chipTone(r.change)}`}>{signedPct(r.change)}</i>}
                  </div>
                  <span className="at-tl-meta">
                    {r.targetSpend != null && <>Budget {fmtRpShort(r.targetSpend)} · </>}
                    {r.superseded ? 'Diganti koreksi'
                      : r.kind === 'original' ? 'Dibagi rata 12 bulan'
                        : r.kind === 'correction' ? 'Mengganti target awal · 12 bulan dibagi rata'
                          : r.effectiveMonth?.endsWith('-01') ? '12 bulan dibagi ulang'
                            : `Mulai ${monthLong(r.effectiveMonth)} · bulan sebelumnya tetap`}
                    {' · '}{dateId(r.createdAt)}{r.createdByName ? ` · ${r.createdByName}` : ''}
                  </span>
                  {r.note && <span className="at-tl-note">“{r.note}”</span>}
                </motion.li>
              ))}
            </ol>
          </section>
        </>
      )}

      {annual && (
        <UpdateTargetDialog
          open={dialog}
          year={year}
          data={data}
          draft={form ? { sales: form.sales, spend: draftSpend ?? '', note: form.note } : { sales: '', spend: '', note: '' }}
          typo={typo}
          saving={saving}
          error={dialogError}
          onCancel={() => setDialog(false)}
          onConfirm={confirmUpdate}
        />
      )}
    </section>
  );
}
