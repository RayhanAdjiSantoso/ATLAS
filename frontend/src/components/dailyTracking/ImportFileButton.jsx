import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Upload, X } from 'lucide-react';
import api from '../../api/client.js';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
};
const fmt = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(n);
const KIND_TITLE = { sales: 'Revenue Data', spend: 'Spending Data' };

// Two-step import. 1) The file is read by the backend without saving
// anything (POST /import/preview) and every column it recognised is listed
// with a checkbox — columns this brand ignored on an earlier upload start
// unticked and are called out. 2) Only the ticked columns are saved
// (POST /import with `selected`); the unticked ones are remembered.
export default function ImportFileButton({ brandId, onImported }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null); // { file, data }
  const [checked, setChecked] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const upload = (path, file, extra = {}) => {
    const formData = new FormData();
    formData.append('brandId', brandId);
    formData.append('file', file);
    for (const [k, v] of Object.entries(extra)) formData.append(k, v);
    return api.post(path, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file after a failed attempt
    if (!file) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await upload('/daily-tracking/import/preview', file);
      setChecked(Object.fromEntries(res.data.columns.map((c) => [c.id, !c.previouslyIgnored])));
      setPreview({ file, data: res.data });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Gagal membaca file');
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    const selected = Object.keys(checked).filter((id) => checked[id]);
    setBusy(true);
    setError('');
    try {
      const res = await upload('/daily-tracking/import', preview.file, { selected: JSON.stringify(selected) });
      setResult(res.data);
      setPreview(null);
      onImported?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Gagal mengimpor file');
    } finally {
      setBusy(false);
    }
  };

  const columns = preview?.data.columns || [];
  const nChecked = columns.filter((c) => checked[c.id]).length;
  const setAll = (kind, value) => setChecked((prev) => ({
    ...prev, ...Object.fromEntries(columns.filter((c) => c.kind === kind).map((c) => [c.id, value])),
  }));

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
        <Upload size={14} /> {busy && !preview ? 'Membaca file...' : 'Upload File Daily Tracking'}
      </button>

      {error && !preview && (
        <div className="alert alert-error dt-import-alert">
          <span>Gagal mengimpor: {error}</span>
          <button type="button" className="btn btn-icon" onClick={() => setError('')} aria-label="Tutup"><X size={14} /></button>
        </div>
      )}

      {result && (
        <div className="alert alert-success dt-import-alert">
          <div>
            <div>
              Berhasil mengimpor <strong>{result.fileName}</strong>: {result.salesSaved} entri revenue, {result.spendSaved} entri spend
              {result.monthsAffected?.length ? <> — bulan {result.monthsAffected.map(monthLabel).join(', ')}</> : null}.
            </div>
            {result.ignoredColumns?.length > 0 && (
              <div className="dt-import-recognized">Diabaikan: {result.ignoredColumns.map((c) => c.label).join(', ')}</div>
            )}
          </div>
          <button type="button" className="btn btn-icon" onClick={() => setResult(null)} aria-label="Tutup"><X size={14} /></button>
        </div>
      )}

      {preview && createPortal(
        <div className="dt-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setPreview(null); }}>
          <div className="dt-modal-card dt-modal-wide" role="dialog" aria-modal="true" aria-label="Pilih kolom yang diimpor">
            <div className="dt-modal-head">
              <h3>Pilih kolom yang ingin disimpan</h3>
              <button type="button" className="btn btn-icon" onClick={() => setPreview(null)} aria-label="Tutup" disabled={busy}><X size={16} /></button>
            </div>
            <p className="dt-confirm-text">
              <strong>{preview.data.fileName}</strong> — {preview.data.dataRowsParsed} baris tanggal
              {preview.data.months.length > 0 && <>, bulan {preview.data.months.map(monthLabel).join(', ')}</>}.
              {' '}Kolom yang tidak dicentang tidak disimpan, dan akan diingat sebagai diabaikan untuk klien ini.
            </p>

            {preview.data.previouslyIgnored.length > 0 && (
              <div className="alert alert-info dt-import-ignored-note">
                Sebelumnya diabaikan: {preview.data.previouslyIgnored.map((c) => c.label).join(', ')}. Kolom ini tidak dicentang — centang kalau ingin disimpan kali ini.
              </div>
            )}

            <div className="dt-import-columns">
              {['sales', 'spend'].map((kind) => {
                const list = columns.filter((c) => c.kind === kind);
                if (!list.length) return null;
                return (
                  <fieldset key={kind} className="dt-import-group">
                    <legend>
                      {KIND_TITLE[kind]}
                      <span className="dt-import-group-actions">
                        <button type="button" className="dt-link-btn" onClick={() => setAll(kind, true)}>Pilih semua</button>
                        <button type="button" className="dt-link-btn" onClick={() => setAll(kind, false)}>Kosongkan</button>
                      </span>
                    </legend>
                    {list.map((c) => (
                      <label key={c.id} className="dt-import-column">
                        <input
                          type="checkbox"
                          checked={!!checked[c.id]}
                          onChange={(e) => setChecked((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                        />
                        <span className="dt-import-column-name">
                          {c.label}
                          {c.isNew && <span className="badge badge-info">channel baru</span>}
                          {c.previouslyIgnored && <span className="badge badge-warning">sebelumnya diabaikan</span>}
                          {!c.fileLabels.includes(c.label) && (
                            <span className="dt-import-column-from">dari kolom “{c.fileLabels.join('”, “')}”</span>
                          )}
                        </span>
                        <span className="dt-import-column-stat">{c.rows} hari · total {fmt(c.total)}</span>
                      </label>
                    ))}
                  </fieldset>
                );
              })}
            </div>

            {error && <div className="alert alert-error">{error}</div>}
            <div className="dt-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPreview(null)} disabled={busy}>Batal</button>
              <button type="button" className="btn btn-primary" onClick={handleImport} disabled={busy || nChecked === 0}>
                {busy ? 'Menyimpan...' : `Simpan ${nChecked} kolom`}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
