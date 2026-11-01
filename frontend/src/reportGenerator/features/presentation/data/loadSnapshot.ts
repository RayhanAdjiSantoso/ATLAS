import api from '../../../../api/client.js';
import { fetchReport } from '../../google/googleAds';
import { getProductMaster, getReportDetail } from '../../reports/api';
import { reconstructMetaReport, reconstructShopeeDeepDive, reconstructShopeeFunnel, reconstructShopeeReport, reconstructTiktokReport } from '../../reports/reconstruct';
import type { SheetRow } from '../../../lib/types';
import { periodLabelFromDates } from '../format';
import { samePeriod } from '../periods';
import type { BlockSource, ChannelKey, DataBlock, MissingAnalysis, PresentationConfig, Snapshot, SourceStatus } from '../types';
import { buildBusinessBlocks, type MonthGrid, type SalesChannel, type SalesGrid } from './businessBlocks';
import { buildGoogleBlocks } from './googleBlocks';
import { addBlock, chartBlock, deltaOf, kpiBlock, L, missing, money } from './helpers';
import { buildMetaBlocks } from './metaBlocks';
import { SHOPEE_DAILY_SELECTIONS, SHOPEE_KEYWORD_SELECTIONS, SHOPEE_PRODUK_SELECTIONS, buildShopeeBlocks } from './shopeeBlocks';
import { buildTiktokBlocks } from './tiktokBlocks';

// Builds a snapshot from ATLAS's existing sources: a saved report_run per channel
// (rebuilt through features/reports/reconstruct.ts, exactly as Riwayat Laporan
// reopens one), the Google Ads report endpoint, and Brand Tracking's revenue
// data. One source failing or having no data never stops the others: it becomes
// a "not available" status, and no slide is planned for it.

interface ChannelTotals {
  source: BlockSource;
  label: string;
  definition: string;
  spend: { old: number | null; cur: number | null };
  revenue: { old: number | null; cur: number | null } | null;
}

