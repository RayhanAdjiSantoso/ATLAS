import { isBoostRow } from '../meta/metaReport';
import { findCol } from '../../lib/columns';
import { parseNum, splitByDayRange, splitMonths } from '../../lib/meta';
import { parseShopeeNum } from '../../lib/shopeeAds';
import { tiktokNum } from '../../lib/tiktok';
import type { SheetRow } from '../../lib/types';
import type { MetaAdRowInput, PeriodRole, ShopeeAdRowInput, TiktokAdRowInput } from './types';

// ══════════════════════════════════════════════════════
// Raw parsed rows (SheetRow[], keyed by the source file's original column
// headers) -> the flat row shape ads_reports.{shopee,meta,tiktok}_ad_rows
// expects. A handful of "core metric" columns are promoted to real columns
// (for SQL-side querying); everything else — including every promoted
// column's own original value — is kept verbatim in `extra` so a saved row
// can be losslessly rehydrated back into a SheetRow for Report History (see
// reconstruct.ts), without needing the original uploaded file.
// ══════════════════════════════════════════════════════

// Finds a header by trying exact (case/whitespace-insensitive) matches
// first, falling back to substring matches — needed because Shopee's export
// has many near-duplicate headers (e.g. "Dilihat" vs "Jumlah Produk
// Dilihat", "Konversi" vs "Konversi Langsung") where a plain substring search
// would grab the wrong column.
function pickCol(headers: string[], opts: { exact?: string[]; includes?: string[]; excludes?: string[] }): string | null {
  const exact = (opts.exact ?? []).map((s) => s.toLowerCase().trim());
  for (const h of headers) {
    if (exact.includes(h.toLowerCase().trim())) return h;
  }
  if (opts.includes) {
    const includes = opts.includes.map((s) => s.toLowerCase());
    const excludes = (opts.excludes ?? []).map((s) => s.toLowerCase());
    const hit = headers.find((h) => {
      const lc = h.toLowerCase();
      return includes.every((k) => lc.includes(k)) && !excludes.some((k) => lc.includes(k));
    });
    if (hit) return hit;
  }
  return null;
}

// ── Shopee ──────────────────────────────────────────────
// Shopee's own DD/MM/YYYY[ HH:MM:SS] date cells, or "Tidak Terbatas"
// (unlimited / no end date) which maps to null.
function parseShopeeDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Fase 3 adds 'toko_keyword' and 'live' channels; "produk_otomatis" rows get
// merged into 'produk' before this is ever called (see shopeeDeepDive.ts's
// mergeProdukOtomatis), so there is no separate channel value for it.
export type ShopeeChannel = 'toko' | 'produk' | 'toko_keyword' | 'live';

// Category/series (from product_master matching) only make sense for the
// Iklan Produk channel — Iklan Toko/Live/Toko-Keyword ad names are campaign
// labels, not product names, so they're never passed a categorization map.
// Keyed by row *object reference* (the same SheetRow objects flowing through
// mergeProdukOtomatis -> categorizeProdukRows -> here), not by name — safe
// because nothing clones these rows in between.
export type ShopeeCategorization = Map<SheetRow, { cleanName: string; category: string; series: string }>;

