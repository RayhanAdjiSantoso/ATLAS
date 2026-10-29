import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, History, Loader2, Scale, X } from 'lucide-react';
import api from '../../api/client.js';
import { fmtRp, fmtRpShort } from '../../dailyTracking/lib/summary.js';
import { presetBrandSettings } from '../common/brandSettingsLink.js';
import {
  MONTH_LONG, MONTH_SHORT, changeFromOriginal, monthIndex, monthLong, pct, signedPct, splitByWeight, splitEqual,
} from './annualModel.js';
import './annualTarget.css';

// Brand Tracking › Target & Budget › Rencana tahunan. The year set in Brand
// Setting, split across its 12 months. The split starts even and can be
// shaped by hand — heavier in campaign months, lighter elsewhere — by typing
// each month's share (Porsi); its target sales and ad budget follow from the
// year's totals. It can only be saved when the 12 shares add up to exactly
// 100%. Each month's figure is that month's target in the monthly view below.

// Shares are kept in basis points (1 = 0,01%) so twelve of them add up
// exactly; the inputs show and take percentages ("8,5" or "8.5").
const toBp = (s) => {
  const t = String(s ?? '').trim().replace(',', '.');
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const bpText = (bp) => (bp / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 });
// The current split as shares adding up to 100%: rounding leftovers go to
// the largest month.
function sharesOf(values, total) {
  if (!total) return splitEqual(10000);
  const bps = values.map((v) => Math.round(((v ?? 0) / total) * 10000));
  const big = bps.indexOf(Math.max(...bps));
  bps[big] += 10000 - bps.reduce((a, b) => a + b, 0);
  return bps;
}
// Rupiah per month from the shares: the stored amounts while the shares are
// untouched (no rounding drift on a save without changes), an exact split of
// the year once they add up to 100%, a plain share before that.
function amountsOf(bps, initial, stored, total) {
  if (bps.every((b, i) => b === initial[i])) return stored;
  const sum = bps.reduce((a, b) => a + (b ?? 0), 0);
  if (sum === 10000) return splitByWeight(total, bps);
  return bps.map((b) => Math.round((total * (b ?? 0)) / 10000));
}

// A quarter's total in the large type: one decimal and a unit (B = miliar,
// M = juta, K = ribu), as in "Rp 1.2 B".
function compact(v) {
  const n = Math.abs(v);
  const [div, unit] = n >= 1e9 ? [1e9, 'B'] : n >= 1e6 ? [1e6, 'M'] : n >= 1e3 ? [1e3, 'K'] : [1, ''];
  return { num: (v / div).toLocaleString('id-ID', { maximumFractionDigits: 1 }), unit };
}

