import crypto from 'crypto';
import pool from '../../config/db.js';
import { AppError } from '../../utils/errors.js';
import { parseReviewsCsv } from './csvSchema.js';
import { hasAnyModel } from './llm.js';
import {
  CSV_SOURCE, canSee, contentHash, getVisibleBusiness, saveBusinessInfo, upsertReviews,
} from './googleReviewsService.js';

// Google Reviews › CSV import (V1): a file from the ATLAS Google Reviews
// Exporter is previewed, confirmed, then stored and read by the same
// pipeline as any other review.
//
//   preview  — parse and check the file, match it to a business, count what
//              is new / changed / already there. The parsed rows wait in
//              gr_imports.payload; nothing touches the reviews yet.
//   confirm  — one import at a time per business (an advisory lock), upsert
//              by review id, so the same file twice changes nothing and an
//              edited review is read again. The analysis is started after,
//              by the user, with the method they choose.
//   cancel   — drop the waiting rows.
//
// Nothing is deleted because a file lacks a review: a CSV is a sample of the
// page at one moment, not the full truth.

const PREVIEW_TTL_HOURS = 24;
// Google Maps content: kept for a limited time, like the live source.
const RETENTION_DAYS = () => (process.env.GR_CSV_RETENTION_DAYS === '0' ? null : Number(process.env.GR_CSV_RETENTION_DAYS) || 30);
const CHUNK = 500;

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const previewLog = new Map();
function throttle(userId) {
  const now = Date.now();
  const recent = (previewLog.get(userId) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 20) throw new AppError('Terlalu banyak upload dalam 10 menit terakhir. Coba lagi sebentar lagi.', 429);
  recent.push(now);
  previewLog.set(userId, recent);
}

const cleanName = (name) => String(name ?? 'reviews.csv').replace(/[\u0000-\u001f\\/]+/g, '_').slice(0, 200) || 'reviews.csv';

async function expireStale() {
  await pool.query(
    `UPDATE public.gr_imports SET status = 'expired', payload = NULL
     WHERE status = 'previewed' AND created_at < now() - make_interval(hours => $1)`,
    [PREVIEW_TTL_HOURS],
  );
}

// Compare the file with what is stored for that business.
async function compare(businessId, rows) {
  if (!businessId) return null;
  const { rows: existing } = await pool.query(
    'SELECT external_id, content_hash, owner_response FROM public.gr_reviews WHERE business_id = $1 AND external_id = ANY($2)',
    [businessId, rows.map((r) => r.externalId)],
  );
  const byId = new Map(existing.map((e) => [e.external_id, e]));
  let fresh = 0;
  let update = 0;
  let same = 0;
  for (const r of rows) {
    const e = byId.get(r.externalId);
    if (!e) fresh += 1;
    else if (e.content_hash !== contentHash(r) || (e.owner_response ?? null) !== (r.ownerResponse ?? null)) update += 1;
    else same += 1;
  }
  return { newReviews: fresh, mayUpdate: update, existing: update + same, unchanged: same };
}

function importOut(r, extra = {}) {
  return {
    id: Number(r.id),
    businessId: r.business_id == null ? null : Number(r.business_id),
    businessName: r.business_name ?? r.business_meta?.name ?? null,
    status: r.status,
    filename: r.filename,
    schemaVersion: r.schema_version,
    totalRows: r.total_rows,
    validRows: r.valid_rows,
    invalidRows: r.invalid_rows,
    duplicateRows: r.duplicate_rows,
    ratingOnlyRows: r.rating_only_rows,
    newReviews: r.new_reviews,
    updatedReviews: r.updated_reviews,
    unchangedReviews: r.unchanged_reviews,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    issues: r.issues ?? [],
    error: r.error,
    runId: r.run_id == null ? null : Number(r.run_id),
    createdBy: r.created_by_name ?? null,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
    ...extra,
  };
}

