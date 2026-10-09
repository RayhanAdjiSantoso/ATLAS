-- =====================================================================
-- 046 — Brand Tracking targets & budget allocation
--
-- One row per brand × month: the month's sales target, ad spend budget, and
-- how that budget is split across the spend channels (percent per channel
-- key, the same keys Daily Tracking uses — fixed and custom). Brand
-- Tracking › Target & Budget reads it against the month's real daily sales
-- and spend to show achievement, run-rate projection, per-channel budget,
-- daily budget and what remains.
--
-- target_roas is not stored: it is target_sales ÷ target_spend.
-- allocation is { "<spend channel_key>": <percent 0–100>, ... }.
--
-- Additive only (a new table); idempotent / re-runnable.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS brand_tracking_targets (
    brand_id      INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    month         DATE    NOT NULL,
    target_sales  NUMERIC(18, 2),
    target_spend  NUMERIC(18, 2),
    allocation    JSONB   NOT NULL DEFAULT '{}'::jsonb,
    notes         TEXT,
    created_by    INTEGER REFERENCES users(user_id),
    updated_by    INTEGER REFERENCES users(user_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_brand_tracking_targets PRIMARY KEY (brand_id, month),
    CONSTRAINT ck_btt_month_first CHECK (EXTRACT(DAY FROM month) = 1),
    CONSTRAINT ck_btt_nonneg CHECK (COALESCE(target_sales, 0) >= 0 AND COALESCE(target_spend, 0) >= 0)
);
