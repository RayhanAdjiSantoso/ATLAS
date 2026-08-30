import pool from '../config/db.js';

export async function getExecutiveMetrics(brandId, startDate, endDate) {
  // Query daily_order_performance for stage 'Pesanan Dibayar'.
  //
  // total_sales_idr / total_orders are gross: reconciled against raw order
  // data and confirmed they already INCLUDE orders later cancelled
  // (cancelled_orders / cancelled_sales_idr) or returned (returned_orders /
  // returned_sales_idr) — those are subset breakdowns, not already
  // subtracted. gmv/transactions below are net (gross minus cancelled minus
  // returned) so "Transaksi"/"GMV" reflect orders that actually stuck, and
  // AOV (= gmv / transactions) stays on a consistent net/net basis.
  // transactions_gross is kept separately for Tingkat Pembatalan, which by
  // definition wants "cancelled as a fraction of all orders that were paid",
  // not of the already-cancelled-excluded net count.
  // Tingkat Konversi (cvr): straight average of the daily "Tingkat Konversi
  // Pesanan" column for the 'Pesanan Dibayar' stage. Verified this figure is
  // NOT reproducible from total_orders/total_visitors in the same row (off
  // by ~2x), so it's a Shopee-computed value we read as-is rather than
  // recompute — averaged across the selected days since it's already a rate,
  // not a raw count that can be summed.
  const orderPerfQuery = `
    SELECT
      COALESCE(SUM(total_sales_idr) - SUM(cancelled_sales_idr) - SUM(returned_sales_idr), 0) AS gmv,
      COALESCE(SUM(total_orders) - SUM(cancelled_orders) - SUM(returned_orders), 0) AS transactions,
      COALESCE(SUM(total_orders), 0) AS transactions_gross,
      COALESCE(SUM(total_visitors), 0) AS visitors,
      COALESCE(SUM(cancelled_orders), 0) AS cancelled_orders,
      COALESCE(SUM(returned_orders), 0) AS returned_orders,
      COALESCE(SUM(products_clicked), 0) AS products_clicked,
      COALESCE(SUM(new_buyers), 0) AS new_buyers,
      COALESCE(SUM(existing_buyers), 0) AS existing_buyers,
      COALESCE(AVG(order_conversion_rate), 0) AS cvr
    FROM shopee.daily_order_performance dop
    JOIN shopee.order_pipeline_stages ops ON ops.stage_id = dop.stage_id
    WHERE dop.brand_id = $1
      AND dop.report_date >= $2
      AND dop.report_date <= $3
      AND ops.stage_name = 'Pesanan Dibayar'
  `;

  // Produk Terjual: SUM(Jumlah) from order_items for orders created within
  // [startDate, endDate], excluding cancelled ("Batal") orders.
  //
  // Reconciled against the monthly product_performance_summary snapshot
  // (which read products_ordered_ready_to_ship, checkpointed at "Pesanan
  // Siap Dikirim"): the two never matched for any date-field/status
  // combination, because they measure different points in the order
  // lifecycle — "ready to ship" (early, Shopee-computed, no daily
  // timestamp exists for it anywhere in the schema) vs order-created/
  // order-completed (late, and "completed" lags 1-2 weeks behind
  // "created" due to shipping + return-window, spilling past month
  // boundaries). This is an intentional switch to the order-created-date
  // based definition so Produk Terjual can follow the selected date range
  // like every other metric on this tab, at the cost of no longer matching
  // Shopee's own "ready to ship" figure.
  const unitsSoldQuery = `
    SELECT COALESCE(SUM(oi.quantity), 0) AS units_sold
    FROM shopee.orders o
    JOIN shopee.order_items oi ON oi.order_id = o.order_id AND oi.brand_id = o.brand_id
    JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
    WHERE o.brand_id = $1
      AND o.order_created_at::date >= $2
      AND o.order_created_at::date <= $3
      AND os.status_name <> 'Batal'
  `;

  const [orderPerfRes, unitsSoldRes] = await Promise.all([
    pool.query(orderPerfQuery, [brandId, startDate, endDate]),
    pool.query(unitsSoldQuery, [brandId, startDate, endDate]),
  ]);

  return {
    ...orderPerfRes.rows[0],
    ...unitsSoldRes.rows[0],
  };
}

