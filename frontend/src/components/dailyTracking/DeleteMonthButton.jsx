import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import api from '../../api/client.js';

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const monthName = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

// Wipes every revenue + spend entry of the open brand for the open month —
// the escape hatch for a bad import (wrong dates in the source spreadsheet).
// Irreversible, so it always goes through a confirmation dialog.
export default function DeleteMonthButton({ brandId, brandName, month, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const close = () => { if (!busy) { setOpen(false); setError(''); } };

  const handleConfirm = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.delete('/daily-tracking/entries', { params: { brandId, month } });
      const { sales, spend } = res.data.deleted;
      setNotice(`Data ${monthName(month)} dihapus: ${sales} entri revenue, ${spend} entri spend.`);
      setOpen(false);
      onDeleted?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Gagal menghapus data');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dt-import">
      <button
        type="button"
        className="btn btn-secondary dt-btn-sm dt-btn-danger-outline"
        onClick={() => { setNotice(''); setOpen(true); }}
      >
        <Trash2 size={14} /> Hapus Data Bulan Ini
      </button>

      {notice && (
        <div className="alert alert-success dt-import-alert">
          <span>{notice}</span>
          <button type="button" className="btn btn-icon" onClick={() => setNotice('')} aria-label="Tutup"><X size={14} /></button>
        </div>
      )}

      {open && createPortal(
        <div className="dt-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="dt-modal-card" role="alertdialog" aria-modal="true" aria-label="Konfirmasi hapus data">
            <div className="dt-modal-head">
              <h3>Apakah Anda yakin?</h3>
              <button type="button" className="btn btn-icon" onClick={close} aria-label="Tutup" disabled={busy}>
                <X size={16} />
              </button>
            </div>
            <p className="dt-confirm-text">
              Seluruh data revenue dan spend <strong>{brandName}</strong> pada bulan{' '}
              <strong>{monthName(month)}</strong> akan dihapus permanen dan tidak bisa dikembalikan.
            </p>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="dt-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={close} disabled={busy} autoFocus>Batal</button>
              <button type="button" className="btn btn-danger" onClick={handleConfirm} disabled={busy}>
                {busy ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
