import { useEffect, useState, useCallback } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import api from '../../api/client.js';

const EMPTY = { revenue: '', transaksi: '', qty_sold: '', target_sales: '', is_partial_month: false };

const numOrUndef = (s) => (s === '' || s === null ? undefined : Number(s));
const fmtMoney = (v) => (v == null ? '-' : `Rp${new Intl.NumberFormat('id-ID').format(Number(v))}`);
const fmtNum = (v) => (v == null ? '-' : new Intl.NumberFormat('id-ID').format(Number(v)));

// §2.3 client_monthly_metrics — one row per (client, month).
export default function MonthlyMetricsForm({ clientId, period, onPickPeriod, onSaved }) {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!clientId) { setEntries([]); return; }
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/monthly-metrics', { params: { brand_id: clientId } })
      .then((res) => setEntries(res.data.entries || []))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  // Prefill the form whenever the selected client/period points at an
  // existing row (edit), else clear it (new entry).
  useEffect(() => {
    const existing = entries.find((e) => e.period === period);
    setForm(existing
      ? {
        revenue: existing.revenue ?? '',
        transaksi: existing.transaksi ?? '',
        qty_sold: existing.qty_sold ?? '',
        target_sales: existing.target_sales ?? '',
        is_partial_month: !!existing.is_partial_month,
      }
      : EMPTY);
    setMessage(null);
  }, [entries, period]);

  const existingForPeriod = entries.find((e) => e.period === period);

  const handleSave = async () => {
    if (form.revenue === '' || Number.isNaN(Number(form.revenue))) {
      setMessage({ type: 'error', text: 'Revenue wajib diisi.' });
      return;
    }
    if (existingForPeriod && !window.confirm(`Timpa data ${period} untuk client ini?`)) return;

    setSaving(true);
    setMessage(null);
    try {
      await api.post('/internal-dashboard/monthly-metrics', {
        brand_id: clientId,
        period,
        revenue: Number(form.revenue),
        transaksi: numOrUndef(form.transaksi),
        qty_sold: numOrUndef(form.qty_sold),
        target_sales: numOrUndef(form.target_sales),
        is_partial_month: form.is_partial_month,
      });
      setMessage({ type: 'success', text: `Tersimpan: ${period}.` });
      load();
      onSaved?.();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menyimpan' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e) => {
    if (!window.confirm(`Hapus data bulan ${e.period}?`)) return;
    setError('');
    try {
      await api.delete(`/internal-dashboard/monthly-metrics/${e.id}`);
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
        <h3 style={{ marginBottom: '0.25rem' }}>
          {existingForPeriod ? `Edit — ${period}` : `Input baru — ${period}`}
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          DS#1 — revenue, transaksi, dan qty total client untuk bulan ini.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div className="form-group">
            <label>Revenue (Rp) *</label>
            <input type="number" min="0" value={form.revenue}
              onChange={(e) => setForm((f) => ({ ...f, revenue: e.target.value }))} placeholder="mis. 125000000" />
          </div>
          <div className="form-group">
            <label>Target Sales (Rp) — opsional</label>
            <input type="number" min="0" value={form.target_sales}
              onChange={(e) => setForm((f) => ({ ...f, target_sales: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Transaksi — opsional</label>
            <input type="number" min="0" value={form.transaksi}
              onChange={(e) => setForm((f) => ({ ...f, transaksi: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Qty Terjual — opsional</label>
            <input type="number" min="0" value={form.qty_sold}
              onChange={(e) => setForm((f) => ({ ...f, qty_sold: e.target.value }))} />
          </div>
        </div>

        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', marginBottom: '1rem' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={form.is_partial_month}
            onChange={(e) => setForm((f) => ({ ...f, is_partial_month: e.target.checked }))} />
          Bulan Parsial <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            (client mulai/berhenti di tengah bulan — dikecualikan penuh dari perbandingan peer di Benchmarking, tapi tetap dihitung di total portfolio)
          </span>
        </label>

        {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Menyimpan...' : existingForPeriod ? 'Simpan Perubahan' : 'Simpan'}
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <h3 style={{ fontSize: '1rem', padding: '1rem 1.5rem 0' }}>Data tersimpan</h3>
        {loading ? (
          <div className="empty-state">Memuat...</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">Belum ada data bulanan.</div>
        ) : (
          <table style={{ marginTop: '1rem' }}>
            <thead>
              <tr><th>Periode</th><th>Revenue</th><th>Transaksi</th><th>Qty</th><th>Target</th><th /></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={e.period === period ? { background: 'var(--primary-light)' } : undefined}>
                  <td>
                    {e.period}
                    {e.is_partial_month && <span className="badge badge-warning" style={{ marginLeft: 4, fontSize: '0.6rem' }}>parsial</span>}
                  </td>
                  <td>{fmtMoney(e.revenue)}</td>
                  <td>{fmtNum(e.transaksi)}</td>
                  <td>{fmtNum(e.qty_sold)}</td>
                  <td>{fmtMoney(e.target_sales)}</td>
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
