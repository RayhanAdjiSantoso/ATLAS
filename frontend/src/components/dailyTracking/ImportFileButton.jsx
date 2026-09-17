import { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import api from '../../api/client.js';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
};

// Best-effort import: the backend parser (dailyTrackingImportParser.js)
// handles whatever column layout the file turns out to have and reports
// exactly what it recognized — this button's job is just to surface that
// report (or the specific failure reason) clearly, not to pre-validate
// anything client-side.
export default function ImportFileButton({ brandId, onImported }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after a failed attempt
    if (!file) return;

    setBusy(true);
    setError('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('brandId', brandId);
      formData.append('file', file);
      const res = await api.post('/daily-tracking/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(res.data);
      onImported?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Gagal mengimpor file');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dt-import">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <button type="button" className="btn btn-secondary dt-btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
        <Upload size={14} /> {busy ? 'Mengimpor...' : 'Upload File Daily Tracking'}
      </button>

      {error && (
        <div className="alert alert-error dt-import-alert">
          <span>Gagal mengimpor: {error}</span>
          <button type="button" className="btn btn-icon" onClick={() => setError('')} aria-label="Tutup"><X size={14} /></button>
        </div>
      )}

      {result && (
        <div className="alert alert-success dt-import-alert">
          <div>
            <div>
              Berhasil mengimpor <strong>{result.fileName}</strong>: {result.dataRowsParsed} baris tanggal,
              {' '}{result.salesSaved} entri revenue, {result.spendSaved} entri spend
              {result.monthsAffected?.length ? <> — bulan {result.monthsAffected.map(monthLabel).join(', ')}</> : null}.
            </div>
            {(result.recognizedSales?.length || result.recognizedSpend?.length) && (
              <div className="dt-import-recognized">
                {result.recognizedSales?.length > 0 && (
                  <div>Channel revenue terdeteksi: {result.recognizedSales.map((c) => `${c.label}${c.isCustom ? ' (baru)' : ''}`).join(', ')}</div>
                )}
                {result.recognizedSpend?.length > 0 && (
                  <div>Channel spend terdeteksi: {result.recognizedSpend.map((c) => `${c.label}${c.isCustom ? ' (baru)' : ''}`).join(', ')}</div>
                )}
              </div>
            )}
          </div>
          <button type="button" className="btn btn-icon" onClick={() => setResult(null)} aria-label="Tutup"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}
