import { KpiTable } from '../../components/KpiTable';
import { PeriodWarningBanner } from '../../components/PeriodWarningBanner';
import { ReportPages } from '../../components/ReportPages';
import { SectionAccordion } from '../../components/SectionAccordion';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import type { DailyTrendMetricSelection } from '../../lib/shopeeDeepDiveInsights';
import type { MetricSelection } from '../../lib/shopeeDeepDiveItemPivot';
import { ChannelPivotSection, DailyTrendSection, ItemPivotSection, TingkatkanDenganIklanTable, UnadvertisedProductsTable, UncategorizedPanel } from './DeepDiveSections';
import { FundamentalAnalysisSection, ParetoAnalysisSection, ProductRankingSection } from './AnalysisSections';
import { ParetoChartSection, PotentialProductsSection, ProductChangeChartSection } from './ProductAnalysisCharts';
import { ChannelContributionSection } from './ChannelContributionSection';
import type { ShopeeDeepDiveReport } from './shopeeDeepDiveReport';
import type { ShopeeFunnelReport } from './shopeeFunnelReport';
import type { ShopeeReport } from './shopeeReport';

// The full Shopee Performance Report body — every section a live Generate
// renders — shared by the Shopee tab and Riwayat Laporan so the two never
// drift. The caller owns the three report objects (built from files, or
// reconstructed from the DB) plus the interactive selection state.
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
  itemPivotTab: 'produk' | 'keyword';
  onItemPivotTabChange: (tab: 'produk' | 'keyword') => void;
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
  itemPivotTab,
  onItemPivotTabChange,
  onSaveCategory,
}: ShopeeReportSectionsProps) {
  const channelFunnel = (key: 'produk' | 'toko' | 'live') => funnelReport?.channels.find((c) => c.key === key);

  // ~14 cards used to be one long scroll — now split across tabbed pages, and
  // within a page only one section is expanded at a time.
  const pages = [
    {
      id: 'ringkasan',
      label: 'Ads Performance',
      content: (
        <SectionAccordion>
          {/* Fundamental Analysis leads: it replaced the old "Iklan Shopee
              Overall" pivot (same totals, none of the funnel decomposition),
              and now carries the account-level Symptom tree + read that used
              to live on a separate Funnel & Diagnosa page. */}
          {funnelReport && (
            <FundamentalAnalysisSection
              values={funnelReport.values}
              liveGmv={funnelReport.liveGmv}
              tree={funnelReport.tree}
              symptom={funnelReport.symptom}
              p1={report.p1}
              p2={report.p2}
            />
          )}
          <ChannelPivotSection
            title="Iklan Produk"
            badge="+ Iklan Produk Otomatis"
            rows={deepDive.produk}
            p1={report.p1}
            p2={report.p2}
            tree={channelFunnel('produk')?.tree}
            symptom={channelFunnel('produk')?.symptom}
          />
          {hasTokoData && (
            <ChannelPivotSection
              title="Iklan Toko"
              badge="Shop+ Ads"
              rows={deepDive.toko}
              p1={report.p1}
              p2={report.p2}
              tree={channelFunnel('toko')?.tree}
              symptom={channelFunnel('toko')?.symptom}
            />
          )}
          {hasLiveData && (
            <ChannelPivotSection
              title="Iklan Live"
              badge="Penonton-based"
              rows={deepDive.live}
              p1={report.p1}
              p2={report.p2}
              tree={channelFunnel('live')?.tree}
              symptom={channelFunnel('live')?.symptom}
            />
          )}
          {funnelReport && <ChannelContributionSection mix={funnelReport.channelMix} periodLabel={report.p2} />}
          {report.productOverviewRows && (
            <div className="sec-block">
              <div className="sec-heading shopee-heading">
                Shopee Toko <span className="sec-badge">Product Overview</span>
                <SectionDownloadButton />
              </div>
              <div style={{ padding: '0 1.4rem 1.4rem' }}>
                <KpiTable rows={report.productOverviewRows} p1={report.p1} p2={report.p2} />
              </div>
            </div>
          )}
        </SectionAccordion>
      ),
    },
    {
      id: 'product-analysis',
      label: 'Product Analysis',
      // Charts only. The tables for the same products live in "Analisis
      // Produk" next door — this tab answers "which few moved / which few
      // earn", that one answers "what exactly did every product do".
      hidden: !funnelReport,
      content: funnelReport ? (
        <>
          {funnelReport.productCharts.map(({ pair, points }) => (
            <ProductChangeChartSection
              key={pair.id}
              pair={pair}
              points={points}
              hasCur={funnelReport.hasProductPerfCur}
              hasOld={funnelReport.hasProductPerfOld}
              missingVisitorsCol={!funnelReport.hasVisitorsCol}
              p1={report.p1}
              p2={report.p2}
            />
          ))}
          <ParetoChartSection rows={funnelReport.pareto} hasData={funnelReport.hasProductPerfCur} periodLabel={report.p2} />
          <PotentialProductsSection products={funnelReport.potentialProducts} hasData={funnelReport.hasProductPerfCur} periodLabel={report.p2} />
        </>
      ) : null,
    },
    {
      id: 'produk',
      label: 'Analisis Produk',
      content: (
        <>
          {funnelReport && (
            <>
              <ParetoAnalysisSection rows={funnelReport.pareto} hasData={funnelReport.hasProductPerfCur} periodLabel={report.p2} />
              <ProductRankingSection
                title="Traffic Analysis"
                badge="Product Performance · ranking traffic per produk"
                rankings={funnelReport.traffic}
                hasCur={funnelReport.hasProductPerfCur}
                hasOld={funnelReport.hasProductPerfOld}
                p1={report.p1}
                p2={report.p2}
              />
              <ProductRankingSection
                title="Conversion Analysis"
                badge="Product Performance · ranking konversi per produk"
                rankings={funnelReport.conversion}
                hasCur={funnelReport.hasProductPerfCur}
                hasOld={funnelReport.hasProductPerfOld}
                p1={report.p1}
                p2={report.p2}
              />
            </>
          )}
          <ItemPivotSection
            produkRows={deepDive.produkPivot}
            produkSelections={deepDive.produkSelections}
            onProdukSelectionsChange={onProdukSelectionsChange}
            keywordRows={deepDive.keywordPivot}
            hasKeywordData={hasTokoKeywordData}
            keywordSelections={deepDive.keywordSelections}
            onKeywordSelectionsChange={onKeywordSelectionsChange}
            customMetrics={customMetrics}
            onAddCustomMetric={onAddCustomMetric}
            activeTab={hasTokoKeywordData ? itemPivotTab : 'produk'}
            onTabChange={onItemPivotTabChange}
            p1={report.p1}
            p2={report.p2}
          />
          <UncategorizedPanel names={deepDive.uncategorized} onSave={onSaveCategory} />
          <UnadvertisedProductsTable rows={deepDive.unadvertisedProducts} hasFile={deepDive.hasProductPerformanceData} />
          <TingkatkanDenganIklanTable rows={deepDive.tingkatkanDenganIklanRows} />
        </>
      ),
    },
    {
      id: 'tren',
      label: 'Tren Harian',
      content: <DailyTrendSection rows={deepDive.dailyTrendPivot} selections={deepDive.dailyTrendSelections} onSelectionsChange={onDailyTrendSelectionsChange} p1={report.p1} p2={report.p2} />,
    },
  ];

  return (
    <>
      <PeriodWarningBanner message={report.periodWarning} />
      <ReportPages pages={pages} accent="var(--shopee)" accentInk="var(--shopee-700)" />
    </>
  );
}
