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
    console.warn('[brand-library] upload ditolak', { brandId, platform, channel, month: req.body.month, message });
    return new AppError(message, 400);
  };
  if (!library.isValidScope(platform, channel)) {
    throw reject(`Kombinasi platform "${platform}" dan channel "${channel}" tidak dikenal`);
  }

  // multer .array: one slot can receive several files at once, which is how
  // a split export ("part 1 of 2") is filed in a single action.
  const files = req.files ?? [];
  if (!files.length) throw reject('File wajib diunggah');

  const month = typeof req.body.month === 'string' && /^\d{4}-\d{2}$/.test(req.body.month) ? req.body.month : null;
  const replaceFileId = req.body.replaceFileId == null || req.body.replaceFileId === '' ? null : Number(req.body.replaceFileId);
  const isReference = library.REFERENCE_CHANNELS.has(channel);
  if (!isReference && !month) throw reject('Bulan periode wajib dipilih untuk dataset ini');
  if (isReference && files.length > 1) throw reject('Dataset referensi hanya menerima satu file');
  if (replaceFileId != null && (!Number.isInteger(replaceFileId) || replaceFileId <= 0)) throw reject('File yang akan diganti tidak valid');
  if (replaceFileId != null && files.length !== 1) throw reject('Penggantian file hanya menerima satu file baru');

  const saved = [];
  const warnings = [];
  let imported = null;

  for (const file of files) {
    const result = await storeOnePart({ req, brandId, platform, channel, month, isReference, file, replaceFileId });
    saved.push(result.file);
    if (result.warning) warnings.push(result.warning);
    if (result.imported) {
      imported = imported ?? { rowsInserted: 0, files: 0, errors: [] };
      if (result.imported.error) imported.errors.push(`${file.originalname}: ${result.imported.error}`);
      else {
        imported.rowsInserted += result.imported.rowsInserted;
        imported.files += 1;
      }
    }
  }

  res.status(201).json({ files: saved, file: saved[0], warning: warnings[0] ?? null, warnings, imported });
});

// One part: read it, file it under the right part number, and — for the three
// Dashboard datasets — parse it into the fact tables Business Overview reads.
async function storeOnePart({ req, brandId, platform, channel, month, isReference, file, replaceFileId }) {
  let summary = { periodMonth: null, periodStart: null, periodEnd: null, coveredDays: 0, dayBitmap: null };
  let rowCount = null;
  let periodSource = null;
  let warning = null;

  if (!isReference) {
    // Reading the file is a bonus, never a gate. The library's job is to HOLD
    // the file for the month the user chose; coverage is derived from it when
    // it can be, and the month shows as a snapshot when it cannot.
    try {
      const analysis = library.analyseFile({ buffer: file.buffer, filename: file.originalname, month });
      summary = analysis;
      rowCount = analysis.rowCount;
      periodSource = analysis.source;

      // File yang periodenya jelas-jelas di luar bulan pilihan diberi tanda
      // permanen, bukan hanya peringatan sekali lewat. Tanpa itu keadaannya
      // hanya tampil sebagai "snapshot" — sama seperti file yang tanggalnya
      // memang tidak terbaca — dan pengguna tidak punya cara tahu bahwa
      // sebenarnya filenya salah slot bulan.
      if (analysis.declaredRange && !analysis.coveredDays) periodSource = 'mismatch';

      if (analysis.declaredRange && !analysis.coveredDays) {
        warning = `${file.originalname}: file menyatakan periode ${analysis.declaredRange.start} – ${analysis.declaredRange.end}, di luar bulan yang dipilih. Tersimpan sebagai snapshot — periksa apakah slot bulannya sudah benar.`;
      } else if (!analysis.coveredDays) {
        warning = `${file.originalname}: tanggal tidak terbaca dari isi file — disimpan sebagai snapshot bulanan.`;
      }
    } catch (err) {
      summary = library.summarisePeriod([], month);
      warning = `${file.originalname}: isinya tidak dapat dibaca sebagai spreadsheet, jadi periodenya mengikuti bulan yang dipilih.`;
      console.warn('[brand-library] parse failed', { brandId, platform, channel, month, file: file.originalname, reason: err.message });
    }
  }

  const parts = await library.listSlotParts(brandId, platform, channel, summary.periodMonth ?? null);
  const sameName = parts.some((part) => part.original_filename === file.originalname);
  const explicitlySplit = /(?:^|[\s_.-])part[\s_.-]*\d+(?:[\s_.-]*(?:of|dari)[\s_.-]*\d+)?/i.test(file.originalname);
  if (replaceFileId == null && !sameName && !explicitlySplit && library.hasCoverageOverlap(parts, summary.dayBitmap)) {
    throw new AppError('Tanggal file bertumpang tindih dengan file yang sudah ada. Gunakan Ganti untuk file pembaruan, atau unggah file dengan penanda part jika ekspornya memang terpecah.', 409);
  }
  const placement = library.placePart(parts, file.originalname, replaceFileId);
  if (!placement) throw new AppError('File yang akan diganti tidak ditemukan pada brand, dataset, dan bulan ini', 400);
  const { partIndex, previousUploadId } = placement;

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
    partIndex,
    filename: file.originalname,
    buffer: file.buffer,
    userId: req.user?.userId,
  });

  // Storing the bytes is the whole job for Report Generator channels. For the
  // three the Dashboard is built on it is only half: Business Overview reads
  // shopee.* fact tables, so the file has to go through the same importer the
  // old Upload Data tab used. Parts merge safely there — every loader
  // de-duplicates on a natural key — so part 2 continues part 1 rather than
  // doubling the days they share.
  let imported = null;
  const fileType = library.DASHBOARD_FILE_TYPES[channel];
  if (fileType) {
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
        filename: file.originalname,
        rawFile: file.buffer,
      });
      const result = await processUpload({
        uploadId, fileType, filepath: file.buffer, brandId, filename: file.originalname,
      });
      await library.setDashboardUpload(saved.id, uploadId);
      await library.setImportResult(saved.id, { status: 'success', rows: result.rowsInserted, uploadId });
      Object.assign(saved, { import_status: 'success', import_error: null, import_rows: result.rowsInserted, dashboard_upload_id: uploadId });
      imported = { rowsInserted: result.rowsInserted };

      // The imported rows outrank whatever the filename claimed: a name is
      // the range that was requested, the rows are what arrived.
      const synced = await library.syncCoverageFromImport(saved.id, result.period, month);
      if (synced) {
        Object.assign(saved, {
          period_start: synced.periodStart,
          period_end: synced.periodEnd,
          covered_days: synced.coveredDays,
          day_bitmap: synced.dayBitmap,
          period_source: synced.source,
        });
      }
    } catch (err) {
      // Filenya tetap tersimpan — byte-nya berguna untuk impor ulang — tapi
      // barisnya ditandai gagal supaya UI tidak menampilkan "Lengkap" untuk
      // periode yang tabel faktanya kosong.
      await library.setImportResult(saved.id, { status: 'failed', error: err.message });
      Object.assign(saved, { import_status: 'failed', import_error: err.message, import_rows: null, dashboard_upload_id: null });
      imported = { error: err.message };
      console.warn('[brand-library] import ke dashboard gagal', { brandId, channel, month, file: file.originalname, reason: err.message });
    }
  } else {
    await library.setImportResult(saved.id, { status: 'not_applicable' });
    Object.assign(saved, { import_status: 'not_applicable' });
  }

  return { file: saved, warning, imported };
}