export async function getGrowthMetrics(brandId, startDate, endDate) {
  // Daily trends for Line Chart & Sales Calendar. Net (gross minus cancelled
  // minus returned) — matches getExecutiveMetrics' orderPerfQuery, so the
  // per-day trend sums back up to the same GMV/Transaksi KPI totals shown
  // on Executive Snapshot instead of a gross figure that no longer agrees.
  const trendQuery = `
    SELECT
      dop.report_date::text AS date,
      COALESCE(SUM(dop.total_sales_idr) - SUM(dop.cancelled_sales_idr) - SUM(dop.returned_sales_idr), 0) AS gmv,
      COALESCE(SUM(dop.total_orders) - SUM(dop.cancelled_orders) - SUM(dop.returned_orders), 0) AS transactions
    FROM shopee.daily_order_performance dop
    JOIN shopee.order_pipeline_stages ops ON ops.stage_id = dop.stage_id
    WHERE dop.brand_id = $1
      AND dop.report_date >= $2
      AND dop.report_date <= $3
      AND ops.stage_name = 'Pesanan Dibayar'
    GROUP BY dop.report_date
    ORDER BY dop.report_date ASC
  `;

  const res = await pool.query(trendQuery, [brandId, startDate, endDate]);
  return res.rows;
}

// Impression (products_viewed under Iklan Shopee) + funnel conversion counts
// (product_performance_summary metrics). Shared by the Traffic & Funnel tab
// and the Executive Snapshot's condensed funnel callout.
export async function getFunnelSnapshot(brandId, startDate, endDate) {
  const impressionQuery = `
    SELECT
      COALESCE(SUM(dcp.products_viewed), 0) AS impressions
    FROM shopee.daily_channel_performance dcp
    JOIN shopee.order_pipeline_stages ops ON ops.stage_id = dcp.stage_id
    JOIN shopee.traffic_channels tc ON tc.channel_id = dcp.channel_id
    WHERE dcp.brand_id = $1
      AND dcp.report_date >= $2
      AND dcp.report_date <= $3
      AND ops.stage_name = 'Pesanan Siap Dikirim'
      AND tc.channel_name = 'Iklan Shopee'
  `;

  const funnelQuery = `
    SELECT
      COALESCE(SUM(product_page_visitors), 0) AS product_page_visitors,
      COALESCE(SUM(cart_visitors), 0) AS cart_visitors,
      COALESCE(SUM(buyers_created), 0) AS buyers_created,
      COALESCE(SUM(buyers_ready_to_ship), 0) AS buyers_ready_to_ship
    FROM shopee.product_performance_summary pps
    JOIN shopee.report_periods rp ON rp.period_id = pps.period_id
    WHERE pps.brand_id = $1
      AND rp.period_start <= $3
      AND rp.period_end >= $2
  `;

  const [impRes, funnelRes] = await Promise.all([
    pool.query(impressionQuery, [brandId, startDate, endDate]),
    pool.query(funnelQuery, [brandId, startDate, endDate]),
  ]);

  return {
    impressions: Number(impRes.rows[0]?.impressions || 0),
    funnel: funnelRes.rows[0],
  };
}

export async function getTrafficAndFunnelMetrics(brandId, startDate, endDate) {
  // Traffic Source click details (Donut Chart)
  const trafficSourceQuery = `
    SELECT
      tc.channel_name AS channel,
      tss.sub_source_name AS sub_source,
      COALESCE(SUM(dcp.products_clicked), 0) AS clicks
    FROM shopee.daily_channel_performance dcp
    JOIN shopee.order_pipeline_stages ops ON ops.stage_id = dcp.stage_id
    JOIN shopee.traffic_channels tc ON tc.channel_id = dcp.channel_id
    JOIN shopee.traffic_sub_sources tss ON tss.sub_source_id = dcp.sub_source_id
    WHERE dcp.brand_id = $1
      AND dcp.report_date >= $2
      AND dcp.report_date <= $3
      AND ops.stage_name = 'Pesanan Siap Dikirim'
    GROUP BY tc.channel_name, tss.sub_source_name
    ORDER BY clicks DESC
  `;

  const [snapshot, trafficRes] = await Promise.all([
    getFunnelSnapshot(brandId, startDate, endDate),
    pool.query(trafficSourceQuery, [brandId, startDate, endDate]),
  ]);

  return {
    impressions: snapshot.impressions,
    trafficSources: trafficRes.rows,
    funnel: snapshot.funnel,
  };
}

