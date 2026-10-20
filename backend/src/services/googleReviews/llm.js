import Anthropic from '@anthropic-ai/sdk';
import { requestGeminiJson, AiSummaryError } from '../aiSummaryService.js';

// One structured JSON answer from whichever model ATLAS already has a key
// for: Claude when ANTHROPIC_API_KEY is set (as the Report Generator brief
// does), otherwise Gemini. No new provider, no new key.
//
// Two jobs, two sizes: reading reviews is many small, uniform calls — a
// small fast model does it well and cheaply; the summary is one call that
// has to reason across the whole set.

const CLASSIFY_MODEL = process.env.GR_CLASSIFY_MODEL || 'claude-haiku-5-5';
const SUMMARY_MODEL = process.env.GR_SUMMARY_MODEL || 'claude-sonnet-5-5';
// Under Vercel's 60-second function limit.
const TIMEOUT_MS = Number(process.env.GR_AI_TIMEOUT_MS) || 50_000;
// A batch of reviews must leave room for the rest of its step.
const CLASSIFY_TIMEOUT_MS = Math.min(TIMEOUT_MS, 38_000);
const WORKSPACE_ID = process.env.ANTHROPIC_WORKSPACE_ID || '';

// Tests stand in a model here; nothing else sets it.
let override = null;
export function setModelForTests(fn) {
  override = fn;
}

export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const hasAnyModel = () => Boolean(override) || hasClaude() || Boolean(process.env.GEMINI_API_KEY);
// Which model reads reviews, as stored with each AI reading: a reading made
// by another model is read again on the next AI run (the cache is per model).
export const classifyEngine = () => (override ? 'test-model'
  : hasClaude() ? `claude:${CLASSIFY_MODEL}`
    : process.env.GEMINI_API_KEY ? `gemini:${process.env.GEMINI_MODEL || 'gemini-flash-latest'}` : null);
export const engineLabel = () => (hasClaude() ? `Claude (${CLASSIFY_MODEL} / ${SUMMARY_MODEL})` : process.env.GEMINI_API_KEY ? 'Gemini' : null);

let client = null;
const getClient = () => {
  client ??= new Anthropic({
    timeout: TIMEOUT_MS,
    // A failed step is retried by the page, inside a fresh function budget.
    maxRetries: 0,
    defaultHeaders: WORKSPACE_ID ? { 'anthropic-workspace-id': WORKSPACE_ID } : undefined,
  });
  return client;
};

// Schemas are written in the subset both APIs accept; Claude's structured
// output additionally wants every object closed.
function closeObjects(schema) {
  if (Array.isArray(schema)) return schema.map(closeObjects);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) out[k] = closeObjects(v);
  if (schema.type === 'object') out.additionalProperties = false;
  return out;
}

// Gemini's responseSchema spells types in capitals.
function forGemini(schema) {
  if (Array.isArray(schema)) return schema.map(forGemini);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties' || k === 'minimum' || k === 'maximum') continue;
    out[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : forGemini(v);
  }
  return out;
}

async function callClaude({ model, system, prompt, schema, maxTokens, timeout }) {
  let res;
  try {
    res = await getClient().beta.messages.create({
      model,
      max_tokens: maxTokens,
      output_config: { format: { type: 'json_schema', schema: closeObjects(schema) } },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    }, { timeout });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiSummaryError('ANTHROPIC_API_KEY ditolak. Periksa key di server.', 502);
    if (err instanceof Anthropic.RateLimitError) throw new AiSummaryError('Batas pemakaian Claude tercapai. Coba lagi beberapa saat lagi.', 429);
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AiSummaryError('Claude tidak merespons dalam batas waktu. Coba lagi.', 504);
    if (err instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(err.message)) throw new AiSummaryError('Saldo kredit API Claude habis.', 402);
    if (err instanceof Anthropic.APIError && err.status) throw new AiSummaryError(`Claude menolak permintaan (HTTP ${err.status}): ${String(err.message).slice(0, 240)}`, err.status >= 500 ? 502 : 400);
    if (err instanceof Anthropic.APIConnectionError) throw new AiSummaryError(`Tidak bisa menghubungi Claude: ${err.message}`);
    throw err;
  }
  if (res.stop_reason === 'refusal') throw new AiSummaryError('Model menolak memproses data ini.', 422);
  if (res.stop_reason === 'max_tokens') throw new AiSummaryError('Jawaban model terpotong. Coba lagi.', 502);
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return { data: JSON.parse(text), model: res.model };
  } catch {
    throw new AiSummaryError('Jawaban model bukan JSON yang valid.');
  }
}

export async function requestJson({ task, system, prompt, schema, maxTokens = 8000 }) {
  if (override) return override({ task, prompt });
  if (hasClaude()) {
    const summary = task === 'summary';
    return callClaude({ model: summary ? SUMMARY_MODEL : CLASSIFY_MODEL, system, prompt, schema, maxTokens, timeout: summary ? TIMEOUT_MS : CLASSIFY_TIMEOUT_MS });
  }
  if (process.env.GEMINI_API_KEY) {
    const data = await requestGeminiJson(`${system}\n\n${prompt}`, forGemini(schema), { maxOutputTokens: maxTokens });
    return { data, model: process.env.GEMINI_MODEL || 'gemini' };
  }
  throw new AiSummaryError('Belum ada model AI di server (ANTHROPIC_API_KEY atau GEMINI_API_KEY).', 503);
}
