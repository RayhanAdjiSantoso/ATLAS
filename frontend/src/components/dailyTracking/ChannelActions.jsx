import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, X } from 'lucide-react';
import api from '../../api/client.js';

const KIND_LABEL = { sales: 'Revenue Data', spend: 'Spending Data' };
const fmt = (n) => new Intl.NumberFormat('id-ID').format(n);

// Move the active channel between Revenue Data and Spending Data. Only
// custom ("+ Tambah Channel Baru" or file-import) channels: the fixed ones
// are app config. Always behind a confirmation that says exactly what happens
// to the data, using the counts the channel list already carries (`usage`).
// Deleting lives in the channel rail (DeleteChannelButton).
export default function ChannelActions({ brandId, kind, channel, onChanged }) {
  const [dialog, setDialog] = useState(null); // 'move' | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!channel?.isCustom) return null;
  const toKind = kind === 'sales' ? 'spend' : 'sales';
  const u = channel.usage || { rows: 0, withQty: 0, withTrx: 0, withNotes: 0, negative: 0 };
  const close = () => { if (!busy) { setDialog(null); setError(''); } };

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/daily-tracking/channels/move', { brandId, kind, key: channel.key });
      setNotice(`Channel "${res.data.label}" dipindahkan ke ${KIND_LABEL[res.data.toKind]} (${fmt(res.data.movedEntries)} entri).`);
      onChanged?.({ movedKey: channel.key, kind, toKind: res.data.toKind });
      setDialog(null);
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Gagal memproses channel');
    } finally {
      setBusy(false);
    }
  };

  const lostOnMove = kind === 'sales' ? [
    u.withQty && `kuantitas (${fmt(u.withQty)} hari)`,
    u.withTrx && `transaksi (${fmt(u.withTrx)} hari)`,
    u.withNotes && `catatan (${fmt(u.withNotes)} hari)`,
  ].filter(Boolean) : [];
  const moveBlocked = kind === 'sales' && u.negative > 0;

  return (
    <div className="dt-channel-actions">
      <button type="button" className="btn btn-secondary dt-btn-sm" onClick={() => { setNotice(''); setDialog('move'); }}>
        <ArrowLeftRight size={14} /> Pindahkan ke {KIND_LABEL[toKind]}
      </button>

      {notice && (
        <div className="alert alert-success dt-import-alert">
          <span>{notice}</span>
          <button type="button" className="btn btn-icon" onClick={() => setNotice('')} aria-label="Tutup"><X size={14} /></button>
        </div>
      )}

      {dialog && createPortal(
        <div className="dt-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="dt-modal-card" role="alertdialog" aria-modal="true" aria-label="Konfirmasi">
            <div className="dt-modal-head">
              <h3>Apakah Anda yakin?</h3>
              <button type="button" className="btn btn-icon" onClick={close} aria-label="Tutup" disabled={busy}><X size={16} /></button>
            </div>

            <>
                <p className="dt-confirm-text">
                  Channel <strong>{channel.label}</strong> akan dipindahkan dari {KIND_LABEL[kind]} ke{' '}
                  <strong>{KIND_LABEL[toKind]}</strong>
                  {u.rows > 0 && <> beserta {fmt(u.rows)} entri</>}.
                  {' '}{kind === 'sales' ? 'Nilai revenue menjadi nilai spend.' : 'Nilai spend menjadi nilai revenue.'}
                </p>
                {lostOnMove.length > 0 && (
                  <p className="dt-confirm-text">Spending Data tidak punya kolom {lostOnMove.join(', ')} — data itu akan hilang.</p>
                )}
                {moveBlocked && (
                  <div className="alert alert-error">Ada {fmt(u.negative)} hari dengan revenue negatif. Spend tidak boleh negatif — perbaiki dulu sebelum memindahkan.</div>
                )}
            </>

            {error && <div className="alert alert-error">{error}</div>}
            <div className="dt-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={close} disabled={busy} autoFocus>Batal</button>
              <button type="button" className="btn btn-primary" onClick={run} disabled={busy || moveBlocked}>
                {busy ? 'Memproses...' : 'Ya, Pindahkan'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