// Impor ulang satu file yang sudah ada di perpustakaan. Dipakai saat impor
// pertamanya gagal (paling sering: function serverless kehabisan waktu), dan
// menghindari kewajiban mengunggah ulang file yang byte-nya sudah tersimpan.
export const reimportLibraryFile = asyncHandler(async (req, res) => {
  const brandId = parseBrandId(req);
  const fileId = Number(req.params.fileId);
  if (!Number.isInteger(fileId)) throw new AppError('fileId tidak valid', 400);

  const file = await library.getFileForImport(brandId, fileId);
  if (!file) throw new AppError('File tidak ditemukan', 404);

  const fileType = library.DASHBOARD_FILE_TYPES[file.channel];
  if (!fileType) throw new AppError('Dataset ini tidak dibaca Dashboard, jadi tidak perlu diimpor', 400);
  if (!file.raw_file) throw new AppError('Byte file tidak tersimpan, unggah ulang filenya', 400);

  // Impor sebelumnya (kalau ada) dihapus dulu supaya tabel fakta tidak
  // menggandakan periode yang sama.
  if (file.dashboard_upload_id) {
    try {
      await uploadService.deleteUpload(file.dashboard_upload_id);
    } catch (err) {
      console.warn('[brand-library] gagal menghapus import lama', { id: file.dashboard_upload_id, reason: err.message });
    }
  }

  const uploadId = uuidv4();
  try {
    await uploadService.createUploadRecord({
      uploadId,
      userId: req.user?.userId ?? file.uploaded_by,
      brandId,
      fileType,
      filename: file.original_filename,
      rawFile: file.raw_file,
    });
    const result = await processUpload({ uploadId, fileType, filepath: file.raw_file, brandId });
    await library.setDashboardUpload(fileId, uploadId);
    await library.setImportResult(fileId, { status: 'success', rows: result.rowsInserted, uploadId });
    const synced = await library.syncCoverageFromImport(fileId, result.period, file.period_month?.slice(0, 7));
    res.json({ imported: { rowsInserted: result.rowsInserted, period: result.period, coverage: synced } });
  } catch (err) {
    await library.setImportResult(fileId, { status: 'failed', error: err.message });
    console.warn('[brand-library] impor ulang gagal', { brandId, fileId, reason: err.message });
    throw new AppError(`Impor ulang gagal: ${err.message}`, 422);
  }
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