// Total discount/voucher amounts given, order-level + item-level. Shared by
// the Transaction Behavior tab (per-type breakdown) and the Executive
// Snapshot (rolled up into a single "Total Diskon Diberikan" KPI).
export async function getDiscountSummary(brandId, startDate, endDate) {
  const discountQuery = `
    SELECT
      SUM(COALESCE(o.seller_voucher_amount, 0))::numeric AS seller_voucher,
      SUM(COALESCE(o.shopee_voucher_amount, 0))::numeric AS shopee_voucher,
      SUM(COALESCE(o.credit_card_discount_amount, 0))::numeric AS credit_card_discount,
      SUM(COALESCE(o.bundle_discount_shopee_amount, 0))::numeric AS bundle_discount_shopee,
      SUM(COALESCE(o.bundle_discount_seller_amount, 0))::numeric AS bundle_discount_seller
    FROM shopee.orders o
    JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
    WHERE o.brand_id = $1
      AND os.status_name = 'Selesai'
      AND o.order_completed_at >= $2
      AND o.order_completed_at < ($3::date + INTERVAL '1 day')
  `;

  const itemDiscountQuery = `
    SELECT
      SUM(COALESCE(oi.seller_discount, 0))::numeric AS seller_discount,
      SUM(COALESCE(oi.shopee_discount, 0))::numeric AS shopee_discount
    FROM shopee.order_items oi
    JOIN shopee.orders o ON o.order_id = oi.order_id AND o.brand_id = oi.brand_id
    JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
    WHERE o.brand_id = $1
      AND os.status_name = 'Selesai'
      AND o.order_completed_at >= $2
      AND o.order_completed_at < ($3::date + INTERVAL '1 day')
  `;

  const [discRes, itemDiscRes] = await Promise.all([
    pool.query(discountQuery, [brandId, startDate, endDate]),
    pool.query(itemDiscountQuery, [brandId, startDate, endDate]),
  ]);

  return { ...discRes.rows[0], ...itemDiscRes.rows[0] };
}

// Distinct paying customers in the period (completed orders only).
export async function getUniqueCustomerCount(brandId, startDate, endDate) {
  const query = `
    SELECT COUNT(DISTINCT o.customer_id)::int AS unique_customers
    FROM shopee.orders o
    JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
    WHERE o.brand_id = $1
      AND os.status_name = 'Selesai'
      AND o.order_completed_at >= $2
      AND o.order_completed_at < ($3::date + INTERVAL '1 day')
  `;
  const res = await pool.query(query, [brandId, startDate, endDate]);
  return Number(res.rows[0]?.unique_customers || 0);
}

// Raw per-customer Recency/Frequency/Monetary, scoped to brand + selected
// date range. Scoring (K-Means natural breaks on winsorized values) and
// segmentation happen in JS -- see services/rfm/rfmAnalysis.js -- since
// K-Means isn't available natively in Postgres.
export async function getRfmRawMetrics(brandId, startDate, endDate) {
  const query = `
    WITH rfm_raw AS (
      SELECT
        c.username,
        o.order_id,
        o.order_completed_at AS order_date,
        o.total_payment
      FROM shopee.orders o
      JOIN shopee.customers c ON c.customer_id = o.customer_id
      JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
      WHERE o.brand_id = $1
        AND os.status_name = 'Selesai'
        AND o.order_completed_at >= $2
        AND o.order_completed_at < ($3::date + INTERVAL '1 day')
    ),
    analysis_const AS (
      SELECT COALESCE(MAX(order_date), NOW()) + INTERVAL '1 day' AS analysis_date
      FROM rfm_raw
    )
    SELECT
      r.username,
      EXTRACT(DAY FROM (ac.analysis_date - MAX(r.order_date)))::int AS recency,
      COUNT(DISTINCT r.order_id)::int AS frequency,
      SUM(r.total_payment)::numeric AS monetary
    FROM rfm_raw r
    CROSS JOIN analysis_const ac
    GROUP BY r.username, ac.analysis_date
  `;

  const res = await pool.query(query, [brandId, startDate, endDate]);
  return res.rows;
}

