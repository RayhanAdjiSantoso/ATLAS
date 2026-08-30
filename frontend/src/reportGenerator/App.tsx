import { useRef, useState } from 'react';
import { Header } from './components/Header';
import { PlatformTabs, type TabKey } from './components/PlatformTabs';
import { MetaTab } from './features/meta/MetaTab';
import { ShopeeTab } from './features/shopee/ShopeeTab';
import { TiktokTab } from './features/tiktok/TiktokTab';
import { BusinessTab } from './features/business/BusinessTab';
import { SummaryTab } from './features/summary/SummaryTab';
import { ClientPicker } from './features/reports/ClientPicker';
import { ReportsTab } from './features/reports/ReportsTab';
import { BIZ_INPUT_CHANNELS, bizBadgeLabel, emptyBizChannel, type BizChannelMetrics, type BizMetricKey, type BizPeriod, type BizRow } from './lib/business';
import { PLATFORM_CONFIG, emptyPlatformState, emptyPlatformStateMap, type PlatformKey, type PlatformResultData } from './lib/summary';

function defaultChannelData(): Record<string, BizChannelMetrics> {
  return Object.fromEntries(BIZ_INPUT_CHANNELS.map((c) => [c.key, emptyBizChannel()]));
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('meta');
  const [clientId, setClientId] = useState<number | null>(null);

  // ── Cross-tab shared state ──
  // platformState feeds the Summary Overview tab (Meta/Shopee/TikTok each
  // report their last-generated result here); the Business Overview state
  // (channelData/offlineStores/otherChannels) is shared between the Business
  // Overview tab's own cards and Summary Overview's Cost per Revenue card,
  // same as the original's module-level globals.
  const [platformState, setPlatformState] = useState(emptyPlatformStateMap());
  const [omzetOld, setOmzetOld] = useState<number | null>(null);
  const [omzetCur, setOmzetCur] = useState<number | null>(null);
  const [channelData, setChannelData] = useState<Record<string, BizChannelMetrics>>(defaultChannelData);
  const [offlineStores, setOfflineStores] = useState<BizRow[]>([{ id: 1, name: 'Store 1', ...emptyBizChannel() }]);
  const [otherChannels, setOtherChannels] = useState<BizRow[]>([{ id: 2, name: 'Channel 1', ...emptyBizChannel() }]);
  const bizRowSeq = useRef(3);

  function setPlatformResult(key: PlatformKey, data: PlatformResultData) {
    setPlatformState((prev) => ({ ...prev, [key]: { done: true, error: null, data } }));
  }
  function invalidatePlatform(key: PlatformKey) {
    setPlatformState((prev) => (prev[key].done || prev[key].error ? { ...prev, [key]: emptyPlatformState() } : prev));
  }

  function handleChannelDataChange(chKey: string, metric: BizMetricKey, period: BizPeriod, v: number | null) {
    setChannelData((prev) => ({ ...prev, [chKey]: { ...prev[chKey], [metric]: { ...prev[chKey][metric], [period]: v } } }));
  }

  const bizState = { channelData, offlineStores, otherChannels, shopeeOmzet: { old: omzetOld, cur: omzetCur } };

  const doneCount = PLATFORM_CONFIG.filter((p) => platformState[p.key].done).length;
  const badges: Record<TabKey, string> = {
    // Meta/Shopee/TikTok badges are a simplified approximation of the
    // original (which turned "✓" the moment a file was uploaded, before
    // Generate) — here they turn "✓" once that platform has generated a
    // report, which is simpler to track precisely and still communicates
    // the same thing ("this platform is ready to show up in Summary").
    meta: platformState.meta.done ? '✓' : '—',
    shopee: platformState.shopee.done ? '✓' : '—',
    tiktok: platformState.tiktok.done ? '✓' : '—',
    business: bizBadgeLabel(bizState),
    summary: doneCount === PLATFORM_CONFIG.length ? '✓' : `${doneCount}/${PLATFORM_CONFIG.length}`,
    reports: '—',
  };

  return (
    // Was <div id="app"> — renamed to a class so its CSS (index.css in this
    // folder) can be scoped under .report-generator-app instead of leaking
    // globally now that this shares a document with the rest of ATLAS.
    <div className="report-generator-app">
      <Header />
      <ClientPicker clientId={clientId} onChange={setClientId} />
      <PlatformTabs activeTab={activeTab} onChange={setActiveTab} badges={badges} />

      <MetaTab isActive={activeTab === 'meta'} clientId={clientId} onGenerated={(data) => setPlatformResult('meta', data)} onInvalidate={() => invalidatePlatform('meta')} />
      <ShopeeTab
        isActive={activeTab === 'shopee'}
        clientId={clientId}
        omzetOld={omzetOld}
        omzetCur={omzetCur}
        onOmzetOldChange={setOmzetOld}
        onOmzetCurChange={setOmzetCur}
        onGenerated={(data) => setPlatformResult('shopee', data)}
        onInvalidate={() => invalidatePlatform('shopee')}
      />
      <TiktokTab isActive={activeTab === 'tiktok'} clientId={clientId} onGenerated={(data) => setPlatformResult('tiktok', data)} onInvalidate={() => invalidatePlatform('tiktok')} />
      <ReportsTab isActive={activeTab === 'reports'} clientId={clientId} />
      <BusinessTab
        isActive={activeTab === 'business'}
        channelData={channelData}
        offlineStores={offlineStores}
        otherChannels={otherChannels}
        shopeeOmzet={{ old: omzetOld, cur: omzetCur }}
        onChannelDataChange={handleChannelDataChange}
        onOfflineStoresChange={setOfflineStores}
        onOtherChannelsChange={setOtherChannels}
        nextRowId={() => bizRowSeq.current++}
      />
      <SummaryTab isActive={activeTab === 'summary'} platformState={platformState} bizState={bizState} />
    </div>
  );
}

export default App;
