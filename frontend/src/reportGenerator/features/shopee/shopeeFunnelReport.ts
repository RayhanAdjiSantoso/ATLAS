import {
  addFunnelChannelSums,
  buildFunnelTree,
  buildFunnelValues,
  funnelMetrics,
  sumFunnelChannel,
  type FunnelTreeRow,
  type FunnelValueRow,
} from '../../lib/shopeeFunnel';
import { buildSymptomSummary, type SymptomSummary } from '../../lib/shopeeFunnelSummary';
import {
  buildPareto,
  buildPotentialProducts,
  buildProductChartPoints,
  buildProductRankings,
  CONVERSION_METRIC_DEFS,
  DEFAULT_PARETO_RANGE,
  hasVisitorsCol,
  mergeProductPerfBySales,
  parseProductPerfRows,
  PRODUCT_CHART_GROUPS,
  selectParetoMonths,
  TRAFFIC_METRIC_DEFS,
  type ParetoRangeSelection,
  type ParetoRow,
  type PotentialProduct,
  type ProductChartGroupDef,
  type ProductMetricRanking,
  type ProductChartPoint,
  type ProductPerfMonth,
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
  // Every Product Performance file already saved to this brand's library,
  // one entry per month, independent of the old/cur periods above. Pareto
  // sums Sales (Confirmed Order) per product across whichever of these
  // paretoRange selects, instead of using productPerfCur alone. Omit/empty
  // falls back to productPerfCur (e.g. reconstructed history reports, which
  // never carry Product Performance data at all).
  productPerfAllMonths?: ProductPerfMonth[] | null;
  // Which of the months above to include — "Semua Bulan" (default), a
  // Bulan Awal–Akhir range, or a single month. See selectParetoMonths.
  paretoRange?: ParetoRangeSelection | null;
}

// One ad channel's current-period contribution — feeds the "Kontribusi Antar
// Channel" chart. `roas` is carried for reference only; the chart's
// effectiveness signal is the efficiency index (GMV share ÷ spend share),
// which is robust to a channel with tiny spend catching one big order.
export interface ChannelMixEntry {
  key: 'produk' | 'toko' | 'live';
  label: string;
  color: string;
  spend: number;
  gmv: number;
  roas: number;
}

// One ad channel's own funnel, so each channel section can show which stage
// moved *its* GMV — the account-level tree can't tell you whether a drop came
// from Iklan Produk or Iklan Toko. Live has no impression/click columns, so it
// only gets a tree when its export happens to carry them.
export interface ChannelFunnel {
  key: 'produk' | 'toko' | 'live';
  label: string;
  // The same 21 funnel values Fundamental Analysis reads, scoped to this
  // channel. The channel tables used to come from a different source that
  // carried a shorter, differently-named metric set, so moving between
  // Fundamental and a channel meant re-learning the table.
  values: FunnelValueRow[];
  tree: FunnelTreeRow[];
  symptom: SymptomSummary;
}

export interface ShopeeFunnelReport {
  values: FunnelValueRow[];
  tree: FunnelTreeRow[];
  // Per-channel funnels, in the same order the channel sections render.
  channels: ChannelFunnel[];
  // Plain-language read of the funnel movement (headline + points + verdict).
  symptom: SymptomSummary;
  // Current-period spend/GMV per ad channel (only channels with data).
  channelMix: ChannelMixEntry[];
  // Iklan Live GMV, shown as a footnote outside the funnel tree (Live has no
  // impression/click columns so it can't join the tree, but its revenue
  // shouldn't vanish from view).
  liveGmv: { old: number; cur: number; hasData: boolean };
  pareto: ParetoRow[];
  traffic: ProductMetricRanking[];
  conversion: ProductMetricRanking[];
  hasProductPerfCur: boolean;
  hasProductPerfOld: boolean;
  // Product Analysis charts: one %Change series per metric pair, plus the
  // single-period Top 5. Keyed by pair id so the section can look one up
  // without depending on array order.
  productCharts: { group: ProductChartGroupDef; points: ProductChartPoint[] }[];
  potentialProducts: PotentialProduct[];
  // False when the export has no plain "Pengunjung Produk" column — the
  // Visit → ATC chart says so rather than drawing a row of zero bars.
  hasVisitorsCol: boolean;
  // Every month Pareto could draw from (sorted ascending) — feeds the
  // "Semua Bulan / rentang / satu bulan" picker's month dropdowns.
  paretoAvailableMonths: string[];
}

