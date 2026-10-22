import crypto from 'crypto';
import pool from '../../config/db.js';
import { AppError } from '../../utils/errors.js';
import { getReviewsProvider, getSearchProvider, CANDIDATE_SOURCES } from './providers/index.js';
import { BATCH_SIZE, classifyBatch, generateSummary } from './analysis.js';
import { classifyEngine, engineLabel, hasAnyModel } from './llm.js';
import { analyzeText, ENGINE_VERSION } from './codeSentiment/engine.js';
import { buildCodeSummary } from './codeSentiment/summary.js';
import { buildExclusions, buildWordCloud, reviewTerms } from './textAnalytics.js';
import {
  highlightStats, ratingDistribution, reviewTopics, SENTIMENTS, sentimentDistribution, sentimentTrend, topicStats, trendInsights,
} from './aggregations.js';

// Google Reviews Analytics.
//
// Collecting and reading reviews takes longer than one serverless request
// may run (60 s on Vercel), so the work is a *run* advanced in steps: the
// page calls POST /runs/:id/step again and again, each step does as much as
// fits in STEP_BUDGET_MS and saves where it got to. Closing the tab loses
// nothing — the next "Analyze" resumes the same run. A step claims the run
// (locked_until) so two tabs never work one run twice.
//
// Stages: collect (page through the source, upsert by review id) → analyze
// (AI reads reviews that are new or whose text changed; rating-only ones
// are marked without a call) → summarize (topics, highlights, executive
// summary, cached per dataset version) → done.

// Reviews from a Google Maps review id share one key space whichever way
// they arrived; CSV imports are stored under this source.
export const CSV_SOURCE = 'google_maps';

// Two sentiment methods, kept apart end to end: each review has one reading
// per method, each method its own summary, and every chart reads one method
// at a time. 'code' (rules + lexicon, no API, no cost) is the default; 'ai'
// (Claude / Gemini) runs only when asked for, never as a fallback.
export const METHODS = ['code', 'ai'];
export const normaliseMethod = (m) => (m === 'ai' ? 'ai' : 'code');
// The version a reading must carry to count as current for its method.
const engineFor = (method) => (method === 'ai' ? classifyEngine() : ENGINE_VERSION);

function requireMethod(method) {
  if (method === 'ai' && !hasAnyModel()) {
    throw new AppError('Analisis AI tidak tersedia: belum ada ANTHROPIC_API_KEY atau GEMINI_API_KEY di server. Gunakan metode Code-Based.', 400);
  }
}

const STEP_BUDGET_MS = Number(process.env.GR_STEP_BUDGET_MS) || 35_000;
// A cap on what one business may collect, so a chain with 40k reviews does
// not run up the source's bill unasked.
const MAX_REVIEWS = Number(process.env.GR_MAX_REVIEWS) || 3000;
const MAX_CONSECUTIVE_FAILURES = 4;
const LOCK_SECONDS = 75;

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
export const contentHash = (r) => sha(`${r.rating ?? ''}|${(r.text ?? '').trim()}`);

/* ── Sources & search ─────────────────────────────────────────────────── */

export function getSources() {
  const search = getSearchProvider();
  const reviews = getReviewsProvider();
  return {
    search: search ? { id: search.id, label: search.label } : null,
    reviews: reviews ? {
      id: reviews.id,
      label: reviews.label,
      coverage: reviews.coverage,
      coverageNote: reviews.coverageNote ?? null,
      experimental: Boolean(reviews.experimental),
      // Playwright: whether a Google account is signed in in its profile
      // (null until its browser has opened once).
      signedIn: reviews.status?.().signedIn ?? null,
    } : null,
    ai: engineLabel(),
    methods: {
      code: { available: true, engine: ENGINE_VERSION },
      ai: { available: hasAnyModel(), engine: engineLabel() },
    },
    // Collecting needs a source; reading needs a model too. A run without a
    // model still collects, then stops with a clear message.
    ready: Boolean(search && reviews),
    candidates: CANDIDATE_SOURCES,
  };
}

function requireSearch() {
  const p = getSearchProvider();
  if (!p) throw new AppError('Sumber pencarian bisnis Google belum dikonfigurasi di server. Hubungi superadmin.', 503);
  return p;
}
function requireReviews() {
  const p = getReviewsProvider();
  if (!p) throw new AppError('Sumber data Google Reviews belum dikonfigurasi di server. Hubungi superadmin.', 503);
  return p;
}

// Per-account, per-instance throttle on searches: each one may cost money at
// the source.
const SEARCH_WINDOW_MS = 10 * 60_000;
const SEARCH_LIMIT = 30;
const searchLog = new Map();
function throttleSearch(userId) {
  const now = Date.now();
  const recent = (searchLog.get(userId) ?? []).filter((t) => now - t < SEARCH_WINDOW_MS);
  if (recent.length >= SEARCH_LIMIT) throw new AppError('Terlalu banyak pencarian dalam 10 menit terakhir. Coba lagi sebentar lagi.', 429);
  recent.push(now);
  searchLog.set(userId, recent);
}

export async function searchBusinesses(query, user) {
  const userId = user?.userId ?? null;
  const q = String(query ?? '').trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 120) throw new AppError('Kata kunci harus 2–120 karakter.', 400);
  const provider = requireSearch();
  throttleSearch(userId);
  const results = await provider.searchBusinesses(q);
  // Mark the ones already analysed, so the list says which can open at once.
  const ids = results.map((r) => r.placeId).filter(Boolean);
  const { rows } = ids.length
    ? await pool.query('SELECT id, place_id, brand_id, created_by FROM public.gr_businesses WHERE place_id = ANY($1)', [ids])
    : { rows: [] };
  const known = new Map(rows.filter((r) => canSee(user, r)).map((r) => [r.place_id, Number(r.id)]));
  return results.filter((r) => r.placeId).map((r) => ({ ...r, businessId: known.get(r.placeId) ?? null }));
}

/* ── Businesses ───────────────────────────────────────────────────────── */

