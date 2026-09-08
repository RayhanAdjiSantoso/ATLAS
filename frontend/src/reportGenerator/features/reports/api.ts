import type { ProductMasterEntry } from '../../lib/shopeeDeepDive';
import type { Client, Platform, PeriodRole, RawFileEntry, ReportDetail, ReportListItem, SaveReportPayload, SavedPeriod, SavedPeriodDetail } from './types';
import api from '../../../api/client.js';

// Was raw fetch(`${API_BASE}/api/...`) against this app's own standalone
// backend. Now that this is a page inside ATLAS, every call goes through
// ATLAS's shared axios instance (src/api/client.js) instead — it already
// attaches the logged-in user's Bearer token and handles a 401 by bouncing
// to /login, which every one of these endpoints now requires (see
// backend/src/routes/reportGeneratorRoutes.js). Its baseURL is '/api', so
// paths below start one level under that (e.g. '/report-generator/reports').

// The old fetch-based asJson() surfaced the backend's own `{error: "..."}`
// message (e.g. "Klien \"X\" sudah ada", "brandId does not reference an
// existing brand.") — callers throughout this app (ClientPicker,
// ReportsTab, ...) catch and display `err.message` directly. Axios instead
// rejects with a generic "Request failed with status code 409" unless we
// unwrap it ourselves, so every call below goes through this on error.
function unwrap(err: unknown): never {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
  throw new Error(data?.error || (err instanceof Error ? err.message : 'Request failed'));
}

// "Clients" here are ATLAS's own brands (public.brands, via /api/brands) —
// no separate clients table/endpoint anymore. Reshaped from
// {brand_id, brand_name} to this app's {id, name} Client shape so nothing
// downstream of ClientPicker needs to know the difference.
export async function getClients(): Promise<Client[]> {
  try {
    const res = await api.get('/brands');
    return res.data.brands.map((b: { brand_id: number; brand_name: string }) => ({ id: b.brand_id, name: b.brand_name }));
  } catch (err) {
    unwrap(err);
  }
}

export async function createClient(name: string): Promise<Client> {
  try {
    const res = await api.post('/brands', { brandName: name });
    const b = res.data.brand;
    return { id: b.brand_id, name: b.brand_name };
  } catch (err) {
    unwrap(err);
  }
}

export async function saveReport(payload: SaveReportPayload, files: RawFileEntry[]): Promise<{ id: number }> {
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  form.append('fileMeta', JSON.stringify(files.map((f) => ({ channel: f.channel, periodRole: f.periodRole, originalFilename: f.file.name }))));
  files.forEach((f) => form.append('files', f.file, f.file.name));
  try {
    // Content-Type: undefined overrides the axios instance's default
    // 'application/json' header for just this call, so the browser sets
    // multipart/form-data with the correct boundary itself (what axios
    // would otherwise stomp on, breaking multer's parsing on the backend).
    const res = await api.post('/report-generator/reports', form, { headers: { 'Content-Type': undefined } });
    return res.data;
  } catch (err) {
    unwrap(err);
  }
}

export async function getReports(clientId: number, platform?: Platform): Promise<ReportListItem[]> {
  try {
    const params: Record<string, string> = { client_id: String(clientId) };
    if (platform) params.platform = platform;
    const res = await api.get('/report-generator/reports', { params });
    return res.data;
  } catch (err) {
    unwrap(err);
  }
}

export async function getReportDetail(id: number): Promise<ReportDetail> {
  try {
    const res = await api.get(`/report-generator/reports/${id}`);
    return res.data;
  } catch (err) {
    unwrap(err);
  }
}

// "Pilih dari data tersimpan" — periods this client has previously uploaded
// for a platform, and the stored rows for one of them.
export async function getSavedPeriods(clientId: number, platform: Platform): Promise<SavedPeriod[]> {
  try {
    const res = await api.get('/report-generator/saved-periods', { params: { client_id: String(clientId), platform } });
    return res.data;
  } catch (err) {
    unwrap(err);
  }
}

export async function getSavedPeriod(runId: number, role: PeriodRole): Promise<SavedPeriodDetail> {
  try {
    const res = await api.get(`/report-generator/reports/${runId}/period/${role}`);
    return res.data;
  } catch (err) {
    unwrap(err);
  }
}

export async function deleteReport(id: number): Promise<void> {
  try {
    await api.delete(`/report-generator/reports/${id}`);
  } catch (err) {
    unwrap(err);
  }
}

// Fase 3 — Shopee Deep-Dive category/series lookup.
export async function getProductMaster(brandId: number): Promise<ProductMasterEntry[]> {
  try {
    const res = await api.get('/report-generator/product-master', { params: { brandId } });
    return res.data;
  } catch (err) {
    unwrap(err);
  }
}

export async function saveProductMasterEntry(brandId: number, entry: ProductMasterEntry): Promise<ProductMasterEntry> {
  try {
    const res = await api.post('/report-generator/product-master', {
      brandId,
      namaProdukClean: entry.namaProdukClean,
      category: entry.category,
      series: entry.series,
    });
    return res.data;
  } catch (err) {
    unwrap(err);
  }
}

// Full replace of a client's category mapping — the "Referensi Kategori
// Produk" upload. Returns the entries actually stored (deduped/validated
// server-side).
export async function replaceProductMaster(brandId: number, entries: ProductMasterEntry[]): Promise<ProductMasterEntry[]> {
  try {
    const res = await api.put('/report-generator/product-master', { brandId, entries });
    return res.data;
  } catch (err) {
    unwrap(err);
  }
}

// ── AI Summary ────────────────────────────────────────────────────────
// Ringkasan analisis per brand + platform + periode. Panggilan ke Gemini
// terjadi di backend (key-nya tidak pernah menyeberang ke browser); di sini
// hanya endpoint ATLAS sendiri.

export interface AiSummaryContent {
  diagnosis: string;
  winning: string[];
  challenge: string[];
  strategic_direction: string[];
  action_items: string[];
}

export interface AiSummaryRecord {
  id: number;
  platform: Platform;
  period_old_label: string | null;
  period_cur_label: string | null;
  summary: AiSummaryContent;
  edited_summary: AiSummaryContent | null;
  model: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  generated_by_name: string | null;
  edited_by_name: string | null;
}

export interface AiSummaryPerformance {
  period: { old: string; cur: string };
  kpis: { label: string; old: string; cur: string; delta: string }[];
  cpasKpis?: { label: string; old: string; cur: string; delta: string }[];
  periodWarning?: string | null;
  notes?: string[];
}

export async function generateAiSummary(input: {
  clientId: number;
  platform: Platform;
  period: { oldLabel: string; curLabel: string; oldStart?: string | null; oldEnd?: string | null; curStart?: string | null; curEnd?: string | null };
  performance: AiSummaryPerformance;
  refresh?: boolean;
}): Promise<{ summary: AiSummaryRecord; cached: boolean }> {
  try {
    const res = await api.post('/report-generator/ai-summary', {
      client_id: input.clientId,
      platform: input.platform,
      period: input.period,
      performance: input.performance,
      refresh: input.refresh ?? false,
    });
    return res.data;
  } catch (err) {
    unwrap(err);
  }
}

export async function saveAiSummaryEdit(id: number, clientId: number, summary: AiSummaryContent): Promise<AiSummaryRecord> {
  try {
    const res = await api.put(`/report-generator/ai-summary/${id}`, { client_id: clientId, summary });
    return res.data.summary;
  } catch (err) {
    unwrap(err);
  }
}
