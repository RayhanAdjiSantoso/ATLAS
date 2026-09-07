import { useEffect, useState, useCallback } from 'react';
import { Pencil, Trash2, Star, X } from 'lucide-react';
import api from '../../api/client.js';

const EMPTY = { id: null, ad_account_id: '', account_name: '', is_primary: false };

// brand_ad_accounts — Meta ad-account list per client (1 : many). Add / edit
// / delete rows. Loose format check on the ID (no confirmed official rule).
export default function AdAccountsForm({ clientId, onSaved }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!clientId) { setRows([]); return; }
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/ad-accounts', { params: { brand_id: clientId } })
      .then((res) => setRows(res.data.entries || []))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);
  useEffect(() => { setForm(EMPTY); setMessage(null); }, [clientId]);

  const editing = form.id != null;

  const handleSave = async () => {
    if (!form.ad_account_id.trim()) {
      setMessage({ type: 'error', text: 'Ad account ID wajib diisi.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.post('/internal-dashboard/ad-accounts', {
        id: form.id ?? undefined,
        brand_id: clientId,
        ad_account_id: form.ad_account_id.trim(),
        account_name: form.account_name.trim() || null,
        is_primary: form.is_primary,
      });
      setMessage({ type: 'success', text: editing ? 'Ad account diperbarui.' : 'Ad account ditambahkan.' });
      setForm(EMPTY);
      load();
      onSaved?.();
    } catch (err) {
      const d = err.response?.data;
      setMessage({ type: 'error', text: d?.details?.[0]?.msg || d?.message || 'Gagal menyimpan' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Hapus ad account ${row.ad_account_id}?`)) return;
    setError('');
    try {
      await api.delete(`/internal-dashboard/ad-accounts/${row.id}`);
      if (form.id === row.id) setForm(EMPTY);
      load();
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus');
    }
  };

  if (!clientId) return <div className="empty-state">Pilih client dulu.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <h3 style={{ marginBottom: '0.25rem' }}>{editing ? 'Edit Ad Account' : 'Tambah Ad Account Meta'}</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Satu client bisa punya lebih dari satu akun iklan. Format ID biasanya <code>act_1234567890</code> (boleh
          juga angka polos) — validasi longgar, belum ada aturan resmi. Hanya satu akun yang bisa jadi <em>primary</em>.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Ad Account ID *</label>
            <input type="text" placeholder="act_1234567890" value={form.ad_account_id}
              onChange={(e) => setForm((f) => ({ ...f, ad_account_id: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Nama Akun (opsional)</label>
            <input type="text" placeholder="mis. Main Account / CPAS" value={form.account_name}
              onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))} />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', margin: '0.25rem 0 1rem' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={form.is_primary}
            onChange={(e) => setForm((f) => ({ ...f, is_primary: e.target.checked }))} />
          Jadikan akun primary {rows.some((r) => r.is_primary && r.id !== form.id) && '(akan menggeser primary yang sekarang)'}
        </label>

        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Menyimpan...' : editing ? 'Simpan perubahan' : 'Tambah'}
          </button>
          {editing && (
            <button type="button" className="btn btn-secondary" onClick={() => setForm(EMPTY)}>
              <X size={16} /> Batal edit
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <h3 style={{ fontSize: '1rem', padding: '1rem 1.5rem 0' }}>Ad account terdaftar</h3>
        {loading ? (
          <div className="empty-state">Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="empty-state">Belum ada ad account untuk client ini.</div>
        ) : (
          <table style={{ marginTop: '1rem' }}>
            <thead><tr><th>Ad Account ID</th><th>Nama</th><th>Primary</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={form.id === r.id ? { background: 'var(--primary-light)' } : undefined}>
                  <td style={{ fontFamily: 'monospace' }}>{r.ad_account_id}</td>
                  <td>{r.account_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td>{r.is_primary && <Star size={15} fill="currentColor" style={{ color: '#f59e0b' }} />}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="button" className="btn btn-secondary btn-icon" title="Edit"
                        onClick={() => { setForm({ id: r.id, ad_account_id: r.ad_account_id, account_name: r.account_name || '', is_primary: r.is_primary }); setMessage(null); }}>
                        <Pencil size={16} />
                      </button>
                      <button type="button" className="btn btn-danger btn-icon" title="Hapus" onClick={() => handleDelete(r)}>
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
    </div>
  );
}