const BUSINESS_COLS = `id, place_id, name, address, category, maps_url, google_rating, google_total, info_source,
  info_updated_at, last_collected_at, last_analyzed_at, dataset_version, created_at, created_by, brand_id`;

// Who sees a business. Accounts limited to some brands (Pengaturan Akses)
// see the businesses linked to those brands and the ones they added
// themselves; an unrestricted account sees all. `user` undefined/null means
// an internal call (a run step, a test) — every route passes req.user.
export function canSee(user, row) {
  const allowed = user?.allowedBrandIds;
  if (!user || !allowed?.length) return true;
  if (row.brand_id != null && allowed.includes(Number(row.brand_id))) return true;
  return row.created_by != null && Number(row.created_by) === Number(user.userId);
}

export async function getVisibleBusiness(id, user) {
  const row = await getBusinessRow(id);
  // Not found and not allowed look the same, so ids cannot be probed.
  if (!canSee(user, row)) throw new AppError('Bisnis tidak ditemukan.', 404);
  return row;
}

function businessOut(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    placeId: r.place_id,
    name: r.name,
    address: r.address,
    category: r.category,
    mapsUrl: r.maps_url,
    googleRating: r.google_rating == null ? null : Number(r.google_rating),
    googleTotal: r.google_total,
    infoUpdatedAt: r.info_updated_at,
    lastCollectedAt: r.last_collected_at,
    lastAnalyzedAt: r.last_analyzed_at,
    datasetVersion: r.dataset_version,
    brandId: r.brand_id ?? null,
  };
}

export async function saveBusinessInfo(info, source, userId = null) {
  const { rows } = await pool.query(
    `INSERT INTO public.gr_businesses (place_id, name, address, category, maps_url, google_rating, google_total, info_source, info_updated_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
     ON CONFLICT (place_id) DO UPDATE SET
       name = EXCLUDED.name, address = EXCLUDED.address, category = EXCLUDED.category, maps_url = EXCLUDED.maps_url,
       -- A source that could not read a figure this time keeps the last one.
       google_rating = COALESCE(EXCLUDED.google_rating, gr_businesses.google_rating),
       google_total = COALESCE(EXCLUDED.google_total, gr_businesses.google_total),
       info_source = EXCLUDED.info_source, info_updated_at = now()
     RETURNING ${BUSINESS_COLS}`,
    [info.placeId, info.name, info.address ?? null, info.category ?? null, info.mapsUrl ?? null,
      Number.isFinite(info.rating) ? info.rating : null, Number.isInteger(info.totalReviews) ? info.totalReviews : null, source, userId],
  );
  return businessOut(rows[0]);
}

// Selecting a search result: its details are read again from the source by
// Place ID rather than trusted from the browser.
export async function selectBusiness(placeId, user) {
  const userId = user?.userId ?? null;
  const id = String(placeId ?? '').trim();
  if (!id || id.length > 300) throw new AppError('Place ID tidak valid.', 400);
  const { rows: existing } = await pool.query(`SELECT ${BUSINESS_COLS} FROM public.gr_businesses WHERE place_id = $1`, [id]);
  if (existing[0] && !canSee(user, existing[0])) throw new AppError('Bisnis ini sudah dianalisis untuk brand yang tidak bisa Anda akses.', 403);
  const provider = requireSearch();
  const info = await provider.getBusiness(id);
  if (!info) throw new AppError('Bisnis tidak ditemukan di sumber data.', 404);
  return saveBusinessInfo({ ...info, placeId: id }, provider.id, userId);
}

export async function listBusinesses(user) {
  const { rows: all } = await pool.query(
    `SELECT ${BUSINESS_COLS.split(',').map((c) => `b.${c.trim()}`).join(', ')},
            (SELECT count(*) FROM public.gr_reviews r WHERE r.business_id = b.id AND (r.expires_at IS NULL OR r.expires_at > now()))::int AS collected
     FROM public.gr_businesses b
     ORDER BY COALESCE(b.last_collected_at, b.created_at) DESC
     LIMIT 300`,
  );
  return all.filter((r) => canSee(user, r)).slice(0, 100).map((r) => ({ ...businessOut(r), collected: r.collected }));
}

// Link a business to an ATLAS brand (or unlink with null). A restricted
// account may only use its own brands, and only on a business it can see.
export async function setBusinessBrand(id, brandId, user) {
  const row = await getVisibleBusiness(id, user);
  const next = brandId == null || brandId === '' ? null : Number(brandId);
  if (next != null) {
    if (!Number.isInteger(next) || next <= 0) throw new AppError('Brand tidak valid.', 400);
    const allowed = user?.allowedBrandIds;
    if (allowed?.length && !allowed.includes(next)) throw new AppError('Akses ditolak untuk brand ini', 403);
    const { rows } = await pool.query('SELECT 1 FROM public.brands WHERE brand_id = $1', [next]);
    if (!rows.length) throw new AppError('Brand tidak ditemukan.', 404);
  } else if (user?.allowedBrandIds?.length && Number(row.created_by) !== Number(user.userId)) {
    // Unlinking would hide it from the brand's other members.
    throw new AppError('Hanya pembuatnya atau akun tanpa batasan brand yang bisa melepas brand.', 403);
  }
  const { rows } = await pool.query(`UPDATE public.gr_businesses SET brand_id = $2 WHERE id = $1 RETURNING ${BUSINESS_COLS}`, [row.id, next]);
  return businessOut(rows[0]);
}

export async function getBusinessRow(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new AppError('ID bisnis tidak valid.', 400);
  const { rows } = await pool.query(`SELECT ${BUSINESS_COLS} FROM public.gr_businesses WHERE id = $1`, [n]);
  if (!rows[0]) throw new AppError('Bisnis tidak ditemukan.', 404);
  return rows[0];
}

/* ── Reviews ──────────────────────────────────────────────────────────── */

// Expired content is removed before anything reads it.
async function purgeExpired(businessId) {
  const { rowCount } = await pool.query(
    'DELETE FROM public.gr_reviews WHERE business_id = $1 AND expires_at IS NOT NULL AND expires_at <= now()',
    [businessId],
  );
  if (rowCount) await pool.query('UPDATE public.gr_businesses SET dataset_version = dataset_version + 1 WHERE id = $1', [businessId]);
}

