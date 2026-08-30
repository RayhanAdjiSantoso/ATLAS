import { categorizeProdukRows, mergeProdukOtomatis, type ProductMasterEntry } from '../../lib/shopeeDeepDive';
import { buildDailyTrendPivot, collectAdvertisedProductCodes, DEFAULT_DAILY_TREND_SELECTIONS, findUnadvertisedVariants, rankVariantsBySiapDikirim, type DailyTrendMetricSelection, type DailyTrendPivotRow, type VariantPerformanceRow } from '../../lib/shopeeDeepDiveInsights';
import { buildKeywordPivot, buildProdukPivot, DEFAULT_KEYWORD_SELECTIONS, pickDominantProdukMetric, type KeywordPivotRow, type MetricSelection, type ProdukPivotRow } from '../../lib/shopeeDeepDiveItemPivot';
import { buildPivotRows, calcLiveChannelMetrics, calcStandardChannelMetrics, CHANNEL_METRIC_DEFS, combineOverallMetrics, detectDominantChannel, LIVE_METRIC_DEFS, OVERALL_METRIC_DEFS, withChannelShare, type DominantChannel, type PivotRow } from '../../lib/shopeeDeepDivePivot';
import type { SheetRow } from '../../lib/types';

// ══════════════════════════════════════════════════════
// FASE 3 — SHOPEE DEEP-DIVE: assembles every pure-logic piece (lib/shopeeDeepDive*.ts)
// into the one report shape the UI renders. Mirrors the shopeeReport.ts /
// metaReport.ts pattern used by the rest of the app.
// ══════════════════════════════════════════════════════

export interface BuildShopeeDeepDiveReportInput {
  produkOld: SheetRow[];
  produkCur: SheetRow[];
  produkOtomatisOld: SheetRow[];
  produkOtomatisCur: SheetRow[];
  tokoOld: SheetRow[];
  tokoCur: SheetRow[];
  tokoKeywordOld: SheetRow[];
  tokoKeywordCur: SheetRow[];
  liveOld: SheetRow[];
  liveCur: SheetRow[];
  // Product Performance is a single, non-compared snapshot (spec: "opsional,
  // insight tambahan, tidak ikut dibandingkan 2 periode").
  productPerformanceRows: SheetRow[] | null;
  tingkatkanDenganIklanRows: SheetRow[] | null;
  overviewOldRows: SheetRow[] | null;
  overviewCurRows: SheetRow[] | null;
  productMaster: ProductMasterEntry[];
  // Total Omzet Toko (Pesanan Dibuat) for each period — the same figure
  // already collected for the original Shopee Ads summary — needed to
  // compute the item-level "Kontribusi Iklan" metric.
  omzetOld: number;
  omzetCur: number;
  // Which metric(s) each pivot displays. Omit to fall back to the spec's own
  // defaults (auto-picked dominant metric for produk; Biaya/Pesanan/CPP for
  // keyword; Pengunjung+Penjualan for the daily trend) — the UI passes an
  // explicit selection once the user picks one via the metric selector.
  produkSelections?: readonly MetricSelection[] | null;
  keywordSelections?: readonly MetricSelection[] | null;
  dailyTrendSelections?: readonly DailyTrendMetricSelection[] | null;
}

export interface ShopeeDeepDiveReport {
  overall: PivotRow[];
  produk: PivotRow[];
  toko: PivotRow[];
  live: PivotRow[];
  dominantChannel: DominantChannel;
  produkPivot: ProdukPivotRow[];
  produkSelections: readonly MetricSelection[];
  keywordPivot: KeywordPivotRow[];
  keywordSelections: readonly MetricSelection[];
  uncategorized: string[];
  hasProductPerformanceData: boolean;
  unadvertisedVariants: VariantPerformanceRow[];
  tingkatkanDenganIklanRows: SheetRow[];
  dailyTrendPivot: DailyTrendPivotRow[];
  dailyTrendSelections: readonly DailyTrendMetricSelection[];
}

