// Mirrors backend/src/types.ts — kept as a separate copy since the frontend
// and backend are separate packages with no shared-types build step.

import type { SheetRow } from '../../lib/types';

export type Platform = 'meta' | 'shopee' | 'tiktok';
export type PeriodRole = 'old' | 'cur';

export interface Client {
  id: number;
  name: string;
}

export interface ShopeeAdRowInput {
  periodRole: PeriodRole;
  channel: string;
  namaIklanRaw: string | null;
  namaIklanClean: string | null;
  kodeProduk: string | null;
  category: string | null;
  series: string | null;
  kataPencarian: string | null;
  tanggalMulai: string | null;
  tanggalSelesai: string | null;
  dilihat: number | null;
  jumlahKlik: number | null;
  ctr: number | null;
  konversi: number | null;
  konversiLangsung: number | null;
  produkTerjual: number | null;
  terjualLangsung: number | null;
  omzetPenjualan: number | null;
  penjualanLangsung: number | null;
  biaya: number | null;
  roas: number | null;
  acos: number | null;
  extra: Record<string, unknown> | null;
}

export interface MetaAdRowInput {
  periodRole: PeriodRole;
  channel: string;
  campaignName: string | null;
  month: string | null;
  age: string | null;
  gender: string | null;
  amountSpent: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  purchases: number | null;
  purchasesConversionValue: number | null;
  roas: number | null;
  extra: Record<string, unknown> | null;
}

export interface TiktokAdRowInput {
  periodRole: PeriodRole;
  campaignName: string | null;
  cost: number | null;
  skuOrders: number | null;
  grossRevenue: number | null;
  extra: Record<string, unknown> | null;
}

export interface SaveReportPayload {
  brandId: number;
  platform: Platform;
  period: {
    oldStart: string | null;
    oldEnd: string | null;
    curStart: string | null;
    curEnd: string | null;
    oldLabel: string | null;
    curLabel: string | null;
  };
  reportConfig: Record<string, unknown> | null;
  rows: {
    shopee?: ShopeeAdRowInput[];
    meta?: MetaAdRowInput[];
    tiktok?: TiktokAdRowInput[];
    // Shopee Product Overview daily rows (verbatim). Backend upserts them
    // into shopee_store_overview_daily keyed by (brand_id, tanggal) — a
    // brand-scoped daily store reusable by any later comparison.
    shopeeOverview?: SheetRow[];
  };
}

export interface RawFileEntry {
  file: File;
  channel: string;
  periodRole: PeriodRole;
}

export interface ReportListItem {
  id: number;
  platform: Platform;
  periodOldLabel: string | null;
  periodCurLabel: string | null;
  periodOldStart: string | null;
  periodOldEnd: string | null;
  periodCurStart: string | null;
  periodCurEnd: string | null;
  createdAt: string;
}

export interface ReportDetail {
  report: {
    id: number;
    brandId: number;
    platform: Platform;
    periodOldLabel: string | null;
    periodCurLabel: string | null;
    periodOldStart: string | null;
    periodOldEnd: string | null;
    periodCurStart: string | null;
    periodCurEnd: string | null;
    reportConfig: Record<string, unknown> | null;
    createdAt: string;
  };
  rows: Record<string, unknown>[];
  // Shopee only — Product Overview daily rows falling inside each period,
  // from the brand-scoped shopee_store_overview_daily store.
  overviewOld?: SheetRow[];
  overviewCur?: SheetRow[];
}

// ── "Pilih dari data tersimpan" (reuse a previously-uploaded period) ──
// One period, standing on its own regardless of which comparison it was
// first saved in. Comes from GET /api/saved-periods (scoped to one client +
// platform, newest save first, one entry per report_run side that actually
// stored rows).
export interface SavedPeriod {
  runId: number;
  role: PeriodRole;
  label: string | null;
  start: string | null; // ISO 'YYYY-MM-DD'
  end: string | null;
  savedAt: string; // report_runs.updated_at
  sourceComparison: string; // e.g. "Jul 2026 vs Jun 2026" — disambiguates instances
  channels: Record<string, number>; // per-channel row count ({} shape for tiktok is { tiktok: n })
  totalRows: number;
}

// GET /api/reports/:runId/period/:role — the period's stored rows, the same
// `extra` blobs reconstruct.ts feeds through buildXReport(), grouped by
// channel so a tab can drop them straight into its per-slot state.
export interface SavedPeriodDetail {
  platform: Platform;
  reportConfig: Record<string, unknown> | null;
  period: { label: string | null; start: string | null; end: string | null };
  channels: Record<string, SheetRow[]>;
  // Shopee only — Product Overview daily rows for this period's date range
  // (empty for other platforms, or when no overview was ever uploaded).
  overview: SheetRow[];
}
