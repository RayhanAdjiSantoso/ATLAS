import { AppError, asyncHandler } from '../utils/errors.js';
import * as brandService from '../services/brandService.js';

export const listBrands = asyncHandler(async (req, res) => {
  const brands = await brandService.listBrands();
  res.json({ brands });
});

export const createBrand = asyncHandler(async (req, res) => {
  const { brandName } = req.body;
  if (!brandName || !brandName.trim()) {
    throw new AppError('Nama brand wajib diisi', 400);
  }

  const existing = await brandService.findBrandByName(brandName);
  if (existing) {
    throw new AppError(`Brand "${existing.brand_name}" sudah terdaftar`, 409, { brand: existing });
  }

  const brand = await brandService.createBrand(brandName);
  res.status(201).json({ brand });
});
