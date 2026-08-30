import { useState } from 'react';
import api from '../../api/client.js';
import AutomationLogPanel from './AutomationLogPanel.jsx';

export default function WeeklyTab() {
  const [running, setRunning] = useState(false);
  const [checking, setChecking] = useState(false);
  const [tokens, setTokens] = useState(null);
  const [message, setMessage] = useState(null);
  const [logRefreshKey, setLogRefreshKey] = useState(0);

  const handleRun = async () => {
    const confirmed = window.confirm(
      'Jalankan Weekly Campaign Review sekarang? Ini akan menulis tab "Weekly Campaign Review" & "Weekly Adset Drilldown" dan mengirim email ringkasan.',
    );
    if (!confirmed) return;

    setRunning(true);
    setMessage(null);
    try {
      await api.post('/meta-automation/weekly/run');
      setMessage({ type: 'success', text: 'Weekly Campaign Review selesai dijalankan.' });
      setLogRefreshKey((k) => k + 1);
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menjalankan Weekly Campaign Review' });
    } finally {
      setRunning(false);
    }
  };

  const handleCheckTokens = async () => {
    setChecking(true);
    setMessage(null);
    setTokens(null);
    try {
      const res = await api.post('/meta-automation/weekly/check-tokens');
      setTokens(res.data.tokens || []);
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal mengecek token' });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="card" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={handleRun} disabled={running}>
          {running ? 'Menjalankan...' : 'Run Now'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleCheckTokens} disabled={checking}>
          {checking ? 'Mengecek...' : 'Check Tokens'}
        </button>
      </div>

      {message && <div className={`alert alert-${message.type}`}>{message.text}</div>}

      {tokens && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Tipe</th>
                <th>Status</th>
                <th>Akun</th>
                <th>Currency</th>
                <th>Business</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.client}>
                  <td>{t.client}</td>
                  <td>{t.type || 'MAIN'}</td>
                  <td><span className={`badge ${t.ok ? 'badge-success' : 'badge-danger'}`}>{t.ok ? 'OK' : 'Gagal'}</span></td>
                  <td>{t.accountName || t.error || '-'}</td>
                  <td>{t.currency || '-'}</td>
                  <td>{t.business || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AutomationLogPanel prefix="[WEEKLY]" refreshKey={logRefreshKey} />
    </div>
  );
}
