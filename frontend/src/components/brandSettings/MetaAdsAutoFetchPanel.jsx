import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Check, CircleAlert, Loader2, RefreshCw, Save, Trash2 } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import SelectMenu from '../common/SelectMenu.jsx';
import './metaAdsAutoFetch.css';

const TYPES = [
  { type: 'MAIN', label: 'Meta Ads' },
  { type: 'CPAS', label: 'CPAS' },
];
const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; };
const idr = (n) => `Rp${Math.round(n).toLocaleString('id-ID')}`;
const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

// A run that never reported back (Apps Script killed at its 6-minute cap, or
// ATLAS unreachable at the end) stays 'running' forever in the log; past
// this age it is shown as failed rather than as perpetually in progress.
const STALE_RUN_MS = 15 * 60 * 1000;
const POLL_MS = 10000;
const POLL_MAX_MS = 6 * 60 * 1000;

function monthOptions() {
  const now = new Date();
  const out = [];
  for (let i = 1; i <= 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ value, label: monthName(value) });
  }
  return out;
}

function runState(run) {
  if (run.status === 'running' && Date.now() - new Date(run.startedAt).getTime() > STALE_RUN_MS) {
    return { key: 'failed', label: 'Tidak selesai' };
  }
  return {
    running: { key: 'running', label: 'Berjalan' },
    success: { key: 'success', label: 'Berhasil' },
    failed: { key: 'failed', label: 'Gagal' },
  }[run.status];
}

