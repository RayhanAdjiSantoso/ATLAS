-- =====================================================================
-- ATLAS APP LAYER — Authentication, Brands, Upload Tracking
-- Run AFTER schema.sql on database atlas_FIN
-- =====================================================================

SET search_path TO public, shopee;

-- ---------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE file_type AS ENUM ('order', 'performance_overview', 'product_performance');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE upload_status AS ENUM ('pending', 'processing', 'success', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------
-- Users (authentication)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id         SERIAL PRIMARY KEY,
    email           VARCHAR(255) NOT NULL,
    password_hash   TEXT NOT NULL,
    full_name       VARCHAR(150) NOT NULL,
    role            user_role NOT NULL DEFAULT 'user',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_users_email UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS ix_users_role ON users (role);

-- ---------------------------------------------------------------------
-- Brands (multi-tenant data separation)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
    brand_id        SERIAL PRIMARY KEY,
    brand_name      VARCHAR(150) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ux_brands_name UNIQUE (brand_name)
);

-- ---------------------------------------------------------------------
-- Upload history
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uploads (
    upload_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             INTEGER NOT NULL REFERENCES users(user_id),
    brand_id            INTEGER NOT NULL REFERENCES brands(brand_id),
    file_type           file_type NOT NULL,
    original_filename   TEXT NOT NULL,
    stored_path         TEXT,
    period_start        DATE,
    period_end          DATE,
    status              upload_status NOT NULL DEFAULT 'pending',
    error_message       TEXT,
    rows_inserted       INTEGER NOT NULL DEFAULT 0,
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_uploads_user ON uploads (user_id);
CREATE INDEX IF NOT EXISTS ix_uploads_brand ON uploads (brand_id);
CREATE INDEX IF NOT EXISTS ix_uploads_file_type ON uploads (file_type);
CREATE INDEX IF NOT EXISTS ix_uploads_period ON uploads (period_start, period_end);
CREATE INDEX IF NOT EXISTS ix_uploads_status ON uploads (status);

-- ---------------------------------------------------------------------
-- Add brand_id + upload_id to shopee fact tables
-- Reason: support multiple brands & upload batches without overwriting
-- ---------------------------------------------------------------------

-- orders
ALTER TABLE shopee.orders ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(brand_id);
ALTER TABLE shopee.orders ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES uploads(upload_id);
CREATE INDEX IF NOT EXISTS ix_orders_brand ON shopee.orders (brand_id);
CREATE INDEX IF NOT EXISTS ix_orders_upload ON shopee.orders (upload_id);

-- daily_order_performance — extend unique constraint for multi-brand
ALTER TABLE shopee.daily_order_performance ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(brand_id);
ALTER TABLE shopee.daily_order_performance ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES uploads(upload_id);
ALTER TABLE shopee.daily_order_performance DROP CONSTRAINT IF EXISTS ux_daily_order_perf;
ALTER TABLE shopee.daily_order_performance
    ADD CONSTRAINT ux_daily_order_perf UNIQUE (brand_id, report_date, stage_id);
CREATE INDEX IF NOT EXISTS ix_dop_brand ON shopee.daily_order_performance (brand_id);

-- product_performance_summary — extend unique constraint for multi-brand
ALTER TABLE shopee.product_performance_summary ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(brand_id);
ALTER TABLE shopee.product_performance_summary ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES uploads(upload_id);
ALTER TABLE shopee.product_performance_summary DROP CONSTRAINT IF EXISTS ux_product_perf_summary;
ALTER TABLE shopee.product_performance_summary
    ADD CONSTRAINT ux_product_perf_summary UNIQUE (brand_id, period_id, product_id);
CREATE INDEX IF NOT EXISTS ix_pps_brand ON shopee.product_performance_summary (brand_id);

-- daily_channel_performance (for future full import)
ALTER TABLE shopee.daily_channel_performance ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(brand_id);
ALTER TABLE shopee.daily_channel_performance ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES uploads(upload_id);
ALTER TABLE shopee.daily_channel_performance DROP CONSTRAINT IF EXISTS ux_daily_channel_perf;
ALTER TABLE shopee.daily_channel_performance
    ADD CONSTRAINT ux_daily_channel_perf UNIQUE (brand_id, report_date, stage_id, channel_id, sub_source_id);

-- channel_product_contribution (for future full import)
ALTER TABLE shopee.channel_product_contribution ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(brand_id);
ALTER TABLE shopee.channel_product_contribution ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES uploads(upload_id);
ALTER TABLE shopee.channel_product_contribution DROP CONSTRAINT IF EXISTS ux_channel_product_contrib;
ALTER TABLE shopee.channel_product_contribution
    ADD CONSTRAINT ux_channel_product_contrib UNIQUE (brand_id, period_id, stage_id, channel_id, product_id);

-- product_variant_performance
ALTER TABLE shopee.product_variant_performance ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(brand_id);
ALTER TABLE shopee.product_variant_performance ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES uploads(upload_id);
ALTER TABLE shopee.product_variant_performance DROP CONSTRAINT IF EXISTS ux_variant_perf;
ALTER TABLE shopee.product_variant_performance
    ADD CONSTRAINT ux_variant_perf UNIQUE (brand_id, period_id, variant_id);

-- products — brand scope for multi-tenant filtering (PK unchanged to preserve FKs)
ALTER TABLE shopee.products ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(brand_id);
ALTER TABLE shopee.products DROP CONSTRAINT IF EXISTS ux_products_brand_product;
ALTER TABLE shopee.products ADD CONSTRAINT ux_products_brand_product UNIQUE (brand_id, product_id);
CREATE INDEX IF NOT EXISTS ix_products_brand ON shopee.products (brand_id);

-- product_variants
ALTER TABLE shopee.product_variants ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(brand_id);
CREATE INDEX IF NOT EXISTS ix_variants_brand ON shopee.product_variants (brand_id);

-- updated_at trigger for users
CREATE OR REPLACE FUNCTION trg_set_users_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION trg_set_users_updated_at();
