import useSessionState from '../hooks/useSessionState.js';
import { useRef, useState } from 'react';
import { GeneratorShell } from './app/GeneratorShell';
import type { ReportKey } from './app/reports';
import { BIZ_INPUT_CHANNELS, bizBadgeLabel, emptyBizChannel, type BizChannelMetrics, type BizMetricKey, type BizPeriod, type BizRow } from './lib/business';
import { PLATFORM_CONFIG, emptyPlatformState, emptyPlatformStateMap, type PlatformKey, type PlatformResultData } from './lib/summary';

function defaultChannelData(): Record<string, BizChannelMetrics> {
  return Object.fromEntries(BIZ_INPUT_CHANNELS.map((c) => [c.key, emptyBizChannel()]));
}

// Holds the state every report type shares and hands it to GeneratorShell,
// which decides what to show from the :platform URL param.
//
// This component is mounted by the /report-generator/:platform route, so it
// stays mounted as you move between report types — only the param changes —
// and an upload in progress or an already-generated report survives the move.
// Leaving the generator for another ATLAS page does reset it, same as every
// other page in the app.
//
// Ported from MRG's App.tsx minus its router, auth provider and site shell:
// ATLAS supplies all three (App.jsx, AuthContext, AppLayout).
function App() {
  const [clientId, setClientId] = useSessionState('generator:client', null);

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
  const badges: Record<ReportKey, string> = {
    meta: platformState.meta.done ? '✓' : '—',
    shopee: platformState.shopee.done ? '✓' : '—',
    tiktok: platformState.tiktok.done ? '✓' : '—',
    business: bizBadgeLabel(bizState),
    summary: doneCount === PLATFORM_CONFIG.length ? '✓' : `${doneCount}/${PLATFORM_CONFIG.length}`,
    reports: '—',
  };

  return (
    // Two classes, two jobs. `.mil-ui` is what index.css / shell.css scope
    // every rule under, so it carries this app's design tokens and styles
    // without them leaking onto the rest of ATLAS. `.report-generator-app` is
    // the handle DOM logic reaches for: exportImage.ts toggles pdf-export-mode
    // on it and portalTarget.ts renders popups into it.
    <div className="mil-ui report-generator-app">
      <GeneratorShell
        clientId={clientId}
        setClientId={(id) => {
          if (id === clientId) return;
          setClientId(id);
          setPlatformState(emptyPlatformStateMap());
          setOmzetOld(null);
          setOmzetCur(null);
          setChannelData(defaultChannelData());
          setOfflineStores([{ id: 1, name: 'Store 1', ...emptyBizChannel() }]);
          setOtherChannels([{ id: 2, name: 'Channel 1', ...emptyBizChannel() }]);
        }}
        badges={badges}
        platformState={platformState}
        bizState={bizState}
        setPlatformResult={setPlatformResult}
        invalidatePlatform={invalidatePlatform}
        omzetOld={omzetOld}
        omzetCur={omzetCur}
        setOmzetOld={setOmzetOld}
        setOmzetCur={setOmzetCur}
        channelData={channelData}
        offlineStores={offlineStores}
        otherChannels={otherChannels}
        onChannelDataChange={handleChannelDataChange}
        setOfflineStores={setOfflineStores}
        setOtherChannels={setOtherChannels}
        nextRowId={() => bizRowSeq.current++}
      />
    </div>
  );
}

export default App;
