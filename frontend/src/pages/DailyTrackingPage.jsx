import { useCallback, useEffect, useState } from 'react';
import api from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import useSessionState from '../hooks/useSessionState.js';
import DailyTrackingClientBar from '../components/dailyTracking/DailyTrackingClientBar.jsx';
import DailyKpiStrip from '../components/dailyTracking/DailyKpiStrip.jsx';
import SectionTabs from '../components/dailyTracking/SectionTabs.jsx';
import SectionToggle from '../components/dailyTracking/SectionToggle.jsx';
import ChannelTabs from '../components/dailyTracking/ChannelTabs.jsx';
import DailyEntryTable from '../components/dailyTracking/DailyEntryTable.jsx';
import ChannelSummaryTable from '../components/dailyTracking/ChannelSummaryTable.jsx';
import AddCustomChannelModal from '../components/dailyTracking/AddCustomChannelModal.jsx';
import MetaSyncButton from '../components/dailyTracking/MetaSyncButton.jsx';
import ImportFileButton from '../components/dailyTracking/ImportFileButton.jsx';
import DeleteMonthButton from '../components/dailyTracking/DeleteMonthButton.jsx';
import useAutoSave from '../dailyTracking/lib/useAutoSave.js';
import { FIXED_SALES_CHANNELS, FIXED_SPEND_CHANNELS, NOTES_SALES_CHANNEL_KEYS } from '../dailyTracking/lib/constants.js';
import '../components/dailyTracking/dailyTracking.css';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function DailyTrackingPage() {
  const { allowedBrandId, isAdmin, isClient, isViewOnly } = useAuth();
  // A client fills in its own revenue; ad spend, import and month deletion
  // stay with the team. Any other view-only account only reads.
  const canEditSales = isClient || !isViewOnly;
  const canEditSpend = !isClient && !isViewOnly;
  const locked = !!allowedBrandId;

  // Expand/collapse per section; remembered for the browser tab.
  const [collapsed, setCollapsed] = useSessionState('daily-tracking:collapsed', {});
  const isOpen = (id) => !collapsed[id];
  const toggleSection = (id) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  const [activeTab, setActiveTab] = useSessionState('daily-tracking:tab', 'sales');

  const [brands, setBrands] = useState([]);
  const [brandId, setBrandId] = useSessionState('daily-tracking:client', null);
  const [brandStatus, setBrandStatus] = useSessionState('daily-tracking:brand-status', 'active');
  const [month, setMonth] = useSessionState('daily-tracking:month', currentMonth());
  const [activeSalesTab, setActiveSalesTab] = useSessionState('daily-tracking:sales-tab', FIXED_SALES_CHANNELS[0].key);
  const [activeSpendTab, setActiveSpendTab] = useSessionState('daily-tracking:spend-tab', FIXED_SPEND_CHANNELS[0].key);
  const [channels, setChannels] = useState({ sales: [], spend: [] });
  const [grid, setGrid] = useState({ days: [], sales: {}, spend: {} });
  const [loading, setLoading] = useState(false);
  const [modalKind, setModalKind] = useState(null); // 'sales' | 'spend' | null
  const [loadError, setLoadError] = useState('');

  // Brands list — GET /brands already filters server-side by allowedBrandId
  // (brandService.listBrands), so a client account only ever sees its own.
  useEffect(() => {
    api.get('/brands').then((res) => {
      const list = res.data.brands || [];
      setBrands(list);
      if (locked) {
        setBrandId(allowedBrandId);
      } else {
        setBrandId((prev) => prev ?? (list.find((b) => b.status === 'active') ?? list[0])?.brand_id ?? null);
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadChannels = useCallback(() => {
    if (!brandId) return;
    api.get('/daily-tracking/channels', { params: { brandId } })
      .then((res) => setChannels(res.data))
      .catch(() => {});
  }, [brandId]);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  const loadEntries = useCallback(() => {
    if (!brandId || !month) return;
    setLoading(true);
    api.get('/daily-tracking/entries', { params: { brandId, month } })
      .then((res) => { setGrid(res.data); setLoadError(''); })
      .catch(() => setLoadError('Gagal memuat data Daily Tracking'))
      .finally(() => setLoading(false));
  }, [brandId, month]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const saveRow = useCallback(async (_key, payload) => {
    await api.put('/daily-tracking/entries', payload);
  }, []);
  const { schedule, status: saveStatus } = useAutoSave(saveRow);

  const onCellChange = (kind, channelKey, date, field, value) => {
    setGrid((g) => {
      const kindGrid = { ...(g[kind] || {}) };
      const channelGrid = { ...(kindGrid[channelKey] || {}) };
      const row = { ...(channelGrid[date] || {}), [field]: value };
      channelGrid[date] = row;
      kindGrid[channelKey] = channelGrid;

      const saveKey = `${kind}:${channelKey}:${date}`;
      if (kind === 'sales') {
        schedule(saveKey, {
          brandId, entryDate: date,
          sales: [{
            channelKey, revenue: row.revenue, transaksi: row.transaksi, qtySold: row.qtySold,
            // Only channels that show a Notes cell send it, so saving any other
            // channel never touches stored notes.
            ...(NOTES_SALES_CHANNEL_KEYS.includes(channelKey) ? { notes: row.notes ?? null } : {}),
          }],
        });
      } else {
        schedule(saveKey, {
          brandId, entryDate: date,
          spend: [{ channelKey, amount: row.amount }],
        });
      }

      return { ...g, [kind]: kindGrid };
    });
  };

  const handleAddChannel = async (kind, label) => {
    const res = await api.post('/daily-tracking/channels', { brandId, kind, label });
    setChannels((c) => ({ ...c, [kind]: [...c[kind], res.data.channel] }));
    if (kind === 'sales') setActiveSalesTab(res.data.channel.key);
    else setActiveSpendTab(res.data.channel.key);
  };

  if (!brandId) {
    return (
      <div className="dt-page">
        <p>Memuat daftar klien...</p>
      </div>
    );
  }

  return (
    <div className="dt-page">
      {/* One sticky block, not two independently-offset ones: the brand/month
          bar and the KPI strip stick together as a unit while the day-by-day
          table scrolls underneath — genuinely position:sticky, unlike
          Dashboard's KpiStrip which is only "sticky" because it never
          unmounts. */}
      <div className="dt-sticky-head">
        <DailyTrackingClientBar
          brands={brands} brandId={brandId} onBrandChange={setBrandId} locked={locked}
          brandStatus={brandStatus} onBrandStatusChange={setBrandStatus}
          month={month} onMonthChange={setMonth}
        />
        <DailyKpiStrip grid={grid} channels={channels} loading={loading} />
        <SectionTabs active={activeTab} onChange={setActiveTab} />
      </div>

      {loadError && <div className="alert alert-error">{loadError}</div>}

      {canEditSpend && <div className="dt-toolbar">
        <ImportFileButton
          brandId={brandId}
          onImported={() => { loadChannels(); loadEntries(); }}
        />
        <DeleteMonthButton
          brandId={brandId}
          brandName={brands.find((b) => b.brand_id === brandId)?.brand_name ?? 'klien ini'}
          month={month}
          onDeleted={loadEntries}
        />
      </div>}

      {activeTab === 'sales' ? (
        <div role="tabpanel" id="dt-panel-sales" aria-labelledby="dt-tab-sales" className="dt-panel">
          <ChannelSummaryTable
            kind="sales" grid={grid} channels={channels}
            open={isOpen('summary-sales')} onToggle={() => toggleSection('summary-sales')}
          />
          <section className="dt-section">
            <div className="dt-section-head">
              <SectionToggle
                title="Revenue Data" bodyId="dt-body-revenue"
                open={isOpen('revenue')} onToggle={() => toggleSection('revenue')}
              />
            </div>
            {isOpen('revenue') && <div id="dt-body-revenue">
              <ChannelTabs
                channels={channels.sales}
                activeKey={activeSalesTab}
                onSelect={setActiveSalesTab}
                onAddChannel={canEditSales ? () => setModalKind('sales') : undefined}
              />
              <DailyEntryTable
                kind="sales" channelKey={activeSalesTab} days={grid.days}
                data={grid.sales[activeSalesTab]}
                onCellChange={(date, field, value) => onCellChange('sales', activeSalesTab, date, field, value)}
                saveStatus={saveStatus}
                readOnly={!canEditSales}
              />
            </div>}
          </section>
        </div>
      ) : (
        <div role="tabpanel" id="dt-panel-spend" aria-labelledby="dt-tab-spend" className="dt-panel">
          <ChannelSummaryTable
            kind="spend" grid={grid} channels={channels}
            open={isOpen('summary-spend')} onToggle={() => toggleSection('summary-spend')}
          />
          <section className="dt-section">
            <div className="dt-section-head">
              <SectionToggle
                title="Spending Data" bodyId="dt-body-spending"
                open={isOpen('spending')} onToggle={() => toggleSection('spending')}
              />
              {isAdmin && canEditSpend && isOpen('spending') && <MetaSyncButton brandId={brandId} onSynced={loadEntries} />}
            </div>
            {isOpen('spending') && <div id="dt-body-spending">
              <ChannelTabs
                channels={channels.spend}
                activeKey={activeSpendTab}
                onSelect={setActiveSpendTab}
                onAddChannel={canEditSpend ? () => setModalKind('spend') : undefined}
              />
              <DailyEntryTable
                kind="spend" channelKey={activeSpendTab} days={grid.days}
                data={grid.spend[activeSpendTab]}
                onCellChange={(date, field, value) => onCellChange('spend', activeSpendTab, date, field, value)}
                saveStatus={saveStatus}
                readOnly={!canEditSpend}
              />
            </div>}
          </section>
        </div>
      )}

      {modalKind && (
        <AddCustomChannelModal
          kind={modalKind}
          onClose={() => setModalKind(null)}
          onSubmit={(label) => handleAddChannel(modalKind, label)}
        />
      )}
    </div>
  );
}
