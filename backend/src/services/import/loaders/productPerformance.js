import {
  blankToNone,
  parseIdr,
  parseIntValue,
  parsePct,
  parseTs,
  readSheetAsStrings,
  readWorkbook,
  toDateString,
} from '../parsers.js';
import { deriveReportPeriod } from './performanceOverview.js';

export function detectProductPerformancePeriod(filepath) {
  const wb = readWorkbook(filepath);

  // Try "Produk yang Baru Ditambahkan" dates
  try {
    const rows = readSheetAsStrings(wb, 'Produk yang Baru Ditambahkan');
    const dates = rows
      .map((r) => parseTs(r['Tanggal Dibuat'], '%d-%m-%Y') || parseTs(r['Tanggal Dibuat']))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (dates.length > 0) {
      const start = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1);
      const end = new Date(dates[dates.length - 1].getFullYear(), dates[dates.length - 1].getMonth() + 1, 0);
      return { start: toDateString(start), end: toDateString(end) };
    }
  } catch {
    // sheet may be empty
  }

  return { start: null, end: null };
}

async function upsertProduct(client, resolver, brandId, productId, productName, statusName) {
  const statusId = await resolver.getOrCreateOne(
    'product_statuses', 'status_id', 'status_name', blankToNone(statusName),
  );
  await client.query(
    `INSERT INTO products (product_id, product_name, product_status_id, brand_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_id) DO UPDATE
       SET product_name = EXCLUDED.product_name,
           product_status_id = EXCLUDED.product_status_id,
           brand_id = COALESCE(products.brand_id, EXCLUDED.brand_id)`,
    [productId, productName, statusId, brandId],
  );
}

export async function loadProductPerformance(client, resolver, filepath, brandId, uploadId, periodId) {
  const wb = readWorkbook(filepath);
  const rows = readSheetAsStrings(wb, 'Produk dengan Performa Terbaik').filter((row) => {
    const variant = blankToNone(row['Kode Variasi']);
    return variant == null;
  });

  let inserted = 0;

  for (const row of rows) {
    const productId = parseIntValue(row['Kode Produk']);
    if (!productId) continue;

    await upsertProduct(client, resolver, brandId, productId, row['Produk'], row['Status Produk Saat Ini']);

    const statusId = await resolver.getOrCreateOne(
      'product_statuses', 'status_id', 'status_name', blankToNone(row['Status Produk Saat Ini']),
    );

    const result = await client.query(
      `INSERT INTO product_performance_summary (
        period_id, product_id, product_status_id,
        product_views, product_clicks, click_percentage,
        orders_created, orders_ready_to_ship,
        sales_created_idr, sales_ready_to_ship_idr,
        unique_viewers, unique_clickers, product_page_visitors, product_page_views,
        visitors_no_purchase, no_purchase_rate, search_clicks, likes,
        cart_visitors, cart_adds, cart_conversion_rate,
        products_ordered_created, products_ordered_ready_to_ship,
        buyers_created, buyers_ready_to_ship,
        created_order_conversion_rate, ready_to_ship_conversion_rate,
        sales_per_order_created, sales_per_order_ready_to_ship,
        repeat_order_rate_created, repeat_purchase_pct_ready_to_ship,
        avg_days_repeat_order_created, avg_days_repeat_purchase_ready_to_ship,
        brand_id, upload_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35
      ) ON CONFLICT (brand_id, period_id, product_id) DO NOTHING RETURNING id`,
      [
        periodId, productId, statusId,
        parseIntValue(row['Jumlah Produk Dilihat']) ?? 0,
        parseIntValue(row['Produk Diklik']) ?? 0,
        parsePct(row['Persentase Klik']),
        parseIntValue(row['Pesanan Dibuat']) ?? 0,
        parseIntValue(row['Pesanan Siap Dikirim']) ?? 0,
        parseIdr(row['Total Penjualan (Pesanan Dibuat) (IDR)']) ?? 0,
        parseIdr(row['Penjualan (Pesanan Siap Dikirim) (IDR)']) ?? 0,
        parseIntValue(row['Produk Unik Dilihat']) ?? 0,
        parseIntValue(row['Produk Unik Diklik']) ?? 0,
        parseIntValue(row['Pengunjung Produk (Kunjungan)']) ?? 0,
        parseIntValue(row['Halaman Produk Dilihat']) ?? 0,
        parseIntValue(row['Pengunjung Melihat Tanpa Membeli']) ?? 0,
        parsePct(row['Tingkat Pengunjung Melihat Tanpa Membeli']),
        parseIntValue(row['Klik Pencarian']) ?? 0,
        parseIntValue(row['Suka']) ?? 0,
        parseIntValue(row['Pengunjung Produk (Menambahkan Produk ke Keranjang)']) ?? 0,
        parseIntValue(row['Dimasukkan ke Keranjang (Produk)']) ?? 0,
        parsePct(row['Tingkat Konversi Produk Dimasukkan ke Keranjang']),
        parseIntValue(row['Produk (Pesanan Dibuat)']) ?? 0,
        parseIntValue(row['Produk (Pesanan Siap Dikirim)']) ?? 0,
        parseIntValue(row['Total Pembeli (Pesanan Dibuat)']) ?? 0,
        parseIntValue(row['Total Pembeli (Pesanan Siap Dikirim)']) ?? 0,
        parsePct(row['Tingkat Konversi (Pesanan yang Dibuat)']),
        parsePct(row['Tingkat Konversi (Pesanan Siap Dikirim)']),
        parseIdr(row['Penjualan per Pesanan (Pesanan Dibuat) (IDR)']),
        parseIdr(row['Penjualan per Pesanan (Pesanan Siap Dikirim) (IDR)']),
        parsePct(row['Tingkat Pesanan Berulang (Pesanan Dibuat)']),
        parsePct(row['% Pembelian Ulang (Pesanan Siap Dikirim)']),
        parseIdr(row['Rata-rata hari Pesanan Berulang (Pesanan Dibuat)']),
        parseIdr(row['Rata-rata Hari Pembelian Terulang (Pesanan Siap Dikirim)']),
        brandId, uploadId,
      ],
    );
    if (result.rowCount > 0) inserted += 1;
  }

  return inserted;
}

