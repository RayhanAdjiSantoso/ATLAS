import { useEffect, useState } from 'react';
import api from '../../api/client.js';

const FILE_TYPES = [
  {
    key: 'order',
    title: 'Order',
    description: 'File ekspor pesanan Shopee (sheet: orders)',
    accept: '.xlsx,.xls',
  },
  {
    key: 'performance_overview',
    title: 'Performance Overview',
    description: 'Ringkasan performa harian toko (Pesanan Dibuat, Siap Dikirim, Dibayar)',
    accept: '.xlsx,.xls',
  },
  {
    key: 'product_performance',
    title: 'Product Performance',
    description: 'Performa produk per periode (Produk dengan Performa Terbaik, dll.)',
    accept: '.xlsx,.xls',
  },
];

function UploadZone({ fileType, title, description, brandId, disabled }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (!file || !brandId) {
      setStatus({ type: 'error', message: 'Pilih brand dan file terlebih dahulu.' });
      return;
    }

    setLoading(true);
    setStatus(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('brandId', brandId);
    formData.append('fileType', fileType);

    try {
      const res = await api.post('/uploads', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setStatus({
        type: 'success',
        message: `Berhasil! ${res.data.rowsInserted ?? 0} baris diimpor. Periode: ${res.data.period?.start || '-'} s/d ${res.data.period?.end || '-'}`,
      });
      setFile(null);
    } catch (err) {
      const data = err.response?.data;
      setStatus({
        type: 'error',
        message: data?.error || data?.message || 'Upload gagal',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="upload-zone card">
      <h3>{title}</h3>
      <p>{description}</p>
      <input
        type="file"
        accept=".xlsx,.xls"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        disabled={disabled || loading}
      />
      {file && <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{file.name}</p>}
      <button
        type="button"
        className="btn btn-primary"
        style={{ marginTop: '1rem' }}
        onClick={handleUpload}
        disabled={disabled || loading || !file}
      >
        {loading ? 'Mengimpor...' : 'Upload & Import'}
      </button>
      {status && (
        <div className={`alert alert-${status.type === 'success' ? 'success' : 'error'}`} style={{ marginTop: '1rem' }}>
          {status.message}
        </div>
      )}
    </div>
  );
}

// Upload Data as a Dashboard tab -- was previously its own standalone page
// (/upload). Deliberately bypasses DashboardTab's date-range/data-fetch
// pipeline: uploading isn't scoped to the global date filter, only to a
// brand, so it manages its own brand selector independent of FilterPanel.
export default function UploadDataTab() {
  const [brands, setBrands] = useState([]);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [brandId, setBrandId] = useState('');
  const [showNewBrand, setShowNewBrand] = useState(false);
  const [newBrandName, setNewBrandName] = useState('');
  const [creatingBrand, setCreatingBrand] = useState(false);
  const [brandError, setBrandError] = useState('');
  const [brandInfo, setBrandInfo] = useState('');

  useEffect(() => {
    api.get('/brands')
      .then((res) => setBrands(res.data.brands))
      .catch(() => {})
      .finally(() => setLoadingBrands(false));
  }, []);

  const handleCreateBrand = async () => {
    if (!newBrandName.trim()) {
      setBrandError('Nama brand wajib diisi.');
      return;
    }

    setCreatingBrand(true);
    setBrandError('');
    setBrandInfo('');

    try {
      const res = await api.post('/brands', { brandName: newBrandName.trim() });
      const brand = res.data.brand;
      setBrands((prev) => [...prev, brand].sort((a, b) => a.brand_name.localeCompare(b.brand_name)));
      setBrandId(String(brand.brand_id));
      setShowNewBrand(false);
      setNewBrandName('');
    } catch (err) {
      const existing = err.response?.data?.details?.brand;
      if (existing) {
        setBrands((prev) => (prev.some((b) => b.brand_id === existing.brand_id) ? prev : [...prev, existing]));
        setBrandId(String(existing.brand_id));
        setShowNewBrand(false);
        setNewBrandName('');
        setBrandInfo(`Brand "${existing.brand_name}" sudah terdaftar dan otomatis dipilih.`);
      } else {
        setBrandError(err.response?.data?.message || 'Gagal membuat brand baru.');
      }
    } finally {
      setCreatingBrand(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Unggah file Excel Shopee per jenis. Periode data akan dibaca otomatis dari isi file.
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="uploadBrandSelect">Nama Brand</label>

          {!showNewBrand ? (
            <>
              <select
                id="uploadBrandSelect"
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
                disabled={loadingBrands}
              >
                <option value="">{loadingBrands ? 'Memuat brand...' : 'Pilih brand...'}</option>
                {brands.map((b) => (
                  <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: '0.5rem', fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                onClick={() => { setShowNewBrand(true); setBrandInfo(''); setBrandError(''); }}
              >
                + Tambah Brand Baru
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                placeholder="Nama brand baru..."
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                style={{ flex: 1, minWidth: '200px' }}
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreateBrand}
                disabled={creatingBrand}
              >
                {creatingBrand ? 'Membuat...' : 'Buat Brand'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => { setShowNewBrand(false); setNewBrandName(''); setBrandError(''); }}
                disabled={creatingBrand}
              >
                Batal
              </button>
            </div>
          )}

          {brandError && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{brandError}</div>}
          {brandInfo && <div className="alert alert-success" style={{ marginTop: '0.75rem' }}>{brandInfo}</div>}
        </div>
      </div>

      <div className="upload-zones">
        {FILE_TYPES.map((ft) => (
          <UploadZone
            key={ft.key}
            fileType={ft.key}
            title={ft.title}
            description={ft.description}
            brandId={brandId}
            disabled={!brandId}
          />
        ))}
      </div>
    </div>
  );
}