export async function getTransactionBehaviorMetrics(brandId, startDate, endDate) {
  const cityQuery = `
    SELECT
      COALESCE(l.city, 'Lainnya') AS city,
      SUM(o.total_payment)::numeric AS total_sales,
      COUNT(DISTINCT o.order_id)::int AS total_orders
    FROM shopee.orders o
    JOIN shopee.locations l ON l.location_id = o.location_id
    JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
    WHERE o.brand_id = $1
      AND os.status_name = 'Selesai'
      AND o.order_completed_at >= $2
      AND o.order_completed_at < ($3::date + INTERVAL '1 day')
    GROUP BY l.city
    ORDER BY total_sales DESC
    LIMIT 10
  `;

  // Fetch all provinces for mapping purposes instead of limiting to 10
  const provQuery = `
    SELECT
      COALESCE(l.province, 'Lainnya') AS province,
      SUM(o.total_payment)::numeric AS total_sales,
      COUNT(DISTINCT o.order_id)::int AS total_orders
    FROM shopee.orders o
    JOIN shopee.locations l ON l.location_id = o.location_id
    JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
    WHERE o.brand_id = $1
      AND os.status_name = 'Selesai'
      AND o.order_completed_at >= $2
      AND o.order_completed_at < ($3::date + INTERVAL '1 day')
    GROUP BY l.province
    ORDER BY total_sales DESC
  `;

  const durationQuery = `
    WITH duration_data AS (
      SELECT
        EXTRACT(EPOCH FROM (o.order_completed_at - o.order_created_at)) / 86400.0 AS durasi_hari
      FROM shopee.orders o
      JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
      WHERE o.brand_id = $1
        AND os.status_name = 'Selesai'
        AND o.order_completed_at >= $2
        AND o.order_completed_at < ($3::date + INTERVAL '1 day')
        AND o.order_completed_at >= o.order_created_at
    ),
    categorized AS (
      SELECT
        CASE
          WHEN durasi_hari <= 1 THEN '<=1 hari'
          WHEN durasi_hari <= 2 THEN '1-2 hari'
          WHEN durasi_hari <= 3 THEN '2-3 hari'
          WHEN durasi_hari <= 5 THEN '3-5 hari'
          WHEN durasi_hari <= 7 THEN '5-7 hari'
          WHEN durasi_hari <= 14 THEN '7-14 hari'
          WHEN durasi_hari <= 30 THEN '14-30 hari'
          ELSE '>30 hari'
        END AS kategori_durasi
      FROM duration_data
    )
    SELECT
      kategori_durasi AS label,
      COUNT(*)::int AS count
    FROM categorized
    GROUP BY kategori_durasi
  `;

  const paymentQuery = `
    SELECT
      COALESCE(pm.method_name, 'Lainnya') AS method_name,
      SUM(o.total_payment)::numeric AS total_sales,
      COUNT(o.order_id)::int AS total_orders
    FROM shopee.orders o
    JOIN shopee.payment_methods pm ON pm.payment_method_id = o.payment_method_id
    JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
    WHERE o.brand_id = $1
      AND os.status_name = 'Selesai'
      AND o.order_completed_at >= $2
      AND o.order_completed_at < ($3::date + INTERVAL '1 day')
    GROUP BY pm.method_name
    ORDER BY total_sales DESC
  `;

  const shippingQuery = `
    SELECT
      COALESCE(so.option_name, 'Lainnya') AS option_name,
      SUM(o.total_payment)::numeric AS total_sales,
      COUNT(o.order_id)::int AS total_orders
    FROM shopee.orders o
    JOIN shopee.shipping_options so ON so.shipping_option_id = o.shipping_option_id
    JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
    WHERE o.brand_id = $1
      AND os.status_name = 'Selesai'
      AND o.order_completed_at >= $2
      AND o.order_completed_at < ($3::date + INTERVAL '1 day')
    GROUP BY so.option_name
    ORDER BY total_sales DESC
  `;

  const cancellationQuery = `
    WITH cancelled_orders AS (
      SELECT
        COALESCE(SUBSTRING(cancellation_reason FROM '(?i)Dibatalkan oleh\\s+([^.]+)\\.'), 'Tidak Diketahui') AS cancelled_by,
        COALESCE(SUBSTRING(cancellation_reason FROM '(?i)Alasan:\\s*(.*)'), 'Tidak Diketahui') AS reason
      FROM shopee.orders o
      JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
      WHERE o.brand_id = $1
        AND os.status_name = 'Batal'
        AND o.order_created_at >= $2
        AND o.order_created_at < ($3::date + INTERVAL '1 day')
    )
    SELECT
      cancelled_by,
      reason,
      COUNT(*)::int AS count
    FROM cancelled_orders
    GROUP BY cancelled_by, reason
    ORDER BY cancelled_by, count DESC
  `;

  const cityRes = await pool.query(cityQuery, [brandId, startDate, endDate]);
  const provRes = await pool.query(provQuery, [brandId, startDate, endDate]);
  const discounts = await getDiscountSummary(brandId, startDate, endDate);
  const durRes = await pool.query(durationQuery, [brandId, startDate, endDate]);
  const payRes = await pool.query(paymentQuery, [brandId, startDate, endDate]);
  const shipRes = await pool.query(shippingQuery, [brandId, startDate, endDate]);
  const cancelRes = await pool.query(cancellationQuery, [brandId, startDate, endDate]);

  return {
    cities: cityRes.rows,
    provinces: provRes.rows,
    discounts,
    durations: durRes.rows,
    payments: payRes.rows,
    shippings: shipRes.rows,
    cancellations: cancelRes.rows,
  };
}