async function upsertProductVariant(client, resolver, brandId, variantId, productId, variantName, statusName) {
  const statusId = await resolver.getOrCreateOne(
    'product_statuses', 'status_id', 'status_name', blankToNone(statusName),
  );
  // variant_sku deliberately left NULL here: the sheet's "SKU Induk" column
  // is the PARENT product's SKU (shared across all its variants), not a
  // per-variant SKU, so writing it here would collide with the partial
  // unique index on variant_sku across sibling variants.
  // brand_id follows the same first-write-wins convention as upsertProduct
  // above (variant_id is a global catalog key, not brand-scoped -- the same
  // sample file can legitimately get uploaded under more than one brand).
  await client.query(
    `INSERT INTO product_variants (variant_id, product_id, variant_name, variant_status_id, brand_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (variant_id) DO UPDATE
       SET product_id = EXCLUDED.product_id,
           variant_name = EXCLUDED.variant_name,
           variant_status_id = EXCLUDED.variant_status_id,
           brand_id = COALESCE(product_variants.brand_id, EXCLUDED.brand_id)`,
    [variantId, productId, variantName, statusId, brandId],
  );
}

// Variant-level rows (Kode Variasi populated, not blank/"-") from the same
// "Produk dengan Performa Terbaik" sheet loadProductPerformance reads —
// these were previously skipped entirely (no loader ever wrote to
// product_variants/product_variant_performance), so the Product Performance
// tab's variant-level view had to be reconstructed from raw orders instead
// of Shopee's own "Pesanan Siap Dikirim" figures. Traffic metrics
// (views/clicks/visitors) are blank ("-") for variant rows in the source
// file, so only sales/order metrics are modeled here.
export async function loadProductVariantPerformance(client, resolver, filepath, brandId, uploadId, periodId) {
  const wb = readWorkbook(filepath);
  const rows = readSheetAsStrings(wb, 'Produk dengan Performa Terbaik').filter((row) => {
    const variant = blankToNone(row['Kode Variasi']);
    return variant != null;
  });

  let inserted = 0;

  for (const row of rows) {
    const productId = parseIntValue(row['Kode Produk']);
    const variantId = parseIntValue(row['Kode Variasi']);
    if (!productId || !variantId) continue;

    await upsertProductVariant(
      client, resolver, brandId, variantId, productId,
      row['Nama Variasi'] ?? '', row['Status Variasi Saat Ini'],
    );
    const statusId = await resolver.getOrCreateOne(
      'product_statuses', 'status_id', 'status_name', blankToNone(row['Status Variasi Saat Ini']),
    );

    const result = await client.query(
      `INSERT INTO product_variant_performance (
        period_id, variant_id, variant_status_id,
        orders_created, orders_ready_to_ship,
        buyers_created, buyers_ready_to_ship,
        sales_created_idr, sales_ready_to_ship_idr,
        products_ordered_ready_to_ship,
        brand_id, upload_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      ) ON CONFLICT (brand_id, period_id, variant_id) DO NOTHING RETURNING id`,
      [
        periodId, variantId, statusId,
        parseIntValue(row['Pesanan Dibuat']) ?? 0,
        parseIntValue(row['Pesanan Siap Dikirim']) ?? 0,
        parseIntValue(row['Total Pembeli (Pesanan Dibuat)']) ?? 0,
        parseIntValue(row['Total Pembeli (Pesanan Siap Dikirim)']) ?? 0,
        parseIdr(row['Total Penjualan (Pesanan Dibuat) (IDR)']) ?? 0,
        parseIdr(row['Penjualan (Pesanan Siap Dikirim) (IDR)']) ?? 0,
        parseIntValue(row['Produk (Pesanan Siap Dikirim)']) ?? 0,
        brandId, uploadId,
      ],
    );
    if (result.rowCount > 0) inserted += 1;
  }

  return inserted;
}

