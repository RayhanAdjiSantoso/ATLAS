import { AppError, asyncHandler } from '../utils/errors.js';
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

  res.status(201).json({ file: saved, warning });
});

export const deleteLibraryFile = asyncHandler(async (req, res) => {
  const brandId = parseBrandId(req);
  const fileId = Number(req.params.fileId);
  if (!Number.isInteger(fileId)) throw new AppError('fileId tidak valid', 400);
  const deleted = await library.deleteLibraryFile(brandId, fileId);
  if (!deleted) throw new AppError('File tidak ditemukan', 404);
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
