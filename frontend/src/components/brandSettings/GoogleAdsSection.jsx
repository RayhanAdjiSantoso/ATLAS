import { useCallback, useEffect, useState } from 'react';
import { Check, CircleAlert, Loader2, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import './metaAdsAutoFetch.css';

const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const dayLabel = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dashed = (id) => `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;

// A run that never reported back (the script hit Google's 30-minute cap, or
// ATLAS was unreachable at the end) stays 'running' in the log; past this age
// it is shown as failed rather than as perpetually in progress.
const STALE_RUN_MS = 45 * 60 * 1000;

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

const GOALS = [
  ['purchase', 'Purchase'], ['lead', 'Lead'], ['micro', 'Micro conversion'], ['other', 'Lainnya'], ['ignore', 'Abaikan'],
];
const GOAL_LABEL = Object.fromEntries(GOALS);
const human = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—');

// Which business goal each conversion action counts toward in the report
// (Purchase and Lead are analysed apart). Without a choice here the report
// derives one from Google's category and marks it as unverified.
function ConversionGoals({ brandId, isViewOnly }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');

  useEffect(() => {
    setData(null);
    api.get('/google-ads/conversion-goals', { params: { brandId } })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat conversion action'));
  }, [brandId]);

  async function save(action, value) {
    const key = `${action.customer_id}|${action.conversion_action_id}`;
    setSaving(key); setError('');
    try {
      const res = await api.put('/google-ads/conversion-goals', {
        brandId, customerId: action.customer_id, conversionActionId: action.conversion_action_id, goal: value || null,
      });
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.details?.[0]?.msg || err.response?.data?.message || 'Gagal menyimpan');
    } finally {
      setSaving('');
    }
  }

  if (!data && !error) return <p className="maf-loading"><Loader2 size={14} className="maf-spin" /> Memuat conversion action…</p>;
  const actions = (data?.actions ?? []).filter((a) => a.status !== 'REMOVED' || a.goal_source === 'manual');
  const unverified = actions.filter((a) => a.goal_source !== 'manual').length;
  return (
    <div className="maf-block">
      <h4>Conversion goals</h4>
      {error && <div className="alert alert-error">{error}</div>}
      {actions.length === 0 ? (
        <p className="maf-hint">Belum ada conversion action — muncul setelah Google Ads Script terbaru berjalan di akun klien.</p>
      ) : (
        <>
          <p className="maf-hint">
            Tentukan tujuan bisnis setiap conversion action. Report memisahkan Purchase dan Lead berdasarkan pilihan ini.
            {unverified > 0 && ` ${unverified} action masih memakai tebakan dari kategori Google.`}
          </p>
          <div className="maf-table-wrap">
            <table className="maf-table">
              <thead><tr><th>Conversion action</th><th>Kategori Google</th><th>Dihitung di Conversions</th><th>Tujuan</th></tr></thead>
              <tbody>
                {actions.map((a) => {
                  const key = `${a.customer_id}|${a.conversion_action_id}`;
                  return (
                    <tr key={key}>
                      <td>{a.name || `#${a.conversion_action_id}`}{a.status === 'REMOVED' && <small className="maf-run-meta"> · dihapus</small>}{a.source === 'conversions_only' && <small className="maf-run-meta"> · bawaan Google</small>}</td>
                      <td>{human(a.category)}</td>
                      <td>{a.include_in_conversions == null ? '—' : a.include_in_conversions ? 'Ya (primer di akun)' : 'Tidak (sekunder)'}</td>
                      <td>
                        <select className="form-input" value={a.goal_source === 'manual' ? a.goal : ''} disabled={isViewOnly || saving === key}
                          onChange={(e) => save(a, e.target.value)} aria-label={`Tujuan ${a.name}`}>
                          <option value="">Bawaan: {GOAL_LABEL[a.goal]} (belum diverifikasi)</option>
                          {GOALS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        {saving === key && <Loader2 size={12} className="maf-spin" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const DQ_LABEL = { VALID: 'Valid', PARTIAL: 'Sebagian', STALE: 'Usang', INCONSISTENT: 'Tidak konsisten', MISSING: 'Tidak ada', UNVERIFIED: 'Belum terverifikasi' };
const dqClass = (s) => (s === 'VALID' ? 'is-success' : s === 'INCONSISTENT' ? 'is-failed' : 'is-running');
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const isoDay = (d) => d.toISOString().slice(0, 10);

// Internal operations & calibration: how the syncs ran (duration, retries,
// datasets), the latest reconciliation checks, and how each diagnostic rule
// performed against the team's review verdicts. Read-only; no secrets.
function OpsPanel({ brandId }) {
  const [ops, setOps] = useState(null);
  const [cal, setCal] = useState(null);
  const [error, setError] = useState('');
  const [days, setDays] = useState(7);
  useEffect(() => {
    setOps(null); setError('');
    api.get('/google-ads/ops', { params: { brandId } }).then((r) => setOps(r.data)).catch((err) => setError(err.response?.data?.message || 'Gagal memuat data operasional'));
  }, [brandId]);
  useEffect(() => {
    const to = new Date();
    const from = new Date(Date.now() - days * 864e5);
    api.get('/google-ads/calibration', { params: { brandId, from: isoDay(from), to: isoDay(to) } }).then((r) => setCal(r.data)).catch(() => setCal(null));
  }, [brandId, days]);
  if (error) return <div className="alert alert-error">{error}</div>;
  if (!ops) return <p className="maf-loading"><Loader2 size={14} className="maf-spin" /> Memuat…</p>;
  return (
    <>
      <p className="maf-hint">
        Ruleset {ops.ruleset_version} · sinkron berhasil {pct(ops.success_rate)} dari {ops.runs.filter((r) => r.status !== 'running').length} run terakhir · {ops.open_alerts} alert terbuka
      </p>
      <div className="maf-table-wrap">
        <table className="maf-table">
          <thead><tr><th>Mulai</th><th>Rentang</th><th>Status</th><th>Durasi</th><th>Baris</th><th>Percobaan</th><th>Dataset</th></tr></thead>
          <tbody>
            {ops.runs.slice(0, 15).map((r) => (
              <tr key={r.runId} title={r.note || ''}>
                <td>{dateTime(r.startedAt)}</td>
                <td>{dayLabel(r.startDate)} – {dayLabel(r.endDate)}</td>
                <td><span className={`maf-badge ${r.stuck || r.status === 'failed' ? 'is-failed' : r.status === 'success' ? 'is-success' : 'is-running'}`}>{r.stuck ? 'Tidak selesai' : r.status}</span></td>
                <td>{r.duration_ms == null ? '—' : `${(r.duration_ms / 1000).toFixed(1)} dtk`}</td>
                <td>{r.rowCount.toLocaleString('id-ID')}</td>
                <td>{r.attempts_same_day > 1 ? `${r.attempts_same_day}× hari itu` : '1'}</td>
                <td>{r.datasetResults && Object.keys(r.datasetResults).length
                  ? Object.entries(r.datasetResults).map(([k, v]) => `${k}${v.status === 'success' ? '' : ` (${v.status})`}`).join(', ')
                  : 'core'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 style={{ marginTop: '1rem' }}>Rekonsiliasi terakhir</h4>
      {ops.data_quality.length ? (
        <div className="maf-table-wrap">
          <table className="maf-table">
            <thead><tr><th>Pemeriksaan</th><th>Periode</th><th>Harapan</th><th>Teramati</th><th>Selisih</th><th>Status</th></tr></thead>
            <tbody>
              {ops.data_quality.map((c) => (
                <tr key={c.check_key} title={c.note || ''}>
                  <td>{c.check_key}</td><td>{dayLabel(c.period_start)} – {dayLabel(c.period_end)}</td>
                  <td>{c.expected == null ? '—' : c.expected.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</td>
                  <td>{c.observed == null ? '—' : c.observed.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</td>
                  <td>{pct(c.rel_diff)}</td>
                  <td><span className={`maf-badge ${dqClass(c.status)}`}>{DQ_LABEL[c.status] ?? c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="maf-hint">Belum ada pemeriksaan tersimpan — terisi setelah sinkron berikutnya.</p>}
      <h4 style={{ marginTop: '1rem' }}>Performa aturan
        <select className="form-input" style={{ marginLeft: '.6rem', width: 'auto', display: 'inline-block' }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>7 hari</option><option value={30}>30 hari</option><option value={90}>90 hari</option>
        </select>
      </h4>
      {cal?.rules?.length ? (
        <div className="maf-table-wrap">
          <table className="maf-table">
            <thead><tr><th>Aturan</th><th>Muncul</th><th>Dipantau</th><th>Alert</th><th>Useful</th><th>Not useful</th><th>False positive</th><th>Needs more data</th><th>Catatan</th></tr></thead>
            <tbody>
              {cal.rules.map((r) => (
                <tr key={r.rule}>
                  <td>{r.rule}</td><td>{r.triggers}</td><td>{r.monitoring}</td><td>{r.alert_openings}</td><td>{r.useful}</td><td>{r.not_useful}</td>
                  <td>{r.false_positive}{r.false_positive_rate != null ? ` (${pct(r.false_positive_rate)})` : ''}</td><td>{r.needs_more_data}</td><td>{r.flag || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="maf-hint">Belum ada temuan atau review pada rentang ini. Review diberikan lewat tombol Useful / False positive di report (tampilan Internal).</p>}
      {cal?.calibration_log?.length > 0 && (
        <details style={{ marginTop: '.8rem' }}>
          <summary className="maf-hint" style={{ cursor: 'pointer' }}>Riwayat kalibrasi aturan ({cal.calibration_log.length})</summary>
          <ul className="maf-runs">
            {[...cal.calibration_log].reverse().map((e) => <li key={e.version + e.rule}><span className="maf-badge is-success">{e.version}</span><span>{e.date} · {e.rule}: {e.change}</span><span className="maf-run-meta">{e.reason}</span></li>)}
          </ul>
        </details>
      )}
    </>
  );
}

function firstOfMonth(offset) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// Pengaturan Brand › Google Ads: which Google Ads accounts feed this brand's
// Report Generator › Google Ads report.
//
// ATLAS only keeps the customer IDs. The numbers are pulled by the Google Ads
// Script in MIL's manager account (apps-script/GoogleAdsReport.js), which asks
// ATLAS every day what is missing — so adding an account here is all it takes,
// and "Tarik ulang" only queues a range for that script's next run.
export default function GoogleAdsSection({ brand }) {
  const { isViewOnly } = useAuth();
  const brandId = brand?.brand_id;
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ customerId: '', backfillFrom: '' });
  const [resync, setResync] = useState({ from: firstOfMonth(-1), to: new Date().toISOString().slice(0, 10) });

  const load = useCallback(async () => {
    if (!brandId) return;
    try {
      const res = await api.get('/google-ads/overview', { params: { brandId } });
      setOverview(res.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memuat koneksi Google Ads');
    }
  }, [brandId]);

  useEffect(() => {
    setOverview(null); setNotice(''); setError('');
    setForm({ customerId: '', backfillFrom: '' });
    load();
  }, [load]);

  async function act(key, work, success) {
    setBusy(key); setError(''); setNotice('');
    try {
      const res = await work();
      if (res?.data?.accounts) setOverview(res.data);
      if (success) setNotice(success);
      return true;
    } catch (err) {
      setError(err.response?.data?.details?.[0]?.msg || err.response?.data?.message || 'Gagal menyimpan');
      return false;
    } finally {
      setBusy('');
    }
  }

  // The account always belongs to the brand open on this page.
  async function addAccount(event) {
    event.preventDefault();
    const ok = await act('add', () => api.post('/google-ads/accounts', {
      brandId,
      customerId: form.customerId,
      backfillFrom: form.backfillFrom || overview?.defaultBackfillFrom,
    }), 'Akun tersimpan. Data mulai ditarik pada jadwal Google Ads Script berikutnya.');
    if (ok) setForm({ customerId: '', backfillFrom: '' });
  }

  const toggleActive = (account) => act(
    `active:${account.id}`,
    () => api.patch(`/google-ads/accounts/${account.id}`, { brandId, isActive: !account.is_active }),
    account.is_active ? 'Penarikan untuk akun ini dihentikan. Data yang sudah ada tetap tersimpan.' : 'Penarikan untuk akun ini aktif lagi.',
  );

  const removeAccount = (account) => {
    if (!window.confirm(`Hapus akun ${dashed(account.customer_id)} dari ${brand.brand_name}? Semua data Google Ads akun ini di ATLAS ikut terhapus.`)) return;
    act(`del:${account.id}`, () => api.delete(`/google-ads/accounts/${account.id}`, { params: { brandId } }), 'Akun dan datanya dihapus.');
  };

  const rebuildArchive = async () => {
    setBusy('archive'); setError(''); setNotice('');
    try {
      const res = await api.post('/google-ads/library/rebuild', { brandId });
      const filed = res.data.months.reduce((n, m) => n + m.files.length, 0);
      setNotice(`Arsip Performance Database diperbarui: ${filed} file untuk ${res.data.months.length} bulan.`);
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal mengisi arsip');
    } finally {
      setBusy('');
    }
  };

  const requestResync = (account) => act(
    `resync:${account.id}`,
    () => api.post(`/google-ads/accounts/${account.id}/resync`, { brandId, from: resync.from, to: resync.to }),
    `Tarik ulang ${dayLabel(resync.from)} – ${dayLabel(resync.to)} dijadwalkan untuk jalan Google Ads Script berikutnya.`,
  );

  if (!brandId) return null;
  const accounts = overview?.accounts ?? [];

  return (
    <>
      <div className="brand-workspace-head">
        <div>
          <h2>Google Ads</h2>
          <p>
            Hubungkan akun Google Ads brand ini dengan Customer ID-nya. Setiap hari jam 01.00 ATLAS menarik data harian per campaign,
            ad group, keyword, search term, kota, iklan, konversi per action, device, jam, dan landing page, plus setting campaign dan Quality Score —
            cost kemarin masuk ke Brand Tracking, dan semuanya tersusun di Report Generator › Google Ads.
          </p>
        </div>
        <span className="brand-section-meta">{accounts.length ? `${accounts.length} akun terhubung` : 'Belum terhubung'}</span>
      </div>

      <section className="maf" aria-label="Akun Google Ads">
        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success">{notice}</div>}

        {!overview ? (
          <p className="maf-loading"><Loader2 size={14} className="maf-spin" /> Memuat…</p>
        ) : (
          <>
            <div className="maf-block">
              <h4>Akun terhubung</h4>
              {accounts.length === 0 ? (
                <div className="maf-empty">
                  <CircleAlert size={16} />
                  <span>Belum ada akun Google Ads untuk brand ini. Tambahkan Customer ID di bawah — ada di pojok kanan atas Google Ads, format 123-456-7890.</span>
                </div>
              ) : (
                <div className="maf-table-wrap">
                  <table className="maf-table">
                    <thead>
                      <tr><th>Customer ID</th><th>Nama di Google Ads</th><th>Mata uang</th><th>Data tersedia</th><th>Sinkron terakhir</th><th /></tr>
                    </thead>
                    <tbody>
                      {accounts.map((a) => (
                        <tr key={a.id}>
                          <td>{dashed(a.customer_id)}{!a.is_active && <small className="maf-run-meta"> · dijeda</small>}</td>
                          <td>{a.account_name || <span className="maf-run-meta">menunggu sinkron pertama</span>}</td>
                          <td>{a.currency_code || '—'}</td>
                          <td>{a.coverage ? `${dayLabel(a.coverage.first_date)} – ${dayLabel(a.coverage.last_date)}` : <span className="maf-run-meta">sejak {dayLabel(a.backfill_from)}, belum ada</span>}</td>
                          <td>
                            {a.last_sync_status === 'failed'
                              ? <span className="maf-badge is-failed" title={a.last_sync_error || ''}><CircleAlert size={12} /> Gagal</span>
                              : a.last_synced_at ? <span className="maf-badge is-success"><Check size={12} /> {dateTime(a.last_synced_at)}</span> : '—'}
                            {a.resync_requested_at && <small className="maf-run-meta"> · tarik ulang {dayLabel(a.resync_from)}–{dayLabel(a.resync_to)} menunggu</small>}
                          </td>
                          <td className="maf-row-actions">
                            <button type="button" className="btn btn-icon" title="Tarik ulang rentang di bawah" aria-label={`Tarik ulang ${dashed(a.customer_id)}`}
                              onClick={() => requestResync(a)} disabled={isViewOnly || !a.is_active || busy === `resync:${a.id}`}>
                              {busy === `resync:${a.id}` ? <Loader2 size={14} className="maf-spin" /> : <RefreshCw size={14} />}
                            </button>
                            <button type="button" className="btn btn-icon" title={a.is_active ? 'Jeda penarikan' : 'Aktifkan penarikan'} aria-label={a.is_active ? 'Jeda' : 'Aktifkan'}
                              onClick={() => toggleActive(a)} disabled={isViewOnly || busy === `active:${a.id}`}>
                              {a.is_active ? <Pause size={14} /> : <Play size={14} />}
                            </button>
                            <button type="button" className="btn btn-icon" title="Hapus akun" aria-label={`Hapus ${dashed(a.customer_id)}`}
                              onClick={() => removeAccount(a)} disabled={isViewOnly || busy === `del:${a.id}`}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {accounts.some((a) => a.last_sync_status === 'failed' && a.last_sync_error) && (
                <p className="maf-hint">
                  {accounts.filter((a) => a.last_sync_status === 'failed').map((a) => `${dashed(a.customer_id)}: ${a.last_sync_error}`).join(' · ')}
                </p>
              )}
              {accounts.length > 0 && (
                <div className="maf-actions">
                  <label className="maf-option">Tarik ulang dari
                    <input type="date" className="form-input" value={resync.from} max={resync.to} onChange={(e) => setResync((r) => ({ ...r, from: e.target.value }))} />
                  </label>
                  <label className="maf-option">sampai
                    <input type="date" className="form-input" value={resync.to} min={resync.from} onChange={(e) => setResync((r) => ({ ...r, to: e.target.value }))} />
                  </label>
                  <small className="maf-hint">Pilih rentang, lalu tekan <RefreshCw size={11} /> pada akunnya. Bulan berjalan dan bulan lalu sudah diperbarui otomatis setiap hari.</small>
                </div>
              )}
              {accounts.length > 0 && !isViewOnly && (
                <div className="maf-actions">
                  <button type="button" className="btn btn-ghost dt-btn-sm" onClick={rebuildArchive} disabled={busy === 'archive'}>
                    {busy === 'archive' ? <Loader2 size={14} className="maf-spin" /> : <RefreshCw size={14} />} Isi arsip Performance Database
                  </button>
                  <small className="maf-hint">Membuat ulang file bulanan Google Ads di Performance Database untuk setiap bulan yang sudah selesai dan tersinkron. Bulan baru terisi otomatis tiap tanggal 1.</small>
                </div>
              )}
            </div>

            {!isViewOnly && (
              <form className="maf-block gads-add-form" onSubmit={addAccount}>
                <h4>Tambah akun</h4>
                <div className="maf-actions">
                  <label className="maf-option">Customer ID
                    <input className="form-input" placeholder="123-456-7890" value={form.customerId} required
                      onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))} />
                  </label>
                  <label className="maf-option">Tarik data sejak
                    <input type="date" className="form-input" value={form.backfillFrom || overview.defaultBackfillFrom}
                      onChange={(e) => setForm((f) => ({ ...f, backfillFrom: e.target.value }))} />
                  </label>
                  <button type="submit" className="btn btn-primary dt-btn-sm" disabled={busy === 'add' || !form.customerId.trim()}>
                    {busy === 'add' ? <Loader2 size={14} className="maf-spin" /> : <Plus size={14} />} Hubungkan
                  </button>
                </div>
                <p className="maf-hint">
                  Setelah menghubungkan, pasang Google Ads Script (apps-script/GoogleAdsReport.js) di akun Google Ads itu sendiri:
                  Tools › Bulk actions › Scripts, lalu jadwalkan Daily jam 01.00. Tanpa script itu, data akun ini tidak akan masuk.
                </p>
              </form>
            )}

            {accounts.length > 0 && <ConversionGoals brandId={brandId} isViewOnly={isViewOnly} />}

            {accounts.length > 0 && (
              <details className="maf-block">
                <summary><h4 style={{ display: 'inline' }}>Operasional &amp; kalibrasi (internal)</h4></summary>
                <OpsPanel brandId={brandId} />
              </details>
            )}

            <div className="maf-block">
              <h4>Riwayat penarikan</h4>
              {overview.runs.length === 0 ? (
                <p className="maf-hint">Belum ada penarikan.</p>
              ) : (
                <ul className="maf-runs">
                  {overview.runs.slice(0, 10).map((run) => {
                    const state = runState(run);
                    return (
                      <li key={run.runId}>
                        <span className={`maf-badge is-${state.key}`}>
                          {state.key === 'running' ? <Loader2 size={12} className="maf-spin" /> : state.key === 'success' ? <Check size={12} /> : <CircleAlert size={12} />}
                          {state.label}
                        </span>
                        <span>{dashed(run.customerId)} · {dayLabel(run.startDate)} – {dayLabel(run.endDate)} · {run.source === 'api' ? 'Google Ads API' : 'Ads Script'}</span>
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
    </>
  );
}
