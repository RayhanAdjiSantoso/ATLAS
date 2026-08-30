import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../api/client.js';

function statusBadgeClass(status) {
  const s = String(status || '').toLowerCase();
  if (s.includes('error') || s.includes('gagal') || s.includes('fail')) return 'badge-danger';
  if (s.includes('ok') || s.includes('success') || s.includes('berhasil')) return 'badge-success';
  return 'badge-info';
}

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID');
}

// Shared by the Weekly/Daily/Daily Tracking tabs: they all write to the same
// "Automation Log" sheet, tagged with a [WEEKLY]/[DAILY]/[TRACKING] prefix
// in `detail` -- filtering by that prefix here is how the tabs split it.
export default function AutomationLogPanel({ prefix, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    api.get('/meta-automation/log', { params: { limit: 20 } })
      .then((res) => setRows(res.data.log || []))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat log'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [refreshKey]);

  const filtered = rows.filter((r) => r.detail?.startsWith(prefix));

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem 0' }}>
        <h3 style={{ fontSize: '1rem' }}>Log Terbaru</h3>
        <button type="button" className="btn btn-secondary btn-icon" title="Muat ulang" onClick={load} disabled={loading}>
          <RefreshCw size={16} />
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ margin: '1rem 1.5rem 0' }}>{error}</div>}

      {loading ? (
        <div className="empty-state">Memuat...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">Belum ada log.</div>
      ) : (
        <table style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Durasi</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.timestamp)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{r.durationSec != null ? `${r.durationSec}s` : '-'}</td>
                <td><span className={`badge ${statusBadgeClass(r.status)}`}>{r.status}</span></td>
                <td>{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