export async function getBasketAnalysisMetrics(brandId, startDate, endDate) {
  const statsQuery = `
    SELECT
      COUNT(DISTINCT o.order_id)::int AS total_transactions,
      COUNT(DISTINCT o.customer_id)::int AS total_customers,
      COALESCE(SUM(o.total_qty_ordered), 0)::int AS total_items,
      COALESCE(AVG(o.total_qty_ordered), 0)::float AS avg_items_per_transaction,
      COALESCE(AVG(o.total_payment), 0)::float AS atv
    FROM shopee.orders o
    JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
    WHERE o.brand_id = $1
      AND os.status_name = 'Selesai'
      AND o.order_completed_at >= $2
      AND o.order_completed_at < ($3::date + INTERVAL '1 day')
  `;

  const sizeQuery = `
    WITH order_items_count AS (
      SELECT
        o.order_id,
        COUNT(DISTINCT oi.sku_reference)::int AS basket_size,
        o.total_payment
      FROM shopee.orders o
      JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
      JOIN shopee.order_items oi ON oi.order_id = o.order_id AND oi.brand_id = o.brand_id
      WHERE o.brand_id = $1
        AND os.status_name = 'Selesai'
        AND o.order_completed_at >= $2
        AND o.order_completed_at < ($3::date + INTERVAL '1 day')
      GROUP BY o.order_id, o.total_payment
    ),
    order_baskets AS (
      SELECT
        order_id,
        total_payment,
        basket_size,
        CASE
          WHEN basket_size = 1 THEN '1 Item'
          WHEN basket_size = 2 THEN '2 Items'
          WHEN basket_size = 3 THEN '3 Items'
          WHEN basket_size = 4 THEN '4 Items'
          ELSE '5+ Items'
        END AS basket_segment
      FROM order_items_count
    )
    SELECT
      basket_segment,
      COUNT(*)::int AS total_orders,
      COALESCE(AVG(total_payment), 0)::numeric AS avg_transaction_value,
      COALESCE(SUM(total_payment), 0)::numeric AS total_revenue
    FROM order_baskets
    GROUP BY basket_segment
  `;

  const pairsQuery = `
    WITH valid_items AS (
      SELECT
        oi.order_id,
        oi.product_name_snapshot AS product_name
      FROM shopee.order_items oi
      JOIN shopee.orders o ON o.order_id = oi.order_id AND o.brand_id = oi.brand_id
      JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
      WHERE o.brand_id = $1
        AND os.status_name = 'Selesai'
        AND o.order_completed_at >= $2
        AND o.order_completed_at < ($3::date + INTERVAL '1 day')
        AND UPPER(TRIM(oi.product_name_snapshot)) != 'RETURN HANDLING FEE'
        AND UPPER(TRIM(oi.product_name_snapshot)) != 'PATRIS - EXTRA BUBBLE WRAP'
    ),
    order_distinct_items AS (
      SELECT DISTINCT order_id, product_name FROM valid_items
    ),
    order_sizes AS (
      SELECT order_id, COUNT(*)::int AS unique_size FROM order_distinct_items GROUP BY order_id
    ),
    product_frequencies AS (
      SELECT product_name, COUNT(*)::int AS product_count FROM order_distinct_items GROUP BY product_name
    ),
    pairs AS (
      SELECT
        a.product_name AS product_a,
        b.product_name AS product_b,
        COUNT(*)::int AS together_count
      FROM order_distinct_items a
      JOIN order_distinct_items b ON a.order_id = b.order_id
      JOIN order_sizes os ON os.order_id = a.order_id
      WHERE a.product_name < b.product_name
        AND os.unique_size >= 2
      GROUP BY a.product_name, b.product_name
    )
    SELECT
      p.product_a,
      p.product_b,
      p.together_count,
      p.together_count::float / (SELECT COALESCE(NULLIF(COUNT(DISTINCT order_id), 0), 1) FROM valid_items) AS support,
      p.together_count::float / COALESCE(NULLIF(fa.product_count, 0), 1) AS confidence_a_to_b,
      p.together_count::float / COALESCE(NULLIF(fb.product_count, 0), 1) AS confidence_b_to_a,
      (p.together_count::float / (SELECT COALESCE(NULLIF(COUNT(DISTINCT order_id), 0), 1) FROM valid_items)) /
        COALESCE(NULLIF(((fa.product_count::float / (SELECT COALESCE(NULLIF(COUNT(DISTINCT order_id), 0), 1) FROM valid_items)) *
         (fb.product_count::float / (SELECT COALESCE(NULLIF(COUNT(DISTINCT order_id), 0), 1) FROM valid_items))), 0), 1) AS lift
    FROM pairs p
    JOIN product_frequencies fa ON fa.product_name = p.product_a
    JOIN product_frequencies fb ON fb.product_name = p.product_b
    ORDER BY p.together_count DESC
    LIMIT 20
  `;

  const statsRes = await pool.query(statsQuery, [brandId, startDate, endDate]);
  const sizeRes = await pool.query(sizeQuery, [brandId, startDate, endDate]);
  const pairsRes = await pool.query(pairsQuery, [brandId, startDate, endDate]);

  return {
    stats: statsRes.rows[0],
    sizes: sizeRes.rows,
    pairs: pairsRes.rows,
  };
}

