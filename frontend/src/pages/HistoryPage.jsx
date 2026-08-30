import { useEffect, useState } from 'react';
import { Trash2, Download } from 'lucide-react';
import api from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import MultiSelectDropdown from '../components/common/MultiSelectDropdown.jsx';

const FILE_TYPE_LABELS = {
  order: 'Order',
  performance_overview: 'Performance Overview',
  product_performance: 'Product Performance',
};

const SOURCE_LABELS = {
  dashboard: { label: 'Dashboard', className: 'badge-info' },
  report_generator: { label: 'Report Generator', className: 'badge-warning' },
};

const STATUS_LABELS = {
  success: { label: 'Berhasil', className: 'badge-success' },
  failed: { label: 'Gagal', className: 'badge-danger' },
  processing: { label: 'Proses', className: 'badge-warning' },
  pending: { label: 'Pending', className: 'badge-info' },
};

function formatPeriod(start, end) {
  if (!start && !end) return '-';
  if (start && end) return `${start} — ${end}`;
  return start || end;
}

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('id-ID');
}

export default function HistoryPage() {
  const { user, isAdmin } = useAuth();
  const [uploads, setUploads] = useState([]);
  const [filters, setFilters] = useState({ brand: [], fileType: [], userId: [], periodStart: '', periodEnd: '' });
  const [filterOptions, setFilterOptions] = useState({ brands: [], users: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    api.get('/uploads/filters').then((res) => setFilterOptions(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== '' && v != null)),
    );

    api.get('/uploads', { params })
      .then((res) => setUploads(res.data.uploads))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat data'))
      .finally(() => setLoading(false));
  }, [filters]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleDownload = async (upload) => {
    setDownloadingId(upload.upload_id);
    setError('');
    try {
      const res = await api.get(`/uploads/${upload.upload_id}/download`, { responseType: 'blob' });
      const blob = new Blob([res.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = upload.original_filename || `upload-${upload.upload_id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal mengunduh file');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (upload) => {
    const confirmed = window.confirm(`Hapus riwayat upload "${upload.original_filename}"? Data yang sudah diimport dari file ini juga akan dihapus.`);
    if (!confirmed) return;

    setDeletingId(upload.upload_id);
    setError('');
    try {
      await api.delete(`/uploads/${upload.upload_id}`);
      setUploads((prev) => prev.filter((u) => u.upload_id !== upload.upload_id));
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal menghapus upload');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>History Upload</h1>
        <p>{isAdmin ? 'Semua riwayat upload dari seluruh pengguna.' : 'Riwayat upload Anda.'}</p>
      </div>

      <div className="card filters">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Cari Brand</label>
          <MultiSelectDropdown
            options={filterOptions.brands.map((b) => ({ value: b, label: b }))}
            selected={filters.brand}
            onChange={(value) => handleFilterChange('brand', value)}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Jenis File</label>
          <MultiSelectDropdown
            options={Object.entries(FILE_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
            selected={filters.fileType}
            onChange={(value) => handleFilterChange('fileType', value)}
          />
        </div>
        {isAdmin && (
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>User</label>
            <MultiSelectDropdown
              options={filterOptions.users.map((u) => ({ value: u.user_id, label: `${u.full_name} (${u.email})` }))}
              selected={filters.userId}
              onChange={(value) => handleFilterChange('userId', value)}
            />
          </div>
        )}
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Periode Mulai</label>
          <input type="date" value={filters.periodStart} onChange={(e) => handleFilterChange('periodStart', e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>Periode Akhir</label>
          <input type="date" value={filters.periodEnd} onChange={(e) => handleFilterChange('periodEnd', e.target.value)} />
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="empty-state">Memuat...</div>
        ) : uploads.length === 0 ? (
          <div className="empty-state">Belum ada riwayat upload.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                <th>File</th>
                <th>Sumber</th>
                <th>Jenis</th>
                <th>Periode</th>
                <th>Waktu Upload</th>
                {isAdmin && <th>User</th>}
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => {
                const st = STATUS_LABELS[u.status] || STATUS_LABELS.pending;
                const canDelete = isAdmin || u.user_id === user?.userId;
                const src = SOURCE_LABELS[u.source] || SOURCE_LABELS.dashboard;
                // Report Generator rows have no file_type (that enum is
                // Dashboard-specific) — report_channel carries their own
                // "Meta Ads · boost"-style label instead.
                const jenis = u.source === 'report_generator' ? u.report_channel : (FILE_TYPE_LABELS[u.file_type] || u.file_type);
                return (
                  <tr key={u.upload_id}>
                    <td>{u.brand_name}</td>
                    <td>{u.original_filename}</td>
                    <td><span className={`badge ${src.className}`}>{src.label}</span></td>
                    <td>{jenis}</td>
                    <td>{formatPeriod(u.period_start?.slice?.(0, 10) || u.period_start, u.period_end?.slice?.(0, 10) || u.period_end)}</td>
                    <td>{formatDate(u.uploaded_at)}</td>
                    {isAdmin && <td>{u.uploaded_by}</td>}
                    <td>
                      <span className={`badge ${st.className}`} title={u.error_message || ''}>{st.label}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {isAdmin && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-icon"
                            title="Unduh file asli (.xlsx/.xls)"
                            disabled={downloadingId === u.upload_id}
                            onClick={() => handleDownload(u)}
                          >
                            <Download size={16} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className="btn btn-danger btn-icon"
                            title="Hapus"
                            disabled={deletingId === u.upload_id}
                            onClick={() => handleDelete(u)}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
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
