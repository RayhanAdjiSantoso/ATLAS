import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ArrowRight, CalendarClock, Check, Loader2, Scale, X } from 'lucide-react';
import { fmtRp, fmtRpShort } from '../../dailyTracking/lib/summary.js';
import MonthBars from './MonthBars.jsx';
import { MONTH_SHORT, changeFromOriginal, planMonths, runningMonth, signedPct } from './annualModel.js';

// The step between typing a new annual target and saving it: how the new
// totals reach the months.
//   A · Bagi rata 12 bulan — every month gets an even share; months already
//       over are measured against the new figure too. Can also mark the
//       update as a correction of a wrongly entered target awal.
//   B · Bulan berjalan & berikutnya — months already over keep their targets,
//       the running month and the ones after take the rest.
// Both show the months before → after on the same chart, so the effect is
// visible before anything is saved.

const range = (a, b) => (a === b ? MONTH_SHORT[a] : `${MONTH_SHORT[a]}–${MONTH_SHORT[b]}`);

export default function UpdateTargetDialog({ open, year, data, draft, typo, saving, error, onCancel, onConfirm }) {
  const reduce = useReducedMotion();
  const from = runningMonth(year);
  const [split, setSplit] = useState('remaining');
  const [correction, setCorrection] = useState(false);
  const [metric, setMetric] = useState('sales');
  const firstRef = useRef(null);

  const plans = useMemo(() => {
    if (!open || !data) return null;
    const sales = Number(draft.sales) || 0;
    const spend = draft.spend === '' ? null : Number(draft.spend);
    const cur = (key) => data.months.map((m) => m[key] ?? 0);
    const make = (s) => ({
      sales: planMonths(cur('targetSales'), sales, s, from),
      spend: spend != null ? planMonths(cur('targetSpend'), spend, s, from) : null,
    });
    const even = make('even');
    const remaining = from ? make('remaining') : null;
    const remainingOk = remaining && remaining.sales.values && (!remaining.spend || remaining.spend.values);
    // How hard B bends the year: the months that move against the average of
    // the ones that stay.
    let jump = null;
    if (remainingOk && from > 1) {
      const pastAvg = remaining.sales.past / (from - 1);
      const restAvg = remaining.sales.rest / (13 - from);
      if (pastAvg > 0) jump = restAvg / pastAvg;
    }
    return { sales, spend, even, remaining, remainingOk, jump };
  }, [open, data, draft, from]);

  const recommended = typo || !plans?.remainingOk ? 'even' : 'remaining';

  // Fresh choice each time the dialog opens, starting on the recommendation.
  useEffect(() => {
    if (!open) return;
    setSplit(recommended);
    setCorrection(Boolean(typo));
    setMetric('sales');
    const id = requestAnimationFrame(() => firstRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onCancel]);

  const annual = data?.annual;
  const original = data?.original;
  const plan = plans ? (split === 'even' ? plans.even : plans.remaining) : null;
  const chartPlan = plan && plan[metric];
  const current = data ? data.months.map((m) => (metric === 'sales' ? m.targetSales : m.targetSpend) ?? 0) : [];
  const nowIdx = from && year === new Date().getFullYear() ? from - 1 : -1;
  const lockedBefore = split === 'remaining' && from ? from - 1 : 0;
  const pastLabel = from > 1 ? range(0, from - 2) : null;
  const restLabel = from ? range(from - 1, 11) : null;

  const options = plans && [
    {
      id: 'even',
      letter: 'A',
      icon: Scale,
      title: 'Bagi rata 12 bulan',
      desc: 'Semua bulan dapat porsi sama dari target baru. Capaian bulan yang sudah lewat ikut dihitung ulang.',
      figure: fmtRpShort(plans.even.sales.values[0]),
      figureNote: 'per bulan',
      lines: [
        plans.even.spend ? `Budget ${fmtRpShort(plans.even.spend.values[0])} / bulan` : null,
        'Cocok bila target awal keliru atau dihitung ulang setahun penuh',
      ],
    },
    {
      id: 'remaining',
      letter: 'B',
      icon: CalendarClock,
      title: 'Bulan berjalan & berikutnya',
      disabled: !plans.remainingOk,
      desc: !from
        ? `Semua bulan ${year} sudah lewat, tidak ada bulan yang bisa diubah.`
        : from === 1
          ? `${year} belum berjalan — 12 bulan dibagi ulang mengikuti pola pembagian sekarang.`
          : `${pastLabel} tetap dengan target lama. Selisihnya dibagi ke ${restLabel} mengikuti pola sekarang.`,
      figure: plans.remainingOk ? fmtRpShort(plans.remaining.sales.rest / (13 - from)) : '—',
      figureNote: from > 1 ? `rata-rata / bulan ${restLabel}` : 'rata-rata / bulan',
      lines: [
        plans.remainingOk && from > 1 ? `${pastLabel} tetap ${fmtRpShort(plans.remaining.sales.past)}` : null,
        from && !plans.remainingOk ? `Target baru lebih kecil dari total ${pastLabel} (${fmtRpShort(plans.remaining.sales.past)})` : null,
      ],
    },
  ];

  const salesChange = changeFromOriginal(plans?.sales, original?.targetSales);
  const spendChange = plans?.spend != null ? changeFromOriginal(plans.spend, original?.targetSpend) : null;
  const motionProps = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, scale: 0.97, y: 10 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.98, y: 6 } };

  return createPortal(
    <AnimatePresence>
      {open && plans && (
        <motion.div
          className="at-dlg-root"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}
        >
          <motion.div
            className="at-dlg"
            role="dialog" aria-modal="true" aria-labelledby="at-dlg-title"
            {...motionProps}
            transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
          >
            <header className="at-dlg-head">
              <div>
                <span className="at-dlg-kicker">Update target {year}</span>
                <h2 id="at-dlg-title">Bagaimana target baru dibagi ke bulan?</h2>
              </div>
              <button type="button" className="at-dlg-x" onClick={onCancel} disabled={saving} aria-label="Tutup"><X size={18} /></button>
            </header>

            <div className="at-dlg-delta">
              <div>
                <span>Target sales</span>
                <p><s>{fmtRpShort(annual.targetSales)}</s><ArrowRight size={14} aria-hidden="true" /><b>{fmtRp(plans.sales)}</b></p>
                {salesChange != null && <em className={salesChange >= 0 ? 'is-up' : 'is-down'}>{signedPct(salesChange)} dari {data.corrected ? 'target awal (dikoreksi)' : 'target awal'}</em>}
              </div>
              {plans.spend != null && (
                <div>
                  <span>Budget iklan</span>
                  <p>{annual.targetSpend != null && <><s>{fmtRpShort(annual.targetSpend)}</s><ArrowRight size={14} aria-hidden="true" /></>}<b>{fmtRp(plans.spend)}</b></p>
                  {spendChange != null && <em className="is-neutral">{signedPct(spendChange)} dari awal</em>}
                </div>
              )}
              {draft.note && <q>{draft.note}</q>}
            </div>

            <div className="at-dlg-options" role="radiogroup" aria-label="Cara membagi target">
              {options.map((o, i) => {
                const Icon = o.icon;
                const on = split === o.id;
                return (
                  <button
                    key={o.id}
                    ref={i === 0 ? firstRef : undefined}
                    type="button" role="radio" aria-checked={on}
                    className={`at-opt${on ? ' is-on' : ''}`}
                    disabled={o.disabled || saving}
                    onClick={() => setSplit(o.id)}
                  >
                    <span className="at-opt-top">
                      <span className="at-opt-letter">{o.letter}</span>
                      <Icon size={16} aria-hidden="true" />
                      <b>{o.title}</b>
                      {recommended === o.id && !o.disabled && <i className="at-opt-rec">Disarankan</i>}
                      <span className="at-opt-radio" aria-hidden="true">{on && <Check size={12} strokeWidth={3} />}</span>
                    </span>
                    <span className="at-opt-desc">{o.desc}</span>
                    <span className="at-opt-fig"><strong>{o.figure}</strong><small>{o.figureNote}</small></span>
                    {o.lines.filter(Boolean).map((l) => <span key={l} className="at-opt-line">{l}</span>)}
                  </button>
                );
              })}
            </div>

            <section className="at-dlg-chart" aria-label="Pratinjau per bulan">
              <div className="at-dlg-chart-head">
                <div className="at-legend">
                  <span><i className="is-ghost" /> Sekarang</span>
                  <span><i className="is-new" /> Setelah update</span>
                  {lockedBefore > 0 && <span><i className="is-locked" /> Tetap</span>}
                </div>
                {plans.spend != null && (
                  <div className="at-mini-seg" role="tablist" aria-label="Pratinjau">
                    {[['sales', 'Sales'], ['spend', 'Budget']].map(([k, l]) => (
                      <button key={k} type="button" role="tab" aria-selected={metric === k} className={metric === k ? 'is-on' : ''} onClick={() => setMetric(k)}>{l}</button>
                    ))}
                  </div>
                )}
              </div>
              {chartPlan?.values ? (
                <MonthBars
                  values={chartPlan.values}
                  ghost={current}
                  lockedBefore={lockedBefore}
                  currentIdx={nowIdx}
                  height={150}
                  tip={(i) => (
                    <>
                      <b>{MONTH_SHORT[i]} {year}</b>
                      <span>{fmtRpShort(current[i])} → {fmtRpShort(chartPlan.values[i])}</span>
                      {i < lockedBefore && <small>tetap</small>}
                    </>
                  )}
                />
              ) : <p className="at-dlg-empty">Opsi ini tidak bisa dipakai untuk angka ini.</p>}
            </section>

            <AnimatePresence initial={false}>
              {split === 'remaining' && plans.jump != null && (plans.jump >= 3 || plans.jump <= 1 / 3) && (
                <motion.p key="jump" className="at-dlg-warn" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
                  <AlertTriangle size={15} aria-hidden="true" />
                  <span>{restLabel} jadi {plans.jump.toLocaleString('id-ID', { maximumFractionDigits: 1 })}× rata-rata {pastLabel}. Kalau target awal salah input, opsi A lebih tepat agar capaian bulan lalu tidak melonjak.</span>
                </motion.p>
              )}
              {split === 'even' && (
                <motion.label key="corr" className={`at-dlg-check${correction ? ' is-on' : ''}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
                  <input type="checkbox" checked={correction} onChange={(e) => setCorrection(e.target.checked)} disabled={saving} />
                  <span>
                    <b>Target awal salah input — jadikan angka ini target awal</b>
                    <small>Rp{(original?.targetSales ?? 0).toLocaleString('id-ID')} tetap ada di riwayat, ditandai diganti. Persentase update berikutnya dihitung dari angka baru.</small>
                  </span>
                </motion.label>
              )}
            </AnimatePresence>

            {error && <p className="at-msg is-error" role="alert">{error}</p>}

            <footer className="at-dlg-foot">
              <span>Target awal dan semua versi tetap tersimpan di riwayat.</span>
              <div>
                <button type="button" className="bp-ghost" onClick={onCancel} disabled={saving}>Kembali</button>
                <button
                  type="button" className="bp-primary"
                  disabled={saving || (split === 'remaining' && !plans.remainingOk)}
                  onClick={() => onConfirm({ split, correction: split === 'even' && correction })}
                >
                  {saving ? <Loader2 size={15} className="brand-spin" /> : <Check size={15} />}
                  {split === 'even' ? (correction ? 'Terapkan A · koreksi' : 'Terapkan opsi A') : 'Terapkan opsi B'}
                </button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