// Replicates the "First & Second Purchase Product" analysis from the
// RFM & Transaction Behavior notebook:
// - representative product per order ("produk_utama") = the order_item with
//   the highest item_subtotal in that order (ties broken by order_item_id,
//   the DB equivalent of pandas' stable-sort "keep first" tiebreak)
// - product identity = product name + variant name (so different variants
//   of the same product are tracked separately)
// - per customer, orders are ranked chronologically by order_created_at;
//   rank 1 = first purchase, rank 2 = second purchase
export async function getFirstSecondPurchaseAnalysis(brandId, startDate, endDate) {
  const purchaseCte = `
    valid_items AS (
      SELECT
        oi.order_id,
        o.customer_id,
        o.order_created_at,
        oi.order_item_id,
        oi.product_name_snapshot AS product_name,
        oi.variant_name_snapshot AS variant_name,
        oi.item_subtotal
      FROM shopee.order_items oi
      JOIN shopee.orders o ON o.order_id = oi.order_id AND o.brand_id = oi.brand_id
      JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
      WHERE o.brand_id = $1
        AND os.status_name = 'Selesai'
        AND o.order_completed_at IS NOT NULL
        AND o.order_completed_at >= $2
        AND o.order_completed_at < ($3::date + INTERVAL '1 day')
        AND UPPER(TRIM(oi.product_name_snapshot)) != 'RETURN HANDLING FEE'
    ),
    produk_utama AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        customer_id,
        order_created_at,
        product_name || ' | ' || COALESCE(variant_name, '(Tanpa Variasi)') AS produk_utama
      FROM valid_items
      ORDER BY order_id, item_subtotal DESC, order_item_id ASC
    ),
    ranked AS (
      SELECT
        customer_id,
        produk_utama,
        ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_created_at ASC, order_id ASC) AS urutan_transaksi
      FROM produk_utama
    )
  `;

  const topFirstQuery = `
    WITH ${purchaseCte}
    SELECT produk_utama AS product_name, COUNT(*)::int AS customer_count
    FROM ranked
    WHERE urutan_transaksi = 1
    GROUP BY produk_utama
    ORDER BY customer_count DESC, produk_utama ASC
    LIMIT 10
  `;

  const topSecondQuery = `
    WITH ${purchaseCte}
    SELECT produk_utama AS product_name, COUNT(*)::int AS customer_count
    FROM ranked
    WHERE urutan_transaksi = 2
    GROUP BY produk_utama
    ORDER BY customer_count DESC, produk_utama ASC
    LIMIT 10
  `;

  const transitionsQuery = `
    WITH ${purchaseCte},
    pertama AS (
      SELECT customer_id, produk_utama FROM ranked WHERE urutan_transaksi = 1
    ),
    kedua AS (
      SELECT customer_id, produk_utama FROM ranked WHERE urutan_transaksi = 2
    )
    SELECT
      pertama.produk_utama AS product_first,
      kedua.produk_utama AS product_second,
      COUNT(*)::int AS customer_count
    FROM pertama
    JOIN kedua ON kedua.customer_id = pertama.customer_id
    GROUP BY pertama.produk_utama, kedua.produk_utama
    ORDER BY customer_count DESC, product_first ASC, product_second ASC
    LIMIT 20
  `;

  const [topFirstRes, topSecondRes, transitionsRes] = await Promise.all([
    pool.query(topFirstQuery, [brandId, startDate, endDate]),
    pool.query(topSecondQuery, [brandId, startDate, endDate]),
    pool.query(transitionsQuery, [brandId, startDate, endDate]),
  ]);

  return {
    topFirst: topFirstRes.rows,
    topSecond: topSecondRes.rows,
    transitions: transitionsRes.rows,
  };
}