// Reviews with the reading of ONE method. A reading counts only while it
// matches the review's current text (and, for the code engine, its current
// version); otherwise the review shows as waiting for that method.
async function loadReviews(businessId, method = 'code') {
  await purgeExpired(businessId);
  const m = normaliseMethod(method);
  const { rows } = await pool.query(
    `SELECT r.id, r.source, r.reviewer_name, r.rating, r.review_date, r.date_precision, r.text, r.language, r.owner_response, r.owner_response_date,
            r.content_hash, r.fetched_at,
            CASE WHEN a.content_hash = r.content_hash AND ($3::text IS NULL OR a.engine_version = $3) THEN a.sentiment END AS sentiment,
            a.confidence, a.praises, a.complaints, a.aspects, a.score, a.evidence, a.terms, a.language AS detected_language, a.analyzed_at
     FROM public.gr_reviews r
     LEFT JOIN public.gr_review_analysis a ON a.review_id = r.id AND a.method = $2
     WHERE r.business_id = $1
     ORDER BY r.review_date DESC NULLS LAST, r.id DESC`,
    [businessId, m, m === 'code' ? ENGINE_VERSION : null],
  );
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    confidence: r.confidence == null ? null : Number(r.confidence),
    score: r.score == null ? null : Number(r.score),
    praises: r.sentiment ? r.praises ?? [] : [],
    complaints: r.sentiment ? r.complaints ?? [] : [],
    aspects: r.sentiment ? r.aspects ?? [] : [],
  }));
}

// Upsert one page. Returns how many rows were new or changed — the signal an
// incremental refresh stops on.
export async function upsertReviews(businessId, source, reviews, retentionDays) {
  const rows = [];
  const seen = new Set();
  for (const r of reviews) {
    const text = typeof r.text === 'string' ? r.text.trim().slice(0, 10_000) : null;
    const rating = Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5 ? r.rating : null;
    const date = r.date && !Number.isNaN(new Date(r.date).getTime()) ? new Date(r.date).toISOString() : null;
    // A source without ids still gets a stable one, so a re-fetch matches.
    const externalId = String(r.externalId || sha(`${r.reviewerName ?? ''}|${date ?? ''}|${text ?? ''}`));
    if (seen.has(externalId)) continue; // the same review twice in one page
    seen.add(externalId);
    rows.push({
      external_id: externalId,
      reviewer_name: r.reviewerName ? String(r.reviewerName).slice(0, 200) : null,
      rating,
      review_date: date,
      date_precision: date && ['day', 'week', 'month', 'year'].includes(r.datePrecision) ? r.datePrecision : null,
      text: text || null,
      language: r.language ? String(r.language).slice(0, 10) : null,
      owner_response: r.ownerResponse ? String(r.ownerResponse).slice(0, 10_000) : null,
      owner_response_date: r.ownerResponseDate && !Number.isNaN(new Date(r.ownerResponseDate).getTime()) ? new Date(r.ownerResponseDate).toISOString() : null,
      content_hash: contentHash({ rating, text }),
    });
  }
  if (!rows.length) return { changed: 0, inserted: 0 };
  const { rows: out } = await pool.query(
    `INSERT INTO public.gr_reviews (business_id, source, external_id, reviewer_name, rating, review_date, date_precision, text, language,
       owner_response, owner_response_date, content_hash, fetched_at, expires_at)
     SELECT $1, $2, x.external_id, x.reviewer_name, x.rating, x.review_date, x.date_precision, x.text, x.language,
            x.owner_response, x.owner_response_date, x.content_hash, now(),
            CASE WHEN $4::int IS NULL THEN NULL ELSE now() + make_interval(days => $4::int) END
     FROM jsonb_to_recordset($3::jsonb) AS x(external_id text, reviewer_name text, rating smallint, review_date timestamptz,
       date_precision text, text text, language text, owner_response text, owner_response_date timestamptz, content_hash text)
     ON CONFLICT (business_id, source, external_id) DO UPDATE SET
       reviewer_name = EXCLUDED.reviewer_name, rating = EXCLUDED.rating,
       -- "6 months ago" read next week is not a new date; an approximate date
       -- is only replaced by a better one.
       review_date = CASE WHEN gr_reviews.date_precision IS NOT NULL AND EXCLUDED.date_precision IS NOT NULL
                          AND gr_reviews.review_date IS NOT NULL THEN gr_reviews.review_date ELSE EXCLUDED.review_date END,
       date_precision = CASE WHEN gr_reviews.date_precision IS NOT NULL AND EXCLUDED.date_precision IS NOT NULL
                             AND gr_reviews.review_date IS NOT NULL THEN gr_reviews.date_precision ELSE EXCLUDED.date_precision END,
       text = EXCLUDED.text, language = COALESCE(EXCLUDED.language, gr_reviews.language),
       owner_response = EXCLUDED.owner_response, owner_response_date = EXCLUDED.owner_response_date,
       content_hash = EXCLUDED.content_hash, fetched_at = now(), expires_at = EXCLUDED.expires_at
     WHERE gr_reviews.content_hash IS DISTINCT FROM EXCLUDED.content_hash
        OR gr_reviews.owner_response IS DISTINCT FROM EXCLUDED.owner_response
     RETURNING (xmax = 0) AS inserted`,
    [businessId, source, JSON.stringify(rows), Number.isInteger(retentionDays) ? retentionDays : null],
  );
  // Seen again unchanged: only its retention window restarts. Kept apart from
  // the upsert so it never counts as a change (an incremental refresh stops
  // on the first page with no real change).
  if (Number.isInteger(retentionDays)) {
    await pool.query(
      `UPDATE public.gr_reviews SET fetched_at = now(), expires_at = now() + make_interval(days => $3::int)
       WHERE business_id = $1 AND source = $2 AND external_id = ANY($4)`,
      [businessId, source, retentionDays, rows.map((r) => r.external_id)],
    );
  }
  return { changed: out.length, inserted: out.filter((r) => r.inserted).length };
}

