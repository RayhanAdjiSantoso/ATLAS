import { useEffect, useMemo, useState } from 'react';
import { DemoBreakdownCard } from '../../components/DemoBreakdownCard';
import { InlineNotice } from '../../components/InlineNotice';
import { KpiTable } from '../../components/KpiTable';
import { OverviewDetailedCard } from '../../components/OverviewDetailedCard';
import { PeriodCompareChip } from '../../components/PeriodCompareChip';
import { PeriodWarningBanner } from '../../components/PeriodWarningBanner';
import { SectionDownloadButton } from '../../components/SectionDownloadButton';
import { ShopeeReportSections } from '../shopee/ShopeeReportSections';
import type { ProductMasterEntry } from '../../lib/shopeeDeepDive';
import type { DailyTrendMetricSelection } from '../../lib/shopeeDeepDiveInsights';
import type { MetricSelection } from '../../lib/shopeeDeepDiveItemPivot';
import { deleteReport, getProductMaster, getReportDetail, getReports, saveProductMasterEntry } from './api';
import { reconstructMetaReport, reconstructShopeeDeepDive, reconstructShopeeFunnel, reconstructShopeeReport, reconstructTiktokReport } from './reconstruct';
import type { Platform, ReportDetail, ReportListItem } from './types';

interface ReportsTabProps {
  isActive: boolean;
  clientId: number | null;
}

const PLATFORM_LABELS: Record<Platform, string> = { meta: 'Meta Ads', shopee: 'Shopee Ads', tiktok: 'TikTok GMV Max' };

