import { useEffect, useState, useCallback } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import api from '../../api/client.js';
import { SALES_CHANNELS } from './constants.js';

const emptyForm = () => Object.fromEntries(SALES_CHANNELS.map((c) => [c.value, '']));
const fmtMoney = (v) => (v == null ? '-' : `Rp${new Intl.NumberFormat('id-ID').format(Number(v))}`);
const channelLabel = (v) => SALES_CHANNELS.find((c) => c.value === v)?.label || v;

// §2.4 client_channel_sales_monthly — one form, all 4 channels at once,
// single submit. Blank channel = not touched (delete it from the table
// below instead).
export default function ChannelSalesForm({ clientId, period, onPickPeriod, onSaved }) {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!clientId) { setEntries([]); return; }
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/channel-sales', { params: { brand_id: clientId } })
      .then((res) => setEntries(res.data.entries || []))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  const rowsForPeriod = entries.filter((e) => e.period === period);

  useEffect(() => {
    const next = emptyForm();
    for (const r of entries.filter((e) => e.period === period)) next[r.channel] = r.sales ?? '';
    setForm(next);
    setMessage(null);
  }, [entries, period]);

  const handleSave = async () => {
    const channels = SALES_CHANNELS
      .filter((c) => form[c.value] !== '' && !Number.isNaN(Number(form[c.value])))
      .map((c) => ({ channel: c.value, sales: Number(form[c.value]) }));
    if (channels.length === 0) {
      setMessage({ type: 'error', text: 'Isi minimal satu channel.' });
      return;
    }
    if (rowsForPeriod.length && !window.confirm(`Timpa data channel ${period} untuk client ini?`)) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await api.post('/internal-dashboard/channel-sales', { brand_id: clientId, period, channels });
      setMessage({ type: 'success', text: `Tersimpan: ${res.data.inserted} baru, ${res.data.updated} diperbarui.` });
      load();
      onSaved?.();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menyimpan' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row) => {
    if (!window.confirm(`Hapus ${channelLabel(row.channel)} — ${row.period}?`)) return;
    setError('');
    try {
      await api.delete(`/internal-dashboard/channel-sales/${row.id}`);
      load();
      onSaved?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus');
    }
  };

  if (!clientId) return <div className="empty-state">Pilih client dan periode dulu.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <h3 style={{ marginBottom: '0.25rem' }}>Sales per Channel — {period}</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          §2.4 — breakdown sales per channel. Kosongkan channel yang tidak dipakai.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {SALES_CHANNELS.map((c) => (
            <div className="form-group" key={c.value}>
              <label>{c.label} (Rp)</label>
              <input type="number" min="0" value={form[c.value]}
                onChange={(e) => setForm((f) => ({ ...f, [c.value]: e.target.value }))} />
            </div>
          ))}
        </div>

        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Menyimpan...' : 'Simpan'}
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <h3 style={{ fontSize: '1rem', padding: '1rem 1.5rem 0' }}>Data tersimpan</h3>
        {loading ? (
          <div className="empty-state">Memuat...</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">Belum ada data channel.</div>
        ) : (
          <table style={{ marginTop: '1rem' }}>
            <thead><tr><th>Periode</th><th>Channel</th><th>Sales</th><th /></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={e.period === period ? { background: 'var(--primary-light)' } : undefined}>
                  <td>{e.period}</td>
                  <td>{channelLabel(e.channel)}</td>
                  <td>{fmtMoney(e.sales)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button type="button" className="btn btn-secondary btn-icon" title="Edit periode ini"
                        onClick={() => onPickPeriod(e.period)}><Pencil size={16} /></button>
                      <button type="button" className="btn btn-danger btn-icon" title="Hapus"
                        onClick={() => handleDelete(e)}><Trash2 size={16} /></button>
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
