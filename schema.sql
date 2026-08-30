-- =====================================================================
-- SKEMA DATABASE — SHOPEE SELLER ANALYTICS (PostgreSQL, target 3NF)
-- Sumber: Dummy Performance Overview 0626.xlsx, Dummy Order 0626.xlsx,
--         Dummy Product Performance 0626.xlsx
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS shopee;
SET search_path TO shopee, public;

-- =====================================================================
-- SECTION 1 — LOOKUP / MASTER (REFERENCE) TABLES
-- =====================================================================

CREATE TABLE order_statuses (
    order_status_id     SMALLSERIAL PRIMARY KEY,
    status_name          TEXT NOT NULL,
    CONSTRAINT ux_order_statuses_name UNIQUE (status_name)
);
COMMENT ON TABLE order_statuses IS 'Status akhir pesanan pada level order header (Selesai, Batal, Diproses, Dikirim, dst). Nilai contoh yang teramati: Selesai, Batal.';

CREATE TABLE order_pipeline_stages (
    stage_id             SMALLSERIAL PRIMARY KEY,
    stage_name            TEXT NOT NULL,
    CONSTRAINT ux_pipeline_stage_name UNIQUE (stage_name)
);
COMMENT ON TABLE order_pipeline_stages IS 'Tahap funnel pada laporan performa: Pesanan Dibuat, Pesanan Siap Dikirim, Pesanan Dibayar.';

CREATE TABLE payment_methods (
    payment_method_id    SMALLSERIAL PRIMARY KEY,
    method_name            TEXT NOT NULL,
    CONSTRAINT ux_payment_method_name UNIQUE (method_name)
);

CREATE TABLE shipping_options (
    shipping_option_id    SMALLSERIAL PRIMARY KEY,
    option_name             TEXT NOT NULL,
    CONSTRAINT ux_shipping_option_name UNIQUE (option_name)
);

CREATE TABLE traffic_channels (
    channel_id             SMALLSERIAL PRIMARY KEY,
    channel_name             TEXT NOT NULL,
    CONSTRAINT ux_channel_name UNIQUE (channel_name)
);
COMMENT ON TABLE traffic_channels IS 'Sumber traffic tingkat atas: Halaman Produk, Live Penjual, Video Penjual, Affiliate, Iklan Shopee.';

CREATE TABLE traffic_sub_sources (
    sub_source_id           SMALLSERIAL PRIMARY KEY,
    sub_source_name           TEXT NOT NULL,
    CONSTRAINT ux_sub_source_name UNIQUE (sub_source_name)
);
COMMENT ON TABLE traffic_sub_sources IS 'Rincian sumber kunjungan di dalam tiap channel: Toko, Pencarian, Rekomendasi, Keranjang, Pesanan Saya, Chat, Promosi, Lainnya, dst.';

CREATE TABLE locations (
    location_id              SERIAL PRIMARY KEY,
    city                       TEXT NOT NULL,
    province                    TEXT NOT NULL,
    CONSTRAINT ux_location UNIQUE (city, province)
);

CREATE TABLE report_periods (
    period_id                 SERIAL PRIMARY KEY,
    period_start                DATE NOT NULL,
    period_end                   DATE NOT NULL,
    CONSTRAINT ux_report_period UNIQUE (period_start, period_end),
    CONSTRAINT ck_report_period_order CHECK (period_end >= period_start)
);
COMMENT ON TABLE report_periods IS 'Rentang periode snapshot laporan bulanan (mis. 2026-06-01 s/d 2026-06-30) — dipakai oleh tabel ringkasan non-harian agar data dari beberapa periode ekspor tidak saling menimpa.';

CREATE TABLE price_competitiveness_statuses (
    status_id                 SMALLSERIAL PRIMARY KEY,
    status_name                 TEXT NOT NULL,
    CONSTRAINT ux_price_status_name UNIQUE (status_name)
);
COMMENT ON TABLE price_competitiveness_statuses IS 'Nilai contoh: Belum Kompetitif, Sudah Kompetitif.';

CREATE TABLE ads_recommendation_stages (
    stage_id                   SMALLSERIAL PRIMARY KEY,
    stage_name                   TEXT NOT NULL,
    CONSTRAINT ux_ads_stage_name UNIQUE (stage_name)
);
COMMENT ON TABLE ads_recommendation_stages IS 'Tahap rekomendasi iklan produk: Tingkatkan dengan Iklan, Iklankan, Cek Performa Iklan.';