export function buildShopeeDeepDiveReport(input: BuildShopeeDeepDiveReportInput): ShopeeDeepDiveReport {
  const produkMergedOld = mergeProdukOtomatis(input.produkOld, input.produkOtomatisOld);
  const produkMergedCur = mergeProdukOtomatis(input.produkCur, input.produkOtomatisCur);

  const catOld = categorizeProdukRows(produkMergedOld, 'Nama Iklan', input.productMaster);
  const catCur = categorizeProdukRows(produkMergedCur, 'Nama Iklan', input.productMaster);

  let produkMOld = calcStandardChannelMetrics(produkMergedOld);
  let produkMCur = calcStandardChannelMetrics(produkMergedCur);
  let tokoMOld = calcStandardChannelMetrics(input.tokoOld);
  let tokoMCur = calcStandardChannelMetrics(input.tokoCur);
  let liveMOld = calcLiveChannelMetrics(input.liveOld);
  let liveMCur = calcLiveChannelMetrics(input.liveCur);
  // Overall = the 3 channels' own totals combined (not "concatenate every
  // raw row and re-sum columns" — Live's export uses "Penonton"/"Pesanan"
  // instead of "Dilihat"/"Konversi", so that approach silently dropped
  // Live's audience/orders from Overall's Dilihat/Pesanan).
  const overallMOld = combineOverallMetrics(produkMOld, tokoMOld, liveMOld);
  const overallMCur = combineOverallMetrics(produkMCur, tokoMCur, liveMCur);
  // %Budget/%Revenue need Overall's own biaya/penjualan as the denominator,
  // only available now that Overall itself has been combined above.
  produkMOld = withChannelShare(produkMOld, overallMOld.biaya, overallMOld.penjualan);
  produkMCur = withChannelShare(produkMCur, overallMCur.biaya, overallMCur.penjualan);
  tokoMOld = withChannelShare(tokoMOld, overallMOld.biaya, overallMOld.penjualan);
  tokoMCur = withChannelShare(tokoMCur, overallMCur.biaya, overallMCur.penjualan);
  liveMOld = withChannelShare(liveMOld, overallMOld.biaya, overallMOld.penjualan);
  liveMCur = withChannelShare(liveMCur, overallMCur.biaya, overallMCur.penjualan);

  const dominantChannel = detectDominantChannel(produkMOld, produkMCur, tokoMOld, tokoMCur);
  const produkSelections = input.produkSelections && input.produkSelections.length ? input.produkSelections : [{ kind: 'builtin' as const, key: pickDominantProdukMetric(produkMOld, produkMCur) }];
  const keywordSelections = input.keywordSelections && input.keywordSelections.length ? input.keywordSelections : DEFAULT_KEYWORD_SELECTIONS;
  const dailyTrendSelections = input.dailyTrendSelections && input.dailyTrendSelections.length ? input.dailyTrendSelections : DEFAULT_DAILY_TREND_SELECTIONS;

  const advertisedCodes = collectAdvertisedProductCodes(produkMergedOld, produkMergedCur, input.tokoOld, input.tokoCur, input.liveOld, input.liveCur, input.tokoKeywordOld, input.tokoKeywordCur);
  const rankedVariants = input.productPerformanceRows ? rankVariantsBySiapDikirim(input.productPerformanceRows) : [];

  return {
    overall: buildPivotRows(overallMOld, overallMCur, OVERALL_METRIC_DEFS),
    produk: buildPivotRows(produkMOld, produkMCur, CHANNEL_METRIC_DEFS),
    toko: buildPivotRows(tokoMOld, tokoMCur, CHANNEL_METRIC_DEFS),
    live: buildPivotRows(liveMOld, liveMCur, LIVE_METRIC_DEFS),
    dominantChannel,
    produkPivot: buildProdukPivot(catOld.rows, catCur.rows, produkSelections, input.omzetOld, input.omzetCur),
    produkSelections,
    keywordPivot: buildKeywordPivot(input.tokoKeywordOld, input.tokoKeywordCur, keywordSelections, input.omzetOld, input.omzetCur),
    keywordSelections,
    uncategorized: [...new Set([...catOld.uncategorized, ...catCur.uncategorized])],
    hasProductPerformanceData: Boolean(input.productPerformanceRows),
    unadvertisedVariants: findUnadvertisedVariants(rankedVariants, advertisedCodes),
    tingkatkanDenganIklanRows: input.tingkatkanDenganIklanRows ?? [],
    dailyTrendPivot: input.overviewOldRows || input.overviewCurRows ? buildDailyTrendPivot(input.overviewOldRows ?? [], input.overviewCurRows ?? [], dailyTrendSelections) : [],
    dailyTrendSelections,
  };
}