// Customer Retention Rate: of every customer with at least one completed
// order in the selected period, what % placed MORE THAN ONE completed order
// (i.e. retained) vs exactly one. Same status/date basis as
// getBasketAnalysisMetrics's statsQuery, so this stays consistent with
// "Total Pelanggan Unik" already shown on this tab.
export async function getCustomerRetention(brandId, startDate, endDate) {
  const query = `
    WITH customer_orders AS (
      SELECT o.customer_id, COUNT(DISTINCT o.order_id)::int AS order_count
      FROM shopee.orders o
      JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
      WHERE o.brand_id = $1
        AND os.status_name = 'Selesai'
        AND o.order_completed_at >= $2
        AND o.order_completed_at < ($3::date + INTERVAL '1 day')
      GROUP BY o.customer_id
    )
    SELECT
      COUNT(*)::int AS total_customers,
      COUNT(*) FILTER (WHERE order_count = 1)::int AS customers_single,
      COUNT(*) FILTER (WHERE order_count > 1)::int AS customers_retained
    FROM customer_orders
  `;
  const res = await pool.query(query, [brandId, startDate, endDate]);
  return res.rows[0] || { total_customers: 0, customers_single: 0, customers_retained: 0 };
}

// Repeat purchase cycle: for customers with >=2 completed orders in the
// period, the day-gap between their 1st and 2nd order (by order_created_at),
// using the exact same "produk_utama" representative-product definition as
// getFirstSecondPurchaseAnalysis above (highest item_subtotal per order).
// Three views over the same underlying jarak_beli set: overall stats,
// bucketed distribution, and same-product vs different-product comparison.
export async function getRepeatPurchaseCycle(brandId, startDate, endDate) {
  const jarakBeliCte = `
    valid_items AS (
      SELECT
        oi.order_id,
        o.customer_id,
        o.order_created_at,
        oi.order_item_id,
        oi.product_name_snapshot AS product_name,
        oi.variant_name_snapshot AS variant_name,
        oi.item_subtotal
      FROM shopee.order_items oi
      JOIN shopee.orders o ON o.order_id = oi.order_id AND o.brand_id = oi.brand_id
      JOIN shopee.order_statuses os ON os.order_status_id = o.order_status_id
      WHERE o.brand_id = $1
        AND os.status_name = 'Selesai'
        AND o.order_completed_at IS NOT NULL
        AND o.order_completed_at >= $2
        AND o.order_completed_at < ($3::date + INTERVAL '1 day')
        AND UPPER(TRIM(oi.product_name_snapshot)) != 'RETURN HANDLING FEE'
    ),
    produk_utama AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        customer_id,
        order_created_at,
        product_name || ' | ' || COALESCE(variant_name, '(Tanpa Variasi)') AS produk_utama
      FROM valid_items
      ORDER BY order_id, item_subtotal DESC, order_item_id ASC
    ),
    ranked AS (
      SELECT
        customer_id,
        order_created_at,
        produk_utama,
        ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_created_at ASC, order_id ASC) AS urutan_transaksi
      FROM produk_utama
    ),
    jarak_beli AS (
      SELECT
        pertama.produk_utama AS produk_pertama,
        kedua.produk_utama AS produk_kedua,
        EXTRACT(EPOCH FROM (kedua.order_created_at - pertama.order_created_at)) / 86400.0 AS jarak_hari
      FROM (SELECT customer_id, order_created_at, produk_utama FROM ranked WHERE urutan_transaksi = 1) pertama
      JOIN (SELECT customer_id, order_created_at, produk_utama FROM ranked WHERE urutan_transaksi = 2) kedua
        ON kedua.customer_id = pertama.customer_id
      WHERE kedua.order_created_at >= pertama.order_created_at
    )
  `;

  const statsQuery = `
    WITH ${jarakBeliCte}
    SELECT
      COUNT(*)::int AS jumlah_pelanggan,
      AVG(jarak_hari)::float AS rata2_hari,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY jarak_hari)::float AS median_hari,
      MIN(jarak_hari)::float AS min_hari,
      MAX(jarak_hari)::float AS max_hari
    FROM jarak_beli
  `;

  const distributionQuery = `
    WITH ${jarakBeliCte},
    bucketed AS (
      SELECT
        CASE
          WHEN jarak_hari <= 1 THEN '0-1 hari'
          WHEN jarak_hari <= 3 THEN '2-3 hari'
          WHEN jarak_hari <= 7 THEN '4-7 hari'
          WHEN jarak_hari <= 14 THEN '8-14 hari'
          WHEN jarak_hari <= 30 THEN '15-30 hari'
          WHEN jarak_hari <= 60 THEN '31-60 hari'
          WHEN jarak_hari <= 90 THEN '61-90 hari'
          WHEN jarak_hari <= 180 THEN '91-180 hari'
          WHEN jarak_hari <= 365 THEN '181-365 hari'
          ELSE '>365 hari'
        END AS rentang,
        CASE
          WHEN jarak_hari <= 1 THEN 1 WHEN jarak_hari <= 3 THEN 2 WHEN jarak_hari <= 7 THEN 3
          WHEN jarak_hari <= 14 THEN 4 WHEN jarak_hari <= 30 THEN 5 WHEN jarak_hari <= 60 THEN 6
          WHEN jarak_hari <= 90 THEN 7 WHEN jarak_hari <= 180 THEN 8 WHEN jarak_hari <= 365 THEN 9
          ELSE 10
        END AS urutan
      FROM jarak_beli
    )
    SELECT rentang, urutan, COUNT(*)::int AS jumlah_pelanggan
    FROM bucketed
    GROUP BY rentang, urutan
    ORDER BY urutan
  `;

  const comparisonQuery = `
    WITH ${jarakBeliCte}
    SELECT
      CASE WHEN produk_pertama = produk_kedua THEN 'Produk sama' ELSE 'Pindah produk' END AS tipe,
      COUNT(*)::int AS jumlah_pelanggan,
      AVG(jarak_hari)::float AS rata2_hari,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY jarak_hari)::float AS median_hari
    FROM jarak_beli
    GROUP BY tipe
  `;

  const [statsRes, distributionRes, comparisonRes] = await Promise.all([
    pool.query(statsQuery, [brandId, startDate, endDate]),
    pool.query(distributionQuery, [brandId, startDate, endDate]),
    pool.query(comparisonQuery, [brandId, startDate, endDate]),
  ]);

  return {
    stats: statsRes.rows[0] || { jumlah_pelanggan: 0, rata2_hari: 0, median_hari: 0, min_hari: 0, max_hari: 0 },
    distribution: distributionRes.rows,
    comparison: comparisonRes.rows,
  };
}

