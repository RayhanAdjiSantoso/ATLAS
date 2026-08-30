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
};

// Groups a Meta Ads account under its Business Manager portfolio -- falls
// back to the account's own client name if it has no portfolio. Used to
// drive the Brand -> Tipe Ad Account (MAIN/CPAS) cascade below, since one
// brand can own more than one ad account.
const brandKey = (a) => a.portfolio || a.client;

export default function DailyTrackingTab() {
  const [configs, setConfigs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [accountSelection, setAccountSelection] = useState({ brand: '', type: '' });
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState(null);

  const [previewingId, setPreviewingId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [runningAll, setRunningAll] = useState(false);
  const [runAllMessage, setRunAllMessage] = useState(null);
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  const brands = Array.from(new Set(accounts.map(brandKey))).sort();
  const typesForBrand = Array.from(
    new Set(accounts.filter((a) => brandKey(a) === accountSelection.brand).map((a) => a.type || 'MAIN')),
  ).sort();

  const loadAll = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get('/meta-automation/tracking'),
      api.get('/meta-automation/accounts'),
    ])
      .then(([trackingRes, accountsRes]) => {
        setConfigs(trackingRes.data.configs || []);
        setAccounts(accountsRes.data.accounts || []);
      })
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data'))
      .finally(() => setLoading(false));
  };

  useEffect(loadAll, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setAccountSelection({ brand: '', type: '' });
    setFormMessage(null);
  };

  const handleEdit = (cfg) => {
    setForm({ ...EMPTY_FORM, ...cfg, id: cfg.id });
    const acct = accounts.find((a) => a.client === cfg.accountClient);
    setAccountSelection(acct ? { brand: brandKey(acct), type: acct.type || 'MAIN' } : { brand: '', type: '' });
    setFormMessage(null);
    setPreview(null);
  };

  const handleSave = async () => {
    if (!form.label.trim() || !form.sheetUrl.trim() || !form.tabName.trim() || !form.accountClient) {
      setFormMessage({ type: 'error', text: 'Nama brand, link sheet, nama tab, dan akun Meta Ads wajib diisi.' });
      return;
    }

    setSaving(true);
    setFormMessage(null);
    try {
      const payload = { ...form };
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

      {error && <div className="alert alert-error">{error}</div>}

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
                  <td>{c.boostHeader} / {c.nonBoostHeader}</td>
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
            {' '}Non-Boost: {preview.nonBoostSpend}, {preview.campaigns} campaign ditemukan. Nilai existing di sheet
            sekarang: {preview.existingBoost} / {preview.existingNonBoost}. Ini cuma preview — belum ditulis ke sheet.
          </div>
        )
      )}

      <div className="card">
        <h3 style={{ marginBottom: '1rem' }}>{form.id ? `Edit: ${form.label}` : 'Tambah Brand Baru'}</h3>

        <div className="form-group">
          <label>Nama Brand (label bebas)</label>
          <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="mis. Petite Fleur - Daily Tracking" />
        </div>

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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Brand (akun Meta Ads)</label>
            <select
              value={accountSelection.brand}
              onChange={(e) => {
                setAccountSelection({ brand: e.target.value, type: '' });
                setForm((f) => ({ ...f, accountClient: '' }));
              }}
            >
              <option value="">Pilih brand...</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Tipe Ad Account</label>
            <select
              value={accountSelection.type}
              disabled={!accountSelection.brand}
              onChange={(e) => {
                const type = e.target.value;
                const acct = accounts.find((a) => brandKey(a) === accountSelection.brand && (a.type || 'MAIN') === type);
                setAccountSelection((s) => ({ ...s, type }));
                setForm((f) => ({ ...f, accountClient: acct ? acct.client : '' }));
              }}
            >
              <option value="">{accountSelection.brand ? 'Pilih tipe...' : 'Pilih brand dulu'}</option>
              {typesForBrand.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Kata Kunci Boost Post</label>
          <input value={form.boostMatch} onChange={(e) => setForm((f) => ({ ...f, boostMatch: e.target.value }))} />
        </div>

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
