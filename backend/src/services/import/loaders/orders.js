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

export function detectOrderPeriod(filepath) {
  const wb = readWorkbook(filepath);
  const rows = readSheetAsStrings(wb, 'orders');
  const dates = rows
    .map((r) => parseTs(r['Waktu Pesanan Dibuat'], '%Y-%m-%d %H:%M'))
    .filter(Boolean);
  if (dates.length === 0) return { start: null, end: null };
  dates.sort((a, b) => a - b);
  return { start: toDateString(dates[0]), end: toDateString(dates[dates.length - 1]) };
}

export async function loadOrders(client, resolver, filepath, brandId, uploadId) {
  const wb = readWorkbook(filepath);
  const rows = readSheetAsStrings(wb, 'orders');

  const grouped = new Map();
  for (const row of rows) {
    const orderId = row['No. Pesanan'];
    if (!orderId) continue;
    if (!grouped.has(orderId)) grouped.set(orderId, []);
    grouped.get(orderId).push(row);
  }

  let inserted = 0;

  for (const [orderId, group] of grouped) {
    const header = group[0];

    const orderStatusId = await resolver.getOrCreateOne(
      'order_statuses', 'order_status_id', 'status_name', header['Status Pesanan'],
    );
    const paymentMethodId = await resolver.getOrCreateOne(
      'payment_methods', 'payment_method_id', 'method_name', blankToNone(header['Metode Pembayaran']),
    );
    const shippingOptionId = await resolver.getOrCreateOne(
      'shipping_options', 'shipping_option_id', 'option_name', blankToNone(header['Opsi Pengiriman']),
    );
    const locationId = await resolver.getOrCreate(
      'locations', 'location_id', ['city', 'province'],
      [blankToNone(header['Kota/Kabupaten']), blankToNone(header['Provinsi'])],
    );
    const customerId = await resolver.getOrCreateOne(
      'customers', 'customer_id', 'username', blankToNone(header['Username (Pembeli)']),
    );

    const result = await client.query(
      `INSERT INTO orders (
        order_id, order_type, order_status_id, cancellation_reason,
        cancellation_return_status, tracking_number, shipping_option_id,
        dropoff_method, ship_by_at, arranged_shipment_at, order_created_at,
        payment_at, payment_method_id, customer_id, receiver_name,
        phone_number, shipping_address, location_id, buyer_note, seller_note,
        total_qty_ordered, total_weight_grams, seller_voucher_amount,
        coin_cashback_amount, shopee_voucher_amount,
        bundle_discount_package_amount, bundle_discount_shopee_amount,
        bundle_discount_seller_amount, shopee_coin_deduction_amount,
        credit_card_discount_amount, shipping_fee_paid_by_buyer,
        estimated_shipping_fee_discount, return_shipping_fee,
        total_payment, estimated_shipping_fee, order_completed_at,
        brand_id, upload_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38
      ) ON CONFLICT (brand_id, order_id) DO NOTHING RETURNING order_id`,
      [
        orderId, blankToNone(header['Tipe Pesanan']), orderStatusId,
        blankToNone(header['Alasan Pembatalan']),
        blankToNone(header['Status Pembatalan/ Pengembalian']),
        blankToNone(header['No. Resi']), shippingOptionId,
        blankToNone(header['Antar ke counter/ pick-up']),
        parseTs(header['Pesanan Harus Dikirimkan Sebelum (Menghindari keterlambatan)'], '%Y-%m-%d %H:%M'),
        parseTs(header['Waktu Pengiriman Diatur'], '%Y-%m-%d %H:%M'),
        parseTs(header['Waktu Pesanan Dibuat'], '%Y-%m-%d %H:%M'),
        parseTs(header['Waktu Pembayaran Dilakukan'], '%Y-%m-%d %H:%M'),
        paymentMethodId, customerId, blankToNone(header['Nama Penerima']),
        blankToNone(header['No. Telepon']), blankToNone(header['Alamat Pengiriman']),
        locationId, blankToNone(header['Catatan dari Pembeli']), blankToNone(header['Catatan']),
        parseIntValue(header['Jumlah Produk di Pesan']), parseIntValue(header['Total Berat']),
        parseIdr(header['Voucher Ditanggung Penjual']) ?? 0,
        parseIdr(header['Cashback Koin']) ?? 0,
        parseIdr(header['Voucher Ditanggung Shopee']) ?? 0,
        parseIdr(header['Paket Diskon']) ?? 0,
        parseIdr(header['Paket Diskon (Diskon dari Shopee)']) ?? 0,
        parseIdr(header['Paket Diskon (Diskon dari Penjual)']) ?? 0,
        parseIdr(header['Potongan Koin Shopee']) ?? 0,
        parseIdr(header['Diskon Kartu Kredit']) ?? 0,
        parseIdr(header['Ongkos Kirim Dibayar oleh Pembeli']) ?? 0,
        parseIdr(header['Estimasi Potongan Biaya Pengiriman']) ?? 0,
        parseIdr(header['Ongkos Kirim Pengembalian Barang']) ?? 0,
        parseIdr(header['Total Pembayaran']),
        parseIdr(header['Perkiraan Ongkos Kirim']) ?? 0,
        parseTs(header['Waktu Pesanan Selesai'], '%Y-%m-%d %H:%M'),
        brandId, uploadId,
      ],
    );

    if (result.rowCount > 0) inserted += 1;

    for (const item of group) {
      const itemResult = await client.query(
        `INSERT INTO order_items (
          order_id, brand_id, variant_id, product_name_snapshot, variant_name_snapshot,
          sku_reference, original_price, discounted_price, quantity,
          returned_quantity, item_subtotal, total_discount, seller_discount,
          shopee_discount, product_weight_grams
        ) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (brand_id, order_id, sku_reference) DO NOTHING RETURNING order_item_id`,
        [
          orderId, brandId, item['Nama Produk'], blankToNone(item['Nama Variasi']),
          blankToNone(item['Nomor Referensi SKU']),
          parseIdr(item['Harga Awal']), parseIdr(item['Harga Setelah Diskon']),
          parseIntValue(item['Jumlah']), parseIntValue(item['Returned quantity']) ?? 0,
          parseIdr(item['Subtotal Pesanan']), parseIdr(item['Total Diskon']) ?? 0,
          parseIdr(item['Diskon Dari Penjual']) ?? 0, parseIdr(item['Diskon Dari Shopee']) ?? 0,
          parseIntValue(item['Berat Produk']),
        ],
      );
      if (itemResult.rowCount > 0) inserted += 1;
    }
  }

  return inserted;
}
