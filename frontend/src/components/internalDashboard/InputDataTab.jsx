import useSessionState from '../../hooks/useSessionState.js';
import { useEffect, useState } from 'react';
import api from '../../api/client.js';
import ClientPicker from './ClientPicker.jsx';
import MonthlyMetricsForm from './MonthlyMetricsForm.jsx';
import ChannelSalesForm from './ChannelSalesForm.jsx';
import PlatformSpendForm from './PlatformSpendForm.jsx';
import SalesChannelsForm from './SalesChannelsForm.jsx';
import AdAccountsForm from './AdAccountsForm.jsx';
import IngestionLogPanel from './IngestionLogPanel.jsx';

const SUB_TABS = [
  { key: 'metrics', label: 'Metrik Bulanan', target: 'client_monthly_metrics', Form: MonthlyMetricsForm, periodScoped: true },
  { key: 'channel', label: 'Sales per Channel', target: 'client_channel_sales_monthly', Form: ChannelSalesForm, periodScoped: true },
  { key: 'platform', label: 'Spend per Platform', target: 'client_platform_spend_monthly', Form: PlatformSpendForm, periodScoped: true },
  { key: 'channels_used', label: 'Channel Dipakai', target: 'client_sales_channels', Form: SalesChannelsForm, periodScoped: false },
  { key: 'ad_accounts', label: 'Ad Account Meta', target: 'brand_ad_accounts', Form: AdAccountsForm, periodScoped: false },
];

const thisMonth = () => new Date().toISOString().slice(0, 7);

// The "Input Data" tab: one shared (client, period) picker driving three
// independent sub-forms, each submitting to its own table + logging its own
// data_ingestion_log event (staggered ingestion, not one atomic submit).
export default function InputDataTab() {
  const [clients, setClients] = useState([]);
  const [clientsError, setClientsError] = useState('');
  const [clientId, setClientId] = useSessionState('internal:InputDataTab:clientId', '');
  const [period, setPeriod] = useSessionState('internal:InputDataTab:period', thisMonth());
  const [sub, setSub] = useSessionState('internal:InputDataTab:sub', SUB_TABS[0].key);
  const [logRefresh, setLogRefresh] = useState(0);

  useEffect(() => {
    api.get('/internal-dashboard/clients')
      .then((res) => setClients(res.data.clients || []))
      .catch((err) => setClientsError(err.response?.data?.message || 'Gagal memuat daftar client'));
  }, []);

  const active = SUB_TABS.find((t) => t.key === sub);
  const ActiveForm = active.Form;
  const numericClientId = clientId ? Number(clientId) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {clientsError && <div className="alert alert-error">{clientsError}</div>}

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: active.periodScoped ? '2fr 1fr' : '1fr', gap: '1rem', alignItems: 'start' }}>
          <ClientPicker clients={clients} value={clientId} onChange={setClientId} />
          {active.periodScoped && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Periode</label>
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </div>
          )}
        </div>
        {!active.periodScoped && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
            Data level-client (bukan per bulan) — periode tidak berlaku di sub-tab ini.
          </p>
        )}
      </div>

      <div className="tabs-nav" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
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
