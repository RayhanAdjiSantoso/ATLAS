import { useEffect, type CSSProperties } from 'react';
import { clearLibraryCatalog } from '../features/reports/LibraryFileSlot';
import { Navigate, useParams } from 'react-router-dom';
import { MetaTab } from '../features/meta/MetaTab';
import { ShopeeTab } from '../features/shopee/ShopeeTab';
import { TiktokTab } from '../features/tiktok/TiktokTab';
import { BusinessTab } from '../features/business/BusinessTab';
import { SummaryTab } from '../features/summary/SummaryTab';
import { ClientPicker } from '../features/reports/ClientPicker';
import { ReportsTab } from '../features/reports/ReportsTab';
import { Reveal } from '../components/Reveal';
import { GenTopNav } from './GenTopNav';
import { isReportKey, REPORT_NAV, reportByKey, type ReportKey } from './reports';
import type { BizChannelMetrics, BizMetricKey, BizPeriod, BizRow, BizState } from '../lib/business';
import type { PlatformKey, PlatformResultData, PlatformStateMap } from '../lib/summary';
import { Database, Sparkles } from 'lucide-react';
import atlasIcon from '../../assets/atlas-icon.png';
import atlasWordmark from '../../assets/atlas-wordmark.png';

export interface GeneratorShellProps {
  clientId: number | null;
  setClientId: (id: number | null) => void;
  badges: Record<ReportKey, string>;
  platformState: PlatformStateMap;
  bizState: BizState;
  setPlatformResult: (key: PlatformKey, data: PlatformResultData) => void;
  invalidatePlatform: (key: PlatformKey) => void;
  omzetOld: number | null;
  omzetCur: number | null;
  setOmzetOld: (v: number | null) => void;
  setOmzetCur: (v: number | null) => void;
  channelData: Record<string, BizChannelMetrics>;
  offlineStores: BizRow[];
  otherChannels: BizRow[];
  onChannelDataChange: (chKey: string, metric: BizMetricKey, period: BizPeriod, v: number | null) => void;
  setOfflineStores: (rows: BizRow[]) => void;
  setOtherChannels: (rows: BizRow[]) => void;
  nextRowId: () => number;
}

// The report-type rail, the page heading, and all six report panels. The
// panels stay mounted whichever one is showing, so an upload in progress and
// an already-generated report survive switching between them — `isActive`
// only controls visibility.
//
// Which one is active comes from the /report-generator/:platform URL param
// rather than local state, so each report type is a real address: linkable,
// bookmarkable, and reachable with the browser's back button.
//
// Ported from MRG's app/GeneratorShell.tsx. Two things differ: the route base
// is /report-generator rather than /generate, and there is no BrandSettingsPage
// branch (that page is not ported — see reports.ts).
export function GeneratorShell(props: GeneratorShellProps) {
  const { platform } = useParams();
  useEffect(() => () => clearLibraryCatalog(), []);
  if (!isReportKey(platform)) return <Navigate to="/report-generator/meta" replace />;
  const activeTab: ReportKey = platform;
  const active = reportByKey(activeTab);
  const generatedCount = (['meta', 'shopee', 'tiktok'] as ReportKey[]).filter((key) => props.badges[key] === '✓').length;

  return (
    <div className="gen-wrap bleed">
      <div className="gen-main" id="app">
        <header className="rg-hero">
          <span className="rg-hero-fx" aria-hidden="true"><i className="rg-hero-aurora" /><i className="rg-hero-grid" /></span>
          <div className="rg-hero-main">
            <Reveal className="rg-hero-copy">
              <span className="rg-hero-eye"><Sparkles size={13} /> Performance reporting workspace</span>
              <h1>Report Generator</h1>
              <p>Bandingkan performa lintas platform, susun insight berbasis konteks brand, lalu hasilkan laporan yang siap dipresentasikan.</p>
              <div className="rg-hero-stats">
                <span><strong>{REPORT_NAV.length}</strong> bagian laporan</span>
                <span><strong>3</strong> platform utama</span>
                <span><strong>{generatedCount}/3</strong> laporan tersusun</span>
              </div>
            </Reveal>
            <div className="rg-hero-badge" aria-hidden="true">
              <span className="rg-hero-ring" /><span className="rg-hero-ring rg-hero-ring-b" />
              <img src={atlasIcon} alt="" className="rg-hero-mark" />
              <img src={atlasWordmark} alt="" className="rg-hero-logo" />
              <small>Consultant reporting</small>
            </div>
          </div>

          <div className="rg-dock">
            <div className="rg-dock-copy">
              <span><Database size={14} /> Brand untuk laporan</span>
              <small>Semua sumber, konteks, dan hasil laporan terikat pada brand yang dipilih.</small>
            </div>
            <ClientPicker clientId={props.clientId} onChange={props.setClientId} />
          </div>
        </header>

        <GenTopNav badges={props.badges} />
        <div className="rg-active-caption" key={activeTab} style={{ '--rg-accent': active.accent } as CSSProperties}>
          <strong>{active.label}</strong>
          <span>{active.tagline}</span>
          <i />
          <p>{active.desc}</p>
        </div>

        <MetaTab key={`${props.clientId}-MetaTab`}
            isActive={activeTab === 'meta'}
            clientId={props.clientId}
            onGenerated={(data) => props.setPlatformResult('meta', data)}
            onInvalidate={() => props.invalidatePlatform('meta')}
          />
          <ShopeeTab key={`${props.clientId}-ShopeeTab`}
            isActive={activeTab === 'shopee'}
            clientId={props.clientId}
            omzetOld={props.omzetOld}
            omzetCur={props.omzetCur}
            onOmzetOldChange={props.setOmzetOld}
            onOmzetCurChange={props.setOmzetCur}
            onGenerated={(data) => props.setPlatformResult('shopee', data)}
            onInvalidate={() => props.invalidatePlatform('shopee')}
          />
          <TiktokTab key={`${props.clientId}-TiktokTab`}
            isActive={activeTab === 'tiktok'}
            clientId={props.clientId}
            onGenerated={(data) => props.setPlatformResult('tiktok', data)}
            onInvalidate={() => props.invalidatePlatform('tiktok')}
          />
          <ReportsTab isActive={activeTab === 'reports'} clientId={props.clientId} />
          <BusinessTab
            isActive={activeTab === 'business'}
            channelData={props.channelData}
            offlineStores={props.offlineStores}
            otherChannels={props.otherChannels}
            shopeeOmzet={{ old: props.omzetOld, cur: props.omzetCur }}
            onChannelDataChange={props.onChannelDataChange}
            onOfflineStoresChange={props.setOfflineStores}
            onOtherChannelsChange={props.setOtherChannels}
            nextRowId={props.nextRowId}
          />
        <SummaryTab isActive={activeTab === 'summary'} platformState={props.platformState} bizState={props.bizState} />
      </div>
    </div>
  );
}
