import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import api from '../../api/client.js';

const fmt = (n) => new Intl.NumberFormat('id-ID').format(n);

// "Hapus Channel" beside "Tambah channel" in the channel rail: deletes the
// picked channel and every entry under it, behind a confirmation. Any
// Revenue Data channel can go (a built-in one is hidden for this brand —
// "Tambah channel" with its name brings it back); in Spending Data only
// custom channels, since the built-in ones are fed by the ad syncs.
export default function DeleteChannelButton({ brandId, kind, channel, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const allowed = Boolean(channel) && (kind === 'sales' || channel.isCustom);
  const rows = channel?.usage?.rows ?? 0;
  const close = () => { if (!busy) { setOpen(false); setError(''); } };

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await api.delete('/daily-tracking/channels', { params: { brandId, kind, key: channel.key } });
      setOpen(false);
      onDeleted?.({ removedKey: channel.key, kind });
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Gagal menghapus channel');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="bt-rail-add is-danger"
        data-feature="hapus-channel"
        onClick={() => setOpen(true)}
        disabled={!allowed}
        title={allowed ? `Hapus channel ${channel.label}` : 'Channel bawaan Spending Data tidak bisa dihapus'}
      >
        <Trash2 size={14} aria-hidden="true" /> Hapus channel
      </button>

      {open && createPortal(
        <div className="dt-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="dt-modal-card" role="alertdialog" aria-modal="true" aria-label="Konfirmasi hapus channel">
            <div className="dt-modal-head">
              <h3>Hapus channel {channel.label}?</h3>
              <button type="button" className="btn btn-icon" onClick={close} aria-label="Tutup" disabled={busy}><X size={16} /></button>
            </div>
            <p className="dt-confirm-text">
              Apakah yakin akan menghapus channel? Semua data yang tersimpan akan dihapus. Hanya hapus ketika memang brand tidak menggunakan channel ini.
            </p>
            <p className="dt-confirm-text">
              {rows > 0 ? <><strong>{fmt(rows)} entri</strong> di semua bulan akan ikut terhapus.</> : 'Channel ini belum punya entri.'}
            </p>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="dt-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={close} disabled={busy} autoFocus>Batal</button>
              <button type="button" className="btn btn-danger" onClick={run} disabled={busy}>
                {busy ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
