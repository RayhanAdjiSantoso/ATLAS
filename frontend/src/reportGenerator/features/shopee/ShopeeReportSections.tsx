import { BarChart3, FileBarChart, Layers, ListTree, Megaphone, MousePointerClick, Network, PieChart, Rocket, Scale, ShoppingCart, Sparkles, Store, TrendingUp, type LucideIcon } from 'lucide-react';
import { KpiTable } from '../../components/KpiTable';
import { PeriodWarningBanner } from '../../components/PeriodWarningBanner';
import { ReportPages } from '../../components/ReportPages';
import { SectionAccordion, SectionGroup } from '../../components/SectionAccordion';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import type { DailyTrendMetricSelection } from '../../lib/shopeeDeepDiveInsights';
import type { MetricSelection } from '../../lib/shopeeDeepDiveItemPivot';
import type { ParetoRangeSelection, PerfMetricVars } from '../../lib/shopeeProductAnalysis';
import { ChannelPivotSection, DailyTrendSection, ItemPivotSection, TingkatkanDenganIklanTable } from './DeepDiveSections';
import { FundamentalAnalysisSection, ParetoAnalysisSection, ProductRankingSection, RankingChart } from './AnalysisSections';
import { ProductChangeChart } from './ProductAnalysisCharts';
import { ChannelEmptySection, ChannelParetoSection, PotentialItemsSection, ProductAdsSplitSection, RoiRootSection, ShopPlusGroupsSection, UncategorizedNote, UnadvertisedProductsSection } from './ChannelAnalysisSections';
import { fmtPivotVal } from '../../lib/shopeeDeepDivePivot';
import './shopeeReport.css';
import { SHOPEE_CHANNELS, type ChannelAnalysis } from '../../lib/shopeeChannelAnalysis';
import { ChannelContributionSection } from './ChannelContributionSection';
import type { ShopeeDeepDiveReport } from './shopeeDeepDiveReport';
import type { ShopeeFunnelReport } from './shopeeFunnelReport';
import type { ShopeeReport } from './shopeeReport';

// The full Shopee Performance Report body — every section a live Generate
// renders — shared by the Shopee tab and Riwayat Laporan so the two never
// drift. The caller owns the three report objects (built from files, or
// reconstructed from the DB) plus the interactive selection state.
//
// One tab per channel: Overall · Product Ads · Shop+ Ads · Live Ads · Banner
// Ads. Overall opens on the ROI root (ROI = revenue ÷ spend, each split by
// channel) and carries the store-level reads (Product Performance); every
// channel tab reads Traffic, Conversion, Pareto and Potential off its own
// export (see lib/shopeeChannelAnalysis.ts for which file feeds which).
// The navigator's icon for a section, read off its title — the title is what
// SectionAccordion already knows about each section.
const SECTION_ICONS: readonly [RegExp, LucideIcon][] = [
  [/roi/i, Scale],
  [/fundamental/i, Network],
  [/kontribusi/i, PieChart],
  [/shopee toko|overview/i, Store],
  [/traffic/i, MousePointerClick],
  [/conversion/i, ShoppingCart],
  [/pareto/i, BarChart3],
  [/tingkatkan/i, Rocket],
  [/potential/i, Sparkles],
  [/tren/i, TrendingUp],
  [/per item/i, ListTree],
  [/grup/i, Layers],
  [/ads$/i, Megaphone],
];
const sectionIcon = (title: string) => {
  const Icon = SECTION_ICONS.find(([re]) => re.test(title))?.[1] ?? FileBarChart;
  return <Icon size={15} strokeWidth={2.2} />;
};

