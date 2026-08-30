import { useState } from 'react';
import api from '../../api/client.js';
import AutomationLogPanel from './AutomationLogPanel.jsx';

export default function DailyTab() {
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState(null);
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  const handleRun = async () => {
    const confirmed = window.confirm(
      'Jalankan Daily Urgent Check sekarang? Email cuma terkirim kalau ada temuan mendesak, tapi ini beneran menjalankan pengecekan.',
    );
    if (!confirmed) return;

    setRunning(true);
    setMessage(null);
    try {
      await api.post('/meta-automation/daily/run');
      setMessage({ type: 'success', text: 'Daily Urgent Check selesai dijalankan.' });
      setLogRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menjalankan Daily Urgent Check' });
    } finally {
      setRunning(false);
    }
  };

  const handleResetCooldown = async () => {
    setResetting(true);
    setMessage(null);
    try {
      await api.post('/meta-automation/daily/reset-cooldown');
      setMessage({ type: 'success', text: 'Cooldown alert direset. Temuan yang sama akan dikirim ulang di run berikutnya.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal reset cooldown' });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={handleRun} disabled={running}>
          {running ? 'Menjalankan...' : 'Run Now'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleResetCooldown} disabled={resetting}>
          {resetting ? 'Mereset...' : 'Reset Cooldown'}
        </button>
      </div>

      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      <AutomationLogPanel prefix="[DAILY]" refreshKey={logRefreshKey} />
    </div>
  );
}
