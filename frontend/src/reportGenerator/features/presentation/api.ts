import api from '../../../api/client.js';
import type { ActionPriority, DraftDetail, DraftSummary, Lang, NarrativeField, PointKind, PresentationDocument, Snapshot, Tone } from './types';

// The builder's calls to /api/report-generator/presentations, through ATLAS's
// shared client (Bearer token, 401 handling), with the backend's message surfaced.

const BASE = '/report-generator/presentations';

function unwrap(err: unknown): never {
  const res = (err as { response?: { status?: number; data?: { error?: string; message?: string } } })?.response;
  const e = new Error(res?.data?.error || res?.data?.message || (err instanceof Error ? err.message : 'Permintaan gagal')) as Error & { status?: number };
  e.status = res?.status;
  throw e;
}

export async function listDrafts(clientId: number): Promise<DraftSummary[]> {
  try {
    return (await api.get(BASE, { params: { client_id: clientId } })).data.drafts;
  } catch (err) {
    unwrap(err);
  }
}

export async function getDraft(id: number): Promise<DraftDetail> {
  try {
    return (await api.get(`${BASE}/${id}`)).data;
  } catch (err) {
    unwrap(err);
  }
}

export interface SaveResult {
  id: number;
  revision: number;
  updated_at: string;
}

export async function createDraft(clientId: number, name: string, document: PresentationDocument, snapshot: Snapshot | null): Promise<SaveResult> {
  try {
    return (await api.post(BASE, { client_id: clientId, name, document, snapshot })).data;
  } catch (err) {
    unwrap(err);
  }
}

// `snapshot` left undefined keeps the stored one; see updateDraft on the server.
export async function updateDraft(id: number, name: string, document: PresentationDocument, baseRevision: number, snapshot?: Snapshot): Promise<SaveResult> {
  try {
    return (await api.put(`${BASE}/${id}`, { name, document, baseRevision, ...(snapshot ? { snapshot } : {}) })).data;
  } catch (err) {
    unwrap(err);
  }
}

export async function deleteDraft(id: number): Promise<void> {
  try {
    await api.delete(`${BASE}/${id}`);
  } catch (err) {
    unwrap(err);
  }
}

export async function duplicateDraft(id: number): Promise<SaveResult> {
  try {
    return (await api.post(`${BASE}/${id}/duplicate`)).data;
  } catch (err) {
    unwrap(err);
  }
}

export async function uploadAsset(reportId: number, file: Blob, name: string): Promise<{ assetId: number }> {
  const form = new FormData();
  form.append('file', file, name);
  try {
    return (await api.post(`${BASE}/${reportId}/assets`, form, { headers: { 'Content-Type': undefined } })).data;
  } catch (err) {
    unwrap(err);
  }
}

// Assets sit behind auth, so an <img src> cannot reach them. Fetched once per
// asset and kept as a data URL, which html2canvas draws without a CORS question.
const assetCache = new Map<string, Promise<string>>();

export function fetchAssetDataUrl(reportId: number, assetId: number): Promise<string> {
  const key = `${reportId}:${assetId}`;
  let pending = assetCache.get(key);
  if (!pending) {
    pending = api.get(`${BASE}/${reportId}/assets/${assetId}`, { responseType: 'blob' }).then(
      (res: { data: Blob }) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(res.data);
      }),
    );
    (pending as Promise<string>).catch(() => assetCache.delete(key));
    assetCache.set(key, pending as Promise<string>);
  }
  return pending as Promise<string>;
}

export async function getAiStatus(): Promise<{ available: boolean; engine: string | null; model: string | null }> {
  try {
    return (await api.get(`${BASE}/ai/status`)).data;
  } catch {
    return { available: false, engine: null, model: null };
  }
}

export interface AiRequest {
  clientId: number;
  lang: Lang;
  tone: Tone;
  fields: (NarrativeField | 'headline' | 'actions')[];
  slideTitle: string;
  period: string;
  facts: string[];
  rootCause: string[];
  context: string;
  otherNarratives: string[];
}

export interface AiResponse {
  suggestions: {
    headline?: string;
    takeaways?: { text: string; kind: PointKind }[];
    findings?: { text: string; kind: PointKind }[];
    insights?: { text: string; kind: PointKind }[];
    wins?: { text: string; kind: PointKind }[];
    risks?: { text: string; kind: PointKind }[];
    actions?: { action: string; priority: ActionPriority; owner: string }[];
  };
  warnings: { field: string; text: string; unmatched: string[] }[];
  model: string;
}

export async function generateNarrative(req: AiRequest): Promise<AiResponse> {
  const { clientId, ...rest } = req;
  try {
    return (await api.post(`${BASE}/ai/generate`, { client_id: clientId, ...rest })).data;
  } catch (err) {
    unwrap(err);
  }
}