interface ShopeeReportSectionsProps {
  report: ShopeeReport;
  deepDive: ShopeeDeepDiveReport;
  funnelReport: ShopeeFunnelReport | null;
  hasTokoData: boolean;
  hasLiveData: boolean;
  hasTokoKeywordData: boolean;
  customMetrics: MetricSelection[];
  onAddCustomMetric: (sel: MetricSelection) => void;
  onProdukSelectionsChange: (sels: MetricSelection[]) => void;
  onKeywordSelectionsChange: (sels: MetricSelection[]) => void;
  onDailyTrendSelectionsChange: (sels: DailyTrendMetricSelection[]) => void;
  onPerformanceSelectionsChange: (sels: (keyof PerfMetricVars)[]) => void;
  paretoRange: ParetoRangeSelection;
  onParetoRangeChange: (next: ParetoRangeSelection) => void;
  itemPivotTab: 'produk' | 'keyword' | 'performa';
  onItemPivotTabChange: (tab: 'produk' | 'keyword' | 'performa') => void;
  onSaveCategory: (name: string, category: string, series: string) => Promise<void>;
}

export function ShopeeReportSections({
  report,
  deepDive,
  funnelReport,
  hasTokoData,
  hasLiveData,
  hasTokoKeywordData,
  customMetrics,
  onAddCustomMetric,
  onProdukSelectionsChange,
  onKeywordSelectionsChange,
  onDailyTrendSelectionsChange,
  onPerformanceSelectionsChange,
  paretoRange,
  onParetoRangeChange,
  itemPivotTab,
  onItemPivotTabChange,
  onSaveCategory,
}: ShopeeReportSectionsProps) {
  const channelFunnel = (key: 'produk' | 'toko' | 'live') => funnelReport?.channels.find((c) => c.key === key);
  const analysis = (key: ChannelAnalysis['key']) => funnelReport?.channelAnalyses.find((c) => c.key === key);
  const { p1, p2 } = report;

  // Traffic, Conversion, Pareto and Potential of one channel, read off its own
  // export — each one section, its chart above its table. Live sessions never
  // repeat across periods, so they rank without a %Change column.
  const channelReads = (a: ChannelAnalysis | undefined) => {
    if (!a) return [];
    const oldMissing = <>Tidak ada {a.itemLabel.toLowerCase()} yang sama di periode lalu — ranking ditampilkan tanpa kolom %Perubahan.</>;
    const color = SHOPEE_CHANNELS.find((c) => c.key === a.key)?.color ?? 'var(--shopee)';
    const chart = (r: ChannelAnalysis['traffic']) => <RankingChart rankings={r.rankings} hasOld={r.hasOld} p1={p1} p2={p2} itemLabel={a.itemLabel} color={color} />;
    return [
      <ProductRankingSection
        key="traffic" title="Traffic Analysis" badge={`${a.label} · ${a.source}`} itemLabel={a.itemLabel}
        rankings={a.traffic.rankings} hasCur={a.traffic.rankings[0]?.rows.length > 0} hasOld={a.traffic.hasOld}
        emptyText={`Belum ada data ${a.label} periode ini.`} oldMissingText={oldMissing} p1={p1} p2={p2} chart={chart(a.traffic)}
      />,
      <ProductRankingSection
        key="conversion" title="Conversion Analysis" badge={`${a.label} · ${a.source}`} itemLabel={a.itemLabel}
        rankings={a.conversion.rankings} hasCur={a.conversion.rankings[0]?.rows.length > 0} hasOld={a.conversion.hasOld}
        emptyText={`Belum ada data ${a.label} periode ini.`} oldMissingText={oldMissing} p1={p1} p2={p2} chart={chart(a.conversion)}
      />,
      <ChannelParetoSection key="pareto" rows={a.pareto} itemLabel={a.itemLabel} channelLabel={a.label} periodLabel={p2} />,
    ];
  };

  const unadvertised = funnelReport ? (
    <UnadvertisedProductsSection data={funnelReport.unadvertised} hasData={funnelReport.hasProductPerfCur} periodLabel={p2} />
  ) : null;

  const produk = analysis('produk');
  const toko = analysis('toko');
  const live = analysis('live');
  const banner = analysis('banner');

  // Each channel tab carries its ROAS for the newer period, so the bar itself
  // says which channel earns its spend before one is opened.
  const roasHint = (v: number | null | undefined) => (v === null || v === undefined ? undefined : fmtPivotVal(v, 'roas'));
  const rootRow = (key: ChannelAnalysis['key']) => funnelReport?.roiRoot.revenue.rows.find((r) => r.key === key);
  const channelTab = (key: ChannelAnalysis['key']) => {
    const row = rootRow(key);
    return { hint: row?.hasData ? roasHint(row.roasCur) : undefined, empty: !row?.hasData };
  };

  const pages = [
    {
      id: 'overall',
      label: 'Overall',
      hint: roasHint(funnelReport?.roiRoot.roi.cur),
      content: (
        <SectionAccordion iconFor={sectionIcon}>
          {funnelReport && <RoiRootSection root={funnelReport.roiRoot} p1={p1} p2={p2} />}
          {funnelReport && (
            <FundamentalAnalysisSection values={funnelReport.values} liveGmv={funnelReport.liveGmv} tree={funnelReport.tree} symptom={funnelReport.symptom} p1={p1} p2={p2} />
          )}
          {funnelReport && funnelReport.channelMix.length > 0 && <ChannelContributionSection mix={funnelReport.channelMix} periodLabel={p2} />}
          {report.productOverviewRows && (
            <div className="sec-block">
              <div className="sec-heading shopee-heading">
                Shopee Toko <span className="sec-badge">Product Overview</span>
                <SectionDownloadButton />
              </div>
              <div style={{ padding: '0 1.4rem 1.4rem' }}>
                <KpiTable rows={report.productOverviewRows} p1={p1} p2={p2} />
              </div>
            </div>
          )}
          {funnelReport && (
            <SectionGroup label="Penjualan toko · semua produk, bukan hanya iklan">
              {(['traffic', 'conversion'] as const).map((id) => {
                const chartGroup = funnelReport.productCharts.find((c) => c.group.id === id);
                return (
                  <ProductRankingSection
                    key={id} title={id === 'traffic' ? 'Traffic Analysis' : 'Conversion Analysis'}
                    badge={`Product Performance · ${id === 'traffic' ? 'traffic' : 'konversi'} per produk toko`}
                    rankings={funnelReport[id]} hasCur={funnelReport.hasProductPerfCur} hasOld={funnelReport.hasProductPerfOld} p1={p1} p2={p2}
                    chart={chartGroup && (
                      <ProductChangeChart
                        group={chartGroup.group} points={chartGroup.points} hasCur={funnelReport.hasProductPerfCur} hasOld={funnelReport.hasProductPerfOld}
                        missingVisitorsCol={!funnelReport.hasVisitorsCol} p1={p1} p2={p2}
                      />
                    )}
                  />
                );
              })}
              <ParetoAnalysisSection
                rows={funnelReport.pareto} hasData={funnelReport.pareto.length > 0} range={paretoRange}
                availableMonths={funnelReport.paretoAvailableMonths} onRangeChange={onParetoRangeChange}
              />
            </SectionGroup>
          )}
          <DailyTrendSection rows={deepDive.dailyTrendPivot} selections={deepDive.dailyTrendSelections} onSelectionsChange={onDailyTrendSelectionsChange} p1={p1} p2={p2} />
        </SectionAccordion>
      ),
    },
    {
      id: 'product-ads',
      label: 'Product Ads',
      ...channelTab('produk'),
      content: (
        <SectionAccordion iconFor={sectionIcon}>
          <ChannelPivotSection
            title="Product Ads" badge="Iklan Produk + Iklan Produk Otomatis" rows={deepDive.produk} p1={p1} p2={p2}
            values={channelFunnel('produk')?.values} tree={channelFunnel('produk')?.tree} symptom={channelFunnel('produk')?.symptom}
          />
          {funnelReport?.produkSplit && <ProductAdsSplitSection split={funnelReport.produkSplit} p1={p1} p2={p2} />}
          {channelReads(produk)}
          {unadvertised}
          <ItemPivotSection
            produkRows={deepDive.produkPivot} produkSelections={deepDive.produkSelections} onProdukSelectionsChange={onProdukSelectionsChange}
            keywordRows={deepDive.keywordPivot} hasKeywordData={hasTokoKeywordData} keywordSelections={deepDive.keywordSelections}
            onKeywordSelectionsChange={onKeywordSelectionsChange} performaRows={deepDive.performancePivot} hasPerformaData={deepDive.hasPerformancePivotData}
            performanceSelections={deepDive.performanceSelections} onPerformanceSelectionsChange={onPerformanceSelectionsChange}
            customMetrics={customMetrics} onAddCustomMetric={onAddCustomMetric}
            activeTab={(itemPivotTab === 'keyword' && !hasTokoKeywordData) || (itemPivotTab === 'performa' && !deepDive.hasPerformancePivotData) ? 'produk' : itemPivotTab}
            onTabChange={onItemPivotTabChange} p1={p1} p2={p2}
          />
          {deepDive.tingkatkanDenganIklanRows && deepDive.tingkatkanDenganIklanRows.length > 0 && <TingkatkanDenganIklanTable rows={deepDive.tingkatkanDenganIklanRows} />}
          {deepDive.uncategorized.length > 0 && <UncategorizedNote alwaysOpen names={deepDive.uncategorized} onSave={onSaveCategory} />}
        </SectionAccordion>
      ),
    },
    {
      id: 'shop-ads',
      label: 'Shop+ Ads',
      ...channelTab('toko'),
      content: hasTokoData || toko?.hasData ? (
        <SectionAccordion iconFor={sectionIcon}>
          <ChannelPivotSection
            title="Shop+ Ads" badge="Shop+ Ads Overall Data" rows={deepDive.toko} p1={p1} p2={p2}
            values={channelFunnel('toko')?.values} tree={channelFunnel('toko')?.tree} symptom={channelFunnel('toko')?.symptom}
          />
          {toko?.groups && <ShopPlusGroupsSection groups={toko.groups} p1={p1} p2={p2} />}
          {channelReads(toko)}
          {toko && <PotentialItemsSection items={toko.potentialItems} itemLabel={toko.itemLabel} channelLabel={toko.label} periodLabel={p2} />}
        </SectionAccordion>
      ) : (
        <ChannelEmptySection label="Shop+ Ads" source="Iklan Toko (Shop+ Ads Overall Data)" />
      ),
    },
    {
      id: 'live-ads',
      label: 'Live Ads',
      ...channelTab('live'),
      content: hasLiveData || live?.hasData ? (
        <SectionAccordion iconFor={sectionIcon}>
          <ChannelPivotSection
            title="Live Ads" badge="Penonton-based" rows={deepDive.live} p1={p1} p2={p2}
            values={channelFunnel('live')?.values} tree={channelFunnel('live')?.tree} symptom={channelFunnel('live')?.symptom}
          />
          {channelReads(live)}
          {live && <PotentialItemsSection items={live.potentialItems} itemLabel={live.itemLabel} channelLabel={live.label} periodLabel={p2} />}
        </SectionAccordion>
      ) : (
        <ChannelEmptySection label="Live Ads" source="Iklan Live (Data Semua Iklan Live)" />
      ),
    },
    {
      id: 'banner-ads',
      label: 'Banner Ads',
      ...channelTab('banner'),
      content: banner?.hasData ? null : <ChannelEmptySection label="Banner Ads" source="Banner Ads" banner />,
    },
  ];

  return (
    <>
      <PeriodWarningBanner message={report.periodWarning} />
      {/* The deep Shopee orange: white labels on the bright #ee4d2d fall
          under AA at tab size. */}
      <ReportPages pages={pages} accent="#c93b1c" accentInk="var(--shopee-700)" />
    </>
  );
}
