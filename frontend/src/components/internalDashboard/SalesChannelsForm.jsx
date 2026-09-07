import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client.js';
import { SALES_CHANNELS, CSC_SOURCE_LABELS } from './constants.js';

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('id-ID') : '-');

// §2.2 client_sales_channels — brand-level (NOT period-scoped). One toggle
// per canonical channel: dipakai / tidak dipakai. Prefilled from whatever
// the migration loaders already wrote (133/139 clients); saving marks the
// touched channels source='manual'.
export default function SalesChannelsForm({ clientId, onSaved }) {
  const [rows, setRows] = useState([]);
  const [toggles, setToggles] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!clientId) { setRows([]); return; }
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/sales-channels', { params: { brand_id: clientId } })
      .then((res) => setRows(res.data.entries || []))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(load, [load]);

  // prefill: channel row's is_used, or false when no row (belum dinilai)
  const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));
  useEffect(() => {
    setToggles(Object.fromEntries(SALES_CHANNELS.map((c) => [c.value, byChannel[c.value]?.is_used ?? false])));
    setMessage(null);
  }, [rows]);

  // only channels whose toggle differs from what's shown (absent shows as
  // unchecked) — so a save never silently materialises channels the user
  // didn't touch, and their migration `source` is left intact.
  const dirty = SALES_CHANNELS.filter((c) => {
    const shown = byChannel[c.value]?.is_used ?? false;
    return toggles[c.value] !== shown;
  });

  const handleSave = async () => {
    // send only channels that changed or are still unassessed
    const channels = dirty.map((c) => ({ channel: c.value, is_used: !!toggles[c.value] }));
    if (channels.length === 0) {
      setMessage({ type: 'error', text: 'Tidak ada perubahan.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.post('/internal-dashboard/sales-channels', { brand_id: clientId, channels });
      setMessage({ type: 'success', text: `Tersimpan: ${res.data.inserted} baru, ${res.data.updated} diperbarui.` });
      load();
      onSaved?.();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menyimpan' });
    } finally {
      setSaving(false);
    }
  };

  if (!clientId) return <div className="empty-state">Pilih client dulu.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <h3 style={{ marginBottom: '0.25rem' }}>Channel yang Dipakai Client</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          §2.2 — dipakai untuk membedakan sel kosong &ldquo;tidak dipakai&rdquo; vs &ldquo;belum diinput&rdquo; di S6 &amp; S8.
          Prefill dari data migrasi; mengubah toggle akan menandai channel itu <code>source = manual</code>.
        </p>

        {loading ? <div className="empty-state">Memuat...</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {SALES_CHANNELS.map((c) => {
              const row = byChannel[c.value];
              return (
                <label key={c.value} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border)' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={!!toggles[c.value]}
                    onChange={(e) => setToggles((t) => ({ ...t, [c.value]: e.target.checked }))} />
                  <span style={{ fontWeight: 600, minWidth: 110 }}>{c.label}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {toggles[c.value] ? 'dipakai' : 'tidak dipakai'}
                    {row
                      ? ` · ${CSC_SOURCE_LABELS[row.source] || row.source || 'sumber tidak diketahui'}`
                      : ' · belum dinilai'}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {message && <div className={`alert alert-${message.type}`} style={{ marginTop: '1rem' }}>{message.text}</div>}

        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || loading} style={{ marginTop: '1rem' }}>
          {saving ? 'Menyimpan...' : `Simpan${dirty.length ? ` (${dirty.length} perubahan)` : ''}`}
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <h3 style={{ fontSize: '1rem', padding: '1rem 1.5rem 0' }}>Data tersimpan</h3>
        {rows.length === 0 ? (
          <div className="empty-state">Belum ada baris untuk client ini.</div>
        ) : (
          <table style={{ marginTop: '1rem' }}>
            <thead><tr><th>Channel</th><th>Status</th><th>Sumber</th><th>Diperbarui</th></tr></thead>
            <tbody>
              {SALES_CHANNELS.filter((c) => byChannel[c.value]).map((c) => {
                const r = byChannel[c.value];
                return (
                  <tr key={c.value}>
                    <td>{c.label}</td>
                    <td>{r.is_used
                      ? <span className="badge badge-success">dipakai</span>
                      : <span className="badge badge-warning">tidak dipakai</span>}</td>
                    <td>{CSC_SOURCE_LABELS[r.source] || r.source || '-'}</td>
                    <td>{fmtDate(r.updated_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
