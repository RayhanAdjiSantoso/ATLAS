import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check, History, Loader2, PencilLine, Scale, X } from 'lucide-react';
import api from '../../api/client.js';
import { fmtRp, fmtRpShort } from '../../dailyTracking/lib/summary.js';
import { presetBrandSettings } from '../common/brandSettingsLink.js';
import {
  MONTH_SHORT, changeFromOriginal, digits, monthIndex, monthLong, pct, signedPct, splitEqual, thousands,
} from './annualModel.js';
import './annualTarget.css';

// Brand Tracking › Target & Budget › Rencana tahunan. The year set in Brand
// Setting, split across its 12 months. The split starts even and can be
// shaped by hand — heavier in campaign months, lighter elsewhere — but it
// can only be saved when the 12 months add up to exactly the year (100%).
// Each month's figure is that month's target in the monthly view below.

export default function AnnualPlan({ brandId, month, canEdit, onSaved }) {
  const year = Number(String(month).slice(0, 4));
  const [state, setState] = useState({ status: 'loading', data: null });
  const [draft, setDraft] = useState(null); // [{ month, sales, spend }]
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

  const sums = useMemo(() => {
    if (!draft || !annual) return null;
    const sales = draft.reduce((a, m) => a + (Number(m.sales) || 0), 0);
    const spend = draft.reduce((a, m) => a + (Number(m.spend) || 0), 0);
    return {
      sales, spend,
      salesOk: sales === annual.targetSales,
      spendOk: !hasSpend || spend === annual.targetSpend,
    };
  }, [draft, annual, hasSpend]);

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

  const startEdit = () => {
    setMessage(null);
    setDraft(months.map((m) => ({ month: m.month, sales: String(m.targetSales ?? 0), spend: String(m.targetSpend ?? 0) })));
  };
  const spreadEvenly = (key, total) => {
    const shares = splitEqual(total);
    setDraft((d) => d.map((m, i) => ({ ...m, [key]: String(shares[i]) })));
  };
  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const { data: next } = await api.put('/daily-tracking/annual-targets/split', {
        brandId, year,
        months: draft.map((m) => ({ month: m.month, targetSales: Number(m.sales) || 0, targetSpend: hasSpend ? Number(m.spend) || 0 : null })),
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

  const sumLine = (label, sum, total, ok) => (
    <div className={`at-sum${ok ? ' is-ok' : sum > total ? ' is-over' : ''}`}>
      <span className="at-sum-bar"><i style={{ transform: `scaleX(${Math.min(total ? sum / total : 0, 1)})` }} /></span>
      <b>{label} {pct(total ? sum / total : 0, 2)}</b>
      <small>{ok ? 'Pas 100%' : sum > total ? `Lebih ${fmtRp(sum - total)}` : `Kurang ${fmtRp(total - sum)}`}</small>
    </div>
  );

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
        {canEdit && !draft && <button type="button" className="bp-ghost" onClick={startEdit}><PencilLine size={15} aria-hidden="true" /> Atur pembagian</button>}
      </header>

      {message && <p className={`tb-msg is-${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      {!draft && (
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
      )}

      <div className="tb-table-wrap">
        <table className="tb-table at-table">
          <thead>
            <tr>
              <th>Bulan</th>
              <th className="is-num">Target sales</th><th className="is-num">Porsi</th>
              {!draft && <><th className="is-num">Realisasi</th><th>Capaian</th></>}
              {hasSpend && <><th className="is-num">Budget iklan</th><th className="is-num">Porsi</th></>}
              {!draft && hasSpend && <th className="is-num">Terpakai</th>}
            </tr>
          </thead>
          <tbody>
            {(draft ?? months).map((row, i) => {
              const m = months[i];
              const salesVal = draft ? Number(row.sales) || 0 : m.targetSales ?? 0;
              const spendVal = draft ? Number(row.spend) || 0 : m.targetSpend ?? 0;
              const ratio = m.targetSales ? (m.actualSales ?? 0) / m.targetSales : null;
              const past = m.month < nowYm;
              const current = m.month === nowYm;
              const tone = ratio == null || (!past && !current) ? null : ratio >= 1 ? 'good' : ratio >= 0.9 ? 'warn' : past ? 'bad' : null;
              return (
                <tr key={m.month} className={`${current ? 'is-current' : ''}${past ? ' is-past' : ''}${m.month === month ? ' is-selected' : ''}`}>
                  <th scope="row">{monthLong(m.month).split(' ')[0]}{current && <em>berjalan</em>}</th>
                  <td className="is-num">
                    {draft
                      ? <span className="at-cell-money"><b>Rp</b><input inputMode="numeric" aria-label={`Target sales ${monthLong(m.month)}`} value={thousands(row.sales)} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, sales: digits(e.target.value) } : x)))} /></span>
                      : fmtRp(salesVal)}
                  </td>
                  <td className="is-num is-muted">{pct(annual.targetSales ? salesVal / annual.targetSales : null, 1)}</td>
                  {!draft && (
                    <>
                      <td className="is-num is-strong">{m.actualSales != null ? fmtRp(m.actualSales) : '—'}</td>
                      <td>
                        <span className="at-bar"><i className={tone ? `is-${tone}` : ''} style={{ transform: `scaleX(${Math.min(ratio ?? 0, 1)})` }} /></span>
                        <span className={`at-ratio${tone ? ` is-${tone}` : ''}`}>{m.actualSales != null && ratio != null ? pct(ratio, 0) : '—'}</span>
                      </td>
                    </>
                  )}
                  {hasSpend && (
                    <>
                      <td className="is-num">
                        {draft
                          ? <span className="at-cell-money"><b>Rp</b><input inputMode="numeric" aria-label={`Budget iklan ${monthLong(m.month)}`} value={thousands(row.spend)} onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, spend: digits(e.target.value) } : x)))} /></span>
                          : fmtRp(spendVal)}
                      </td>
                      <td className="is-num is-muted">{pct(annual.targetSpend ? spendVal / annual.targetSpend : null, 1)}</td>
                    </>
                  )}
                  {!draft && hasSpend && <td className="is-num">{m.actualSpend != null ? fmtRp(m.actualSpend) : '—'}</td>}
                </tr>
              );
            })}
          </tbody>
          {!draft && (
            <tfoot>
              <tr>
                <th>Total</th>
                <td className="is-num">{fmtRp(annual.targetSales)}</td><td className="is-num">100%</td>
                <td className="is-num">{fmtRp(months.reduce((a, m) => a + (m.actualSales ?? 0), 0))}</td><td />
                {hasSpend && <><td className="is-num">{fmtRp(annual.targetSpend)}</td><td className="is-num">100%</td><td className="is-num">{fmtRp(months.reduce((a, m) => a + (m.actualSpend ?? 0), 0))}</td></>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {draft && sums && (
        <div className="at-edit-foot">
          <div className="at-sums">
            {sumLine('Sales', sums.sales, annual.targetSales, sums.salesOk)}
            {hasSpend && sumLine('Budget', sums.spend, annual.targetSpend, sums.spendOk)}
          </div>
          <div className="at-edit-tools">
            <button type="button" className="tb-link" onClick={() => spreadEvenly('sales', annual.targetSales)}><Scale size={14} aria-hidden="true" /> Bagi rata sales</button>
            {hasSpend && <button type="button" className="tb-link" onClick={() => spreadEvenly('spend', annual.targetSpend)}><Scale size={14} aria-hidden="true" /> Bagi rata budget</button>}
          </div>
          <footer className="at-actions">
            <button type="button" className="bp-ghost" onClick={() => setDraft(null)} disabled={saving}><X size={15} aria-hidden="true" /> Batal</button>
            <button type="button" className="bp-primary" onClick={save} disabled={saving || !sums.salesOk || !sums.spendOk} title={!sums.salesOk || !sums.spendOk ? 'Total 12 bulan harus tepat 100%' : undefined}>
              {saving ? <Loader2 size={15} className="dt-spin" /> : <Check size={15} />} Simpan pembagian
            </button>
          </footer>
        </div>
      )}
      <p className="tb-foot">Target tahunan dan update-nya diatur di Brand Setting › Brand Context › Target tahunan. Saat update, target baru dibagi rata ke 12 bulan atau hanya ke bulan berjalan & berikutnya; target awal tetap tersimpan.</p>
    </section>
  );
}
