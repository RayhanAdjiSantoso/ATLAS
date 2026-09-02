import { KpiTable } from '../../components/KpiTable';
import { PeriodWarningBanner } from '../../components/PeriodWarningBanner';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import type { DailyTrendMetricSelection } from '../../lib/shopeeDeepDiveInsights';
import type { MetricSelection } from '../../lib/shopeeDeepDiveItemPivot';
import { ChannelPivotSection, DailyTrendSection, ItemPivotSection, TingkatkanDenganIklanTable, UnadvertisedProductsTable, UncategorizedPanel } from './DeepDiveSections';
import { FundamentalAnalysisSection, ParetoAnalysisSection, ProductRankingSection } from './AnalysisSections';
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
  return (
    <>
      <PeriodWarningBanner message={report.periodWarning} />

      <ChannelPivotSection title="Iklan Shopee Overall" badge="Semua Channel" rows={deepDive.overall} p1={report.p1} p2={report.p2} />
      <ChannelPivotSection title="Iklan Produk" badge="+ Iklan Produk Otomatis" rows={deepDive.produk} p1={report.p1} p2={report.p2} />
      {hasTokoData && <ChannelPivotSection title="Iklan Toko" badge="Shop+ Ads" rows={deepDive.toko} p1={report.p1} p2={report.p2} />}
      {hasLiveData && <ChannelPivotSection title="Iklan Live" badge="Penonton-based" rows={deepDive.live} p1={report.p1} p2={report.p2} />}

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

      {funnelReport && (
        <>
          <FundamentalAnalysisSection values={funnelReport.values} tree={funnelReport.tree} liveGmv={funnelReport.liveGmv} p1={report.p1} p2={report.p2} />
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
      <DailyTrendSection rows={deepDive.dailyTrendPivot} selections={deepDive.dailyTrendSelections} onSelectionsChange={onDailyTrendSelectionsChange} p1={report.p1} p2={report.p2} />
    </>
  );
}