export async function previewImport(user, file) {
  if (!file?.buffer) throw new AppError('Pilih file CSV terlebih dahulu.', 400);
  if (!/\.csv$/i.test(file.originalname ?? '')) throw new AppError('File harus berekstensi .csv.', 400);
  throttle(user.userId);
  await expireStale();

  const parsed = parseReviewsCsv(file.buffer);
  if (!parsed.rows.length) {
    throw Object.assign(new AppError('Tidak ada baris ulasan yang valid di file ini.', 400), { details: { issues: parsed.issues, stats: parsed.stats } });
  }

  // Match the business: by the identifier in the file; without one the user
  // chooses (an existing business with that name, or a new one).
  let matched = null;
  let candidates = [];
  if (parsed.business.key) {
    const { rows } = await pool.query('SELECT id, name, address, brand_id, created_by FROM public.gr_businesses WHERE place_id = $1', [parsed.business.key]);
    if (rows[0] && !canSee(user, rows[0])) throw new AppError('Bisnis di file ini sudah dianalisis untuk brand yang tidak bisa Anda akses.', 403);
    matched = rows[0] ?? null;
  } else {
    const { rows } = await pool.query(
      `SELECT id, name, address, brand_id, created_by FROM public.gr_businesses
       WHERE lower(name) = lower($1) OR name ILIKE '%' || $1 || '%' ORDER BY (lower(name) = lower($1)) DESC, id DESC LIMIT 20`,
      [parsed.business.name.slice(0, 200)],
    );
    candidates = rows.filter((r) => canSee(user, r)).slice(0, 8).map((r) => ({ id: Number(r.id), name: r.name, address: r.address }));
  }
  const comparison = await compare(matched?.id, parsed.rows);
  const fileSha = sha(file.buffer);
  const { rows: before } = await pool.query(
    "SELECT confirmed_at FROM public.gr_imports WHERE file_sha = $1 AND status = 'imported' ORDER BY confirmed_at DESC LIMIT 1",
    [fileSha],
  );

  const { rows } = await pool.query(
    `INSERT INTO public.gr_imports (business_id, filename, file_sha, file_bytes, schema_version, business_meta, total_rows, valid_rows,
       invalid_rows, duplicate_rows, rating_only_rows, date_from, date_to, issues, payload, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
    [matched?.id ?? null, cleanName(file.originalname), fileSha, file.buffer.length, parsed.schemaVersion, JSON.stringify(parsed.business),
      parsed.stats.total, parsed.stats.valid, parsed.stats.invalid, parsed.stats.duplicates, parsed.stats.ratingOnly,
      parsed.stats.dateFrom, parsed.stats.dateTo, JSON.stringify(parsed.issues), JSON.stringify(parsed.rows), user.userId],
  );
  return importOut(rows[0], {
    business: parsed.business,
    fromExporter: parsed.fromExporter,
    matchedBusiness: matched ? { id: Number(matched.id), name: matched.name, address: matched.address } : null,
    needsMapping: !parsed.business.key,
    candidates,
    comparison,
    withoutDate: parsed.stats.withoutDate,
    previouslyImportedAt: before[0]?.confirmed_at ?? null,
  });
}

async function claim(user, importId) {
  const id = Number(importId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Import tidak valid.', 400);
  // Only the person who uploaded it confirms it, and only once.
  const { rows } = await pool.query(
    `UPDATE public.gr_imports SET status = 'importing', confirmed_by = $2, confirmed_at = now()
     WHERE id = $1 AND status = 'previewed' AND created_by = $2 RETURNING *`,
    [id, user.userId],
  );
  if (rows[0]) return rows[0];
  const { rows: cur } = await pool.query('SELECT status, created_by FROM public.gr_imports WHERE id = $1', [id]);
  if (!cur[0] || Number(cur[0].created_by) !== Number(user.userId)) throw new AppError('Import tidak ditemukan.', 404);
  const why = { importing: 'sedang diproses', imported: 'sudah diimpor', cancelled: 'sudah dibatalkan', expired: 'kedaluwarsa (lebih dari 24 jam) — upload ulang file-nya', failed: 'gagal — upload ulang file-nya' }[cur[0].status];
  throw new AppError(`Import ini ${why ?? cur[0].status}.`, 409);
}

async function resolveBusiness(user, imp, { businessId, createNew, brandId }) {
  const meta = imp.business_meta ?? {};
  if (businessId) {
    const row = await getVisibleBusiness(businessId, user);
    if (meta.key && row.place_id !== meta.key) {
      throw new AppError('File ini milik bisnis lain (business_id berbeda). Pilih bisnis yang sesuai atau biarkan ATLAS mencocokkannya.', 400);
    }
    return row;
  }
  let key = meta.key;
  if (!key) {
    if (!createNew) throw new AppError('File tanpa business_id: pilih bisnis yang sesuai atau buat bisnis baru.', 400);
    key = `manual:${sha(`${(meta.name ?? '').toLowerCase()}|${(meta.address ?? '').toLowerCase()}`).slice(0, 24)}`;
  }
  const { rows } = await pool.query('SELECT * FROM public.gr_businesses WHERE place_id = $1', [key]);
  if (rows[0]) {
    if (!canSee(user, rows[0])) throw new AppError('Bisnis di file ini sudah dianalisis untuk brand yang tidak bisa Anda akses.', 403);
    return rows[0];
  }
  const created = await saveBusinessInfo({
    placeId: key, name: meta.name, address: meta.address, category: null, mapsUrl: meta.url, rating: meta.rating, totalReviews: meta.totalReviews,
  }, 'csv_import', user.userId);
  if (brandId != null && brandId !== '') {
    const b = Number(brandId);
    const allowed = user.allowedBrandIds;
    if (!Number.isInteger(b) || (allowed?.length && !allowed.includes(b))) throw new AppError('Akses ditolak untuk brand ini', 403);
    await pool.query('UPDATE public.gr_businesses SET brand_id = $2 WHERE id = $1 AND EXISTS (SELECT 1 FROM public.brands WHERE brand_id = $2)', [created.id, b]);
  }
  const { rows: again } = await pool.query('SELECT * FROM public.gr_businesses WHERE id = $1', [created.id]);
  return again[0];
}

export async function confirmImport(user, importId, options = {}) {
  const imp = await claim(user, importId);
  const lockClient = await pool.connect();
  let business = null;
  try {
    business = await resolveBusiness(user, imp, options);
    // One import per business at a time, across every server instance.
    await lockClient.query('SELECT pg_advisory_lock(hashtext($1))', [`gr_business_${business.id}`]);

    const rows = imp.payload ?? [];
    const { rows: existing } = await pool.query(
      'SELECT external_id, source FROM public.gr_reviews WHERE business_id = $1 AND external_id = ANY($2)',
      [business.id, rows.map((r) => r.externalId)],
    );
    // A review already stored (from any source) is updated where it is.
    const sourceOf = new Map(existing.map((e) => [e.external_id, e.source]));
    const groups = new Map();
    for (const r of rows) {
      const src = sourceOf.get(r.externalId) ?? CSV_SOURCE;
      if (!groups.has(src)) groups.set(src, []);
      groups.get(src).push(r);
    }
    let changed = 0;
    let inserted = 0;
    for (const [src, list] of groups) {
      for (let i = 0; i < list.length; i += CHUNK) {
        const res = await upsertReviews(business.id, src, list.slice(i, i + CHUNK), RETENTION_DAYS());
        changed += res.changed;
        inserted += res.inserted;
      }
    }
    const meta = imp.business_meta ?? {};
    await pool.query(
      `UPDATE public.gr_businesses SET
         last_collected_at = now(),
         dataset_version = dataset_version + CASE WHEN $2 > 0 THEN 1 ELSE 0 END,
         google_rating = COALESCE($3, google_rating),
         google_total = COALESCE($4, google_total),
         address = COALESCE(address, $5),
         maps_url = COALESCE(maps_url, $6),
         info_updated_at = CASE WHEN $3 IS NOT NULL OR $4 IS NOT NULL THEN now() ELSE info_updated_at END
       WHERE id = $1`,
      [business.id, changed, meta.rating ?? null, meta.totalReviews ?? null, meta.address ?? null, meta.url ?? null],
    );

    // The analysis is the user's next step: they choose the method (code by
    // default, AI only when they ask) and press Run — nothing is spent here.
    const run = null;
    const { rows: done } = await pool.query(
      `UPDATE public.gr_imports SET status = 'imported', business_id = $2, new_reviews = $3, updated_reviews = $4,
         unchanged_reviews = $5, run_id = $6, payload = NULL
       WHERE id = $1 RETURNING *`,
      [imp.id, business.id, inserted, changed - inserted, rows.length - changed, run?.id ?? null],
    );
    return importOut(done[0], { run, analysis: 'not_run', aiAvailable: hasAnyModel() });
  } catch (err) {
    await pool.query("UPDATE public.gr_imports SET status = 'failed', error = $2, payload = NULL, business_id = COALESCE($3, business_id) WHERE id = $1",
      [imp.id, String(err.message).slice(0, 500), business?.id ?? null]);
    throw err;
  } finally {
    if (business) await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [`gr_business_${business.id}`]).catch(() => {});
    lockClient.release();
  }
}

export async function cancelImport(user, importId) {
  const { rows } = await pool.query(
    `UPDATE public.gr_imports SET status = 'cancelled', payload = NULL
     WHERE id = $1 AND status = 'previewed' AND created_by = $2 RETURNING *`,
    [Number(importId), user.userId],
  );
  if (!rows[0]) throw new AppError('Import tidak ditemukan atau sudah diproses.', 404);
  return importOut(rows[0]);
}

// The history: imports of businesses this account can see, plus its own
// uploads not yet tied to a business.
export async function listImports(user, { businessId } = {}) {
  await expireStale();
  const params = [];
  let where = '';
  if (businessId) {
    await getVisibleBusiness(businessId, user);
    params.push(Number(businessId));
    where = 'WHERE i.business_id = $1';
  }
  const { rows } = await pool.query(
    `SELECT i.id, i.business_id, i.status, i.filename, i.schema_version, i.total_rows, i.valid_rows, i.invalid_rows, i.duplicate_rows,
            i.rating_only_rows, i.new_reviews, i.updated_reviews, i.unchanged_reviews, i.date_from, i.date_to, i.issues, i.error,
            i.run_id, i.created_at, i.confirmed_at, i.created_by, i.business_meta,
            b.name AS business_name, b.brand_id, b.created_by AS business_created_by, u.full_name AS created_by_name
     FROM public.gr_imports i
     LEFT JOIN public.gr_businesses b ON b.id = i.business_id
     LEFT JOIN public.users u ON u.user_id = i.created_by
     ${where}
     ORDER BY i.created_at DESC LIMIT 200`,
    params,
  );
  return rows
    .filter((r) => (r.business_id
      ? canSee(user, { brand_id: r.brand_id, created_by: r.business_created_by })
      : Number(r.created_by) === Number(user.userId)))
    .slice(0, 50)
    .map((r) => importOut(r));
}