CREATE TABLE product_statuses (
    status_id                   SMALLSERIAL PRIMARY KEY,
    status_name                   TEXT NOT NULL,
    CONSTRAINT ux_product_status_name UNIQUE (status_name)
);
COMMENT ON TABLE product_statuses IS 'Status produk/variasi saat ini (mis. Normal). Dipakai bersama oleh products dan product_variants karena berbagi domain nilai yang sama.';

-- =====================================================================
-- SECTION 2 — MASTER DATA (PELANGGAN & PRODUK)
-- =====================================================================

CREATE TABLE customers (
    customer_id                  SERIAL PRIMARY KEY,
    username                       VARCHAR(100) NOT NULL,
    created_at                       TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT ux_customer_username UNIQUE (username)
);
COMMENT ON TABLE customers IS 'Identitas pembeli berdasarkan username Shopee (Username (Pembeli) pada sheet orders). Nama penerima/telepon/alamat disimpan di level orders karena dapat berbeda antar pesanan meski pembelinya sama (mis. dikirim ke alamat orang lain).';

CREATE TABLE products (
    product_id                    BIGINT PRIMARY KEY,        -- Kode Produk
    product_name                    TEXT NOT NULL,
    sku_induk                         VARCHAR(100),
    product_status_id                  SMALLINT REFERENCES product_statuses(status_id),
    current_price                        NUMERIC(14,2) CHECK (current_price IS NULL OR current_price >= 0),
    created_date                           DATE,
    created_day_name                         VARCHAR(20),
    created_at                                 TIMESTAMP NOT NULL DEFAULT now(),
    updated_at                                   TIMESTAMP NOT NULL DEFAULT now()
);
COMMENT ON TABLE products IS 'Master produk (Kode Produk) dari sheet-sheet Product Performance. created_date/created_day_name berasal dari sheet "Produk yang Baru Ditambahkan".';
COMMENT ON COLUMN products.sku_induk IS 'Kolom "SKU Induk" pada sumber selalu kosong di sampel data; disimpan nullable untuk kompatibilitas ke depan.';
CREATE UNIQUE INDEX ux_products_sku_induk ON products (sku_induk) WHERE sku_induk IS NOT NULL;
CREATE INDEX ix_products_name ON products (product_name);

CREATE TABLE product_variants (
    variant_id                      BIGINT PRIMARY KEY,       -- Kode Variasi
    product_id                        BIGINT NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    variant_name                        TEXT NOT NULL,   -- mis. "Espresso,40"
    variant_sku                           VARCHAR(100),           -- padanan best-effort ke orders.Nomor Referensi SKU
    variant_status_id                       SMALLINT REFERENCES product_statuses(status_id),
    CONSTRAINT ux_variant_per_product UNIQUE (product_id, variant_name)
);
COMMENT ON TABLE product_variants IS 'Variasi produk (warna/ukuran) dari sheet Produk dengan Performa Terbaik.';
CREATE UNIQUE INDEX ux_variants_sku ON product_variants (variant_sku) WHERE variant_sku IS NOT NULL;
CREATE INDEX ix_variants_product ON product_variants (product_id);

-- =====================================================================
-- SECTION 3 — TRANSAKSI (ORDERS & ORDER ITEMS)
-- =====================================================================