export default function AnnualPlan({ brandId, month, canEdit, onSaved }) {
  const year = Number(String(month).slice(0, 4));
  const [state, setState] = useState({ status: 'loading', data: null });
  // Porsi typed in the Setting panel, per side, while it differs from what is
  // saved (null = nothing changed).
  const [draft, setDraft] = useState(null); // { sales: string[], spend: string[] }
  const [metric, setMetric] = useState('sales'); // which figure the quarters show
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null });
    setDraft(null);
    setMessage(null);
    api.get('/daily-tracking/annual-targets', { params: { brandId, year } })
      .then(({ data }) => alive && setState({ status: 'ready', data }))
      .catch((err) => alive && setState({ status: 'error', error: err.response?.data?.message || 'Rencana tahunan tidak dapat dimuat' }));
    return () => { alive = false; };
  }, [brandId, year]);

  const data = state.data;
  const annual = data?.annual;
  const hasSpend = annual?.targetSpend != null;
  const nowYm = new Date().toISOString().slice(0, 7);

  // The saved split as shares, and the split the panels show: shares in basis
  // points and the rupiah they give.
  const init = useMemo(() => (data && annual ? {
    sales: sharesOf(data.months.map((m) => m.targetSales), annual.targetSales),
    spend: sharesOf(data.months.map((m) => m.targetSpend), annual.targetSpend),
  } : null), [data, annual]);
  const plan = useMemo(() => {
    if (!init) return null;
    const side = (key, total, field) => {
      const bps = draft ? draft[key].map(toBp) : init[key];
      const valid = bps.every((b) => b !== null);
      const sum = bps.reduce((a, b) => a + (b ?? 0), 0);
      const stored = data.months.map((m) => m[field] ?? 0);
      return { bps, valid, sum, ok: valid && sum === 10000, amounts: amountsOf(bps, init[key], stored, total ?? 0) };
    };
    const sales = side('sales', annual.targetSales, 'targetSales');
    const spend = hasSpend ? side('spend', annual.targetSpend, 'targetSpend') : null;
    return { sales, spend, ok: sales.ok && (!spend || spend.ok) };
  }, [draft, init, annual, data, hasSpend]);

  if (state.status === 'loading') return <p className="at-state"><Loader2 size={14} className="dt-spin" /> Memuat rencana tahunan…</p>;
  if (state.status === 'error') return <p className="at-state is-error">{state.error}</p>;

  if (!annual) {
    return (
      <section className="soft-card tb-card at-plan is-empty" data-feature="rencana-tahunan" aria-label="Rencana tahunan">
        <header className="tb-head">
          <div>
            <h2>Rencana tahunan {year}</h2>
            <p>Belum ada target tahunan untuk {year}.{canEdit ? ' Target bulanan di bawah tetap bisa diatur per bulan.' : ' Target diatur oleh tim MIL Digital.'}</p>
          </div>
          {canEdit && (
            <Link to={`/pengaturan-brand?detail=${brandId}`} className="bp-ghost" onClick={() => presetBrandSettings({ brandId })}>
              Isi di Brand Setting <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          )}
        </header>
      </section>
    );
  }

  const months = data.months;
  const original = data.original;
  const updates = data.updates ?? 0;
  const baseLabel = data.corrected ? 'target awal (dikoreksi)' : 'target awal';
  const salesChange = changeFromOriginal(annual.targetSales, original?.targetSales);
  const ytd = months.filter((m) => m.month <= nowYm);
  const ytdSales = ytd.reduce((a, m) => a + (m.actualSales ?? 0), 0);
  const ytdTarget = ytd.reduce((a, m) => a + (m.targetSales ?? 0), 0);
  const ytdSpend = ytd.reduce((a, m) => a + (m.actualSpend ?? 0), 0);

  // The first keystroke opens a draft of both sides from the saved shares.
  const texts = (key) => (draft ? draft[key] : init[key].map(bpText));
  const setShare = (key, i, value) => {
    setMessage(null);
    setDraft((d) => {
      const base = d ?? { sales: init.sales.map(bpText), spend: init.spend.map(bpText) };
      return { ...base, [key]: base[key].map((v, j) => (j === i ? value.replace(/[^\d.,]/g, '') : v)) };
    });
  };
  const spreadEvenly = (key) => setDraft((d) => ({ ...(d ?? { sales: init.sales.map(bpText), spend: init.spend.map(bpText) }), [key]: splitEqual(10000).map(bpText) }));
  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const { data: next } = await api.put('/daily-tracking/annual-targets/split', {
        brandId, year,
        months: months.map((m, i) => ({ month: m.month, targetSales: plan.sales.amounts[i], targetSpend: hasSpend ? plan.spend.amounts[i] : null })),
      });
      setState({ status: 'ready', data: next });
      setDraft(null);
      setMessage({ tone: 'ok', text: `Pembagian ${year} tersimpan.` });
      onSaved?.();
    } catch (err) {
      setMessage({ tone: 'error', text: err.response?.data?.message || 'Pembagian gagal disimpan' });
    } finally {
      setSaving(false);
    }
  };

  // Porsi of one side against 100%.
  const sumLine = (label, side) => (
    <div className={`at-sum${side.ok ? ' is-ok' : side.sum > 10000 ? ' is-over' : ''}`}>
      <span className="at-sum-bar"><i style={{ transform: `scaleX(${Math.min(side.sum / 10000, 1)})` }} /></span>
      <b>Porsi {label} {bpText(side.sum)}%</b>
      <small>{!side.valid ? 'Ada porsi yang tidak valid' : side.ok ? 'Pas 100%' : side.sum > 10000 ? `Lebih ${bpText(side.sum - 10000)}%` : `Kurang ${bpText(10000 - side.sum)}%`}</small>
    </div>
  );

  // The quarters show one figure: target sales, or the ad budget.
  const view = metric === 'spend' && hasSpend ? 'spend' : 'sales';
  const side = plan[view];
  const yearTotal = view === 'sales' ? annual.targetSales : annual.targetSpend;
  const actualOf = (m) => (view === 'sales' ? m.actualSales : m.actualSpend);
  const quarters = [0, 1, 2, 3].map((q) => {
    const idx = [q * 3, q * 3 + 1, q * 3 + 2];
    return { q: q + 1, idx, total: idx.reduce((a, i) => a + (side.amounts[i] ?? 0), 0) };
  });
  const viewLabel = view === 'sales' ? 'Target sales' : 'Budget iklan';

  return (
    <section className="soft-card tb-card at-plan" data-feature="rencana-tahunan" aria-label="Rencana tahunan">
      <header className="tb-head">
        <div>
          <h2>Rencana tahunan {year}</h2>
          <p>
            Target {fmtRp(annual.targetSales)}{hasSpend ? ` · budget ${fmtRp(annual.targetSpend)}` : ''}
            {updates > 0 && <> · <span className="at-flag-inline"><History size={13} aria-hidden="true" /> Diperbarui {updates}× · {signedPct(salesChange)} dari {baseLabel} {fmtRpShort(original.targetSales)}</span></>}
          </p>
        </div>
      </header>

      {message && <p className={`tb-msg is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      <div className="at-figures">
        <article className="at-fig is-main">
          <span>{year > Number(nowYm.slice(0, 4)) ? `Realisasi ${year} · belum berjalan` : year < Number(nowYm.slice(0, 4)) ? `Realisasi ${year}` : `Realisasi s.d. ${MONTH_SHORT[monthIndex(nowYm)]} ${year}`}</span>
          <strong>{fmtRp(ytdSales)}</strong>
          <small>{pct(annual.targetSales ? ytdSales / annual.targetSales : null)} dari target setahun · {pct(ytdTarget ? ytdSales / ytdTarget : null)} dari target s.d. bulan ini</small>
        </article>
        <article className="at-fig">
          <span>Sisa target {year}</span>
          <strong>{fmtRp(Math.max(annual.targetSales - ytdSales, 0))}</strong>
          <small>{original && updates > 0 ? `${data.corrected ? 'Target awal (dikoreksi)' : 'Target awal'} ${fmtRp(original.targetSales)}` : 'Belum ada update target'}</small>
        </article>
        <article className="at-fig">
          <span>Budget terpakai</span>
          <strong>{fmtRp(ytdSpend)}</strong>
          <small>{hasSpend ? `${pct(annual.targetSpend ? ytdSpend / annual.targetSpend : null)} dari budget setahun` : 'Budget tahunan belum diisi'}</small>
        </article>
      </div>

      {/* The year by quarter (left) and the share of each month (Setting). */}
      <div className="ap-board">
        <div className="ap-main">
          <div className="ap-year">
            <b>{year}</b>
            <span><small>{viewLabel}</small>{fmtRp(yearTotal)}</span>
          </div>
          {quarters.map(({ q, idx, total }) => (
            <section key={q} className="ap-quarter" aria-label={`Q${q} ${year}`}>
              <ul className="ap-months">
                {idx.map((i) => {
                  const m = months[i];
                  const amount = side.amounts[i] ?? 0;
                  const past = m.month < nowYm;
                  const current = m.month === nowYm;
                  // The running month always reads its progress: nothing
                  // entered yet is Rp0 so far, not a missing figure.
                  const actual = actualOf(m) ?? (current ? 0 : null);
                  const ratio = amount && actual != null ? actual / amount : null;
                  const tone = ratio == null || view === 'spend' || (!past && !current) ? '' : ratio >= 1 ? ' is-good' : ratio >= 0.9 ? ' is-warn' : past ? ' is-bad' : '';
                  return (
                    <li key={m.month} className={`ap-month${current ? ' is-current' : ''}${m.month === month ? ' is-selected' : ''}`}>
                      <b>{MONTH_LONG[i].toUpperCase()}</b>
                      <strong>{fmtRp(amount)}</strong>
                      <span className={`ap-month-real${tone}`}>
                        {actual != null
                          ? <>{view === 'sales' ? 'Realisasi' : 'Terpakai'} {fmtRpShort(actual)}{ratio != null ? ` · ${pct(ratio, 0)}` : ''}</>
                          : past ? 'Belum ada realisasi' : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="ap-qtotal">
                <span>Q{q}</span>
                <strong><sup>Rp</sup>{compact(total).num}<sub>{compact(total).unit}</sub></strong>
                <small>{pct(yearTotal ? total / yearTotal : null, 1)} dari setahun</small>
              </div>
            </section>
          ))}
        </div>

        <aside className="ap-setting" aria-label="Porsi per bulan">
          <h3>Setting</h3>
          {/* Which split is set here — and shown by quarter on the left. */}
          {hasSpend && (
            <div className="at-mini-seg ap-seg" role="tablist" aria-label="Porsi yang diatur">
              {[['sales', 'Target sales'], ['spend', 'Budget iklan']].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'is-on' : ''} onClick={() => setMetric(k)}>{l}</button>
              ))}
            </div>
          )}
          <p>Porsi {view === 'sales' ? 'target sales' : 'budget iklan'} tiap bulan. {canEdit ? 'Nominal di kiri dihitung otomatis.' : 'Diatur oleh tim MIL Digital.'}</p>
          <ul>
            {months.map((m, i) => (
              <li key={m.month}>
                <b>{MONTH_LONG[i].toUpperCase()}</b>
                {canEdit ? (
                  <span className="ap-pct">
                    <input inputMode="decimal" aria-label={`Porsi ${viewLabel.toLowerCase()} ${monthLong(m.month)}`} value={texts(view)[i]} onChange={(e) => setShare(view, i, e.target.value)} />
                    <i>%</i>
                  </span>
                ) : <span className="ap-pct is-read">{bpText(side.bps[i] ?? 0)}%</span>}
              </li>
            ))}
          </ul>
          {canEdit && <button type="button" className="tb-link" onClick={() => spreadEvenly(view)}><Scale size={14} aria-hidden="true" /> Bagi rata</button>}
        </aside>
      </div>

      {draft && (
        <div className="at-edit-foot">
          <div className="at-sums">
            {sumLine('sales', plan.sales)}
            {plan.spend && sumLine('budget', plan.spend)}
          </div>
          <footer className="at-actions">
            <button type="button" className="bp-ghost" onClick={() => setDraft(null)} disabled={saving}><X size={15} aria-hidden="true" /> Batal</button>
            <button type="button" className="bp-primary" onClick={save} disabled={saving || !plan.ok} title={!plan.ok ? 'Total porsi 12 bulan harus tepat 100%' : undefined}>
              {saving ? <Loader2 size={15} className="dt-spin" /> : <Check size={15} />} Simpan pembagian
            </button>
          </footer>
        </div>
      )}
      <p className="tb-foot">Target tahunan dan update-nya diatur di Brand Setting › Setup Context & Brand Direction › Annual Target. Saat update, target baru dibagi rata ke 12 bulan atau hanya ke bulan berjalan & berikutnya; target awal tetap tersimpan.</p>
    </section>
  );
}