export function mapShopeeRows(rows: SheetRow[], channel: ShopeeChannel, periodRole: PeriodRole, categorization?: ShopeeCategorization): ShopeeAdRowInput[] {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const col = {
    namaIklan: pickCol(headers, { exact: ['nama iklan'] }),
    kodeProduk: pickCol(headers, { exact: ['kode produk'] }),
    kataPencarian: pickCol(headers, { exact: ['kata pencarian'] }),
    tanggalMulai: pickCol(headers, { exact: ['tanggal mulai'] }),
    tanggalSelesai: pickCol(headers, { exact: ['tanggal selesai'] }),
    dilihat: pickCol(headers, { exact: ['dilihat'] }),
    jumlahKlik: pickCol(headers, { exact: ['jumlah klik'] }),
    ctr: pickCol(headers, { exact: ['persentase klik'] }),
    konversi: pickCol(headers, { exact: ['konversi'] }),
    konversiLangsung: pickCol(headers, { exact: ['konversi langsung'] }),
    produkTerjual: pickCol(headers, { exact: ['produk terjual'] }),
    terjualLangsung: pickCol(headers, { exact: ['terjual langsung'] }),
    omzetPenjualan: pickCol(headers, { exact: ['omzet penjualan'] }),
    penjualanLangsung: pickCol(headers, { includes: ['penjualan langsung'] }),
    biaya: pickCol(headers, { exact: ['biaya'] }),
    roas: pickCol(headers, { exact: ['efektifitas iklan', 'efektivitas iklan'] }),
    acos: pickCol(headers, { includes: ['acos'], excludes: ['langsung'] }),
  };
  return rows.map((r) => {
    const cat = categorization?.get(r);
    return {
      periodRole,
      channel,
      namaIklanRaw: col.namaIklan ? String(r[col.namaIklan] ?? '') || null : null,
      namaIklanClean: cat?.cleanName ?? null,
      kodeProduk: col.kodeProduk ? String(r[col.kodeProduk] ?? '') || null : null,
      category: cat?.category ?? null,
      series: cat?.series ?? null,
      kataPencarian: col.kataPencarian ? String(r[col.kataPencarian] ?? '') || null : null,
      tanggalMulai: col.tanggalMulai ? parseShopeeDate(r[col.tanggalMulai]) : null,
      tanggalSelesai: col.tanggalSelesai ? parseShopeeDate(r[col.tanggalSelesai]) : null,
      dilihat: col.dilihat ? parseShopeeNum(r[col.dilihat]) : null,
      jumlahKlik: col.jumlahKlik ? parseShopeeNum(r[col.jumlahKlik]) : null,
      ctr: col.ctr ? parseShopeeNum(r[col.ctr]) : null,
      konversi: col.konversi ? parseShopeeNum(r[col.konversi]) : null,
      konversiLangsung: col.konversiLangsung ? parseShopeeNum(r[col.konversiLangsung]) : null,
      produkTerjual: col.produkTerjual ? parseShopeeNum(r[col.produkTerjual]) : null,
      terjualLangsung: col.terjualLangsung ? parseShopeeNum(r[col.terjualLangsung]) : null,
      omzetPenjualan: col.omzetPenjualan ? parseShopeeNum(r[col.omzetPenjualan]) : null,
      penjualanLangsung: col.penjualanLangsung ? parseShopeeNum(r[col.penjualanLangsung]) : null,
      biaya: col.biaya ? parseShopeeNum(r[col.biaya]) : null,
      roas: col.roas ? parseShopeeNum(r[col.roas]) : null,
      acos: col.acos ? parseShopeeNum(r[col.acos]) : null,
      extra: r as Record<string, unknown>,
    };
  });
}

// ── Meta ────────────────────────────────────────────────
function findColAny(rows: SheetRow[], keywordGroups: string[][]): string | null {
  for (const group of keywordGroups) {
    const hit = findCol(rows, group);
    if (hit) return hit;
  }
  return null;
}

// Splits a raw Meta rows array (single uploaded file, spanning 2 "Month"
// buckets) into old/cur groups and tags each row with the given channel —
// mirrors buildMetaReport's own splitMonths() call so the saved rows are
// exactly the ones the generated report was computed from (rows from any
// month bucket other than the oldest/newest are dropped there too).
export interface MetaDayRangePair {
  old: { start: Date; end: Date };
  cur: { start: Date; end: Date };
}

export function mapMetaRows(rows: SheetRow[], channel: 'boost' | 'nonboost' | 'cpas_overall', dayRanges?: MetaDayRangePair | null): MetaAdRowInput[] {
  if (!rows.length) return [];
  const dayCol = findCol(rows, ['day']);
  if (dayCol && dayRanges) {
    const { old, cur } = splitByDayRange(rows, dayCol, dayRanges.old, dayRanges.cur);
    return [...tagMetaRows(old, channel, 'old', dayCol), ...tagMetaRows(cur, channel, 'cur', dayCol)];
  }
  const monthCol = findCol(rows, ['month']);
  const { old, cur } = splitMonths(rows, monthCol);
  return [...tagMetaRows(old, channel, 'old'), ...tagMetaRows(cur, channel, 'cur')];
}