CREATE TABLE orders (
    order_id                          VARCHAR(20) PRIMARY KEY,     -- No. Pesanan
    order_type                          VARCHAR(50),
    order_status_id                       SMALLINT NOT NULL REFERENCES order_statuses(order_status_id),
    cancellation_reason                     TEXT,
    cancellation_return_status                VARCHAR(100),
    tracking_number                             VARCHAR(50),
    shipping_option_id                            SMALLINT REFERENCES shipping_options(shipping_option_id),
    dropoff_method                                  VARCHAR(30),
    ship_by_at                                        TIMESTAMP,
    arranged_shipment_at                                TIMESTAMP,
    order_created_at                                      TIMESTAMP NOT NULL,
    payment_at                                              TIMESTAMP,
    payment_method_id                                         SMALLINT REFERENCES payment_methods(payment_method_id),
    customer_id                                                  INTEGER NOT NULL REFERENCES customers(customer_id),
    receiver_name                                                  TEXT,
    phone_number                                                     VARCHAR(30),
    shipping_address                                                   TEXT,
    location_id                                                          INTEGER REFERENCES locations(location_id),
    buyer_note                                                             TEXT,
    seller_note                                                              TEXT,
    total_qty_ordered                                                          INTEGER NOT NULL DEFAULT 0 CHECK (total_qty_ordered >= 0),
    total_weight_grams                                                           INTEGER DEFAULT 0 CHECK (total_weight_grams >= 0),
    seller_voucher_amount                                                          NUMERIC(14,2) NOT NULL DEFAULT 0,
    coin_cashback_amount                                                             NUMERIC(14,2) NOT NULL DEFAULT 0,
    shopee_voucher_amount                                                              NUMERIC(14,2) NOT NULL DEFAULT 0,
    bundle_discount_package_amount                                                       NUMERIC(14,2) NOT NULL DEFAULT 0,
    bundle_discount_shopee_amount                                                          NUMERIC(14,2) NOT NULL DEFAULT 0,
    bundle_discount_seller_amount                                                            NUMERIC(14,2) NOT NULL DEFAULT 0,
    shopee_coin_deduction_amount                                                                NUMERIC(14,2) NOT NULL DEFAULT 0,
    credit_card_discount_amount                                                                   NUMERIC(14,2) NOT NULL DEFAULT 0,
    shipping_fee_paid_by_buyer                                                                      NUMERIC(14,2) NOT NULL DEFAULT 0,
    estimated_shipping_fee_discount                                                                   NUMERIC(14,2) NOT NULL DEFAULT 0,
    return_shipping_fee                                                                                 NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_payment                                                                                         NUMERIC(14,2) NOT NULL CHECK (total_payment >= 0),
    estimated_shipping_fee                                                                                  NUMERIC(14,2) NOT NULL DEFAULT 0,
    order_completed_at                                                                                        TIMESTAMP,
    CONSTRAINT ck_orders_completed_after_created CHECK (order_completed_at IS NULL OR order_completed_at >= order_created_at)
);
COMMENT ON TABLE orders IS 'Header pesanan (1 baris per No. Pesanan). Field diskon/ongkir/voucher diasumsikan berlaku di level order (sama untuk semua item dalam 1 pesanan) karena data sampel hanya berisi pesanan 1-item sehingga tidak bisa dipastikan; lihat catatan asumsi.';
CREATE INDEX ix_orders_status ON orders (order_status_id);
CREATE INDEX ix_orders_customer ON orders (customer_id);
CREATE INDEX ix_orders_created_at ON orders (order_created_at);
CREATE INDEX ix_orders_payment_at ON orders (payment_at);
CREATE INDEX ix_orders_location ON orders (location_id);

CREATE TABLE order_items (
    order_item_id                BIGSERIAL PRIMARY KEY,
    order_id                       VARCHAR(20) NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    variant_id                       BIGINT REFERENCES product_variants(variant_id),
    product_name_snapshot              TEXT NOT NULL,
    variant_name_snapshot                TEXT,
    sku_reference                          VARCHAR(100),
    original_price                           NUMERIC(14,2) NOT NULL CHECK (original_price >= 0),
    discounted_price                           NUMERIC(14,2) NOT NULL CHECK (discounted_price >= 0),
    quantity                                     INTEGER NOT NULL CHECK (quantity > 0),
    returned_quantity                              INTEGER NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0 AND returned_quantity <= quantity),
    item_subtotal                                    NUMERIC(14,2) NOT NULL CHECK (item_subtotal >= 0),
    total_discount                                     NUMERIC(14,2) NOT NULL DEFAULT 0,
    seller_discount                                      NUMERIC(14,2) NOT NULL DEFAULT 0,
    shopee_discount                                        NUMERIC(14,2) NOT NULL DEFAULT 0,
    product_weight_grams                                     INTEGER CHECK (product_weight_grams IS NULL OR product_weight_grams >= 0),
    CONSTRAINT ux_order_item_sku UNIQUE (order_id, sku_reference)
);
COMMENT ON TABLE order_items IS 'Baris item/SKU dalam 1 pesanan. product_name_snapshot & variant_name_snapshot disimpan apa adanya (denormalized) agar riwayat transaksi tidak berubah walau nama produk diedit di master di kemudian hari. variant_id nullable karena data Product Performance tidak memiliki kunci SKU yang identik dengan orders (lihat catatan asumsi pemadanan produk).';
CREATE INDEX ix_order_items_order ON order_items (order_id);
CREATE INDEX ix_order_items_variant ON order_items (variant_id);
CREATE INDEX ix_order_items_sku ON order_items (sku_reference);

