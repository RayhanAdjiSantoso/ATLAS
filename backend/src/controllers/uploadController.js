import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { validationResult } from 'express-validator';
import { AppError, asyncHandler } from '../utils/errors.js';
import * as uploadService from '../services/uploadService.js';
import * as brandService from '../services/brandService.js';
import { processUpload } from '../services/import/importService.js';

function validate(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new AppError('Validasi gagal', 400, errors.array());
  }
}

function toArray(value) {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

export const uploadFile = asyncHandler(async (req, res) => {
  validate(req);

  if (!req.file) {
    throw new AppError('File Excel wajib diunggah', 400);
  }

  const { brandId, fileType } = req.body;
  const uploadId = req.uploadId || uuidv4();
  const storedPath = req.file.path;

  const brand = await brandService.getBrandById(Number(brandId));
  if (!brand) {
    throw new AppError('Brand tidak ditemukan', 400);
  }

  await uploadService.createUploadRecord({
    uploadId,
    userId: req.user.userId,
    brandId: brand.brand_id,
    fileType,
    filename: req.file.originalname,
    storedPath,
  });

  // Process synchronously for reliable status; can be made async later
  try {
    const result = await processUpload({
      uploadId,
      fileType,
      filepath: storedPath,
      brandId: brand.brand_id,
    });

    res.status(201).json({
      message: 'Upload dan import berhasil',
      uploadId,
      status: 'success',
      rowsInserted: result.rowsInserted,
      period: result.period,
    });
  } catch (err) {
    res.status(422).json({
      message: 'Upload tercatat tetapi import gagal',
      uploadId,
      status: 'failed',
      error: err.message,
    });
  }
});

export const listUploads = asyncHandler(async (req, res) => {
  validate(req);

  const uploads = await uploadService.listUploads({
    userId: req.user.userId,
    role: req.user.role,
    filters: {
      brand: toArray(req.query.brand),
      fileType: toArray(req.query.fileType),
      userId: toArray(req.query.userId),
      periodStart: req.query.periodStart,
      periodEnd: req.query.periodEnd,
    },
  });

  res.json({ uploads });
});

export const getUpload = asyncHandler(async (req, res) => {
  const upload = await uploadService.getUploadById(req.params.uploadId);
  if (!upload) throw new AppError('Upload tidak ditemukan', 404);

  if (req.user.role !== 'admin' && upload.user_id !== req.user.userId) {
    throw new AppError('Akses ditolak', 403);
  }

  res.json({ upload });
});

// Admin-only: stream the original uploaded Excel file back as-is (the
// stored file already is the file the user uploaded, in whatever Excel
// format -- .xlsx or .xls -- it was submitted in; multer's fileFilter only
// ever accepts those two).
export const downloadUpload = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw new AppError('Akses ditolak', 403);
  }

  const upload = await uploadService.getUploadFileById(req.params.uploadId);
  if (!upload) throw new AppError('Upload tidak ditemukan', 404);

  // Report Generator rows have no stored_path -- their file lives as BYTEA
  // in ads_reports.raw_uploads (raw_upload_id), never written to disk.
  if (upload.source === 'report_generator') {
    if (!upload.raw_upload_id) throw new AppError('File tidak ditemukan di server', 404);
    const file = await uploadService.getReportGeneratorFile(upload.raw_upload_id);
    if (!file?.raw_file) throw new AppError('File tidak ditemukan di server', 404);
    res.setHeader('Content-Disposition', `attachment; filename="${(file.original_filename || upload.original_filename).replace(/"/g, '')}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(file.raw_file);
    return;
  }

  try {
    await fs.access(upload.stored_path);
  } catch {
    throw new AppError('File tidak ditemukan di server', 404);
  }

  res.download(upload.stored_path, upload.original_filename);
});

export const deleteUpload = asyncHandler(async (req, res) => {
  const upload = await uploadService.getUploadById(req.params.uploadId);
  if (!upload) throw new AppError('Upload tidak ditemukan', 404);

  if (req.user.role !== 'admin' && upload.user_id !== req.user.userId) {
    throw new AppError('Akses ditolak', 403);
  }

  const deleted = await uploadService.deleteUpload(req.params.uploadId);

  if (deleted?.stored_path) {
    await fs.rm(path.dirname(deleted.stored_path), { recursive: true, force: true }).catch(() => {});
  }

  res.json({ message: 'Upload berhasil dihapus' });
});

export const getFilterOptions = asyncHandler(async (req, res) => {
  const brands = await uploadService.listBrandsForFilter();
  const users = req.user.role === 'admin'
    ? await uploadService.listUsersForFilter()
    : [];

  res.json({ brands, users });
});