/* ── Runs ─────────────────────────────────────────────────────────────── */

export function runOut(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    businessId: Number(r.business_id),
    status: r.status,
    stage: r.stage,
    method: r.method ?? 'ai',
    // Finer step inside collect, reported by the source while it works.
    phase: r.stage === 'collect' ? r.cursor?.phase ?? null : null,
    mode: r.cursor?.mode ?? 'incremental',
    pages: r.pages,
    collected: r.collected,
    newReviews: r.new_reviews,
    analyzed: r.analyzed,
    toAnalyze: r.to_analyze,
    error: r.error,
    coverageNote: r.coverage_note,
    startedAt: r.started_at,
    updatedAt: r.updated_at,
    finishedAt: r.finished_at,
  };
}

async function latestRun(businessId) {
  const { rows } = await pool.query('SELECT * FROM public.gr_runs WHERE business_id = $1 ORDER BY started_at DESC LIMIT 1', [businessId]);
  return rows[0] ?? null;
}

// "Analyze" / "Refresh": resumes the business's active run, or starts one.
// mode 'full' pages through everything; 'incremental' stops at the first
// page that brings nothing new (the source returns newest first). The first
// run of a business is always full.
export async function startRun(businessId, { mode, method } = {}, user = null) {
  const userId = user?.userId ?? null;
  const m = normaliseMethod(method);
  requireMethod(m);
  const b = await getVisibleBusiness(businessId, user);
  requireReviews();
  const active = await pool.query("SELECT * FROM public.gr_runs WHERE business_id = $1 AND status = 'running'", [b.id]);
  if (active.rows[0]) return runOut(active.rows[0]);
  const effective = mode === 'full' || !b.last_collected_at ? 'full' : 'incremental';
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.gr_runs (business_id, cursor, started_by, method) VALUES ($1, $2, $3, $4) RETURNING *`,
      [b.id, JSON.stringify({ mode: effective, token: null }), userId, m],
    );
    return runOut(rows[0]);
  } catch (err) {
    // Two tabs pressed at once: the partial unique index let one through.
    if (err.code === '23505') {
      const again = await pool.query("SELECT * FROM public.gr_runs WHERE business_id = $1 AND status = 'running'", [b.id]);
      return runOut(again.rows[0]);
    }
    throw err;
  }
}

// After an import: read what is new or changed, then summarise — the same
// run machinery, starting past collection. Joins a run already going.
export async function startAnalysis(businessId, userId = null, method = 'code') {
  const m = normaliseMethod(method);
  requireMethod(m);
  const { rows: active } = await pool.query("SELECT * FROM public.gr_runs WHERE business_id = $1 AND status = 'running'", [businessId]);
  if (active[0]) return runOut(active[0]);
  try {
    const toAnalyze = await countPending(businessId, new Date(), m);
    const { rows } = await pool.query(
      `INSERT INTO public.gr_runs (business_id, stage, cursor, started_by, to_analyze, method)
       VALUES ($1, 'analyze', '{"mode":"import"}'::jsonb, $2, $3, $4)
       RETURNING *`,
      [businessId, userId, toAnalyze, m],
    );
    return runOut(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      const again = await pool.query("SELECT * FROM public.gr_runs WHERE business_id = $1 AND status = 'running'", [businessId]);
      return runOut(again.rows[0]);
    }
    throw err;
  }
}

async function visibleRun(runId, user) {
  const { rows } = await pool.query('SELECT * FROM public.gr_runs WHERE id = $1', [Number(runId)]);
  if (!rows[0]) throw new AppError('Proses tidak ditemukan.', 404);
  if (user) await getVisibleBusiness(rows[0].business_id, user).catch(() => { throw new AppError('Proses tidak ditemukan.', 404); });
  return rows[0];
}

export async function getRun(runId, user) {
  return runOut(await visibleRun(runId, user));
}

async function getRunInternal(runId) {
  const { rows } = await pool.query('SELECT * FROM public.gr_runs WHERE id = $1', [Number(runId)]);
  if (!rows[0]) throw new AppError('Proses tidak ditemukan.', 404);
  return runOut(rows[0]);
}

export async function cancelRun(runId, user) {
  await visibleRun(runId, user);
  const { rows } = await pool.query(
    "UPDATE public.gr_runs SET status = 'cancelled', finished_at = now(), updated_at = now(), locked_until = NULL WHERE id = $1 AND status = 'running' RETURNING *",
    [Number(runId)],
  );
  return rows[0] ? runOut(rows[0]) : getRunInternal(runId);
}

async function saveRun(id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const { rows } = await pool.query(
    `UPDATE public.gr_runs SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...keys.map((k) => (k === 'cursor' ? JSON.stringify(fields[k]) : fields[k]))],
  );
  return rows[0];
}