-- =====================================================================
-- SECTION 4 — FAKTA HARIAN (PERFORMANCE OVERVIEW)
-- =====================================================================

CREATE TABLE daily_order_performance (
    id                     BIGSERIAL PRIMARY KEY,
    report_date               DATE NOT NULL,
    stage_id                    SMALLINT NOT NULL REFERENCES order_pipeline_stages(stage_id),
    total_sales_idr                NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (total_sales_idr >= 0),
    total_orders                     INTEGER NOT NULL DEFAULT 0 CHECK (total_orders >= 0),
    sales_per_order                    NUMERIC(14,2),
    products_clicked                     INTEGER NOT NULL DEFAULT 0,
    total_visitors                         INTEGER NOT NULL DEFAULT 0,
    order_conversion_rate                    NUMERIC(8,4),
    cancelled_orders                           INTEGER NOT NULL DEFAULT 0,
    cancelled_sales_idr                          NUMERIC(16,2) NOT NULL DEFAULT 0,
    returned_orders                                INTEGER NOT NULL DEFAULT 0,
    returned_sales_idr                               NUMERIC(16,2) NOT NULL DEFAULT 0,
    total_buyers                                       INTEGER NOT NULL DEFAULT 0,
    new_buyers                                           INTEGER NOT NULL DEFAULT 0,
    existing_buyers                                        INTEGER NOT NULL DEFAULT 0,
    potential_buyers                                         INTEGER NOT NULL DEFAULT 0,
    repeat_purchase_rate                                       NUMERIC(8,4),
    CONSTRAINT ux_daily_order_perf UNIQUE (report_date, stage_id)
);
COMMENT ON TABLE daily_order_performance IS 'Satu baris = ringkasan metrik toko per hari per tahap funnel (dari sheet Pesanan Dibuat / Pesanan Siap Dikirim / Pesanan Dibayar).';
CREATE INDEX ix_dop_date ON daily_order_performance (report_date);
CREATE INDEX ix_dop_stage ON daily_order_performance (stage_id);

CREATE TABLE daily_channel_performance (
    id                     BIGSERIAL PRIMARY KEY,
    report_date               DATE NOT NULL,
    stage_id                    SMALLINT NOT NULL REFERENCES order_pipeline_stages(stage_id),
    channel_id                    SMALLINT NOT NULL REFERENCES traffic_channels(channel_id),
    sub_source_id                   SMALLINT NOT NULL REFERENCES traffic_sub_sources(sub_source_id),
    sales_idr                         NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (sales_idr >= 0),
    sales_ratio                         NUMERIC(8,4),
    products_viewed                       INTEGER NOT NULL DEFAULT 0,
    products_clicked                        INTEGER NOT NULL DEFAULT 0,
    total_orders                              NUMERIC(12,2) NOT NULL DEFAULT 0,
    products_ordered                            NUMERIC(12,2) NOT NULL DEFAULT 0,
    click_percentage                              NUMERIC(8,4),
    conversion_rate                                 NUMERIC(8,4),
    sales_per_order                                   NUMERIC(14,2),
    total_buyers                                        INTEGER NOT NULL DEFAULT 0,
    unique_products_viewed                                INTEGER NOT NULL DEFAULT 0,
    unique_products_clicked                                 INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT ux_daily_channel_perf UNIQUE (report_date, stage_id, channel_id, sub_source_id)
);
COMMENT ON TABLE daily_channel_performance IS 'Metrik traffic & penjualan harian per kombinasi channel x sub-source x tahap funnel (dari sheet "Asal Penjualan" / "Sumber Kunjungan"). total_orders & products_ordered bertipe NUMERIC karena nilai pada sumber data mengandung pecahan (mis. 2.273,67), kemungkinan hasil atribusi berbobot lintas sumber kunjungan pada satu pesanan.';
CREATE INDEX ix_dcp_date ON daily_channel_performance (report_date);
CREATE INDEX ix_dcp_channel ON daily_channel_performance (channel_id, sub_source_id);
CREATE INDEX ix_dcp_stage ON daily_channel_performance (stage_id);

-- =====================================================================
-- SECTION 5 — FAKTA RINGKASAN PER PERIODE (PRODUCT PERFORMANCE)
-- =====================================================================