export async function applyPriceCompetitiveness(client, resolver, filepath, brandId, periodId, sheetName) {
  const wb = readWorkbook(filepath);
  const rows = readSheetAsStrings(wb, sheetName);
  const statusId = await resolver.getOrCreateOne(
    'price_competitiveness_statuses', 'status_id', 'status_name', sheetName,
  );

  let updated = 0;
  for (const row of rows) {
    const productId = parseIntValue(row['Kode Produk']);
    if (!productId) continue;
    const result = await client.query(
      `UPDATE product_performance_summary
       SET price_competitiveness_status_id = $1
       WHERE brand_id = $2 AND period_id = $3 AND product_id = $4`,
      [statusId, brandId, periodId, productId],
    );
    updated += result.rowCount;
  }
  return updated;
}

export async function applyAdsRecommendation(client, resolver, filepath, brandId, periodId, sheetName) {
  const wb = readWorkbook(filepath);
  const rows = readSheetAsStrings(wb, sheetName);
  const stageId = await resolver.getOrCreateOne(
    'ads_recommendation_stages', 'stage_id', 'stage_name', sheetName,
  );

  let updated = 0;
  for (const row of rows) {
    const productId = parseIntValue(row['Kode Produk']);
    if (!productId) continue;
    const result = await client.query(
      `UPDATE product_performance_summary
       SET ads_recommendation_stage_id = $1
       WHERE brand_id = $2 AND period_id = $3 AND product_id = $4`,
      [stageId, brandId, periodId, productId],
    );
    updated += result.rowCount;
  }
  return updated;
}

export async function resolvePeriodId(client, resolver, filepath, brandId) {
  // Prefer deriving from linked performance overview upload for same brand
  const recent = await client.query(
    `SELECT period_start, period_end FROM uploads
     WHERE brand_id = $1 AND file_type = 'performance_overview'
       AND status = 'success' AND period_start IS NOT NULL
     ORDER BY uploaded_at DESC LIMIT 1`,
    [brandId],
  );

  if (recent.rows.length > 0) {
    const { period_start, period_end } = recent.rows[0];
    return resolver.getOrCreate(
      'report_periods', 'period_id', ['period_start', 'period_end'],
      [period_start, period_end],
    );
  }

  const detected = detectProductPerformancePeriod(filepath);
  if (detected.start && detected.end) {
    return resolver.getOrCreate(
      'report_periods', 'period_id', ['period_start', 'period_end'],
      [detected.start, detected.end],
    );
  }

  return null;
}

export { deriveReportPeriod };
