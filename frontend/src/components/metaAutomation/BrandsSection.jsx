import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import api from '../../api/client.js';

const EMPTY_FORM = { id: '', client: '', type: 'MAIN', token: '' };

// Alur 1 — Tambah Brand ke Database: cuma kredensial ad account, TIDAK
// ADA pengaturan notifikasi di sini sama sekali. Itu ada di SubscriptionsSection.
export default function BrandsSection() {
  const [brands, setBrands] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.get('/meta-automation/brands'),
      api.get('/meta-automation/subscriptions'),
    ])
      .then(([brandsRes, subsRes]) => {
        setBrands(brandsRes.data.brands || []);
        setSubscriptions(subsRes.data.subscriptions || []);
      })
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat brand'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setFormMessage(null);
  };

  const handleEdit = (b) => {
    setForm({ id: b.id, client: b.client, type: b.type, token: '' });
    setFormMessage(null);
  };

  const isExistingBrand = brands.some((b) => b.id === form.id);

  const handleSave = async () => {
    if (!form.id.trim() || !form.client.trim()) {
      setFormMessage({ type: 'error', text: 'ID akun dan nama brand wajib diisi.' });
      return;
    }
    const isEdit = brands.some((b) => b.id === form.id && b.source === 'dynamic');
    if (!isEdit && !form.token.trim()) {
      setFormMessage({ type: 'error', text: 'Token wajib diisi untuk brand baru.' });
      return;
    }

    const confirmed = window.confirm(
      isEdit
        ? `Simpan perubahan ke brand "${form.client}"?`
        : `Tambah brand "${form.client}" baru? Ini akan menyimpan token ke Script Properties Apps Script.`,
    );
    if (!confirmed) return;

    const payload = { client: form.client.trim(), type: form.type, token: form.token.trim() || undefined };

    setSaving(true);
    setFormMessage(null);
    try {
      const res = isEdit
        ? await api.put(`/meta-automation/brands/${encodeURIComponent(form.id)}`, payload)
        : await api.post('/meta-automation/brands', { ...payload, id: form.id.trim() });
      setFormMessage({ type: 'success', text: `Tersimpan: "${res.data.brand.client}". Belum ada yang dinotifikasi — buat langganan di tab Langganan kalau perlu.` });
      resetForm();
      load();
    } catch (err) {
      setFormMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menyimpan brand' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (b) => {
    const relatedSubs = subscriptions.filter((s) => s.brandId === b.id);
    const question = relatedSubs.length
      ? `Hapus brand "${b.client}"? Ini akan ikut menghapus ${relatedSubs.length} langganan: ${relatedSubs.map((s) => s.email).join(', ')}. Aksi ini tidak bisa dibatalkan.`
      : `Hapus brand "${b.client}"? Brand ini belum punya langganan.`;
    const confirmed = window.confirm(question);
    if (!confirmed) return;

    setDeletingId(b.id);
    setError('');
    try {
      await api.delete(`/meta-automation/brands/${encodeURIComponent(b.id)}`);
      load();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus brand');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state">Memuat...</div>
        ) : brands.length === 0 ? (
          <div className="empty-state">Belum ada brand.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                <th>ID Ad Account</th>
                <th>Tipe</th>
                <th>Sumber</th>
                <th>Token</th>
                <th>Langganan</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => {
                const subCount = subscriptions.filter((s) => s.brandId === b.id).length;
                return (
                  <tr key={b.id}>
                    <td>{b.client}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{b.id}</td>
                    <td>{b.type}</td>
                    <td>
                      <span className={`badge ${b.source === 'dynamic' ? 'badge-info' : 'badge-warning'}`}>
                        {b.source === 'dynamic' ? 'Dinamis' : 'Hardcoded'}
                      </span>
                    </td>
                    <td><span className={`badge ${b.hasToken ? 'badge-success' : 'badge-danger'}`}>{b.hasToken ? 'Ada' : 'Kosong'}</span></td>
                    <td>{subCount}</td>
                    <td>
                      {b.source === 'dynamic' && (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="button" className="btn btn-secondary btn-icon" title="Edit" onClick={() => handleEdit(b)}>
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-icon"
                            title="Hapus"
                            disabled={deletingId === b.id}
                            onClick={() => handleDelete(b)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '0.5rem' }}>{form.id && isExistingBrand ? `Edit: ${form.client}` : 'Tambah Brand ke Database'}</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Cuma kredensial ad account. Brand ini tidak akan menghasilkan email apa pun sampai ada
          yang membuat langganan untuknya di tab Langganan.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>ID Ad Account (act_...)</label>
            <input
              value={form.id}
              disabled={!!form.id && isExistingBrand}
              onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              placeholder="act_123456789012345"
            />
          </div>
          <div className="form-group">
            <label>Nama Brand</label>
            <input value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))} placeholder="mis. Maiimi" />
          </div>
          <div className="form-group">
            <label>Tipe Ad Account</label>
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="MAIN">MAIN</option>
              <option value="CPAS">CPAS</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Token Meta Ads</label>
          <input
            type="password"
            value={form.token}
            onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
            placeholder={isExistingBrand ? 'Kosongkan kalau tidak ganti token' : 'Token system user Meta Ads'}
          />
        </div>

        {formMessage && <div className={`alert alert-${formMessage.type}`}>{formMessage.text}</div>}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={saving}>
            Batal / Form Kosong
          </button>
        </div>
      </div>
    </div>
  );
}
