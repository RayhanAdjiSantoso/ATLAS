import {
  addFunnelChannelSums,
  buildFunnelTree,
  buildFunnelValues,
  funnelMetrics,
  sumFunnelChannel,
  type FunnelTreeRow,
  type FunnelValueRow,
} from '../../lib/shopeeFunnel';
import {
  buildPareto,
  buildProductRankings,
  CONVERSION_METRIC_DEFS,
  parseProductPerfRows,
  TRAFFIC_METRIC_DEFS,
  type ParetoRow,
  type ProductMetricRanking,
} from '../../lib/shopeeProductAnalysis';
import { findShopeeCol, parseShopeeNum } from '../../lib/shopeeAds';
import type { SheetRow } from '../../lib/types';

// ══════════════════════════════════════════════════════
// SHOPEE ADS — assembles the 4 "manual report" sections (Fundamental /
// Pareto / Traffic / Conversion) into one report shape the UI renders.
// Called alongside buildShopeeReport + buildShopeeDeepDiveReport in
// ShopeeTab.generate(). Mirrors the shopeeDeepDiveReport.ts pattern.
// ══════════════════════════════════════════════════════

export interface BuildShopeeFunnelReportInput {
  // Fundamental — Iklan Produk (already merged with Produk Otomatis by the
  // caller) + Iklan Toko, 2 periods. Live is footnote-only.
  produkOld: SheetRow[];
  produkCur: SheetRow[];
  tokoOld: SheetRow[];
  tokoCur: SheetRow[];
  liveOld: SheetRow[];
  liveCur: SheetRow[];
  // Total Omzet Toko (Pesanan Dibuat) — the "GMV (Overall)" node.
  omzetOld: number;
  omzetCur: number;
  // Pareto / Traffic / Conversion — "Produk dengan Performa Terbaik" sheet
  // rows for each period. Old may be null (Pareto still works; Traffic /
  // Conversion fall back to single-period).
  productPerfOld: SheetRow[] | null;
  productPerfCur: SheetRow[] | null;
}

export interface ShopeeFunnelReport {
  values: FunnelValueRow[];
  tree: FunnelTreeRow[];
  // Iklan Live GMV, shown as a footnote outside the funnel tree (Live has no
  // impression/click columns so it can't join the tree, but its revenue
  // shouldn't vanish from view).
  liveGmv: { old: number; cur: number; hasData: boolean };
  pareto: ParetoRow[];
  traffic: ProductMetricRanking[];
  conversion: ProductMetricRanking[];
  hasProductPerfCur: boolean;
  hasProductPerfOld: boolean;
}

function sumLiveGmv(rows: SheetRow[]): number {
  const col = findShopeeCol(rows, 'omzet penjualan');
  if (!col) return 0;
  return rows.reduce((s, r) => s + parseShopeeNum(r[col]), 0);
}

export function buildShopeeFunnelReport(input: BuildShopeeFunnelReportInput): ShopeeFunnelReport {
  const sumsOld = addFunnelChannelSums(sumFunnelChannel(input.produkOld), sumFunnelChannel(input.tokoOld));
  const sumsCur = addFunnelChannelSums(sumFunnelChannel(input.produkCur), sumFunnelChannel(input.tokoCur));
  const mOld = funnelMetrics(sumsOld, input.omzetOld);
  const mCur = funnelMetrics(sumsCur, input.omzetCur);

  const liveOldGmv = sumLiveGmv(input.liveOld);
  const liveCurGmv = sumLiveGmv(input.liveCur);

  const perfOld = input.productPerfOld ? parseProductPerfRows(input.productPerfOld) : [];
  const perfCur = input.productPerfCur ? parseProductPerfRows(input.productPerfCur) : [];

  return {
    values: buildFunnelValues(mOld, mCur),
    tree: buildFunnelTree(mOld, mCur),
    liveGmv: { old: liveOldGmv, cur: liveCurGmv, hasData: liveOldGmv > 0 || liveCurGmv > 0 },
    pareto: buildPareto(perfCur),
    traffic: buildProductRankings(perfOld, perfCur, TRAFFIC_METRIC_DEFS),
    conversion: buildProductRankings(perfOld, perfCur, CONVERSION_METRIC_DEFS),
    hasProductPerfCur: perfCur.length > 0,
    hasProductPerfOld: perfOld.length > 0,
  };
}
