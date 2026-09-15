import { useEffect, useState } from 'react';
import api from '../../api/client.js';

// Shows a "Sync dari Sheets" button for brands that have an active
// brand_sheet_sources row (migration 022) — most brands don't yet (manual
// forms below stay the primary path for those), so this renders nothing
// for them rather than an empty/disabled state.
export default function SheetSyncPanel({ clientId, onSynced }) {
  const [sources, setSources] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/internal-dashboard/sheet-sources')
      .then((res) => setSources(res.data.sources || []))
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    setResult(null);
    setError('');
  }, [clientId]);

  if (!sources || !clientId) return null;
  const source = sources.find((s) => s.brand_id === clientId);
  if (!source) return null;

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    setResult(null);
    try {
      const res = await api.post('/internal-dashboard/sync-from-sheets', { brand_id: clientId });
      setResult(res.data.result);
      onSynced?.();
    } catch (err) {
      setError(err.response?.data?.message || 'Gagal sync dari Sheets');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: '220px' }}>
        <strong>Sumber Google Sheets tersedia</strong>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {source.spreadsheet_title}
          {!source.is_verified && ' — belum diverifikasi manual'}
          {source.last_synced_at && ` · terakhir sync ${new Date(source.last_synced_at).toLocaleString('id-ID')}`}
        </p>
      </div>
      <button type="button" className="btn btn-primary" disabled={syncing} onClick={handleSync}>
        {syncing ? 'Menyinkronkan…' : 'Sync dari Sheets'}
      </button>
      {result && (
        <div className="alert alert-success" style={{ margin: 0, flexBasis: '100%' }}>
          Berhasil: {result.monthsSynced.length} bulan disinkronkan
          {result.monthsSynced.length > 0 && ` (${result.monthsSynced.join(', ')})`}
          {result.monthsSkipped.length > 0 && `, ${result.monthsSkipped.length} bulan dilewati (belum diisi di sheet)`}.
        </div>
      )}
      {error && <div className="alert alert-error" style={{ margin: 0, flexBasis: '100%' }}>{error}</div>}
    </div>
  );
}