// Auto-fetch of Meta Ads / CPAS insights into ATLAS. Lives under Data & file
// › Meta Ads. An account is eligible exactly when it is registered in Meta
// Ads Automation › Brand & Langganan and linked to this ATLAS brand — the
// same rule Daily Tracking's auto-fill uses. Admin only: it reaches the Meta
// tokens held in Apps Script.
export default function MetaAdsAutoFetchPanel({ brand }) {
  const { isAdmin, isViewOnly } = useAuth();
  const brandId = brand?.brand_id;

  const [overview, setOverview] = useState(null);
  const [accounts, setAccounts] = useState(null); // null = still asking Apps Script
  const [accountsError, setAccountsError] = useState('');
  const [error, setError] = useState('');
  const [type, setType] = useState('MAIN');
  const [draft, setDraft] = useState({ MAIN: [], CPAS: [] });
  const [month, setMonth] = useState(() => monthOptions()[0].value);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const pollUntil = useRef(0);
  const pollTimer = useRef(null);

  const loadOverview = useCallback(async () => {
    if (!brandId) return null;
    try {
      const res = await api.get('/meta-ads-insights/overview', { params: { brandId } });
      setOverview(res.data);
      setError('');
      return res.data;
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memuat data Meta Ads');
      return null;
    }
  }, [brandId]);

  // Config comes from ATLAS's own DB (fast); eligibility needs Apps Script
  // (seconds to a minute) — loaded separately so the panel is usable at once.
  useEffect(() => {
    if (!isAdmin || !brandId) return undefined;
    let cancelled = false;
    setOverview(null); setAccounts(null); setAccountsError(''); setNotice('');
    loadOverview().then((data) => {
      if (!cancelled && data) setDraft({ MAIN: data.config.MAIN.extraMetrics, CPAS: data.config.CPAS.extraMetrics });
    });
    api.get('/meta-ads-insights/accounts', { params: { brandId } })
      .then((res) => { if (!cancelled) setAccounts(res.data.accounts); })
      .catch((err) => { if (!cancelled) setAccountsError(err.response?.data?.message || 'Gagal memeriksa akun di Meta Ads Automation'); });
    return () => { cancelled = true; };
  }, [isAdmin, brandId, loadOverview]);

  useEffect(() => () => clearTimeout(pollTimer.current), []);

  // After "Tarik sekarang" the run finishes minutes later in Apps Script, so
  // watch the log until nothing is running any more (or give up quietly).
  const startPolling = useCallback(() => {
    pollUntil.current = Date.now() + POLL_MAX_MS;
    clearTimeout(pollTimer.current);
    const tick = async () => {
      const data = await loadOverview();
      const active = data?.runs.some((r) => r.status === 'running' && Date.now() - new Date(r.startedAt).getTime() <= STALE_RUN_MS);
      if (active !== false && Date.now() < pollUntil.current) pollTimer.current = setTimeout(tick, POLL_MS);
    };
    pollTimer.current = setTimeout(tick, POLL_MS);
  }, [loadOverview]);

  const catalog = overview?.catalog ?? [];
  const defaults = useMemo(() => catalog.filter((m) => m.group === 'default'), [catalog]);
  const optionals = useMemo(() => catalog.filter((m) => m.group === 'optional'), [catalog]);
  const registered = (t) => accounts?.find((a) => a.accountType === t)?.registered;
  const saved = overview?.config[type].extraMetrics ?? [];
  const selected = draft[type];
  const dirty = saved.length !== selected.length || saved.some((k) => !selected.includes(k));
  const readOnly = isViewOnly;

  const toggleMetric = (key) => setDraft((d) => ({
    ...d,
    [type]: d[type].includes(key) ? d[type].filter((k) => k !== key) : [...d[type], key],
  }));

  const saveConfig = async () => {
    setBusy('save'); setNotice('');
    try {
      const res = await api.put('/meta-ads-insights/config', { brandId, accountType: type, extraMetrics: selected });
      setOverview((o) => ({ ...o, config: { ...o.config, [type]: { extraMetrics: res.data.extraMetrics } } }));
      setNotice('Pilihan metrik tersimpan. Berlaku untuk penarikan berikutnya.');
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menyimpan pilihan metrik');
    } finally { setBusy(''); }
  };

  const fetchNow = async () => {
    // A dirty selection would silently be ignored (the run reads the SAVED one).
    if (dirty && !window.confirm('Pilihan metrik belum disimpan dan tidak dipakai penarikan ini. Lanjut tarik data dengan pilihan tersimpan?')) return;
    setBusy('fetch'); setNotice(''); setError('');
    try {
      await api.post('/meta-ads-insights/fetch', { brandId, accountType: type, month });
      setNotice(`Penarikan ${monthName(month)} dijadwalkan di Apps Script. Biasanya selesai dalam beberapa menit; status di bawah diperbarui otomatis.`);
      await loadOverview();
      startPolling();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menjadwalkan penarikan');
    } finally { setBusy(''); }
  };

  const deleteMonth = async (row) => {
    if (!window.confirm(`Hapus data Meta Ads ${monthName(row.month)} (${row.accountType === 'CPAS' ? 'CPAS' : 'Meta Ads'})? Tidak bisa dikembalikan.`)) return;
    setBusy(`del:${row.accountType}:${row.month}`); setNotice(''); setError('');
    try {
      await api.delete('/meta-ads-insights/months', { params: { brandId, accountType: row.accountType, month: row.month } });
      await loadOverview();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus data');
    } finally { setBusy(''); }
  };

  if (!isAdmin || !brandId) return null;

  const typeRegistered = registered(type);
  const typeLabel = TYPES.find((t) => t.type === type).label;
  const canAct = typeRegistered && !readOnly;

  return (
    <section className="maf" aria-label="Tarik otomatis Meta Ads">
      <header className="maf-head">
        <span className="maf-head-icon" aria-hidden="true"><CalendarClock size={18} /></span>
        <div>
          <h3>Tarik otomatis dari Meta</h3>
          <p>
            Tiap tanggal 1, ATLAS menarik data bulan sebelumnya per campaign, umur, gender, dan hari untuk akun yang
            sudah terdaftar di <Link to="/meta-automation">Meta Ads Automation › Brand &amp; Langganan</Link>.
          </p>
        </div>
      </header>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}
      {accountsError && <div className="alert alert-error">{accountsError}</div>}

      <div className="maf-types" role="tablist" aria-label="Jenis akun">
        {TYPES.map((t) => {
          const reg = registered(t.type);
          return (
            <button
              key={t.type} type="button" role="tab" aria-selected={type === t.type}
              className={`maf-type ${type === t.type ? 'is-active' : ''}`} onClick={() => setType(t.type)}
            >
              {t.label}
              <small className={reg ? 'is-on' : ''}>
                {accounts == null && !accountsError ? 'memeriksa…' : reg ? 'terdaftar' : 'belum terdaftar'}
              </small>
            </button>
          );
        })}
      </div>

      {accounts != null && !typeRegistered && (
        <div className="maf-empty">
          <CircleAlert size={16} />
          <span>
            Brand ini belum punya akun {typeLabel} yang tertaut. Daftarkan dulu di{' '}
            <Link to="/meta-automation">Meta Ads Automation › Brand &amp; Langganan</Link> (pilih tipe {type}, dan pastikan
            nama brand-nya cocok dengan brand ini) agar penarikan otomatis berjalan.
          </span>
        </div>
      )}

      {!overview ? (
        <p className="maf-loading"><Loader2 size={14} className="maf-spin" /> Memuat…</p>
      ) : (
        <>
          <div className="maf-block">
            <h4>Metrik</h4>
            <div className="maf-chips" aria-label="Metrik default">
              {defaults.map((m) => (
                <span key={m.key} className="maf-chip is-locked" title={m.note ?? 'Selalu ditarik'}>
                  {m.label}{m.note ? ' *' : ''}
                </span>
              ))}
            </div>
            <p className="maf-hint">
              Breakdown: campaign name, age, gender, day. * Instagram profile visits memakai link clicks sebagai pendekatan
              (API Meta tidak menyediakannya), sekitar 3–8% di bawah Ads Manager.
            </p>

            <h4 className="maf-sub">Tambahan (opsional)</h4>
            <div className="maf-options">
              {optionals.map((m) => (
                <label key={m.key} className="maf-option">
                  <input
                    type="checkbox" checked={selected.includes(m.key)}
                    disabled={readOnly} onChange={() => toggleMetric(m.key)}
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
            <div className="maf-actions">
              <button type="button" className="btn btn-secondary dt-btn-sm" onClick={saveConfig} disabled={!dirty || busy === 'save' || readOnly}>
                {busy === 'save' ? <Loader2 size={14} className="maf-spin" /> : <Save size={14} />} Simpan metrik
              </button>
              <small className="maf-hint">Metrik baru hanya berlaku untuk penarikan berikutnya; bulan yang sudah tersimpan perlu ditarik ulang.</small>
            </div>
          </div>

          <div className="maf-block">
            <h4>Tarik sekarang</h4>
            <div className="maf-actions">
              <div className="maf-month"><SelectMenu value={month} onChange={setMonth} options={monthOptions()} label="Bulan" /></div>
              <button type="button" className="btn btn-primary dt-btn-sm" onClick={fetchNow} disabled={!canAct || busy === 'fetch'}>
                {busy === 'fetch' ? <Loader2 size={14} className="maf-spin" /> : <RefreshCw size={14} />} Tarik {typeLabel}
              </button>
              <small className="maf-hint">Menarik ulang bulan yang sudah ada akan menggantinya dengan data terbaru dari Meta.</small>
            </div>
          </div>

          <div className="maf-block">
            <h4>Data tersimpan</h4>
            {overview.months.length === 0 ? (
              <p className="maf-hint">Belum ada data yang ditarik.</p>
            ) : (
              <div className="maf-table-wrap">
                <table className="maf-table">
                  <thead>
                    <tr><th>Bulan</th><th>Akun</th><th>Baris</th><th>Hari</th><th>Campaign</th><th>Amount spent</th><th>Terakhir ditarik</th><th /></tr>
                  </thead>
                  <tbody>
                    {overview.months.map((row) => (
                      <tr key={`${row.accountType}-${row.month}`}>
                        <td>{monthName(row.month)}</td>
                        <td>{row.accountType === 'CPAS' ? 'CPAS' : 'Meta Ads'}</td>
                        <td>{row.rowCount.toLocaleString('id-ID')}</td>
                        <td>{row.dayCount}</td>
                        <td>{row.campaignCount}</td>
                        <td>{idr(row.amountSpent)}</td>
                        <td>{dateTime(row.fetchedAt)}</td>
                        <td>
                          <button
                            type="button" className="btn btn-icon" aria-label={`Hapus ${monthName(row.month)}`}
                            onClick={() => deleteMonth(row)} disabled={readOnly || busy === `del:${row.accountType}:${row.month}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="maf-block">
            <h4>Riwayat penarikan</h4>
            {overview.runs.length === 0 ? (
              <p className="maf-hint">Belum ada penarikan.</p>
            ) : (
              <ul className="maf-runs">
                {overview.runs.slice(0, 8).map((run, index) => {
                  const state = runState(run);
                  return (
                    <li key={`${run.startedAt}-${index}`}>
                      <span className={`maf-badge is-${state.key}`}>
                        {state.key === 'running' ? <Loader2 size={12} className="maf-spin" /> : state.key === 'success' ? <Check size={12} /> : <CircleAlert size={12} />}
                        {state.label}
                      </span>
                      <span>{monthName(run.month.slice(0, 7))} · {run.accountType === 'CPAS' ? 'CPAS' : 'Meta Ads'} · {run.trigger === 'scheduled' ? 'otomatis' : 'manual'}</span>
                      <span className="maf-run-meta">
                        {run.status === 'success' ? `${run.rowCount.toLocaleString('id-ID')} baris · ` : ''}{dateTime(run.startedAt)}
                        {run.note ? ` · ${run.note}` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
