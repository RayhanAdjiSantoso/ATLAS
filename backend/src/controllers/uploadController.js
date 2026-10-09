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

export const uploadFile = asyncHandler(async (req, res) => {
  validate(req);

  if (!req.file) {
    throw new AppError('File Excel wajib diunggah', 400);
  }

  const { brandId, fileType } = req.body;
  const uploadId = uuidv4();
  const rawFile = req.file.buffer;

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
    rawFile,
  });

  // Process synchronously for reliable status; can be made async later
  try {
    const result = await processUpload({
      uploadId,
      fileType,
      filepath: rawFile,
      brandId: brand.brand_id,
      filename: req.file.originalname,
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
