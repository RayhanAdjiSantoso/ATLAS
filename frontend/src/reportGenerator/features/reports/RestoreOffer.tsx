import { History } from 'lucide-react';
import './restoreOffer.css';

// The last report of this session, offered rather than reopened on its own
// (useRestoreLastReport): its files are fetched only once this is pressed.
export function RestoreOffer({ onRestore, onDismiss }: { onRestore: () => void; onDismiss: () => void }) {
  return (
    <div className="restore-offer" role="region" aria-label="Laporan terakhir" data-feature="restore-last-report">
      <span className="restore-offer-ico" aria-hidden="true"><History size={17} /></span>
      <p>
        <strong>Laporan terakhir sesi ini bisa dibuka lagi</strong>
        <small>Datanya baru dimuat setelah Anda membukanya.</small>
      </p>
      <div className="restore-offer-actions">
        <button type="button" className="btn btn-ghost" onClick={onDismiss}>Abaikan</button>
        <button type="button" className="btn btn-primary" onClick={onRestore}>Buka laporan terakhir</button>
      </div>
    </div>
  );
}
