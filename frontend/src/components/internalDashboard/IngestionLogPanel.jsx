import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../api/client.js';
import { TARGET_LABELS } from './constants.js';

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('id-ID') : '-');
const statusClass = (s) =>
  s === 'success' ? 'badge-success' : s === 'failed' ? 'badge-danger' : 'badge-warning';

// §2.7 data_ingestion_log feed. `target` scopes it to one sub-tab's table;
// `brandId` scopes it to the selected client; `refreshKey` re-fetches after
// a save/delete.
export default function IngestionLogPanel({ brandId, target, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    if (!brandId) { setRows([]); return; }
    setLoading(true);
    setError('');
    api.get('/internal-dashboard/ingestion-log', { params: { brand_id: brandId, target, limit: 20 } })
      .then((res) => setRows(res.data.log || []))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat log'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [brandId, target, refreshKey]);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem 0' }}>
        <h3 style={{ fontSize: '1rem' }}>Riwayat Input — {TARGET_LABELS[target]}</h3>
        <button type="button" className="btn btn-secondary btn-icon" title="Muat ulang" onClick={load} disabled={loading}>
          <RefreshCw size={16} />
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ margin: '1rem 1.5rem 0' }}>{error}</div>}

      {loading ? (
        <div className="empty-state">Memuat...</div>
      ) : !brandId ? (
        <div className="empty-state">Pilih client dulu.</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">Belum ada input untuk client ini.</div>
      ) : (
        <table style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Periode</th>
              <th>Aksi</th>
              <th>Baris</th>
              <th>Status</th>
              <th>Oleh</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.created_at)}</td>
                <td>{r.period || '-'}</td>
                <td>{r.method}</td>
                <td>{r.row_count}</td>
                <td><span className={`badge ${statusClass(r.status)}`}>{r.status}</span></td>
                <td>{r.performed_by_name || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