const CHANNEL_LABEL: Record<ChannelKey, string> = { meta: 'Meta Ads', shopee: 'Shopee Ads', tiktok: 'TikTok GMV Max', google: 'Google Ads' };
const errText = (err: unknown) => (err instanceof Error ? err.message : 'Gagal memuat data.');

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endKey = end.slice(0, 7);
  for (let i = 0; i < 13; i += 1) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= endKey) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function shiftMonth(month: string, by: number): string {
  const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthTick = (month: string) => `${SHORT_MONTH[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;

function mergeGrids(grids: SalesGrid[]): SalesGrid {
  const out: SalesGrid = {};
  for (const g of grids) for (const [k, days] of Object.entries(g)) out[k] = { ...(out[k] ?? {}), ...days };
  return out;
}

function sumSpend(list: ChannelTotals[], k: 'old' | 'cur'): number | null {
  return list.reduce<number | null>((a, t) => (t.spend[k] === null ? a : (a ?? 0) + (t.spend[k] as number)), null);
}

export async function loadSnapshot(config: PresentationConfig): Promise<Snapshot> {
  const blocks: Record<string, DataBlock> = {};
  const gaps: MissingAnalysis[] = [];
  const sources: SourceStatus[] = [];
  const totals: ChannelTotals[] = [];
  let metaSubs: Snapshot['metaSubs'] = [];
  let shopeeChannels: Snapshot['shopeeChannels'] = [];
  const { period, brandId } = config;

  // A report with no stored dates (older saves) cannot be shown to differ.
  const differsFromDeck = (detail: { report: { periodCurStart: string | null; periodCurEnd: string | null; periodOldStart: string | null; periodOldEnd: string | null } }) => {
    const r = detail.report;
    if (!r.periodCurStart || !r.periodCurEnd) return true;
    return r.periodCurStart !== period.curStart || r.periodCurEnd !== period.curEnd || r.periodOldStart !== period.oldStart || r.periodOldEnd !== period.oldEnd;
  };

  const ownLabels = (p: { curStart: string; curEnd: string; oldStart: string; oldEnd: string }) => (
    samePeriod(p, period)
      ? { old: period.oldLabel, cur: period.curLabel }
      : { old: periodLabelFromDates(p.oldStart, p.oldEnd, config.lang), cur: periodLabelFromDates(p.curStart, p.curEnd, config.lang) }
  );

  const absent = (key: ChannelKey, message: string, importTo: string = key) => {
    sources.push({ source: key, label: CHANNEL_LABEL[key], status: 'unavailable', message });
    gaps.push(missing(`${key}.all`, key, L(CHANNEL_LABEL[key]), message, importTo));
  };

  async function loadMeta() {
    const { enabled, runId } = config.channels.meta;
    if (!enabled) return;
    if (!runId) return absent('meta', 'Belum ada laporan Meta Ads tersimpan untuk periode ini.');
    try {
      const detail = await getReportDetail(runId);
      const report = reconstructMetaReport(detail);
      const built = buildMetaBlocks(report);
      if (!built.subs.length) return absent('meta', 'Laporan Meta Ads tersimpan tidak berisi data yang bisa dibaca.');
      Object.assign(blocks, built.blocks);
      gaps.push(...built.missing);
      metaSubs = built.subs.map((s) => ({ key: s.key, label: s.label }));
      sources.push({ source: 'meta', label: CHANNEL_LABEL.meta, status: 'ok', periodOld: report.p1, periodCur: report.p2, periodWarning: report.periodWarning, periodMismatch: differsFromDeck(detail), runId });
      totals.push({ source: 'meta', label: 'Meta Ads', definition: 'Purchase Value', spend: built.totalSpend, revenue: built.revenue });
    } catch (err) {
      sources.push({ source: 'meta', label: CHANNEL_LABEL.meta, status: 'error', message: errText(err), runId });
    }
  }

  async function loadShopee() {
    const { enabled, runId } = config.channels.shopee;
    if (!enabled) return;
    if (!runId) return absent('shopee', 'Belum ada laporan Shopee Ads tersimpan untuk periode ini.');
    try {
      const [detail, master] = await Promise.all([getReportDetail(runId), getProductMaster(brandId).catch(() => [])]);
      const report = reconstructShopeeReport(detail);
      const deep = reconstructShopeeDeepDive(detail, master, { produkSelections: SHOPEE_PRODUK_SELECTIONS, keywordSelections: SHOPEE_KEYWORD_SELECTIONS, dailyTrendSelections: SHOPEE_DAILY_SELECTIONS });
      const funnel = reconstructShopeeFunnel(detail);
      const built = buildShopeeBlocks(report, deep, funnel);
      if (!built.ids.kpi) return absent('shopee', 'Laporan Shopee Ads tersimpan tidak berisi data yang bisa dibaca.');
      Object.assign(blocks, built.blocks);
      gaps.push(...built.missing);
      shopeeChannels = built.channels.filter((c) => c.kpi).map((c) => ({ key: c.key, label: c.label }));
      sources.push({ source: 'shopee', label: CHANNEL_LABEL.shopee, status: 'ok', periodOld: report.p1, periodCur: report.p2, periodWarning: report.periodWarning, periodMismatch: differsFromDeck(detail), runId });
      totals.push({ source: 'shopee', label: 'Shopee Ads', definition: 'GMV (Ads)', spend: built.totalSpend, revenue: built.revenue });
    } catch (err) {
      sources.push({ source: 'shopee', label: CHANNEL_LABEL.shopee, status: 'error', message: errText(err), runId });
    }
  }

  async function loadTiktok() {
    const { enabled, runId } = config.channels.tiktok;
    if (!enabled) return;
    if (!runId) return absent('tiktok', 'Belum ada laporan TikTok GMV Max tersimpan untuk periode ini.');
    try {
      const detail = await getReportDetail(runId);
      const report = reconstructTiktokReport(detail);
      const rowsOf = (role: string) => detail.rows.filter((r) => r.period_role === role).map((r) => (r.extra as SheetRow | null) ?? {});
      const built = buildTiktokBlocks(report, rowsOf('old'), rowsOf('cur'));
      if (!built.ids.kpi) return absent('tiktok', 'Laporan TikTok GMV Max tersimpan tidak berisi data yang bisa dibaca.');
      Object.assign(blocks, built.blocks);
      sources.push({ source: 'tiktok', label: CHANNEL_LABEL.tiktok, status: 'ok', periodOld: report.p1, periodCur: report.p2, periodWarning: report.periodWarning, periodMismatch: differsFromDeck(detail), runId });
      totals.push({ source: 'tiktok', label: 'TikTok GMV Max', definition: 'Gross Revenue', spend: built.totalSpend, revenue: built.revenue });
    } catch (err) {
      sources.push({ source: 'tiktok', label: CHANNEL_LABEL.tiktok, status: 'error', message: errText(err), runId });
    }
  }

  async function loadGoogle() {
    if (!config.channels.google.enabled) return;
    try {
      const own = config.channels.google.period ?? period;
      const report = await fetchReport(brandId, { oldStart: own.oldStart, oldEnd: own.oldEnd, curStart: own.curStart, curEnd: own.curEnd });
      const empty = !report.accounts?.length || (report.cur.totals.cost === 0 && report.old.totals.cost === 0 && report.cur.totals.impressions === 0);
      if (empty) return absent('google', 'Akun Google Ads belum terhubung atau belum punya data pada periode ini.');
      const labels = ownLabels(own);
      const built = buildGoogleBlocks(report, labels.old, labels.cur);
      Object.assign(blocks, built.blocks);
      gaps.push(...built.missing);
      // Data that stops before the period ends would read as a real collapse.
      const lastDate = (report.coverage ?? []).map((c) => c.last_date).sort().pop();
      const incomplete = lastDate && lastDate < own.curEnd ? `Data Google Ads baru tersedia sampai ${lastDate}, belum mencakup seluruh periode, sehingga perubahannya belum sebanding.` : null;
      sources.push({ source: 'google', label: CHANNEL_LABEL.google, status: 'ok', periodOld: labels.old, periodCur: labels.cur, periodMismatch: !samePeriod(own, period), periodWarning: incomplete, currency: built.currency });
      totals.push({ source: 'google', label: 'Google Ads', definition: 'Conversion Value', spend: built.totalSpend, revenue: built.revenue });
    } catch (err) {
      sources.push({ source: 'google', label: CHANNEL_LABEL.google, status: 'error', message: errText(err) });
    }
  }

  let businessRevenue: { old: number | null; cur: number | null } | null = null;
  async function loadBusiness() {
    if (!config.includeBusiness) return;
    const label = 'Business Overview';
    try {
      const entries = (month: string): Promise<SalesGrid> => api.get('/daily-tracking/entries', { params: { brandId, month } }).then((r: { data: { sales?: SalesGrid } }) => r.data.sales ?? {});
      const own = config.businessPeriod ?? period;
      const labels = ownLabels(own);
      const curMonths = monthsBetween(own.curStart, own.curEnd);
      const oldMonths = monthsBetween(own.oldStart, own.oldEnd);
      const lastMonth = curMonths[curMonths.length - 1];
      const historyMonths = Array.from({ length: 6 }, (_, i) => shiftMonth(lastMonth, i - 5));
      const wanted = [...new Set([...curMonths, ...oldMonths, ...historyMonths])];
      const [channelRes, grids] = await Promise.all([
        api.get('/daily-tracking/channels', { params: { brandId } }),
        Promise.all(wanted.map(async (m) => [m, await entries(m)] as const)),
      ]);
      const byMonth = new Map(grids);
      const channels: SalesChannel[] = channelRes.data.sales ?? [];
      const history: MonthGrid[] = historyMonths.map((m) => ({ month: m, label: monthTick(m), grid: byMonth.get(m) ?? {} }));
      const built = buildBusinessBlocks({
        channels,
        oldGrid: mergeGrids(oldMonths.map((m) => byMonth.get(m) ?? {})),
        curGrid: mergeGrids(curMonths.map((m) => byMonth.get(m) ?? {})),
        history,
        oldStart: own.oldStart, oldEnd: own.oldEnd, curStart: own.curStart, curEnd: own.curEnd,
        p1: labels.old, p2: labels.cur,
      });
      if (!built.ids.kpi) {
        const message = 'Revenue Data di Brand Tracking kosong untuk periode ini.';
        sources.push({ source: 'business', label, status: 'unavailable', message });
        gaps.push(missing('business.all', 'business', L('Sales Performance & Channel Revenue'), message));
        return;
      }
      Object.assign(blocks, built.blocks);
      businessRevenue = built.revenue;
      // Data that stops before the period ends would read as a real collapse.
      const curGrid = mergeGrids(curMonths.map((m) => byMonth.get(m) ?? {}));
      const lastFilled = Object.values(curGrid).flatMap((days) => Object.entries(days).filter(([, v]) => v?.revenue != null).map(([d]) => d.slice(0, 10))).filter((d) => d <= own.curEnd).sort().pop();
      const incomplete = lastFilled && lastFilled < own.curEnd ? `Revenue Data baru terisi sampai ${lastFilled}, belum mencakup seluruh periode, sehingga perubahannya belum sebanding.` : null;
      sources.push({ source: 'business', label, status: 'ok', periodOld: labels.old, periodCur: labels.cur, periodMismatch: !samePeriod(own, period), periodWarning: incomplete });
    } catch (err) {
      const denied = (err as { response?: { status?: number } })?.response?.status === 403;
      const message = denied ? 'Akun ini tidak punya akses ke modul Brand Tracking.' : errText(err);
      sources.push({ source: 'business', label, status: denied ? 'unavailable' : 'error', message });
      gaps.push(missing('business.all', 'business', L('Sales Performance & Channel Revenue'), message));
    }
  }

  await Promise.all([loadMeta(), loadShopee(), loadTiktok(), loadGoogle(), loadBusiness()]);

  // Cross-channel. Spend is one definition everywhere, so it can be totalled, but
  // only over one period. Revenue never is: each platform attributes differently,
  // so every line names its own definition and they are not added together. A
  // channel on other dates says so in its own row.
  const bySource = new Map(sources.map((src) => [src.source, src]));
  const mixedPeriods = sources.some((src) => src.status === 'ok' && src.periodMismatch);
  const rowLabel = (source: BlockSource, label: string) => {
    const src = bySource.get(source);
    return src?.periodMismatch ? `${label} (${src.periodCur} vs ${src.periodOld})` : label;
  };
  const mixedNote = mixedPeriods ? L('Periode antarchannel berbeda, sehingga angkanya tidak sebanding dan total spend tidak dihitung.', 'Channels cover different periods, so these figures are not comparable and no spend total is shown.') : undefined;
  const withSpend = totals.filter((t) => t.spend.cur !== null || t.spend.old !== null);
  if (withSpend.length) {
    const rows = withSpend.map((t) => ({ label: rowLabel(t.source, t.label), old: money(t.spend.old), cur: money(t.spend.cur), delta: deltaOf(t.spend.old, t.spend.cur, 'neutral') }));
    if (withSpend.length > 1 && !mixedPeriods) rows.unshift({ label: 'Total Ad Spend', old: money(sumSpend(withSpend, 'old')), cur: money(sumSpend(withSpend, 'cur')), delta: deltaOf(sumSpend(withSpend, 'old'), sumSpend(withSpend, 'cur'), 'neutral') });
    addBlock(blocks, kpiBlock('overview.spend.kpi', 'overview', L('Advertising Spend'), rows, mixedNote));
    addBlock(blocks, chartBlock('overview.spend.chart', 'overview', L('Advertising Spend per Channel', 'Advertising Spend by Channel'), 'bar', withSpend.map((t) => t.label), [
      { label: period.oldLabel, role: 'old', values: withSpend.map((t) => t.spend.old) },
      { label: period.curLabel, role: 'cur', values: withSpend.map((t) => t.spend.cur) },
    ], 'money', mixedNote));
    // A share of spend across different periods would not mean anything.
    if (withSpend.length > 1 && !mixedPeriods) {
      addBlock(blocks, chartBlock('overview.spend.share', 'overview', L('Porsi Spend per Channel', 'Spend Share by Channel'), 'donut', withSpend.map((t) => t.label), [{ label: period.curLabel, values: withSpend.map((t) => t.spend.cur) }], 'money'));
    }
  }

  const revenue = businessRevenue as { old: number | null; cur: number | null } | null;
  const execRows = [
    ...(revenue ? [{ label: rowLabel('business', 'Revenue (Brand Tracking)'), old: money(revenue.old), cur: money(revenue.cur), delta: deltaOf(revenue.old, revenue.cur, 'higher-better') }] : []),
    ...(withSpend.length && !mixedPeriods ? [{ label: 'Total Ad Spend', old: money(sumSpend(withSpend, 'old')), cur: money(sumSpend(withSpend, 'cur')), delta: deltaOf(sumSpend(withSpend, 'old'), sumSpend(withSpend, 'cur'), 'neutral') }] : []),
    ...totals.flatMap((t) => (t.revenue ? [{ label: rowLabel(t.source, `${t.label} · ${t.definition}`), old: money(t.revenue.old), cur: money(t.revenue.cur), delta: deltaOf(t.revenue.old, t.revenue.cur, 'higher-better') }] : [])),
  ];
  addBlock(blocks, kpiBlock('overview.exec', 'overview', L('Ringkasan KPI', 'KPI Summary'), execRows, mixedNote ?? L('Tiap channel memakai definisi revenue masing-masing, sehingga angkanya tidak dijumlahkan.', 'Each channel uses its own revenue definition, so these figures are not added together.')));

  return { builtAt: new Date().toISOString(), sources, blocks, missing: gaps, metaSubs, shopeeChannels };
}