// Advance a run by one step. Returns the run's state; when another step
// holds the run, returns it untouched with busy: true.
export async function stepRun(runId, user) {
  await visibleRun(runId, user);
  const { rows } = await pool.query(
    `UPDATE public.gr_runs SET locked_until = now() + make_interval(secs => $2), updated_at = now()
     WHERE id = $1 AND status = 'running' AND (locked_until IS NULL OR locked_until < now())
     RETURNING *`,
    [Number(runId), LOCK_SECONDS],
  );
  let run = rows[0];
  if (!run) {
    const current = await getRunInternal(runId);
    return { ...current, busy: current.status === 'running' };
  }

  const startedAt = Date.now();
  const deadline = startedAt + STEP_BUDGET_MS;
  try {
    const b = await getBusinessRow(run.business_id);
    if (run.stage === 'collect') run = await collectStep(run, b, deadline);
    if (run.stage === 'analyze' && normaliseMethod(run.method) === 'ai' && !hasAnyModel()) {
      throw Object.assign(new AppError('Ulasan sudah tersimpan, tetapi analisis tidak bisa jalan: belum ada model AI di server (isi ANTHROPIC_API_KEY atau GEMINI_API_KEY), lalu tekan Refresh.', 503), { fatal: true });
    }
    if (run.stage === 'analyze' && Date.now() < deadline - 20_000) run = await analyzeStep(run, b, deadline);
    // The summary is one long call; it only starts on a fresh step so it has
    // the whole function budget to itself.
    // (The code summary is instant and may run at any point of a step.)
    if (run.stage === 'summarize' && (normaliseMethod(run.method) === 'code' || Date.now() - startedAt < 3_000)) run = await summarizeStep(run, b);
    run = await saveRun(run.id, { locked_until: null, attempts: 0, error: null });
  } catch (err) {
    const attempts = run.attempts + 1;
    // A refusal from the source (CAPTCHA, sign-in wall, no browser) or a
    // missing setting will not change on a retry.
    const failed = err.fatal || attempts >= MAX_CONSECUTIVE_FAILURES;
    const message = err instanceof AppError || err.statusCode ? err.message : `Kesalahan tak terduga: ${err.message}`;
    console.error('[google-reviews] step failed:', err);
    run = await saveRun(run.id, {
      locked_until: null,
      attempts,
      error: message,
      ...(failed ? { status: 'failed', finished_at: new Date().toISOString() } : {}),
    });
  }
  return runOut(run);
}

async function collectStep(run, b, deadline) {
  const provider = requireReviews();
  const cursor = run.cursor ?? { mode: 'full', token: null };
  let { pages, collected, new_reviews: newReviews } = run;
  let finished = false;
  let note = null;
  let freshInfo = null;
  const notices = [];
  // Phases are written as the source reports them, so a page polling the run
  // sees "opening the page" while this request is still busy.
  const setPhase = (phase) => {
    cursor.phase = phase;
    pool.query('UPDATE public.gr_runs SET cursor = jsonb_set(COALESCE(cursor, \'{}\'::jsonb), \'{phase}\', to_jsonb($2::text)), updated_at = now() WHERE id = $1', [run.id, phase])
      .catch(() => {});
  };

  while (Date.now() < deadline - 8_000) {
    const page = await provider.fetchReviewsPage({ placeId: b.place_id, cursor: cursor.token, onProgress: setPhase });
    const reviews = Array.isArray(page?.reviews) ? page.reviews : [];
    if (page?.business) freshInfo = page.business;
    if (page?.notice && !notices.includes(page.notice)) notices.push(page.notice);
    setPhase('save');
    const { changed, inserted } = await upsertReviews(b.id, provider.id, reviews, provider.retentionDays ?? null);
    pages += 1;
    collected += reviews.length;
    newReviews += inserted;
    cursor.token = page?.nextCursor ?? null;
    if (!cursor.token || !reviews.length) { finished = true; break; }
    if (cursor.mode === 'incremental' && changed === 0) { finished = true; break; }
    if (collected >= MAX_REVIEWS) {
      finished = true;
      note = `Pengambilan dibatasi ${MAX_REVIEWS.toLocaleString('id-ID')} ulasan per proses (GR_MAX_REVIEWS).`;
      break;
    }
    run = await saveRun(run.id, { cursor, pages, collected, new_reviews: newReviews });
  }

  if (!finished) return saveRun(run.id, { cursor, pages, collected, new_reviews: newReviews });
  try {
    await provider.endCollection?.(b.place_id);
  } catch { /* an open list also closes on its own when idle */ }

  // The source's standing caveat is shown from the source itself; the run
  // keeps what this visit found.
  note = [note, ...notices].filter(Boolean).join(' ') || null;
  // Refresh what Google reports (rating, total): from the visit itself when
  // the source read it on the way, otherwise from the search source.
  const search = getSearchProvider();
  if (freshInfo?.name) {
    await saveBusinessInfo({ ...freshInfo, placeId: b.place_id }, provider.id);
  } else if (search) {
    try {
      const info = await search.getBusiness(b.place_id);
      if (info) await saveBusinessInfo({ ...info, placeId: b.place_id }, search.id);
    } catch (err) {
      console.warn('[google-reviews] business info refresh failed:', err.message);
    }
  }
  await pool.query(
    `UPDATE public.gr_businesses SET last_collected_at = now(), dataset_version = dataset_version + CASE WHEN $2 > 0 THEN 1 ELSE 0 END WHERE id = $1`,
    [b.id, newReviews],
  );
  const toAnalyze = await countPending(b.id, run.started_at, run.method);
  return saveRun(run.id, { cursor, pages, collected, new_reviews: newReviews, stage: 'analyze', to_analyze: toAnalyze, coverage_note: note });
}

// Reviews still to read: never read, edited since, or failed before this
// run began (a failure inside this run is not retried in a loop).
//
// Per method: $1 business, $2 since, $3 method, $4 the engine a reading
// must carry (the code engine's version, or the AI model in use). A reading
// from another engine version is read again; an AI reading from before
// versions were recorded (NULL) is kept, so an upgrade does not re-bill.
const PENDING_SQL = `
  FROM public.gr_reviews r
  LEFT JOIN public.gr_review_analysis a ON a.review_id = r.id AND a.method = $3
  WHERE r.business_id = $1 AND (r.expires_at IS NULL OR r.expires_at > now())
    AND (a.review_id IS NULL OR a.content_hash <> r.content_hash
      OR ($4::text IS NOT NULL AND a.engine_version IS NOT NULL AND a.engine_version <> $4)
      OR ($3 = 'code' AND a.engine_version IS NULL)
      OR (a.sentiment = 'failed' AND a.analyzed_at < $2))`;

async function countPending(businessId, since, method = 'code') {
  const m = normaliseMethod(method);
  const { rows } = await pool.query(`SELECT count(*)::int AS n ${PENDING_SQL}`, [businessId, since, m, engineFor(m)]);
  return rows[0].n;
}

