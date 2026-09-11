import { Router } from 'express';
import * as ai from '../../services/aiSummaryService.js';
import * as brandService from '../../services/brandService.js';
import * as library from '../../services/brandLibraryService.js';

// AI Summary — satu ringkasan terstruktur per brand + platform + periode.
//
// Router terpisah dengan tetangganya (reports/savedPeriods/productMaster)
// dan dipasang di reportGeneratorRoutes.js, jadi `authenticate` sudah
// berlaku sebelum apa pun di sini jalan.
export const aiSummaryRouter = Router();

const PLATFORMS = ['meta', 'shopee', 'tiktok'];

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

// GET /?client_id=&platform=  — riwayat ringkasan brand ini (bagian C).
aiSummaryRouter.get('/', async (req, res) => {
  const brandId = Number(req.query.client_id);
  const platform = typeof req.query.platform === 'string' ? req.query.platform : null;
  if (!Number.isInteger(brandId)) return fail(res, 400, 'client_id wajib diisi');
  if (platform && !PLATFORMS.includes(platform)) return fail(res, 400, 'platform tidak dikenal');
  res.json({ summaries: await ai.listForBrand(brandId, platform) });
});

// POST /  — hasilkan (atau ambil dari cache) ringkasan untuk payload ini.
//
// Body: { client_id, platform, period, performance, refresh? }
// `performance` datang jadi dari frontend — angka yang SUDAH dihitung oleh
// Report Generator, bukan data mentah. Backend sengaja tidak menghitung
// ulang: yang dibaca model harus persis yang dilihat pengguna di layar.
aiSummaryRouter.post('/', async (req, res) => {
  const brandId = Number(req.body?.client_id);
  const { platform, period, performance, refresh } = req.body ?? {};

  if (!Number.isInteger(brandId)) return fail(res, 400, 'client_id wajib diisi');
  if (!PLATFORMS.includes(platform)) return fail(res, 400, 'platform tidak dikenal');
  if (!performance?.kpis?.length) return fail(res, 400, 'Belum ada data performa untuk diringkas. Generate laporannya dulu.');

  const brand = await brandService.getBrandById(brandId);
  if (!brand) return fail(res, 404, 'Brand tidak ditemukan');

  const profile = await library.getProfile(brandId);

  // Hash dihitung dari apa yang benar-benar memengaruhi jawaban model:
  // angka periode ini plus konteks brand. Konteks brand ikut karena
  // mengubah objective di Pengaturan Brand memang harus menghasilkan
  // ringkasan yang berbeda walau angkanya sama.
  const cacheInput = {
    prompt_version: ai.PROMPT_VERSION,
    platform,
    period,
    performance,
    profile: profile && {
      brand_products_customer: profile.brand_products_customer,
      positioning_driver: profile.positioning_driver,
      key_products_channels: profile.key_products_channels,
      business_characteristics: profile.business_characteristics,
      historical_learning: profile.historical_learning,
      objective_target: profile.objective_target,
      strategic_priorities: profile.strategic_priorities,
      constraints_concerns: profile.constraints_concerns,
    },
  };
  const payloadHash = ai.hashPayload(cacheInput);

  if (!refresh) {
    const cached = await ai.findCached(brandId, platform, payloadHash);
    if (cached) return res.json({ summary: cached, cached: true });
  }

  const history = await ai.listHistory(brandId, platform, payloadHash);
  const prompt = ai.buildPrompt({
    brandName: brand.brand_name,
    platform,
    period,
    profile,
    history,
    performance,
  });

  try {
    const summary = await ai.callGemini(prompt);
    const saved = await ai.saveSummary({
      brandId, platform, period, payloadHash,
      inputPayload: { prompt, cacheInput },
      summary,
      userId: req.user?.userId,
    });
    res.json({ summary: saved, cached: false });
  } catch (err) {
    // Gagalnya AI tidak boleh terlihat seperti gagalnya laporan: status dan
    // pesannya spesifik, dan frontend merender ini sebagai satu kartu error
    // di bawah laporan yang tetap utuh.
    if (err instanceof ai.AiSummaryError) {
      console.warn('[ai-summary] gagal', { brandId, platform, reason: err.message });
      return fail(res, err.statusCode, err.message);
    }
    throw err;
  }
});

// PUT /:id  — simpan hasil suntingan tim (draft AI tetap tersimpan apa adanya).
aiSummaryRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const brandId = Number(req.body?.client_id);
  if (!Number.isInteger(id) || !Number.isInteger(brandId)) return fail(res, 400, 'id dan client_id wajib diisi');
  const updated = await ai.saveEdit(id, brandId, req.body?.summary ?? {}, req.user?.userId);
  if (!updated) return fail(res, 404, 'Ringkasan tidak ditemukan');
  res.json({ summary: updated });
});