CREATE TABLE channel_product_contribution (
    id                    BIGSERIAL PRIMARY KEY,
    period_id                INTEGER NOT NULL REFERENCES report_periods(period_id),
    stage_id                   SMALLINT NOT NULL REFERENCES order_pipeline_stages(stage_id),
    channel_id                   SMALLINT NOT NULL REFERENCES traffic_channels(channel_id),
    product_id                     BIGINT NOT NULL REFERENCES products(product_id),
    product_status_id                SMALLINT REFERENCES product_statuses(status_id),
    sales_ratio                        NUMERIC(8,4),
    sales_idr                            NUMERIC(16,2) NOT NULL DEFAULT 0,
    products_viewed                        INTEGER NOT NULL DEFAULT 0,
    products_clicked                         INTEGER NOT NULL DEFAULT 0,
    total_orders                               NUMERIC(12,2) NOT NULL DEFAULT 0,
    products_ordered                             NUMERIC(12,2) NOT NULL DEFAULT 0,
    click_percentage                               NUMERIC(8,4),
    conversion_rate                                  NUMERIC(8,4),
    sales_per_order                                    NUMERIC(14,2),
    total_buyers                                         INTEGER NOT NULL DEFAULT 0,
    unique_products_viewed                                 INTEGER NOT NULL DEFAULT 0,
    unique_products_clicked                                  INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT ux_channel_product_contrib UNIQUE (period_id, stage_id, channel_id, product_id)
);
COMMENT ON TABLE channel_product_contribution IS 'Top produk kontributor penjualan per channel per periode laporan (dari sheet "Kontribusi Produk..."). Bersifat ringkasan Top-N per channel, bukan daftar lengkap seluruh produk.';
CREATE INDEX ix_cpc_period ON channel_product_contribution (period_id);
CREATE INDEX ix_cpc_product ON channel_product_contribution (product_id);
CREATE INDEX ix_cpc_channel ON channel_product_contribution (channel_id);

CREATE TABLE product_performance_summary (
    id                        BIGSERIAL PRIMARY KEY,
    period_id                    INTEGER NOT NULL REFERENCES report_periods(period_id),
    product_id                     BIGINT NOT NULL REFERENCES products(product_id),
    product_status_id                SMALLINT REFERENCES product_statuses(status_id),
    price_competitiveness_status_id    SMALLINT REFERENCES price_competitiveness_statuses(status_id),
    ads_recommendation_stage_id          SMALLINT REFERENCES ads_recommendation_stages(stage_id),
    current_price                          NUMERIC(14,2),
    variant_count                            INTEGER CHECK (variant_count IS NULL OR variant_count >= 0),
    product_views                              INTEGER NOT NULL DEFAULT 0,
    product_clicks                               INTEGER NOT NULL DEFAULT 0,
    click_percentage                               NUMERIC(8,4),
    unique_viewers                                   INTEGER NOT NULL DEFAULT 0,
    unique_clickers                                    INTEGER NOT NULL DEFAULT 0,
    product_page_visitors                                INTEGER NOT NULL DEFAULT 0,
    product_page_views                                     INTEGER NOT NULL DEFAULT 0,
    visitors_no_purchase                                     INTEGER NOT NULL DEFAULT 0,
    no_purchase_rate                                           NUMERIC(8,4),
    search_clicks                                                INTEGER NOT NULL DEFAULT 0,
    likes                                                          INTEGER NOT NULL DEFAULT 0,
    cart_visitors                                                    INTEGER NOT NULL DEFAULT 0,
    cart_adds                                                          INTEGER NOT NULL DEFAULT 0,
    cart_conversion_rate                                                 NUMERIC(8,4),
    orders_created                                                         INTEGER NOT NULL DEFAULT 0,
    orders_ready_to_ship                                                     INTEGER NOT NULL DEFAULT 0,
    products_ordered_created                                                   INTEGER NOT NULL DEFAULT 0,
    products_ordered_ready_to_ship                                               INTEGER NOT NULL DEFAULT 0,
    buyers_created                                                                 INTEGER NOT NULL DEFAULT 0,
    buyers_ready_to_ship                                                             INTEGER NOT NULL DEFAULT 0,
    created_order_conversion_rate                                                      NUMERIC(8,4),
    ready_to_ship_conversion_rate                                                        NUMERIC(8,4),
    sales_created_idr                                                                      NUMERIC(16,2) NOT NULL DEFAULT 0,
    sales_ready_to_ship_idr                                                                  NUMERIC(16,2) NOT NULL DEFAULT 0,
    sales_per_order_created                                                                    NUMERIC(14,2),
    sales_per_order_ready_to_ship                                                                NUMERIC(14,2),
    repeat_order_rate_created                                                                      NUMERIC(8,4),
    repeat_purchase_pct_ready_to_ship                                                                NUMERIC(8,4),
    avg_days_repeat_order_created                                                                      NUMERIC(8,2),
    avg_days_repeat_purchase_ready_to_ship                                                               NUMERIC(8,2),
    CONSTRAINT ux_product_perf_summary UNIQUE (period_id, product_id)
);
COMMENT ON TABLE product_performance_summary IS 'Ringkasan performa produk per periode laporan (grain: 1 produk x 1 periode), menggabungkan sheet "Produk dengan Performa Terbaik" (level produk saja, baris variasi ditangani di product_variant_performance), "Produk yang Baru Ditambahkan" (created_date/created_day_name pada tabel products), "Harga Belum/Sudah Kompetitif" (price_competitiveness_status_id + variant_count), dan "Tingkatkan dengan Iklan/Iklankan/Cek Performa Iklan" (ads_recommendation_stage_id) — karena seluruhnya berbagi grain & sebagian besar kolom metrik yang identik, sehingga digabung menjadi satu tabel lebar alih-alih 5 tabel terpisah yang nyaris duplikat.';
CREATE INDEX ix_pps_period ON product_performance_summary (period_id);
CREATE INDEX ix_pps_product ON product_performance_summary (product_id);
CREATE INDEX ix_pps_ads_stage ON product_performance_summary (ads_recommendation_stage_id);
CREATE INDEX ix_pps_price_status ON product_performance_summary (price_competitiveness_status_id);

