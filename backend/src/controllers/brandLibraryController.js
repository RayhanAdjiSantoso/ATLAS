import { v4 as uuidv4 } from 'uuid';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as uploadService from '../services/uploadService.js';
import { processUpload } from '../services/import/importService.js';
import * as brandService from '../services/brandService.js';
import * as library from '../services/brandLibraryService.js';

async function requireBrand(brandId) {
  const brand = await brandService.getBrandById(brandId);
  if (!brand) throw new AppError('Brand tidak ditemukan', 404);
  return brand;
}

function parseBrandId(req) {
  const brandId = Number(req.params.brandId);
  if (!Number.isInteger(brandId) || brandId <= 0) throw new AppError('brandId tidak valid', 400);
  return brandId;
}

export const getProfile = asyncHandler(async (req, res) => {
  const brandId = parseBrandId(req);
  await requireBrand(brandId);
  res.json({ profile: await library.getProfile(brandId) });
});

export const saveProfile = asyncHandler(async (req, res) => {
  const brandId = parseBrandId(req);
  await requireBrand(brandId);
  const profile = await library.saveProfile(brandId, req.body ?? {}, req.user?.userId);
  res.json({ profile });
});

export const listLibrary = asyncHandler(async (req, res) => {
  const brandId = parseBrandId(req);
  await requireBrand(brandId);
  res.json({ files: await library.listLibrary(brandId), channels: library.LIBRARY_CHANNELS });
});