// `periodColOverride` lets the day-mode branch above store the row's Day
// value into the same `month` text column (extra still keeps the full raw
// row regardless, so reconstruction never depends on this column).
function tagMetaRows(rows: SheetRow[], channel: string, periodRole: PeriodRole, periodColOverride?: string | null): MetaAdRowInput[] {
  if (!rows.length) return [];
  const campCol = findCol(rows, ['campaign']);
  const monthCol = periodColOverride ?? findCol(rows, ['month']);
  const ageCol = findCol(rows, ['age']);
  const genderCol = findCol(rows, ['gender']);
  const spentCol = findCol(rows, ['amount spent']);
  const imprCol = findCol(rows, ['impression']);
  const clicksCol = findColAny(rows, [['link click'], ['clicks (all)'], ['outbound click']]);
  const ctrCol = findCol(rows, ['ctr']);
  const purchasesCol = findCol(rows, ['purchases']);
  const convValueCol = findColAny(rows, [['purchases conversion value'], ['conversion value']]);
  const roasCol = findCol(rows, ['roas']);
  return rows.map((r) => ({
    periodRole,
    channel,
    campaignName: campCol ? String(r[campCol] ?? '') || null : null,
    month: monthCol ? String(r[monthCol] ?? '') || null : null,
    age: ageCol ? String(r[ageCol] ?? '') || null : null,
    gender: genderCol ? String(r[genderCol] ?? '') || null : null,
    amountSpent: spentCol ? parseNum(r[spentCol]) : null,
    impressions: imprCol ? parseNum(r[imprCol]) : null,
    clicks: clicksCol ? parseNum(r[clicksCol]) : null,
    ctr: ctrCol ? parseNum(r[ctrCol]) : null,
    purchases: purchasesCol ? parseNum(r[purchasesCol]) : null,
    purchasesConversionValue: convValueCol ? parseNum(r[convValueCol]) : null,
    roas: roasCol ? parseNum(r[roasCol]) : null,
    extra: r as Record<string, unknown>,
  }));
}

// Splits a raw Meta main-file rows array into Boost/Non-Boost channels using
// the same campaign-name classifier the report itself uses, then delegates
// to mapMetaRows for the old/cur split + column extraction.
export function mapMetaMainRows(rows: SheetRow[], dayRanges?: MetaDayRangePair | null): MetaAdRowInput[] {
  if (!rows.length) return [];
  const campCol = findCol(rows, ['campaign']);
  const isBoost = isBoostRow(campCol);
  const boostRows = rows.filter(isBoost);
  const nonBoostRows = rows.filter((r) => !isBoost(r));
  return [...mapMetaRows(boostRows, 'boost', dayRanges), ...mapMetaRows(nonBoostRows, 'nonboost', dayRanges)];
}

// CPAS file rows: no boost/nonboost split (that classifier is Meta main-file
// specific) — the NV/RM/"other" grouping used by the report is a deterministic
// function of campaign_name, so it's recomputed at reopen time instead of
// being persisted as separate channel values.
export function mapMetaCpasRows(rows: SheetRow[], dayRanges?: MetaDayRangePair | null): MetaAdRowInput[] {
  return mapMetaRows(rows, 'cpas_overall', dayRanges);
}

// ── TikTok ──────────────────────────────────────────────
export function mapTiktokRows(rows: SheetRow[], periodRole: PeriodRole): TiktokAdRowInput[] {
  return rows.map((r) => ({
    periodRole,
    campaignName: String(r['Campaign name'] ?? r['Campaign Name'] ?? '') || null,
    cost: tiktokNum(r, 'Cost', 'cost'),
    skuOrders: tiktokNum(r, 'SKU orders', 'SKU Orders', 'sku orders'),
    grossRevenue: tiktokNum(r, 'Gross revenue', 'Gross Revenue', 'gross revenue'),
    extra: r as Record<string, unknown>,
  }));
}