async function saveAnalyses(entries) {
  if (!entries.length) return;
  await pool.query(
    `INSERT INTO public.gr_review_analysis (review_id, method, content_hash, sentiment, confidence, praises, complaints, aspects, model,
       engine_version, score, evidence, terms, language, analyzed_at)
     SELECT x.review_id, x.method, x.content_hash, x.sentiment, x.confidence, COALESCE(x.praises, '{}'), COALESCE(x.complaints, '{}'),
            COALESCE(x.aspects, '{}'), x.model, x.engine_version, x.score, x.evidence, COALESCE(x.terms, '{}'), x.language, now()
     FROM jsonb_to_recordset($1::jsonb) AS x(review_id bigint, method text, content_hash text, sentiment text, confidence numeric,
       praises text[], complaints text[], aspects text[], model text, engine_version text, score numeric, evidence text, terms text[], language text)
     ON CONFLICT (review_id, method) DO UPDATE SET content_hash = EXCLUDED.content_hash, sentiment = EXCLUDED.sentiment,
       confidence = EXCLUDED.confidence, praises = EXCLUDED.praises, complaints = EXCLUDED.complaints,
       aspects = EXCLUDED.aspects, model = EXCLUDED.model, engine_version = EXCLUDED.engine_version, score = EXCLUDED.score,
       evidence = EXCLUDED.evidence, terms = EXCLUDED.terms, language = EXCLUDED.language, analyzed_at = now()`,
    [JSON.stringify(entries)],
  );
}

// The code engine reads a whole page of reviews in milliseconds.
const CODE_BATCH = 500;

async function analyzeStep(run, b, deadline) {
  const method = normaliseMethod(run.method);
  const engine = engineFor(method);
  let analyzed = run.analyzed;
  let touched = false;
  for (;;) {
    const { rows: batch } = await pool.query(
      `SELECT r.id, r.rating, r.text, r.content_hash ${PENDING_SQL} ORDER BY r.review_date DESC NULLS LAST, r.id LIMIT $5`,
      [b.id, run.started_at, method, engine, method === 'code' ? CODE_BATCH : BATCH_SIZE],
    );
    if (!batch.length) break;
    touched = true;

    // No words, nothing to read: rating-only — never judged by its stars.
    const ratingOnly = batch.filter((r) => !r.text || !r.text.trim());
    const withText = batch.filter((r) => r.text && r.text.trim());
    const entries = ratingOnly.map((r) => ({
      review_id: r.id, method, content_hash: r.content_hash, sentiment: 'rating_only', engine_version: engine,
    }));
    if (method === 'code') {
      // No API call on this path, ever.
      for (const r of withText) {
        const x = analyzeText(r.text);
        entries.push({
          review_id: r.id, method, content_hash: r.content_hash, sentiment: x.sentiment, confidence: null,
          praises: x.praises, complaints: x.complaints, aspects: x.aspects, model: null, engine_version: x.engineVersion,
          score: x.score, evidence: x.evidence, terms: x.terms, language: x.language === 'unknown' ? null : x.language,
        });
      }
    } else if (withText.length) {
      const { results, model } = await classifyBatch(withText);
      for (const r of withText) {
        const got = results.get(String(r.id));
        entries.push(got
          ? {
            review_id: r.id,
            method,
            content_hash: r.content_hash,
            sentiment: got.sentiment,
            confidence: got.confidence,
            praises: got.praises,
            complaints: got.complaints,
            aspects: [...new Set([...got.praises, ...got.complaints])],
            model,
            engine_version: engine,
            language: got.language,
          }
          : { review_id: r.id, method, content_hash: r.content_hash, sentiment: 'failed', model, engine_version: engine });
        if (got?.language) await pool.query('UPDATE public.gr_reviews SET language = COALESCE(language, $2) WHERE id = $1', [r.id, got.language]);
      }
    }
    await saveAnalyses(entries);
    analyzed += batch.length;
    run = await saveRun(run.id, { analyzed });
    // One more batch must fit comfortably in what is left of the step.
    if (Date.now() > deadline - (method === 'code' ? 5_000 : 20_000)) return run;
  }
  if (touched) await pool.query('UPDATE public.gr_businesses SET last_analyzed_at = now() WHERE id = $1', [b.id]);
  return saveRun(run.id, { stage: 'summarize' });
}

/* ── Summary ──────────────────────────────────────────────────────────── */