export const uploadLibraryFile = asyncHandler(async (req, res) => {
  const brandId = parseBrandId(req);
  await requireBrand(brandId);

  const { platform, channel } = req.body;
  const reject = (message) => {
    console.warn('[brand-library] upload ditolak', { brandId, platform, channel, month: req.body.month, file: req.file?.originalname, message });
    return new AppError(message, 400);
  };
  if (!library.isValidScope(platform, channel)) {
    throw reject(`Kombinasi platform "${platform}" dan channel "${channel}" tidak dikenal`);
  }
  if (!req.file) throw reject('File wajib diunggah');

  // "YYYY-MM" — the month slot the user dropped the file into. Reference
  // files (product master) have no month and must not be given one.
  const month = typeof req.body.month === 'string' && /^\d{4}-\d{2}$/.test(req.body.month) ? req.body.month : null;
  const isReference = library.REFERENCE_CHANNELS.has(channel);
  if (!isReference && !month) throw reject('Bulan periode wajib dipilih untuk dataset ini');

  let summary = { periodMonth: null, periodStart: null, periodEnd: null, coveredDays: 0, dayBitmap: null };
  let rowCount = null;
  let periodSource = null;
  let warning = null;
  if (!isReference) {
    // Reading the file is a bonus, never a gate. The library's job is to
    // HOLD the file for the month the user chose; the coverage is derived
    // from it when it can be, and the month shows as a snapshot when it
    // cannot. Refusing the upload because a period was unreadable was the
    // wrong trade — it left the user with no file at all.
    try {
      const analysis = library.analyseFile({ buffer: req.file.buffer, filename: req.file.originalname, month });
      summary = analysis;
      rowCount = analysis.rowCount;
      periodSource = analysis.source;

      if (analysis.declaredRange && !analysis.coveredDays) {
        // The file says which period it covers and it is not this one. The
        // user's slot still wins (they may be filing it deliberately), but
        // silently storing an empty month would hide a real mistake.
        warning = `File ini menyatakan periode ${analysis.declaredRange.start} – ${analysis.declaredRange.end}, di luar bulan yang dipilih. Tersimpan sebagai snapshot — periksa apakah slot bulannya sudah benar.`;
      } else if (!analysis.coveredDays) {
        warning = 'Tanggal tidak terbaca dari isi file — disimpan sebagai snapshot bulanan.';
      }
    } catch (err) {
      summary = library.summarisePeriod([], month);
      warning = 'File tersimpan, tetapi isinya tidak dapat dibaca sebagai spreadsheet, jadi periodenya mengikuti bulan yang dipilih.';
      console.warn('[brand-library] parse failed', { brandId, platform, channel, month, file: req.file.originalname, reason: err.message });
    }
  }

  const existing = await library.findLibraryFile(brandId, platform, channel, summary.periodMonth ?? null);
  const previousUploadId = existing?.dashboard_upload_id ?? null;

  const saved = await library.upsertLibraryFile({
    brandId,
    platform,
    channel,
    periodMonth: summary.periodMonth,
    periodStart: summary.periodStart,
    periodEnd: summary.periodEnd,
    coveredDays: summary.coveredDays,
    dayBitmap: summary.dayBitmap,
    rowCount,
    periodSource,
    filename: req.file.originalname,
    buffer: req.file.buffer,
    userId: req.user?.userId,
  });

  // Storing the bytes is the whole job for Report Generator channels. For
  // the three the Dashboard is built on it is only half: Business Overview
  // reads shopee.* fact tables, so the file has to go through the same
  // importer the old Upload Data tab used, or the dashboard stays at zero
  // while this page reports "100% siap" — exactly the contradiction that
  // sent this page's own hint text ("Data masuk lewat Pengaturan Brand")
  // ahead of what the backend actually did.
  let imported = null;
  const fileType = library.DASHBOARD_FILE_TYPES[channel];
  if (fileType) {
    // A re-upload of the same month replaces the library row; its previous
    // import has to go with it or the fact tables double-count the month.
    if (previousUploadId) {
      try {
        await uploadService.deleteUpload(previousUploadId);
      } catch (err) {
        console.warn('[brand-library] gagal menghapus import lama', { previousUploadId, reason: err.message });
      }
    }

    const uploadId = uuidv4();
    try {
      await uploadService.createUploadRecord({
        uploadId,
        userId: req.user?.userId,
        brandId,
        fileType,
        filename: req.file.originalname,
        rawFile: req.file.buffer,
      });
      const result = await processUpload({ uploadId, fileType, filepath: req.file.buffer, brandId });
      await library.setDashboardUpload(saved.id, uploadId);
      imported = { rowsInserted: result.rowsInserted, period: result.period };

      // The imported rows outrank whatever the filename claimed.
      const synced = await library.syncCoverageFromImport(saved.id, result.period, month);
      if (synced) {
        Object.assign(saved, {
          period_start: synced.periodStart,
          period_end: synced.periodEnd,
          covered_days: synced.coveredDays,
          day_bitmap: synced.dayBitmap,
          period_source: 'import',
        });
        const monthDays = synced.dayBitmap?.length ?? 0;
        if (synced.coveredDays < monthDays) {
          warning = `Isi file hanya mencakup ${synced.periodStart} – ${synced.periodEnd} (${synced.coveredDays} dari ${monthDays} hari). Jika ekspornya terbagi (part 1 of 2), unggah bagian berikutnya ke bulan yang sama.`;
        }
      }
    } catch (err) {
      // The file stays in the library either way — it is still the source of
      // truth for the Report Generator — but the dashboard will not show it,
      // and saying so is the difference between a fixable problem and a
      // mystery.
      imported = { error: err.message };
      console.warn('[brand-library] import ke dashboard gagal', { brandId, channel, month, reason: err.message });
    }
  }

  res.status(201).json({ file: { ...saved, dashboard_upload_id: imported?.error ? null : saved.dashboard_upload_id }, warning, imported });
});

export const deleteLibraryFile = asyncHandler(async (req, res) => {
  const brandId = parseBrandId(req);
  const fileId = Number(req.params.fileId);
  if (!Number.isInteger(fileId)) throw new AppError('fileId tidak valid', 400);
  const deleted = await library.deleteLibraryFile(brandId, fileId);
  if (!deleted) throw new AppError('File tidak ditemukan', 404);
  // Whatever this file put into the dashboard's fact tables goes with it,
  // otherwise removing a file from the library silently leaves its numbers
  // behind on the dashboard.
  if (deleted.dashboard_upload_id) {
    try {
      await uploadService.deleteUpload(deleted.dashboard_upload_id);
    } catch (err) {
      console.warn('[brand-library] gagal menghapus import terkait', { uploadId: deleted.dashboard_upload_id, reason: err.message });
    }
  }
  res.json({ deleted: true });
});

export const downloadLibraryFile = asyncHandler(async (req, res) => {
  const brandId = parseBrandId(req);
  const fileId = Number(req.params.fileId);
  if (!Number.isInteger(fileId)) throw new AppError('fileId tidak valid', 400);
  const file = await library.getLibraryFileBytes(brandId, fileId);
  if (!file?.raw_file) throw new AppError('File tidak ditemukan di server', 404);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_filename)}"`);
  res.send(file.raw_file);
});
