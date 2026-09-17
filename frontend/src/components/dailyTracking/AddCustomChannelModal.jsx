import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function AddCustomChannelModal({ kind, onClose, onSubmit }) {
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const title = kind === 'sales' ? 'Tambah Channel Penjualan Baru' : 'Tambah Channel Iklan Baru';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!label.trim()) { setError('Nama channel wajib diisi'); return; }
    setSaving(true);
    setError('');
    try {
      await onSubmit(label.trim());
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Gagal menambah channel');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="dt-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dt-modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dt-modal-head">
          <h3>{title}</h3>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Tutup">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="dt-new-channel-label">Nama Channel</label>
            <input
              id="dt-new-channel-label"
              type="text"
              autoFocus
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={kind === 'sales' ? 'mis. Blibli, Lazada' : 'mis. Google Ads'}
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="dt-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Batal</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Menyimpan...' : 'Tambah'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
