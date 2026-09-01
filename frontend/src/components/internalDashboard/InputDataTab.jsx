import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client.js';
import MonthlyMetricsForm from './MonthlyMetricsForm.jsx';
import ChannelSalesForm from './ChannelSalesForm.jsx';
import PlatformSpendForm from './PlatformSpendForm.jsx';
import IngestionLogPanel from './IngestionLogPanel.jsx';

const SUB_TABS = [
  { key: 'metrics', label: 'Metrik Bulanan', target: 'client_monthly_metrics', Form: MonthlyMetricsForm },
  { key: 'channel', label: 'Sales per Channel', target: 'client_channel_sales_monthly', Form: ChannelSalesForm },
  { key: 'platform', label: 'Spend per Platform', target: 'client_platform_spend_monthly', Form: PlatformSpendForm },
];

const thisMonth = () => new Date().toISOString().slice(0, 7);

// The "Input Data" tab: one shared (client, period) picker driving three
// independent sub-forms, each submitting to its own table + logging its own
// data_ingestion_log event (staggered ingestion, not one atomic submit).
export default function InputDataTab() {
  const [clients, setClients] = useState([]);
  const [clientsError, setClientsError] = useState('');
  const [clientId, setClientId] = useState('');
  const [period, setPeriod] = useState(thisMonth());
  const [sub, setSub] = useState(SUB_TABS[0].key);
  const [logRefresh, setLogRefresh] = useState(0);

  useEffect(() => {
    api.get('/internal-dashboard/clients')
      .then((res) => setClients(res.data.clients || []))
      .catch((err) => setClientsError(err.response?.data?.message || 'Gagal memuat daftar client'));
  }, []);

  const active = SUB_TABS.find((t) => t.key === sub);
  const ActiveForm = active.Form;
  const numericClientId = clientId ? Number(clientId) : null;

  const grouped = useMemo(() => {
    const g = { active: [], other: [] };
    for (const c of clients) (c.status === 'active' ? g.active : g.other).push(c);
    return g;
  }, [clients]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {clientsError && <div className="alert alert-error">{clientsError}</div>}

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Client</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Pilih client...</option>
              <optgroup label={`Aktif (${grouped.active.length})`}>
                {grouped.active.map((c) => <option key={c.brand_id} value={c.brand_id}>{c.brand_name}</option>)}
              </optgroup>
              <optgroup label={`Non-aktif / lainnya (${grouped.other.length})`}>
                {grouped.other.map((c) => (
                  <option key={c.brand_id} value={c.brand_id}>{c.brand_name}{c.status ? ` (${c.status})` : ''}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Periode</label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="tabs-nav" style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        {SUB_TABS.map((t) => (
          <button key={t.key} type="button"
            className={`btn ${sub === t.key ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontWeight: 600, fontSize: '0.85rem', padding: '0.4rem 1rem', border: sub === t.key ? 'none' : '1px solid var(--border)' }}
            onClick={() => setSub(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <ActiveForm
        clientId={numericClientId}
        period={period}
        onPickPeriod={setPeriod}
        onSaved={() => setLogRefresh((k) => k + 1)}
      />

      <IngestionLogPanel brandId={numericClientId} target={active.target} refreshKey={logRefresh} />
    </div>
  );
}