// "Riwayat Laporan" — lists saved reports for the selected client (GET
// /api/reports) and reopens one read-only (GET /api/reports/:id) by feeding
// its persisted rows back through the same buildXReport() functions the
// live Meta/Shopee/TikTok tabs use (see reconstruct.ts), so no report file
// re-upload is needed.
export function ReportsTab({ isActive, clientId }: ReportsTabProps) {
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isActive || !clientId) return;
    setLoading(true);
    setListError(null);
    setSelected(null);
    setQuery('');
    getReports(clientId)
      .then(setReports)
      .catch((err) => setListError((err as Error).message))
      .finally(() => setLoading(false));
  }, [isActive, clientId]);

  const visibleReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) =>
      `${r.periodCurLabel ?? ''} ${r.periodOldLabel ?? ''} ${PLATFORM_LABELS[r.platform]} ${new Date(r.createdAt).toLocaleString('id-ID')}`.toLowerCase().includes(q),
    );
  }, [reports, query]);

  function open(id: number) {
    setDetailError(null);
    setSelected(null);
    getReportDetail(id).then(setSelected).catch((err) => setDetailError((err as Error).message));
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Hapus laporan ini dari riwayat? Tindakan ini tidak bisa dibatalkan.')) return;
    setDeleteError(null);
    setDeletingId(id);
    try {
      await deleteReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      if (selected?.report.id === id) setSelected(null);
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className={`panel${isActive ? ' active' : ''}`}>
      <div className="source-block">
        <div className="source-header">
          <div className="source-label">Riwayat Laporan</div>
        </div>
        {!clientId && <div className="empty-note">Pilih klien terlebih dahulu (di bagian atas halaman) untuk melihat riwayat laporan.</div>}
        {clientId && loading && <div className="empty-note">Memuat riwayat…</div>}
        {clientId && listError && <InlineNotice title="Riwayat tidak bisa dimuat">{listError}</InlineNotice>}
        {clientId && !loading && !listError && reports.length === 0 && <div className="empty-note">Belum ada laporan tersimpan untuk klien ini.</div>}
        {deleteError && <InlineNotice title="Laporan gagal dihapus">{deleteError}</InlineNotice>}
        {clientId && !loading && !listError && reports.length > 0 && (
          <input
            className="saved-modal-search"
            style={{ margin: '.8rem 0 0', width: '100%' }}
            placeholder="Cari laporan — label periode / platform…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        {clientId && !loading && !listError && reports.length > 0 && visibleReports.length === 0 && (
          <div className="empty-note">Tidak ada laporan yang cocok dengan “{query}”.</div>
        )}
        <div className="reports-list">
          {visibleReports.map((r) => (
            <div key={r.id} className="report-list-item" onClick={() => open(r.id)}>
              <div className="report-list-main">
                <div className="report-list-title">
                  {r.periodCurLabel} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>vs {r.periodOldLabel}</span>
                </div>
                <div className="report-list-meta">Disimpan {new Date(r.createdAt).toLocaleString('id-ID')}</div>
              </div>
              <div className="report-list-badge">{PLATFORM_LABELS[r.platform]}</div>
              <span
                className="report-list-delete"
                title="Hapus laporan ini"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(r.id);
                }}
              >
                {deletingId === r.id ? '…' : '🗑'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {detailError && <InlineNotice title="Laporan gagal dibuka">{detailError}</InlineNotice>}
      {selected && <ReportDetailView detail={selected} />}
    </div>
  );
}

function ReportDetailView({ detail }: { detail: ReportDetail }) {
  if (detail.report.platform === 'shopee') return <ShopeeDetailView detail={detail} />;
  if (detail.report.platform === 'meta') return <MetaDetailView detail={detail} />;
  return <TiktokDetailView detail={detail} />;
}

function ShopeeDetailView({ detail }: { detail: ReportDetail }) {
  const report = useMemo(() => reconstructShopeeReport(detail), [detail]);
  const funnelReport = useMemo(() => reconstructShopeeFunnel(detail), [detail]);

  // Category mapping for this client — same source the live tab uses, so an
  // "Uncategorized" fix here persists and re-categorizes the view.
  const [productMaster, setProductMaster] = useState<ProductMasterEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    getProductMaster(detail.report.brandId)
      .then((rows) => {
        if (!cancelled) setProductMaster(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [detail.report.brandId]);

  const [produkSelections, setProdukSelections] = useState<MetricSelection[] | null>(null);
  const [keywordSelections, setKeywordSelections] = useState<MetricSelection[] | null>(null);
  const [dailyTrendSelections, setDailyTrendSelections] = useState<DailyTrendMetricSelection[] | null>(null);
  const [customMetrics, setCustomMetrics] = useState<MetricSelection[]>([]);
  const [itemPivotTab, setItemPivotTab] = useState<'produk' | 'keyword'>('produk');

  const deepDive = useMemo(
    () => reconstructShopeeDeepDive(detail, productMaster, { produkSelections, keywordSelections, dailyTrendSelections }),
    [detail, productMaster, produkSelections, keywordSelections, dailyTrendSelections],
  );

  const hasTokoData = detail.rows.some((r) => r.channel === 'toko');
  const hasLiveData = detail.rows.some((r) => r.channel === 'live');
  const hasTokoKeywordData = detail.rows.some((r) => r.channel === 'toko_keyword');

  async function handleSaveCategory(name: string, category: string, series: string) {
    await saveProductMasterEntry(detail.report.brandId, { namaProdukClean: name, category, series });
    setProductMaster((prev) => [...prev.filter((p) => p.namaProdukClean !== name), { namaProdukClean: name, category, series }]);
  }

  return (
    <div id="report-shopee-history">
      <div className="report-top">
        <div className="report-title">Performance Report</div>
        <div className="report-period">
          <PeriodCompareChip old={report.p1} cur={report.p2} onBrand />
        </div>
      </div>
      <div data-role="r-body">
        <ShopeeReportSections
          report={report}
          deepDive={deepDive}
          funnelReport={funnelReport}
          hasTokoData={hasTokoData}
          hasLiveData={hasLiveData}
          hasTokoKeywordData={hasTokoKeywordData}
          customMetrics={customMetrics}
          onAddCustomMetric={(sel) => setCustomMetrics((prev) => [...prev, sel])}
          onProdukSelectionsChange={setProdukSelections}
          onKeywordSelectionsChange={setKeywordSelections}
          onDailyTrendSelectionsChange={setDailyTrendSelections}
          itemPivotTab={itemPivotTab}
          onItemPivotTabChange={setItemPivotTab}
          onSaveCategory={handleSaveCategory}
        />
        <div className="empty-note">
          Section Pareto / Traffic / Conversion butuh file Product Performance — belum disimpan ke database, hanya tersedia saat laporan baru dibuat.
        </div>
      </div>
    </div>
  );
}

function MetaDetailView({ detail }: { detail: ReportDetail }) {
  const report = reconstructMetaReport(detail);
  const hasAnySection = Boolean(
    report.boost || report.nonBoost || report.boostAgeDemo || report.boostGenderDemo || report.ageDemo || report.genderDemo || (report.cpas && Object.keys(report.cpas).length),
  );
  return (
    <div id="report-meta-history">
      <div className="report-top">
        <div className="report-title">Performance Report</div>
        <div className="report-period">
          <PeriodCompareChip old={report.p1} cur={report.p2} onBrand />
        </div>
      </div>
      <div data-role="r-body">
        <PeriodWarningBanner message={report.periodWarning} />
        <PeriodWarningBanner message={report.reachWarning} />
        <PeriodWarningBanner message={report.reachApproxNote} />
        {!hasAnySection && <div className="empty-note">Tidak ada section yang bisa ditampilkan.</div>}
        {report.boost && <OverviewDetailedCard heading="Boost Post" badge="Meta Ads" overviewRows={report.boost.overviewRows} detailedRows={report.boost.detailedRows} allCols={report.boost.allCols} p1={report.p1} p2={report.p2} />}
        {report.boostAgeDemo && (
          <DemoBreakdownCard
            heading="Boost Post · Age Breakdown"
            badge={`data ${report.p2}`}
            rows={report.boostAgeDemo.rows}
            dimCol={report.boostAgeDemo.dimCol}
            allCols={report.boostAgeDemo.allCols}
            defaultCols={report.boostAgeDemo.defaultCols}
          />
        )}
        {report.boostGenderDemo && (
          <DemoBreakdownCard
            heading="Boost Post · Gender Breakdown"
            badge={`data ${report.p2}`}
            rows={report.boostGenderDemo.rows}
            dimCol={report.boostGenderDemo.dimCol}
            allCols={report.boostGenderDemo.allCols}
            defaultCols={report.boostGenderDemo.defaultCols}
          />
        )}
        {report.nonBoost && (
          <OverviewDetailedCard heading="Non-Boost Post" badge="Meta Ads" overviewRows={report.nonBoost.overviewRows} detailedRows={report.nonBoost.detailedRows} allCols={report.nonBoost.allCols} p1={report.p1} p2={report.p2} />
        )}
        {report.ageDemo && (
          <DemoBreakdownCard heading="Non-Boost Post · Age Breakdown" badge={`data ${report.p2}`} rows={report.ageDemo.rows} dimCol={report.ageDemo.dimCol} allCols={report.ageDemo.allCols} defaultCols={report.ageDemo.defaultCols} />
        )}
        {report.genderDemo && (
          <DemoBreakdownCard heading="Non-Boost Post · Gender Breakdown" badge={`data ${report.p2}`} rows={report.genderDemo.rows} dimCol={report.genderDemo.dimCol} allCols={report.genderDemo.allCols} defaultCols={report.genderDemo.defaultCols} />
        )}
        {report.cpas?.overall && (
          <OverviewDetailedCard heading="CPAS Marketplace" badge="Overall" overviewRows={report.cpas.overall.overviewRows} detailedRows={report.cpas.overall.detailedRows} allCols={report.cpas.overall.allCols} p1={report.p1} p2={report.p2} />
        )}
        {report.cpas?.ageDemo && (
          <DemoBreakdownCard heading="CPAS Marketplace · Age Breakdown" badge={`data ${report.p2}`} rows={report.cpas.ageDemo.rows} dimCol={report.cpas.ageDemo.dimCol} allCols={report.cpas.ageDemo.allCols} defaultCols={report.cpas.ageDemo.defaultCols} />
        )}
        {report.cpas?.genderDemo && (
          <DemoBreakdownCard heading="CPAS Marketplace · Gender Breakdown" badge={`data ${report.p2}`} rows={report.cpas.genderDemo.rows} dimCol={report.cpas.genderDemo.dimCol} allCols={report.cpas.genderDemo.allCols} defaultCols={report.cpas.genderDemo.defaultCols} />
        )}
        {report.cpas?.nv && (
          <OverviewDetailedCard heading="CPAS Marketplace · NV" badge="New Visitor" overviewRows={report.cpas.nv.overviewRows} detailedRows={report.cpas.nv.detailedRows} allCols={report.cpas.nv.allCols} p1={report.p1} p2={report.p2} />
        )}
        {report.cpas?.rm && (
          <OverviewDetailedCard heading="CPAS Marketplace · RM" badge="Retargeting" overviewRows={report.cpas.rm.overviewRows} detailedRows={report.cpas.rm.detailedRows} allCols={report.cpas.rm.allCols} p1={report.p1} p2={report.p2} />
        )}
      </div>
    </div>
  );
}

function TiktokDetailView({ detail }: { detail: ReportDetail }) {
  const report = reconstructTiktokReport(detail);
  return (
    <div id="report-tiktok-history">
      <div className="report-top">
        <div className="report-title">Performance Report</div>
        <div className="report-period">
          <PeriodCompareChip old={report.p1} cur={report.p2} onBrand />
        </div>
      </div>
      <div data-role="r-body">
        <PeriodWarningBanner message={report.periodWarning} />
        <div className="sec-block">
          <div className="sec-heading tiktok-heading">
            TikTok GMV Max <span className="sec-badge">Overall</span>
            <SectionDownloadButton />
          </div>
          <div style={{ padding: '0 1.4rem 1.4rem' }}>
            <KpiTable rows={report.rows} p1={report.p1} p2={report.p2} />
          </div>
        </div>
      </div>
    </div>
  );
}