CREATE TABLE product_variant_performance (
    id                BIGSERIAL PRIMARY KEY,
    period_id            INTEGER NOT NULL REFERENCES report_periods(period_id),
    variant_id              BIGINT NOT NULL REFERENCES product_variants(variant_id),
    variant_status_id         SMALLINT REFERENCES product_statuses(status_id),
    orders_created               INTEGER NOT NULL DEFAULT 0,
    orders_ready_to_ship            INTEGER NOT NULL DEFAULT 0,
    buyers_created                     INTEGER NOT NULL DEFAULT 0,
    buyers_ready_to_ship                  INTEGER NOT NULL DEFAULT 0,
    sales_created_idr                        NUMERIC(16,2) NOT NULL DEFAULT 0,
    sales_ready_to_ship_idr                     NUMERIC(16,2) NOT NULL DEFAULT 0,
    CONSTRAINT ux_variant_perf UNIQUE (period_id, variant_id)
);
COMMENT ON TABLE product_variant_performance IS 'Rincian performa per variasi (baris "Kode Variasi" pada sheet Produk dengan Performa Terbaik). Pada sampel data, metrik traffic (views/clicks/dst.) untuk baris variasi bernilai kosong ("-") sehingga hanya metrik penjualan yang dimodelkan di sini.';
CREATE INDEX ix_pvp_period ON product_variant_performance (period_id);
CREATE INDEX ix_pvp_variant ON product_variant_performance (variant_id);

-- =====================================================================
-- SECTION 6 — AUTO-UPDATE TRIGGER (opsional, DDL murni — bukan seed data)
-- =====================================================================
-- products.updated_at diberi DEFAULT now() tapi tidak otomatis berubah saat
-- UPDATE tanpa trigger eksplisit. Ditambahkan di sini karena termasuk
-- kategori "trigger/function bila diperlukan", bukan data referensi.

CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION trg_set_updated_at();

-- =====================================================================
-- CATATAN PENTING — TIDAK ADA SEED DATA DI FILE INI
-- =====================================================================
-- Seluruh tabel lookup (order_statuses, order_pipeline_stages, payment_methods,
-- shipping_options, traffic_channels, traffic_sub_sources,
-- price_competitiveness_statuses, ads_recommendation_stages, product_statuses),
-- locations, dan report_periods SENGAJA dibiarkan KOSONG setelah schema.sql
-- dijalankan. Isinya diperoleh sepenuhnya secara otomatis oleh proses ETL
-- (lihat lookup_cache.py + import_shopee_data.py) melalui pola "get-or-create"
-- terhadap UNIQUE constraint masing-masing tabel — nilai baru apa pun yang
-- muncul di data sumber (status pesanan baru, metode pembayaran baru,
-- ekspedisi baru, dst.) otomatis ditambahkan pada saat import, TANPA perlu
-- mengubah schema.sql maupun kode ETL.