function sumLiveGmv(rows: SheetRow[]): number {
  const col = findShopeeCol(rows, 'omzet penjualan');
  if (!col) return 0;
  return rows.reduce((s, r) => s + parseShopeeNum(r[col]), 0);
}

function mixEntry(key: ChannelMixEntry['key'], label: string, color: string, spend: number, gmv: number): ChannelMixEntry {
  return { key, label, color, spend, gmv, roas: spend > 0 ? gmv / spend : 0 };
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
  const allMonths = input.productPerfAllMonths ?? [];
  const selectedMonths = selectParetoMonths(allMonths, input.paretoRange ?? DEFAULT_PARETO_RANGE);
  const paretoRecords = selectedMonths.length ? mergeProductPerfBySales(selectedMonths.map((m) => parseProductPerfRows(m.rows))) : perfCur;

  // Current-period channel mix — Iklan Produk always present; Toko / Live only
  // when the user uploaded that channel. Live GMV uses the same "Omzet
  // Penjualan" column sumLiveGmv reads.
  const produkCurSums = sumFunnelChannel(input.produkCur);
  // Segment fills carry a white percentage label, so they are the platform hues
  // one step darker: #ee4d2d and #0d9488 put white at 3.66:1 and 3.74:1, which
  // fails AA at the 11px the label renders at.
  const channelMix: ChannelMixEntry[] = [mixEntry('produk', 'Iklan Produk', '#c93b1c', produkCurSums.spend, produkCurSums.gmv)];
  if (input.tokoOld.length || input.tokoCur.length) {
    const t = sumFunnelChannel(input.tokoCur);
    channelMix.push(mixEntry('toko', 'Iklan Toko', '#0f766e', t.spend, t.gmv));
  }
  if (input.liveOld.length || input.liveCur.length) {
    channelMix.push(mixEntry('live', 'Iklan Live', '#7c3aed', sumFunnelChannel(input.liveCur).spend, liveCurGmv));
  }

  // A channel only earns a tree if it actually reports the funnel columns —
  // Iklan Live normally reports viewers, not impressions/clicks, and an
  // all-zero tree would read as a real collapse rather than "no data".
  const channelFunnel = (key: ChannelFunnel['key'], label: string, oldRows: SheetRow[], curRows: SheetRow[]): ChannelFunnel | null => {
    const so = sumFunnelChannel(oldRows);
    const sc = sumFunnelChannel(curRows);
    if (!(so.impressions || sc.impressions || so.clicks || sc.clicks)) return null;
    const co = funnelMetrics(so, input.omzetOld);
    const cc = funnelMetrics(sc, input.omzetCur);
    return { key, label, values: buildFunnelValues(co, cc), tree: buildFunnelTree(co, cc), symptom: buildSymptomSummary(co, cc) };
  };
  const channels = [
    channelFunnel('produk', 'Iklan Produk', input.produkOld, input.produkCur),
    channelFunnel('toko', 'Iklan Toko', input.tokoOld, input.tokoCur),
    channelFunnel('live', 'Iklan Live', input.liveOld, input.liveCur),
  ].filter((c): c is ChannelFunnel => c !== null);

  return {
    values: buildFunnelValues(mOld, mCur),
    tree: buildFunnelTree(mOld, mCur),
    channels,
    symptom: buildSymptomSummary(mOld, mCur),
    channelMix: channelMix.filter((e) => e.spend > 0 || e.gmv > 0),
    liveGmv: { old: liveOldGmv, cur: liveCurGmv, hasData: liveOldGmv > 0 || liveCurGmv > 0 },
    pareto: buildPareto(paretoRecords),
    traffic: buildProductRankings(perfOld, perfCur, TRAFFIC_METRIC_DEFS),
    conversion: buildProductRankings(perfOld, perfCur, CONVERSION_METRIC_DEFS),
    hasProductPerfCur: perfCur.length > 0,
    hasProductPerfOld: perfOld.length > 0,
    productCharts: PRODUCT_CHART_GROUPS.map((group) => ({ group, points: buildProductChartPoints(perfOld, perfCur, group) })),
    potentialProducts: buildPotentialProducts(perfCur, 10),
    hasVisitorsCol: input.productPerfCur ? hasVisitorsCol(input.productPerfCur) : false,
    paretoAvailableMonths: [...new Set(allMonths.map((m) => m.month))].sort(),
  };
}
