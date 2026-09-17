import { useEffect, useState } from 'react';
import { Pencil, FlaskConical, Trash2 } from 'lucide-react';
import api from '../../api/client.js';
import AutomationLogPanel from './AutomationLogPanel.jsx';

const EMPTY_FORM = {
  id: null,
  label: '',
  sheetUrl: '',
  tabName: '',
  headerRow: 3,
  dateHeader: 'Date',
  boostHeader: 'Boost Post',
  nonBoostHeader: '',
  accountClient: '',
  boostMatch: 'profile visit',
  emailOnFailure: true,
  atlasBrandId: null,
  cpasAccountId: '',
  cpasHeader: 'CPAS Shopee',
};

export default function DailyTrackingTab() {
  const [configs, setConfigs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [atlasBrands, setAtlasBrands] = useState([]); // [{brand_id, brand_name}]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [accountSelection, setAccountSelection] = useState({ brand: '', type: '' });
  const [trackCpas, setTrackCpas] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState(null);

  const [previewingId, setPreviewingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [runningAll, setRunningAll] = useState(false);
  const [runAllMessage, setRunAllMessage] = useState(null);
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  const brands = Array.from(new Set(accounts.map((a) => a.client))).sort();
  const typesForBrand = Array.from(
    new Set(accounts.filter((a) => a.client === accountSelection.brand).map((a) => a.type || 'MAIN')),
  ).sort();
  // A brand's ad account can itself be typed CPAS — a brand with both MAIN
  // and CPAS accounts registered (see BrandsSection) normally gets TWO
  // separate Daily Tracking configs (e.g. "Petite Fleur - MAIN" and
  // "Petite Fleur - CPAS"), not one. Picking Tipe Ad Account = CPAS here
  // means THIS config's own account is the CPAS one: no Boost/Non-Boost
  // classification at all, every campaign's spend just sums into one number.
  const isCpasType = accountSelection.type === 'CPAS';
  // The MAIN-config bolt-on below is a separate, optional path: pull CPAS
  // from a sibling account WITHOUT a second config, when the brand's own
  // Daily Tracking is simpler as one row. At most one sibling CPAS account
  // per brand, enforced by uiSaveBrand_'s name+type uniqueness.
  const cpasAccount = !isCpasType
    && accounts.find((a) => a.client === accountSelection.brand && (a.type || 'MAIN') === 'CPAS');
  // "Brand (akun Meta Ads)" is now sourced from BrandsSection, which itself
  // only lets you pick from ATLAS's own brand list — so this should always
  // resolve. A miss only happens for a brand added before that restriction
  // existed; the field stays optional in that case rather than blocking save.
  const atlasBrandMatch = atlasBrands.find((b) => b.brand_name === accountSelection.brand);

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      // /meta-automation/tracking and /accounts both hit the SAME Apps
      // Script Web App — firing them at once is exactly the "concurrent
      // script executions" condition that makes Google's front end serve an
      // interstitial page instead of proxying through (see
      // metaAutomationService.js). Sequential, not Promise.all, so the two
      // requests never overlap. /brands is ATLAS's own endpoint, unaffected,
      // so it stays independent.
      const atlasBrandsPromise = api.get('/brands');
      const trackingRes = await api.get('/meta-automation/tracking');
      const accountsRes = await api.get('/meta-automation/accounts');
      const atlasBrandsRes = await atlasBrandsPromise;
      setConfigs(trackingRes.data.configs || []);
      setAccounts(accountsRes.data.accounts || []);
      setAtlasBrands(atlasBrandsRes.data.brands || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal memuat data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(loadAll, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setAccountSelection({ brand: '', type: '' });
    setTrackCpas(false);
    setFormMessage(null);
  };

  const handleEdit = (cfg) => {
    setForm({
      ...EMPTY_FORM,
      ...cfg,
      id: cfg.id,
      // Apps Script nulls out whichever side doesn't apply to this config's
      // account type (boost/non-boost for a CPAS-primary config, cpasHeader
      // for a plain MAIN config with no bolt-on) — fall back to the
      // empty-form defaults so those fields never hand a null to a
      // controlled <input>, even if the admin flips "Tipe Ad Account" while
      // editing.
      boostHeader: cfg.boostHeader || EMPTY_FORM.boostHeader,
      nonBoostHeader: cfg.nonBoostHeader || EMPTY_FORM.nonBoostHeader,
      boostMatch: cfg.boostMatch || EMPTY_FORM.boostMatch,
      cpasHeader: cfg.cpasHeader || EMPTY_FORM.cpasHeader,
    });
    const acct = accounts.find((a) => a.client === cfg.accountClient);
    setAccountSelection(acct ? { brand: acct.client, type: acct.type || 'MAIN' } : { brand: '', type: '' });
    setTrackCpas(!!cfg.cpasAccountId);
    setFormMessage(null);
    setPreview(null);
  };

  const handleSave = async () => {
    if (!form.sheetUrl.trim() || !form.tabName.trim() || !form.accountClient) {
      setFormMessage({ type: 'error', text: 'Brand, link sheet, dan nama tab wajib diisi.' });
      return;
    }
    if (trackCpas && !cpasAccount) {
      setFormMessage({ type: 'error', text: 'Tidak ada akun CPAS terdaftar untuk brand ini — daftarkan dulu di tab Brand.' });
      return;
    }
    if (isCpasType && !form.cpasHeader.trim()) {
      setFormMessage({ type: 'error', text: 'Nama kolom CPAS Shopee wajib diisi.' });
      return;
    }
    if (!isCpasType && !form.nonBoostHeader.trim()) {
      setFormMessage({ type: 'error', text: 'Nama kolom non-boost wajib diisi.' });
      return;
    }

    // Label tidak lagi diketik manual — diambil dari Brand + Tipe Ad Account
    // yang dipilih, supaya selalu konsisten dengan pilihan di atas.
    const label = `${accountSelection.brand} - ${accountSelection.type}`;
    const needsCpasHeader = isCpasType || (trackCpas && cpasAccount);

    setSaving(true);
    setFormMessage(null);
    try {
      const payload = {
        ...form,
        label,
        atlasBrandId: atlasBrandMatch ? atlasBrandMatch.brand_id : null,
        // Backend/`.gs` also derive this from the account's own type and
        // will null these out server-side for a CPAS-typed config either
        // way — cleared here too so a stale value never shows in the table.
        boostHeader: isCpasType ? null : form.boostHeader,
        nonBoostHeader: isCpasType ? null : form.nonBoostHeader,
        boostMatch: isCpasType ? null : form.boostMatch,
        cpasAccountId: !isCpasType && trackCpas && cpasAccount ? cpasAccount.id : null,
        cpasHeader: needsCpasHeader ? (form.cpasHeader.trim() || 'CPAS Shopee') : null,
      };
      delete payload.id;
      const res = form.id
        ? await api.put(`/meta-automation/tracking/${form.id}`, payload)
        : await api.post('/meta-automation/tracking', payload);
      const saved = res.data.config;
      setFormMessage({ type: 'success', text: `Tersimpan: "${saved.label}". Sheet, tab, dan header sudah ketemu & tervalidasi.` });
      resetForm();
      loadAll();
    } catch (err) {
      setFormMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menyimpan' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (cfg) => {
    const confirmed = window.confirm(`Hapus konfigurasi "${cfg.label}"? Data di sheet brand-nya tidak akan berubah, ini cuma menghapus pendaftarannya di sini.`);
    if (!confirmed) return;

    setDeletingId(cfg.id);
    setError('');
    try {
      const res = await api.delete(`/meta-automation/tracking/${cfg.id}`);
      setConfigs(res.data.configs || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus');
    } finally {
      setDeletingId(null);
    }
  };

  const handlePreview = async (cfg) => {
    setPreviewingId(cfg.id);
    setPreview(null);
    setError('');
    try {
      const res = await api.post(`/meta-automation/tracking/${cfg.id}/preview`);
      setPreview({ ...res.data.preview, label: res.data.preview.label || cfg.label });
    } catch (err) {
      setPreview({ status: 'FAILED', label: cfg.label, error: err.response?.data?.message || 'Test gagal' });
    } finally {
      setPreviewingId(null);
    }
  };

  const handleRunAll = async () => {
    const confirmed = window.confirm('Jalankan H-1 untuk SEMUA brand sekarang? Ini akan menulis Boost Post & kolom non-boost ke sheet Daily Tracking tiap brand.');
    if (!confirmed) return;

    setRunningAll(true);
    setRunAllMessage(null);
    try {
      await api.post('/meta-automation/tracking/run-all');
      setRunAllMessage({ type: 'success', text: 'Daily Tracking selesai dijalankan untuk semua brand.' });
      setLogRefreshKey((k) => k + 1);
    } catch (err) {
      setRunAllMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menjalankan Daily Tracking' });
    } finally {
      setRunningAll(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={handleRunAll} disabled={runningAll}>
          {runningAll ? 'Menjalankan...' : 'Jalankan Sekarang (Semua Brand)'}
        </button>
      </div>
      {runAllMessage && <div className={`alert alert-${runAllMessage.type}`}>{runAllMessage.text}</div>}

      {error && (
        <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <span>{error} — Apps Script kadang sempat membalas halaman "loading" saat baru dipanggil, coba lagi tanpa refresh browser.</span>
          <button type="button" className="btn btn-secondary" onClick={loadAll} disabled={loading}>Coba Lagi</button>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state">Memuat...</div>
        ) : configs.length === 0 ? (
          <div className="empty-state">Belum ada brand yang dikonfigurasi. Isi form di bawah untuk menambahkan.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                <th>Tab</th>
                <th>Akun</th>
                <th>Kolom</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {configs.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>{c.tabName}</td>
                  <td>{c.accountClient}</td>
                  <td>
                    {c.boostHeader
                      ? `${c.boostHeader} / ${c.nonBoostHeader}${c.cpasAccountId ? ` / ${c.cpasHeader}` : ''}`
                      : c.cpasHeader}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="button" className="btn btn-secondary btn-icon" title="Edit" onClick={() => handleEdit(c)}>
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-icon"
                        title="Test (dry run)"
                        disabled={previewingId === c.id}
                        onClick={() => handlePreview(c)}
                      >
                        <FlaskConical size={16} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-icon"
                        title="Hapus"
                        disabled={deletingId === c.id}
                        onClick={() => handleDelete(c)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {preview && (
        preview.status === 'FAILED' ? (
          <div className="alert alert-error">Test GAGAL untuk "{preview.label}" — {preview.error}</div>
        ) : (
          <div className="alert alert-success">
            Test OK — {preview.label} (tanggal {preview.date}, baris {preview.row}). Boost Post: {preview.boostSpend},
            {' '}Non-Boost: {preview.nonBoostSpend}
            {preview.cpasSpend != null && <>, CPAS: {preview.cpasSpend}</>}
            {' '}({preview.campaigns} campaign ditemukan). Nilai existing di sheet
            sekarang: {preview.existingBoost} / {preview.existingNonBoost}
            {preview.existingCpas != null && <> / {preview.existingCpas}</>}. Ini cuma preview — belum ditulis ke sheet.
          </div>
        )
      )}

      <div className="card">
        <h3 style={{ marginBottom: '1rem' }}>{form.id ? `Edit: ${form.label}` : 'Tambah Brand Baru'}</h3>

        <div className="form-group">
          <label>Link Google Sheets</label>
          <input value={form.sheetUrl} onChange={(e) => setForm((f) => ({ ...f, sheetUrl: e.target.value }))} placeholder="https://docs.google.com/spreadsheets/d/..." />
        </div>

        <div className="form-group">
          <label>Nama Tab</label>
          <input value={form.tabName} onChange={(e) => setForm((f) => ({ ...f, tabName: e.target.value }))} placeholder="mis. Daily Tracking 2026" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Baris Header</label>
            <input type="number" min="1" value={form.headerRow} onChange={(e) => setForm((f) => ({ ...f, headerRow: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Header Kolom Tanggal</label>
            <input value={form.dateHeader} onChange={(e) => setForm((f) => ({ ...f, dateHeader: e.target.value }))} />
          </div>
        </div>

        {!isCpasType && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label>Header Kolom Boost Post</label>
              <input value={form.boostHeader} onChange={(e) => setForm((f) => ({ ...f, boostHeader: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Header Kolom Non-Boost</label>
              <input value={form.nonBoostHeader} onChange={(e) => setForm((f) => ({ ...f, nonBoostHeader: e.target.value }))} placeholder="mis. FB Ads" />
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Brand (akun Meta Ads)</label>
            <select
              value={accountSelection.brand}
              onChange={(e) => {
                setAccountSelection({ brand: e.target.value, type: '' });
                setForm((f) => ({ ...f, accountClient: '' }));
                setTrackCpas(false);
              }}
            >
              <option value="">Pilih brand...</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            {accountSelection.brand && !atlasBrandMatch && (
              <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '0.35rem' }}>
                Nama brand ini tidak cocok dengan brand ATLAS manapun — config akan tetap tersimpan
                dan tetap menulis ke Sheet, tapi TIDAK akan muncul di dropdown "Pilih config" pada
                halaman Daily Tracking ATLAS. Perbaiki lewat tab Brand kalau perlu.
              </p>
            )}
          </div>
          <div className="form-group">
            <label>Tipe Ad Account</label>
            <select
              value={accountSelection.type}
              disabled={!accountSelection.brand}
              onChange={(e) => {
                const type = e.target.value;
                const acct = accounts.find((a) => a.client === accountSelection.brand && (a.type || 'MAIN') === type);
                setAccountSelection((s) => ({ ...s, type }));
                setForm((f) => ({ ...f, accountClient: acct ? acct.client : '' }));
                setTrackCpas(false);
              }}
            >
              <option value="">{accountSelection.brand ? 'Pilih tipe...' : 'Pilih brand dulu'}</option>
              {typesForBrand.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {accountSelection.type && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                {isCpasType
                  ? 'Akun CPAS: tidak ada pembagian Boost/Non-Boost — semua campaign akun ini dijumlah langsung jadi satu angka CPAS.'
                  : 'Akun MAIN: campaign diklasifikasi Boost/Non-Boost lewat kata kunci di bawah, seperti biasa.'}
              </p>
            )}
          </div>
        </div>

        {!isCpasType && (
          <div className="form-group">
            <label>Kata Kunci Boost Post</label>
            <input value={form.boostMatch} onChange={(e) => setForm((f) => ({ ...f, boostMatch: e.target.value }))} />
          </div>
        )}

        {isCpasType && (
          <div className="form-group">
            <label>Header Kolom CPAS Shopee</label>
            <input
              value={form.cpasHeader}
              onChange={(e) => setForm((f) => ({ ...f, cpasHeader: e.target.value }))}
              placeholder="mis. CPAS Shopee"
            />
          </div>
        )}

        {cpasAccount && (
          <div className="form-group" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: trackCpas ? '0.75rem' : 0 }}>
              <input
                type="checkbox"
                id="trackCpas"
                style={{ width: 'auto' }}
                checked={trackCpas}
                onChange={(e) => setTrackCpas(e.target.checked)}
              />
              <label htmlFor="trackCpas" style={{ marginBottom: 0 }}>
                Tarik juga CPAS Shopee dari akun {cpasAccount.id} — TANPA pembagian berdasarkan
                nama campaign (beda dari Boost/Non-Boost di atas), semua spend akun ini dijumlah apa adanya.
              </label>
            </div>
            {trackCpas && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Header Kolom CPAS Shopee</label>
                <input
                  value={form.cpasHeader}
                  onChange={(e) => setForm((f) => ({ ...f, cpasHeader: e.target.value }))}
                  placeholder="mis. CPAS Shopee"
                />
              </div>
            )}
          </div>
        )}

        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            id="emailOnFailure"
            style={{ width: 'auto' }}
            checked={form.emailOnFailure}
            onChange={(e) => setForm((f) => ({ ...f, emailOnFailure: e.target.checked }))}
          />
          <label htmlFor="emailOnFailure" style={{ marginBottom: 0 }}>Kirim email kalau gagal narik data</label>
        </div>

        {formMessage && <div className={`alert alert-${formMessage.type}`}>{formMessage.text}</div>}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Memvalidasi...' : 'Simpan & Validasi'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={saving}>
            Batal / Form Kosong
          </button>
        </div>
      </div>

      <AutomationLogPanel prefix="[TRACKING]" refreshKey={logRefreshKey} />
    </div>
  );
}
