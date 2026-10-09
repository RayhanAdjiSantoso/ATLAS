import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Loader2, PencilLine, Scale, Target, X } from 'lucide-react';
import api from '../../api/client.js';
import { channelTotal, fmtRp, fmtRpShort, totalForKind } from '../../dailyTracking/lib/summary.js';
import { monthName, todayIso } from '../../dailyTracking/lib/daily.js';

// Brand Tracking › Target & Budget. The month's plan — a sales target, an ad
// budget and its split across spend channels — read against what Brand
// Tracking already holds: real sales and spend so far, the run-rate
// projection to month end, and per channel what is left and what can be
// spent per day from here. Replaces the "Target / Real / Projected" block
// and budget table kept at the top of each brand's Google Sheet.
//
// Real figures count every sales channel (DRC, B2B, website — the sheet's
// "Real Sales") and every spend channel. Days elapsed run to yesterday in
// the running month (today is still being sold, spend lands H-1).

const ratioX = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`);
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: d })}%`);
const digits = (s) => String(s ?? '').replace(/[^\d]/g, '');
const thousands = (v) => (v === '' || v == null ? '' : Number(v).toLocaleString('id-ID'));

// Days the month's figures cover: all of a past month; in the running month,
// up to the last day that holds any entry (never past yesterday) — the
// figures stop where entry stops, so dividing by calendar days elapsed would
// understate the run rate whenever entry is a day or two behind.
function paceOf(month, days, grid, kinds = ['sales', 'spend']) {
  const today = todayIso();
  const ym = today.slice(0, 7);
  if (month < ym) return days;
  if (month > ym) return 0;
  const yesterday = Math.max(Number(today.slice(8)) - 1, 0);
  let last = 0;
  for (const kind of kinds) {
    for (const byDate of Object.values(grid?.[kind] || {})) {
      for (const [date, row] of Object.entries(byDate || {})) {
        const v = kind === 'sales' ? row?.revenue : row?.amount;
        if (v != null && v !== '' && Number(v) !== 0) last = Math.max(last, Number(date.slice(8)));
      }
    }
  }
  return Math.min(last || yesterday, yesterday);
}

// Sales: reaching the target is good. Spend: landing near the budget is good,
// over it is a warning, far under it means the plan is not being run.
function salesStatus(projectedRatio) {
  if (projectedRatio == null) return null;
  if (projectedRatio >= 1) return { tone: 'good', label: 'On track' };
  if (projectedRatio >= 0.9) return { tone: 'warn', label: 'Hampir' };
  return { tone: 'bad', label: 'Tertinggal' };
}
function spendStatus(projectedRatio) {
  if (projectedRatio == null) return null;
  if (projectedRatio > 1.05) return { tone: 'bad', label: 'Over budget' };
  if (projectedRatio >= 0.9) return { tone: 'good', label: 'Sesuai rencana' };
  return { tone: 'warn', label: 'Under-spend' };
}

function GoalCard({ title, target, real, projected, format, status, expected, sub }) {
  const ratio = target ? real / target : null;
  const projRatio = target && projected != null ? projected / target : null;
  return (
    <article className="tb-goal">
      <header>
        <span>{title}</span>
        {status && <b className={`tb-status is-${status.tone}`}>{status.label}</b>}
      </header>
      <div className="tb-goal-figure">
        <strong>{format(real)}</strong>
        <small>dari target {format(target)}</small>
      </div>
      <div className="tb-progress" aria-hidden="true">
        <i className="tb-progress-proj" style={{ transform: `scaleX(${Math.min(projRatio ?? 0, 1)})` }} />
        <i className="tb-progress-real" style={{ transform: `scaleX(${Math.min(ratio ?? 0, 1)})` }} />
        {expected != null && expected > 0 && expected < 1 && <em style={{ left: `${expected * 100}%` }} title="Seharusnya sudah sampai sini" />}
      </div>
      <dl>
        <div><dt>Tercapai</dt><dd>{pct(ratio)}</dd></div>
        <div><dt>Proyeksi akhir bulan</dt><dd>{format(projected)} <small>({pct(projRatio, 0)})</small></dd></div>
      </dl>
      {sub && <p className="tb-goal-sub">{sub}</p>}
    </article>
  );
}