function phraseCounts(reviews, field, limit) {
  const m = new Map();
  for (const r of reviews) for (const p of new Set(r[field] ?? [])) m.set(p, (m.get(p) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([aspect, count]) => ({ aspect, count }));
}

function summaryInput(b, reviews) {
  const read = reviews.filter((r) => SENTIMENTS.includes(r.sentiment));
  const dist = sentimentDistribution(reviews);
  const praises = phraseCounts(read, 'praises', 60);
  const complaints = phraseCounts(read, 'complaints', 60);
  const trend = sentimentTrend(reviews, { granularity: 'month' });
  const samples = new Map();
  const addSamples = (list, field) => {
    for (const { aspect } of list.slice(0, 10)) {
      for (const r of read.filter((x) => x[field].includes(aspect)).slice(0, 2)) {
        if (samples.size >= 40) return;
        samples.set(r.id, { id: String(r.id), stars: r.rating, sentiment: r.sentiment, text: r.text.length > 300 ? `${r.text.slice(0, 300)}…` : r.text });
      }
    }
  };
  addSamples(praises, 'praises');
  addSamples(complaints, 'complaints');
  return {
    business: { name: b.name, category: b.category, google_rating: b.google_rating == null ? null : Number(b.google_rating), google_total_reviews: b.google_total },
    coverage: {
      collected_reviews: reviews.length,
      analyzed_text_reviews: dist.analyzed,
      rating_only_reviews: dist.ratingOnly,
      failed_reviews: dist.failed,
      earliest_review: read.map((r) => r.review_date && new Date(r.review_date).toISOString()).filter(Boolean).sort().at(0) ?? null,
      latest_review: read.map((r) => r.review_date && new Date(r.review_date).toISOString()).filter(Boolean).sort().at(-1) ?? null,
    },
    sentiment_distribution: dist.items,
    rating_distribution: ratingDistribution(reviews).items,
    monthly_trend: trend.points.slice(-12).map((p) => ({ period: p.label, total: p.total, positive_pct: p.positivePct, negative_pct: p.negativePct, partial: p.partial })),
    trend_findings: trendInsights(trend),
    praise_aspects: praises,
    complaint_aspects: complaints,
    sample_reviews: [...samples.values()],
  };
}

// A summary belongs to one method and to the exact readings it was built
// from: the reviews' version plus how many readings that method has and when
// the last one was made. Same signature, no new summary (and no AI call).
async function readingSignature(businessId, method) {
  const { rows } = await pool.query(
    `SELECT b.dataset_version, count(a.review_id)::int AS n, max(a.analyzed_at) AS last
     FROM public.gr_businesses b
     LEFT JOIN public.gr_reviews r ON r.business_id = b.id
     LEFT JOIN public.gr_review_analysis a ON a.review_id = r.id AND a.method = $2
     WHERE b.id = $1 GROUP BY b.dataset_version`,
    [businessId, method],
  );
  const x = rows[0] ?? { dataset_version: 0, n: 0, last: null };
  return { signature: `${x.dataset_version}|${x.n}|${x.last ? new Date(x.last).toISOString() : '-'}|${engineFor(method) ?? '-'}`, readings: x.n, version: x.dataset_version };
}

async function summarizeStep(run, b) {
  const method = normaliseMethod(run.method);
  const { signature, version } = await readingSignature(b.id, method);
  const { rows: have } = await pool.query('SELECT 1 FROM public.gr_summaries WHERE business_id = $1 AND method = $2 AND signature = $3', [b.id, method, signature]);
  if (!have.length) {
    const reviews = await loadReviews(b.id, method);
    if (reviews.some((r) => SENTIMENTS.includes(r.sentiment))) {
      const { summary, model } = method === 'code'
        ? { summary: buildCodeSummary({ business: b, reviews }), model: ENGINE_VERSION }
        : await generateSummary(summaryInput(b, reviews));
      await pool.query(
        `INSERT INTO public.gr_summaries (business_id, dataset_version, summary, model, method, signature) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (business_id, method, signature) DO UPDATE SET summary = EXCLUDED.summary, model = EXCLUDED.model, created_at = now()`,
        [b.id, version, JSON.stringify(summary), model, method, signature],
      );
    }
  }
  return saveRun(run.id, { stage: 'done', status: 'done', finished_at: new Date().toISOString() });
}

/* ── Dashboard ────────────────────────────────────────────────────────── */

async function latestSummary(businessId, method) {
  const m = normaliseMethod(method);
  const { rows } = await pool.query(
    'SELECT summary, model, created_at, signature FROM public.gr_summaries WHERE business_id = $1 AND method = $2 ORDER BY created_at DESC LIMIT 1',
    [businessId, m],
  );
  const s = rows[0];
  if (!s) return null;
  const { signature } = await readingSignature(businessId, m);
  return { ...s.summary, model: s.model, createdAt: s.created_at, stale: s.signature !== signature };
}

// How far each method has got for a business, for the method switch.
async function methodStatus(businessId) {
  const { rows } = await pool.query(
    `SELECT a.method, count(*)::int AS readings, max(a.analyzed_at) AS last
     FROM public.gr_review_analysis a JOIN public.gr_reviews r ON r.id = a.review_id AND a.content_hash = r.content_hash
     WHERE r.business_id = $1 AND (a.method <> 'code' OR a.engine_version = $2)
     GROUP BY a.method`,
    [businessId, ENGINE_VERSION],
  );
  const by = Object.fromEntries(rows.map((r) => [r.method, { readings: r.readings, lastAnalyzedAt: r.last }]));
  return {
    code: { available: true, engine: ENGINE_VERSION, readings: by.code?.readings ?? 0, lastAnalyzedAt: by.code?.lastAnalyzedAt ?? null },
    ai: { available: hasAnyModel(), engine: engineLabel(), readings: by.ai?.readings ?? 0, lastAnalyzedAt: by.ai?.lastAnalyzedAt ?? null },
  };
}

export async function getDashboard(businessId, user, { method } = {}) {
  const b = await getVisibleBusiness(businessId, user);
  const m = normaliseMethod(method);
  const reviews = await loadReviews(b.id, m);
  const read = reviews.filter((r) => SENTIMENTS.includes(r.sentiment));
  const dist = sentimentDistribution(reviews);
  const exclusions = buildExclusions({ businessName: b.name, reviewerNames: reviews.map((r) => r.reviewer_name) });
  const summary = await latestSummary(b.id, m);
  const trend = sentimentTrend(reviews, { granularity: 'month' });
  const run = await latestRun(b.id);
  const methods = await methodStatus(b.id);
  const provider = getReviewsProvider();
  const googleTotal = b.google_total;
  const { rows: imports } = await pool.query(
    `SELECT id, filename, confirmed_at, new_reviews, updated_reviews, valid_rows FROM public.gr_imports
     WHERE business_id = $1 AND status = 'imported' ORDER BY confirmed_at DESC LIMIT 1`,
    [b.id],
  );
  const lastImport = imports[0] ?? null;
  const imported = reviews.filter((r) => r.source === CSV_SOURCE).length;
  // Where the analysis stands, in one word for the page.
  const waiting = dist.pending + dist.failed;
  const hasReadings = reviews.some((r) => r.sentiment);
  const analysisStatus = run?.status === 'running' && normaliseMethod(run.method) === m ? 'running'
    : !reviews.length ? 'empty'
      : m === 'ai' && !hasAnyModel() && waiting > 0 ? 'unavailable'
        : !hasReadings ? 'not_run'
          : waiting > 0 ? 'pending'
            : summary?.stale || (!summary && dist.analyzed) ? 'outdated' : 'done';

  return {
    business: businessOut(b),
    coverage: {
      googleTotal,
      collected: reviews.length,
      analyzed: dist.analyzed,
      ratingOnly: dist.ratingOnly,
      failed: dist.failed,
      pending: dist.pending,
      // Below 95% of what Google reports, the page says the set is partial.
      limited: Boolean(googleTotal && reviews.length < googleTotal * 0.95),
      sourceNote: provider?.coverage === 'limited' && reviews.some((r) => r.source === provider.id) ? provider.coverageNote ?? null : null,
      runNote: run?.coverage_note ?? null,
      earliest: reviews.map((r) => r.review_date && new Date(r.review_date).toISOString()).filter(Boolean).sort().at(0) ?? null,
      latest: reviews.map((r) => r.review_date && new Date(r.review_date).toISOString()).filter(Boolean).sort().at(-1) ?? null,
    },
    sentiment: dist,
    ratings: ratingDistribution(reviews),
    wordCloud: {
      overall: buildWordCloud(read, { exclusions }),
      positive: buildWordCloud(read.filter((r) => r.sentiment === 'positive'), { exclusions }),
      negative: buildWordCloud(read.filter((r) => r.sentiment === 'negative'), { exclusions }),
    },
    trend: { ...trend, insights: trendInsights(trend) },
    topics: summary ? topicStats(summary.topics, read) : [],
    love: summary ? highlightStats(summary.love, read, 'love') : [],
    improve: summary ? highlightStats(summary.improve, read, 'improve') : [],
    summary: summary ? { executive: summary.executive, model: summary.model, createdAt: summary.createdAt, stale: summary.stale, method: m } : null,
    run: runOut(run),
    dataSource: {
      kind: imported === reviews.length && imported ? 'csv' : imported ? 'mixed' : reviews.length ? 'live' : 'none',
      importedReviews: imported,
      lastImport: lastImport && {
        id: Number(lastImport.id), filename: lastImport.filename, at: lastImport.confirmed_at,
        newReviews: lastImport.new_reviews, updatedReviews: lastImport.updated_reviews, rows: lastImport.valid_rows,
      },
      totalAvailable: googleTotal,
      analysis: { status: analysisStatus, waiting, ai: engineLabel() },
    },
    // The method every figure above was read with, and how far each got.
    analysis: { method: m, methods },
  };
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function getTrend(businessId, { granularity, from, to, method }, user) {
  const b = await getVisibleBusiness(businessId, user);
  const reviews = await loadReviews(b.id, method);
  const trend = sentimentTrend(reviews, {
    granularity: granularity === 'week' ? 'week' : 'month',
    from: isDate(from) ? from : undefined,
    to: isDate(to) ? to : undefined,
  });
  return { ...trend, insights: trendInsights(trend) };
}

/* ── Reviews explorer ─────────────────────────────────────────────────── */

const SORTS = {
  newest: (a, b) => (b.review_date ? new Date(b.review_date) : 0) - (a.review_date ? new Date(a.review_date) : 0) || b.id - a.id,
  oldest: (a, b) => (a.review_date ? new Date(a.review_date) : Infinity) - (b.review_date ? new Date(b.review_date) : Infinity) || a.id - b.id,
  rating_desc: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || SORTS.newest(a, b),
  rating_asc: (a, b) => (a.rating ?? 6) - (b.rating ?? 6) || SORTS.newest(a, b),
};

export async function listReviews(businessId, query = {}, user) {
  const b = await getVisibleBusiness(businessId, user);
  const m = normaliseMethod(query.method);
  let reviews = await loadReviews(b.id, m);
  const summary = await latestSummary(b.id, m);
  const topics = summary?.topics ?? [];

  const q = String(query.q ?? '').trim().toLowerCase().slice(0, 100);
  const sentiment = String(query.sentiment ?? '');
  const rating = Number(query.rating);
  const term = String(query.term ?? '').trim().toLowerCase().slice(0, 80);
  const topic = String(query.topic ?? '').trim();

  if (q) reviews = reviews.filter((r) => (r.text ?? '').toLowerCase().includes(q) || (r.owner_response ?? '').toLowerCase().includes(q));
  if (sentiment === 'pending') reviews = reviews.filter((r) => !r.sentiment);
  else if (sentiment) reviews = reviews.filter((r) => r.sentiment === sentiment);
  if (Number.isInteger(rating) && rating >= 1 && rating <= 5) reviews = reviews.filter((r) => r.rating === rating);
  if (isDate(query.from)) {
    const t = new Date(`${query.from}T00:00:00+07:00`).getTime();
    reviews = reviews.filter((r) => r.review_date && new Date(r.review_date).getTime() >= t);
  }
  if (isDate(query.to)) {
    const t = new Date(`${query.to}T23:59:59.999+07:00`).getTime();
    reviews = reviews.filter((r) => r.review_date && new Date(r.review_date).getTime() <= t);
  }
  if (term) {
    const exclusions = buildExclusions({ businessName: b.name, reviewerNames: reviews.map((r) => r.reviewer_name) });
    reviews = reviews.filter((r) => r.text && reviewTerms(r.text, exclusions).has(term));
  }
  if (topic) reviews = reviews.filter((r) => reviewTopics(r, topics).includes(topic));

  reviews.sort(SORTS[query.sort] ?? SORTS.newest);
  const pageSize = Math.min(50, Math.max(5, Number(query.pageSize) || 20));
  const total = reviews.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Number(query.page) || 1));

  return {
    total,
    page,
    pages,
    pageSize,
    items: reviews.slice((page - 1) * pageSize, page * pageSize).map((r) => ({
      id: r.id,
      date: r.review_date,
      datePrecision: r.date_precision ?? null,
      rating: r.rating,
      text: r.text,
      language: r.language,
      sentiment: r.sentiment ?? 'pending',
      confidence: r.confidence,
      score: r.sentiment ? r.score : null,
      evidence: r.sentiment ? r.evidence ?? null : null,
      terms: r.sentiment ? r.terms ?? [] : [],
      detectedLanguage: r.sentiment ? r.detected_language ?? null : null,
      topics: reviewTopics(r, topics),
      ownerResponse: r.owner_response,
      ownerResponseDate: r.owner_response_date,
    })),
  };
}
