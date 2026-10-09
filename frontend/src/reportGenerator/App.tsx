import useSessionState from '../hooks/useSessionState.js';
import { useState } from 'react';
import { GeneratorShell } from './app/GeneratorShell';
import type { ReportKey } from './app/reports';
import { BIZ_INPUT_CHANNELS, emptyBizChannel, type BizChannelMetrics, type BizRow } from './lib/business';
import { PLATFORM_CONFIG, emptyPlatformState, emptyPlatformStateMap, type PlatformKey, type PlatformResultData } from './lib/summary';

// The manual per-channel inputs of the old Business Overview tab are gone (the
// tab now reads Daily Tracking), so Summary Overview's Cost per Revenue sees
// only the Shopee omzet through these empty channel slots.
const EMPTY_CHANNEL_DATA: Record<string, BizChannelMetrics> = Object.fromEntries(BIZ_INPUT_CHANNELS.map((c) => [c.key, emptyBizChannel()]));
const EMPTY_BIZ_ROWS: BizRow[] = [];

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
  // report their last-generated result here).
  const [platformState, setPlatformState] = useState(emptyPlatformStateMap());
  // Google Ads is not part of Summary Overview (yet), so it keeps its own flag.
  const [googleDone, setGoogleDone] = useState(false);
  const [omzetOld, setOmzetOld] = useState<number | null>(null);
  const [omzetCur, setOmzetCur] = useState<number | null>(null);

  function setPlatformResult(key: PlatformKey, data: PlatformResultData) {
    setPlatformState((prev) => ({ ...prev, [key]: { done: true, error: null, data } }));
  }
  function invalidatePlatform(key: PlatformKey) {
    setPlatformState((prev) => (prev[key].done || prev[key].error ? { ...prev, [key]: emptyPlatformState() } : prev));
  }

  const bizState = { channelData: EMPTY_CHANNEL_DATA, offlineStores: EMPTY_BIZ_ROWS, otherChannels: EMPTY_BIZ_ROWS, shopeeOmzet: { old: omzetOld, cur: omzetCur } };

  const doneCount = PLATFORM_CONFIG.filter((p) => platformState[p.key].done).length;
  const badges: Record<ReportKey, string> = {
    meta: platformState.meta.done ? '✓' : '—',
    shopee: platformState.shopee.done ? '✓' : '—',
    tiktok: platformState.tiktok.done ? '✓' : '—',
    google: googleDone ? '✓' : '—',
    business: '—',
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
          setGoogleDone(false);
          setOmzetOld(null);
          setOmzetCur(null);
        }}
        badges={badges}
        platformState={platformState}
        bizState={bizState}
        setPlatformResult={setPlatformResult}
        setGoogleDone={setGoogleDone}
        invalidatePlatform={invalidatePlatform}
        omzetOld={omzetOld}
        omzetCur={omzetCur}
        setOmzetOld={setOmzetOld}
        setOmzetCur={setOmzetCur}
      />
    </div>
  );
}

export default App;
