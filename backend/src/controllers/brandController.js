import { AppError, asyncHandler } from '../utils/errors.js';
import * as brandService from '../services/brandService.js';

export const listBrands = asyncHandler(async (req, res) => {
  const brands = await brandService.listBrands(req.user.allowedBrandId);
  res.json({ brands });
});

export const createBrand = asyncHandler(async (req, res) => {
  const { brandName } = req.body;
  if (typeof brandName !== 'string' || !brandName.trim()) {
    throw new AppError('Nama brand wajib diisi', 400);
  }

  if ([...brandName.trim()].length > 150) throw new AppError('Nama brand maksimal 150 karakter', 400);

  const existing = await brandService.findBrandByName(brandName);
  if (existing) {
    throw new AppError(`Brand "${existing.brand_name}" sudah terdaftar`, 409, { brand: existing });
  }

  try {
    const brand = await brandService.createBrand(brandName);
    res.status(201).json({ brand });
  } catch (err) {
    if (err.code === '23505') throw new AppError('Brand sudah terdaftar', 409);
    throw err;
  }
});

export const updateBrandStatus = asyncHandler(async (req, res) => {
  const brandId = Number(req.params.brandId);
  const { status } = req.body;
  if (!Number.isSafeInteger(brandId) || brandId <= 0) throw new AppError('Brand ID tidak valid', 400);
  if (!['active', 'off', 'freeze'].includes(status)) throw new AppError('Status brand tidak valid', 400);
  const brand = await brandService.updateBrandStatus(brandId, status);
  if (!brand) throw new AppError('Brand tidak ditemukan', 404);
  res.json({ brand });
});

const parseBrandId = (raw) => {
  const brandId = Number(raw);
  if (!Number.isSafeInteger(brandId) || brandId <= 0) throw new AppError('Brand ID tidak valid', 400);
  return brandId;
};

// What deleting this brand would meet: data that blocks it, settings that go with it.
export const getBrandDeleteCheck = asyncHandler(async (req, res) => {
  const brandId = parseBrandId(req.params.brandId);
  const brand = await brandService.getBrandById(brandId);
  if (!brand) throw new AppError('Brand tidak ditemukan', 404);
  const refs = await brandService.getBrandReferences(brandId);
  res.json({ brand, canDelete: refs.blocking.length === 0, ...refs });
});

export const deleteBrand = asyncHandler(async (req, res) => {
  const brandId = parseBrandId(req.params.brandId);
  const result = await brandService.deleteBrand(brandId);
  if (result.notFound) throw new AppError('Brand tidak ditemukan', 404);
  if (!result.deleted) {
    throw new AppError('Brand ini masih punya data, jadi tidak bisa dihapus. Ubah statusnya menjadi Nonaktif.', 409, { blocking: result.blocking });
  }
  res.json({ deleted: true, brand: result.brand, cleared: result.cleared });
});
