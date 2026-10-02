import { useCallback, useEffect, useState } from 'react';
import { Check, CircleAlert, Loader2, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import api from '../../api/client.js';
import { useAuth } from '../../contexts/AuthContext.jsx';
import BrandCombo from '../metaAutomation/BrandCombo.jsx';
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
  const [form, setForm] = useState({ customerId: '', brandName: brand?.brand_name ?? '', backfillFrom: '' });
  const [atlasBrands, setAtlasBrands] = useState([]); // [{brand_id, brand_name}]
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
    setForm({ customerId: '', brandName: brand?.brand_name ?? '', backfillFrom: '' });
    load();
  }, [load, brand?.brand_name]);

  useEffect(() => {
    api.get('/brands')
      .then((res) => setAtlasBrands(res.data.brands || []))
      .catch(() => setAtlasBrands([]));
  }, []);

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

  // The account goes to the brand picked under "Nama Brand" — the brand
  // open on this page by default, but any ATLAS brand can be chosen.
  const targetBrand = atlasBrands.find((b) => b.brand_name === form.brandName) ?? null;

  async function addAccount(event) {
    event.preventDefault();
    if (!targetBrand) return;
    const elsewhere = targetBrand.brand_id !== brandId;
    const ok = await act('add', async () => {
      await api.post('/google-ads/accounts', {
        brandId: targetBrand.brand_id,
        customerId: form.customerId,
        backfillFrom: form.backfillFrom || overview?.defaultBackfillFrom,
      });
      // The response lists the target brand's accounts; this page shows this brand's.
      return api.get('/google-ads/overview', { params: { brandId } });
    }, elsewhere
      ? `Akun tersimpan di brand ${targetBrand.brand_name}. Buka brand itu untuk melihat status sinkronnya.`
      : 'Akun tersimpan. Data mulai ditarik pada jadwal Google Ads Script berikutnya (harian).');
    if (ok) setForm({ customerId: '', brandName: brand?.brand_name ?? '', backfillFrom: '' });
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
            Hubungkan akun Google Ads brand ini dengan Customer ID-nya. ATLAS menarik data harian per campaign, ad group,
            keyword, search term, dan kota setiap hari, lalu menyusunnya di Report Generator › Google Ads.
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
            </div>

            {!isViewOnly && (
              <form className="maf-block gads-add-form" onSubmit={addAccount}>
                <h4>Tambah akun</h4>
                <div className="maf-actions">
                  <label className="maf-option">Customer ID
                    <input className="form-input" placeholder="123-456-7890" value={form.customerId} required
                      onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))} />
                  </label>
                  <div className="maf-option gads-brand-field">Nama Brand
                    <BrandCombo
                      options={atlasBrands.map((b) => b.brand_name).sort()}
                      value={form.brandName}
                      placeholder="Pilih brand ATLAS..."
                      onChange={(v) => setForm((f) => ({ ...f, brandName: v }))}
                    />
                  </div>
                  <label className="maf-option">Tarik data sejak
                    <input type="date" className="form-input" value={form.backfillFrom || overview.defaultBackfillFrom}
                      onChange={(e) => setForm((f) => ({ ...f, backfillFrom: e.target.value }))} />
                  </label>
                  <button type="submit" className="btn btn-primary dt-btn-sm" disabled={busy === 'add' || !form.customerId.trim() || !targetBrand}>
                    {busy === 'add' ? <Loader2 size={14} className="maf-spin" /> : <Plus size={14} />} Hubungkan
                  </button>
                </div>
                <p className="maf-hint">
                  Setelah menghubungkan, pasang Google Ads Script (apps-script/GoogleAdsReport.js) di akun Google Ads itu sendiri:
                  Tools › Bulk actions › Scripts, lalu jadwalkan Daily. Tanpa script itu, data akun ini tidak akan masuk.
                </p>
              </form>
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