export default function TargetBudget({ brandId, month, grid, channels, canEdit }) {
  const [state, setState] = useState({ status: 'loading', target: null, previous: null });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (!brandId || !month) return undefined;
    let alive = true;
    setState({ status: 'loading', target: null, previous: null });
    setEditing(false);
    setMessage(null);
    api.get('/daily-tracking/targets', { params: { brandId, month } })
      .then(({ data }) => alive && setState({ status: 'ready', target: data.target, previous: data.previous }))
      .catch((err) => alive && setState({ status: 'error', error: err.response?.data?.message || 'Target tidak dapat dimuat' }));
    return () => { alive = false; };
  }, [brandId, month]);

  const spendChannels = channels.spend || [];
  const days = grid.days?.length || 0;
  const elapsed = Math.min(paceOf(month, days, grid), days);
  const daysLeft = Math.max(days - elapsed, 0);
  const expected = days ? elapsed / days : null;
  const realSales = totalForKind(grid, channels, 'sales', 'revenue');
  const realSpend = totalForKind(grid, channels, 'spend', 'amount');
  // Sales and spend are entered separately (spend syncs H-1 on its own), so
  // each projects from its own last filled day.
  const salesDays = Math.min(paceOf(month, days, grid, ['sales']), days);
  const spendDays = Math.min(paceOf(month, days, grid, ['spend']), days);
  const project = (v, d) => (v == null ? null : d >= days ? v : d > 0 ? (v / d) * days : null);

  const startEdit = (from) => {
    const src = from ?? state.target;
    setForm({
      targetSales: src?.targetSales ?? '',
      targetSpend: src?.targetSpend ?? '',
      allocation: Object.fromEntries(spendChannels.map((c) => [c.key, src?.allocation?.[c.key] ?? ''])),
      notes: src?.notes ?? '',
    });
    setMessage(null);
    setEditing(true);
  };

  const allocTotal = form ? Object.values(form.allocation).reduce((a, v) => a + (Number(v) || 0), 0) : 0;

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const allocation = Object.fromEntries(Object.entries(form.allocation).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));
      const { data } = await api.put('/daily-tracking/targets', {
        brandId, month,
        targetSales: form.targetSales === '' ? null : Number(form.targetSales),
        targetSpend: form.targetSpend === '' ? null : Number(form.targetSpend),
        allocation, notes: form.notes,
      });
      setState({ status: 'ready', target: data.target, previous: null });
      setEditing(false);
      setMessage({ tone: 'ok', text: `Target ${monthName(month)} tersimpan.` });
    } catch (err) {
      setMessage({ tone: 'error', text: err.response?.data?.message || 'Target gagal disimpan' });
    } finally {
      setSaving(false);
    }
  };

  const spreadEvenly = () => {
    const keys = spendChannels.map((c) => c.key).filter((k) => Number(form.allocation[k]) > 0);
    const use = keys.length ? keys : spendChannels.map((c) => c.key);
    const each = Math.floor((100 / use.length) * 100) / 100;
    const alloc = Object.fromEntries(spendChannels.map((c) => [c.key, use.includes(c.key) ? each : '']));
    alloc[use[0]] = Math.round((100 - each * (use.length - 1)) * 100) / 100;
    setForm({ ...form, allocation: alloc });
  };

  const t = state.target;
  const rows = useMemo(() => {
    if (!t) return [];
    return spendChannels.map((c) => {
      const share = Number(t.allocation?.[c.key]) || 0;
      // A channel with no share has no budget: its spend is shown, but there
      // is nothing for it to be over or under.
      const monthly = t.targetSpend != null && share > 0 ? (share / 100) * t.targetSpend : null;
      const spent = channelTotal(grid, 'spend', c.key, 'amount');
      const remain = monthly != null ? monthly - (spent ?? 0) : null;
      const plannedToDate = monthly != null && days ? monthly * (elapsed / days) : null;
      const pace = plannedToDate ? (spent ?? 0) / plannedToDate : null;
      return {
        key: c.key, label: c.label, share, monthly, spent,
        daily: monthly != null && days ? monthly / days : null,
        dailyReal: spent != null && elapsed ? spent / elapsed : null,
        remain,
        perDayLeft: remain != null && daysLeft ? Math.max(remain, 0) / daysLeft : null,
        status: monthly ? spendStatus(pace) : null,
      };
    }).filter((r) => r.share > 0 || r.spent)
      // Allocated channels first, biggest share first; unallocated spend after.
      .sort((a, b) => b.share - a.share);
  }, [t, spendChannels, grid, days, elapsed, daysLeft]);

  if (state.status === 'loading') return <p className="tb-state"><Loader2 size={15} className="dt-spin" /> Memuat target…</p>;
  if (state.status === 'error') return <p className="tb-state is-error">{state.error}</p>;

  // ── Edit form ──────────────────────────────────────────────────────────
  if (editing && form) {
    const ts = Number(form.targetSales) || 0;
    const tp = Number(form.targetSpend) || 0;
    return (
      <section className="soft-card tb-card tb-form" aria-label="Atur target">
        <header className="tb-head">
          <div>
            <h2>Atur target · {monthName(month)}</h2>
            <p>Target penjualan dan budget iklan bulan ini, lalu bagi budget ke tiap channel.</p>
          </div>
        </header>
        <div className="tb-form-goals">
          <label>
            <span>Target sales</span>
            <div className="tb-money"><b>Rp</b><input inputMode="numeric" value={thousands(form.targetSales)} onChange={(e) => setForm({ ...form, targetSales: digits(e.target.value) })} placeholder="350.000.000" /></div>
          </label>
          <label>
            <span>Budget ads spend</span>
            <div className="tb-money"><b>Rp</b><input inputMode="numeric" value={thousands(form.targetSpend)} onChange={(e) => setForm({ ...form, targetSpend: digits(e.target.value) })} placeholder="63.000.000" /></div>
          </label>
          <div className="tb-form-roas">
            <span>Target ROAS</span>
            <strong>{ts && tp ? ratioX(ts / tp) : '—'}</strong>
            <small>sales ÷ spend</small>
          </div>
        </div>

        <div className="tb-form-alloc">
          <div className="tb-form-alloc-head">
            <h3>Alokasi budget per channel</h3>
            <div className={`tb-sum${Math.abs(allocTotal - 100) < 0.01 ? ' is-full' : allocTotal > 100 ? ' is-over' : ''}`}>
              <span><i style={{ transform: `scaleX(${Math.min(allocTotal / 100, 1)})` }} /></span>
              <b>{allocTotal.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%</b>
              <small>{Math.abs(allocTotal - 100) < 0.01 ? 'Pas 100%' : allocTotal > 100 ? 'Lebih dari 100%' : `Sisa ${(100 - allocTotal).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`}</small>
            </div>
            <button type="button" className="tb-link" onClick={spreadEvenly}><Scale size={14} aria-hidden="true" /> Bagi rata</button>
          </div>
          <div className="tb-alloc-grid">
            {spendChannels.map((c) => {
              const v = form.allocation[c.key];
              const amount = tp && Number(v) ? (Number(v) / 100) * tp : null;
              return (
                <label key={c.key} className={Number(v) > 0 ? 'is-on' : ''}>
                  <span className="tb-alloc-name">{c.label}</span>
                  <span className="tb-pct">
                    <input inputMode="decimal" value={v} placeholder="0"
                      onChange={(e) => setForm({ ...form, allocation: { ...form.allocation, [c.key]: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') } })} />
                    <b>%</b>
                  </span>
                  <small>{amount != null ? `${fmtRpShort(amount)} / bln · ${fmtRpShort(days ? amount / days : null)} / hari` : '—'}</small>
                </label>
              );
            })}
          </div>
        </div>

        <label className="tb-notes">
          <span>Catatan (opsional)</span>
          <textarea rows={2} value={form.notes} maxLength={1000} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="mis. Payday sale tanggal 25 — budget Iklanku dinaikkan" />
        </label>

        {message && <p className={`tb-msg is-${message.tone}`} role="alert">{message.text}</p>}
        <footer className="tb-form-foot">
          <button type="button" className="bp-ghost" onClick={() => setEditing(false)} disabled={saving}><X size={15} aria-hidden="true" /> Batal</button>
          <button type="button" className="bp-primary" onClick={save} disabled={saving || allocTotal > 100.01}>
            {saving ? <Loader2 size={15} className="dt-spin" /> : <Check size={15} />} Simpan target
          </button>
        </footer>
      </section>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────
  if (!t) {
    return (
      <section className="soft-card tb-card tb-empty" aria-label="Target belum diatur">
        <span className="tb-empty-ico" aria-hidden="true"><Target size={22} /></span>
        <div>
          <h2>Belum ada target untuk {monthName(month)}</h2>
          <p>Atur target sales dan budget iklan, lalu bagi budget ke tiap channel — pencapaian, proyeksi akhir bulan, dan sisa budget harian dihitung otomatis dari data Brand Tracking.</p>
        </div>
        {canEdit ? (
          <div className="tb-empty-actions">
            <button type="button" className="bp-primary" onClick={() => startEdit(null)}><PencilLine size={15} aria-hidden="true" /> Atur target</button>
            {state.previous && (
              <button type="button" className="bp-ghost" onClick={() => startEdit(state.previous)}>
                <Copy size={15} aria-hidden="true" /> Salin dari {monthName(state.previous.month)}
              </button>
            )}
          </div>
        ) : <p className="tb-muted">Target diatur oleh tim MIL Digital.</p>}
      </section>
    );
  }

  // ── Plan vs real ───────────────────────────────────────────────────────
  const targetRoas = t.targetSales && t.targetSpend ? t.targetSales / t.targetSpend : null;
  const realRoas = realSales != null && realSpend ? realSales / realSpend : null;
  const projSales = project(realSales, salesDays);
  const projSpend = project(realSpend, spendDays);
  const projRoas = projSales != null && projSpend ? projSales / projSpend : null;
  const allocSum = Object.values(t.allocation ?? {}).reduce((a, v) => a + (Number(v) || 0), 0);
  const tot = rows.reduce((a, r) => ({
    monthly: a.monthly + (r.monthly ?? 0), spent: a.spent + (r.spent ?? 0), remain: a.remain + (r.remain ?? 0),
  }), { monthly: 0, spent: 0, remain: 0 });

  return (
    <div className="tb">
      <section className="soft-card tb-card" aria-label="Pencapaian target">
        <header className="tb-head">
          <div>
            <h2>Pencapaian · {monthName(month)}</h2>
            <p>
              {elapsed >= days ? 'Bulan selesai' : elapsed === 0 ? 'Bulan belum berjalan' : `Data s.d. tanggal ${elapsed} dari ${days} · ${daysLeft} hari tersisa`}
              {t.updatedAt && <> · diatur {new Date(t.updatedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}{t.updatedByName ? ` oleh ${t.updatedByName}` : ''}</>}
            </p>
          </div>
          {canEdit && <button type="button" className="bp-ghost" onClick={() => startEdit(null)}><PencilLine size={15} aria-hidden="true" /> Ubah target</button>}
        </header>
        {message && <p className={`tb-msg is-${message.tone}`} role="status">{message.text}</p>}
        <div className="tb-goals">
          <GoalCard
            title="Sales" target={t.targetSales} real={realSales} projected={projSales} format={fmtRp}
            status={t.targetSales ? salesStatus(projSales != null ? projSales / t.targetSales : null) : null} expected={expected}
            sub={t.targetSales && days - salesDays > 0 ? `Data sales s.d. tgl ${salesDays} · butuh ${fmtRpShort(Math.max(t.targetSales - (realSales ?? 0), 0) / (days - salesDays))} / hari untuk mencapai target` : null}
          />
          <GoalCard
            title="Ads spend" target={t.targetSpend} real={realSpend} projected={projSpend} format={fmtRp}
            status={t.targetSpend ? spendStatus(projSpend != null ? projSpend / t.targetSpend : null) : null} expected={expected}
            sub={t.targetSpend && days - spendDays > 0 ? `Data spend s.d. tgl ${spendDays} · sisa ${fmtRpShort(Math.max(t.targetSpend - (realSpend ?? 0), 0))}, ${fmtRpShort(Math.max(t.targetSpend - (realSpend ?? 0), 0) / (days - spendDays))} / hari` : null}
          />
          <article className="tb-goal is-roas">
            <header>
              <span>ROAS blended</span>
              {targetRoas && realRoas && <b className={`tb-status is-${realRoas >= targetRoas ? 'good' : realRoas >= targetRoas * 0.9 ? 'warn' : 'bad'}`}>{realRoas >= targetRoas ? 'Di atas target' : 'Di bawah target'}</b>}
            </header>
            <div className="tb-goal-figure">
              <strong>{ratioX(realRoas)}</strong>
              <small>target {ratioX(targetRoas)}</small>
            </div>
            <div className="tb-roas-scale" aria-hidden="true">
              <i style={{ left: `${Math.min((realRoas ?? 0) / Math.max(targetRoas ?? 1, realRoas ?? 0, 0.01) * 100, 100)}%` }} />
              <em style={{ left: `${targetRoas ? Math.min(targetRoas / Math.max(targetRoas, realRoas ?? 0) * 100, 100) : 0}%` }} />
            </div>
            <dl>
              <div><dt>Proyeksi akhir bulan</dt><dd>{ratioX(projRoas)}</dd></div>
              <div><dt>Selisih dari target</dt><dd>{targetRoas && realRoas ? `${realRoas - targetRoas >= 0 ? '+' : ''}${(realRoas - targetRoas).toLocaleString('id-ID', { maximumFractionDigits: 2 })}x` : '—'}</dd></div>
            </dl>
          </article>
        </div>
        {t.notes && <p className="tb-note">“{t.notes}”</p>}
      </section>

      <section className="soft-card tb-card" aria-label="Alokasi budget per channel">
        <header className="tb-head">
          <div>
            <h2>Budget per channel</h2>
            <p>Alokasi {allocSum.toLocaleString('id-ID', { maximumFractionDigits: 2 })}% dari budget {fmtRp(t.targetSpend)}{Math.abs(allocSum - 100) > 0.01 ? ' — belum genap 100%' : ''}.</p>
          </div>
        </header>
        {!rows.length ? (
          <p className="tb-muted">Belum ada alokasi channel. {canEdit && 'Atur lewat "Ubah target".'}</p>
        ) : (
          <div className="tb-table-wrap">
            <table className="tb-table">
              <thead>
                <tr>
                  <th>Channel</th><th className="is-num">Alokasi</th><th className="is-num">Budget / bulan</th><th className="is-num">Budget / hari</th>
                  <th className="is-num">Realisasi</th><th className="is-num">Real / hari</th><th className="is-num">Sisa budget</th><th className="is-num">Sisa / hari</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <span className="tb-ch">{r.label}</span>
                      <span className="tb-use" aria-hidden="true"><i style={{ transform: `scaleX(${r.monthly ? Math.min((r.spent ?? 0) / r.monthly, 1) : 0})` }} /></span>
                    </td>
                    <td className="is-num">{r.share ? `${r.share.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%` : '—'}</td>
                    <td className="is-num">{fmtRp(r.monthly)}</td>
                    <td className="is-num is-muted">{fmtRp(r.daily)}</td>
                    <td className="is-num is-strong">{fmtRp(r.spent)}</td>
                    <td className="is-num">{fmtRp(r.dailyReal)}</td>
                    <td className={`is-num${r.remain != null && r.remain < 0 ? ' is-neg' : ''}`}>{fmtRp(r.remain)}</td>
                    <td className="is-num">{fmtRp(r.perDayLeft)}</td>
                    <td>{r.status ? <b className={`tb-status is-${r.status.tone}`}>{r.status.label}</b> : <span className="tb-muted">Tanpa alokasi</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th><td className="is-num">{allocSum.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%</td>
                  <td className="is-num">{fmtRp(tot.monthly)}</td><td className="is-num">{fmtRp(days ? tot.monthly / days : null)}</td>
                  <td className="is-num">{fmtRp(tot.spent)}</td><td className="is-num">{fmtRp(elapsed ? tot.spent / elapsed : null)}</td>
                  <td className="is-num">{fmtRp(tot.remain)}</td><td className="is-num">{fmtRp(daysLeft ? Math.max(tot.remain, 0) / daysLeft : null)}</td><td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="tb-foot">Proyeksi = realisasi ÷ hari yang sudah berisi data × jumlah hari sebulan. Status per channel membandingkan realisasi dengan rencana sampai hari yang sama: sesuai bila 90–105% dari yang seharusnya sudah terpakai.</p>
      </section>
    </div>
  );
}

