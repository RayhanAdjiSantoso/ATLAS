import { useEffect } from 'react';
import { clearLibraryCatalog } from '../features/reports/LibraryFileSlot';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { MetaTab } from '../features/meta/MetaTab';
import { ShopeeTab } from '../features/shopee/ShopeeTab';
import { TiktokTab } from '../features/tiktok/TiktokTab';
import { GoogleAdsTab } from '../features/google/GoogleAdsTab';
import { BusinessOverviewTab } from '../features/business/BusinessOverviewTab';
import { SummaryTab } from '../features/summary/SummaryTab';
import { ClientPicker } from '../features/reports/ClientPicker';
import { ReportsTab } from '../features/reports/ReportsTab';
import PageBand from '../../components/common/PageBand.jsx';
import { ReportIcon } from '../components/ReportIcon';
import { BRAND_KEYS, BrandLogo, type BrandKey } from '../components/BrandLogo';
import { DISABLED_REPORTS, ENABLED_NAV, REPORT_NAV, isReportKey, reportByKey, type ReportKey } from './reports';
import type { BizState } from '../lib/business';
import type { PlatformKey, PlatformResultData, PlatformStateMap } from '../lib/summary';
import { Archive, History, Layers, LayoutGrid } from 'lucide-react';

export interface GeneratorShellProps {
  clientId: number | null;
  setClientId: (id: number | null) => void;
  badges: Record<ReportKey, string>;
  platformState: PlatformStateMap;
  bizState: BizState;
  setPlatformResult: (key: PlatformKey, data: PlatformResultData) => void;
  setGoogleDone: (done: boolean) => void;
  invalidatePlatform: (key: PlatformKey) => void;
  omzetOld: number | null;
  omzetCur: number | null;
  setOmzetOld: (v: number | null) => void;
  setOmzetCur: (v: number | null) => void;
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
// Report types shown as band tabs: every enabled one except Riwayat.
const TAB_REPORTS = REPORT_NAV.filter((r) => !DISABLED_REPORTS.includes(r.key) && r.key !== 'reports');

export function GeneratorShell(props: GeneratorShellProps) {
  const { platform } = useParams();
  useEffect(() => () => clearLibraryCatalog(), []);
  if (!isReportKey(platform) || DISABLED_REPORTS.includes(platform)) return <Navigate to="/report-generator/meta" replace />;
  const activeTab: ReportKey = platform;
  const active = reportByKey(activeTab);
  const generatedCount = (['meta', 'shopee', 'tiktok', 'google'] as ReportKey[]).filter((key) => props.badges[key] === '✓').length;

  return (
    <div className="gen-wrap bleed">
      <div className="gen-main" id="app" data-platform={activeTab}>
        {/* Level 1 on the shared ATLAS header band (the same component as
            Brand Setting and Business Overview): the report types as folder
            tabs, the open one's description under the title. Riwayat is a
            utility, not a report type, so it sits in the band's corner. */}
        <PageBand
          kicker="Workspace · Laporan"
          title="Report Generator"
          desc={active.desc}
          compact
          ariaLabel="Jenis laporan"
          layoutId="rg-tab-sheet"
          activeKey={activeTab}
          tabs={TAB_REPORTS.map((r) => ({
            key: r.key,
            to: `/report-generator/${r.key}`,
            label: r.label,
            hint: r.tagline,
            logo: BRAND_KEYS.includes(r.key),
            icon: BRAND_KEYS.includes(r.key)
              ? <BrandLogo name={r.key as BrandKey} size={20} />
              : <ReportIcon name={r.key} />,
            badge: props.badges[r.key] === '✓' ? '✓' : props.badges[r.key] && props.badges[r.key] !== '—' ? props.badges[r.key] : undefined,
          }))}
          aside={(
            <NavLink to="/report-generator/reports" className={`band-action${activeTab === 'reports' ? ' is-on' : ''}`}>
              <History size={15} aria-hidden="true" /> Riwayat laporan
            </NavLink>
          )}
        />

        <section className="rgx-command" aria-label="Brand untuk laporan">
          <div className="rgx-field rgx-field-brand">
            <span className="rgx-field-label">Brand untuk laporan</span>
            <ClientPicker clientId={props.clientId} onChange={props.setClientId} />
          </div>
          <dl className="rgx-stats">
            <div>
              <dt><LayoutGrid size={14} aria-hidden="true" /> Bagian laporan</dt>
              <dd>{ENABLED_NAV.length}</dd>
            </div>
            <div>
              <dt><Layers size={14} aria-hidden="true" /> Platform utama</dt>
              <dd>4</dd>
            </div>
            <div>
              <dt><Archive size={14} aria-hidden="true" /> Laporan tersusun</dt>
              <dd>{generatedCount}<small>/4</small></dd>
            </div>
          </dl>
        </section>

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
          <GoogleAdsTab key={`${props.clientId}-GoogleAdsTab`}
            isActive={activeTab === 'google'}
            clientId={props.clientId}
            onGenerated={() => props.setGoogleDone(true)}
            onInvalidate={() => props.setGoogleDone(false)}
          />
          <ReportsTab isActive={activeTab === 'reports'} clientId={props.clientId} />
          <BusinessOverviewTab key={`${props.clientId}-BusinessOverviewTab`}
            isActive={activeTab === 'business'}
            clientId={props.clientId}
          />
        <SummaryTab isActive={activeTab === 'summary'} platformState={props.platformState} bizState={props.bizState} />
      </div>
    </div>
  );
}