// Product/variant sales, scoped to brand + selected date range, read
// DIRECTLY from Shopee's own "Pesanan Siap Dikirim" figures (imported
// verbatim from the Product Performance Excel export) instead of
// reconstructed from raw orders/order_items -- this is an exact match
// against the source file/notebook, not an approximation.
//
// level='category' -> product_performance_summary (Kode Variasi blank rows)
// level='variant'  -> product_variant_performance (Kode Variasi populated
//                     rows; both tables share the same period_id -> monthly
//                     report_periods, used as the "month" bucket for the
//                     PLC growth/decline trend).
//
// NOTE: products.created_date (PLC "Introduction" rule) is never populated
// by any loader in this app (checked directly: 0/72 rows have it set) --
// pre-existing gap, unrelated to this query, same as before this change.
export async function getProductPerformanceRawMetrics(brandId, startDate, endDate, level) {
  if (level === 'variant') {
    const query = `
      SELECT
        p.product_name,
        pv.variant_name,
        to_char(rp.period_start, 'YYYY-MM') AS month,
        pvp.products_ordered_ready_to_ship::int AS quantity,
        pvp.sales_ready_to_ship_idr::numeric AS revenue,
        p.created_date
      FROM shopee.product_variant_performance pvp
      JOIN shopee.product_variants pv ON pv.variant_id = pvp.variant_id
      JOIN shopee.products p ON p.product_id = pv.product_id
      JOIN shopee.report_periods rp ON rp.period_id = pvp.period_id
      WHERE pvp.brand_id = $1
        AND rp.period_start <= $3
        AND rp.period_end >= $2
    `;
    const res = await pool.query(query, [brandId, startDate, endDate]);
    return res.rows;
  }

  const query = `
    SELECT
      p.product_name,
      NULL::text AS variant_name,
      to_char(rp.period_start, 'YYYY-MM') AS month,
      pps.products_ordered_ready_to_ship::int AS quantity,
      pps.sales_ready_to_ship_idr::numeric AS revenue,
      p.created_date
    FROM shopee.product_performance_summary pps
    JOIN shopee.products p ON p.product_id = pps.product_id
    JOIN shopee.report_periods rp ON rp.period_id = pps.period_id
    WHERE pps.brand_id = $1
      AND rp.period_start <= $3
      AND rp.period_end >= $2
  `;
  const res = await pool.query(query, [brandId, startDate, endDate]);
  return res.rows;
}
