-- =====================================================================
-- 058 — Built-in Revenue Data channels a brand does not use
--
-- Brand Tracking › Input Daily Tracking › Hapus Channel. A built-in channel
-- (Website, Chat, Shopee, …) is app config, so "deleting" it for one brand
-- deletes its entries and records it here; the channel list then leaves it
-- out. Adding a channel with the same name again (Tambah Channel, or a file
-- import that picks its column) removes the row and brings it back.
--
-- Additive only; idempotent.
-- =====================================================================

CREATE TABLE IF NOT EXISTS daily_tracking_hidden_channels (
    brand_id     INTEGER NOT NULL REFERENCES brands(brand_id) ON DELETE CASCADE,
    kind         TEXT    NOT NULL,           -- 'sales' | 'spend'
    channel_key  TEXT    NOT NULL,           -- a FIXED_*_CHANNELS key
    hidden_by    INTEGER REFERENCES users(user_id),
    hidden_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (brand_id, kind, channel_key),
    CONSTRAINT ck_dthc_kind CHECK (kind IN ('sales', 'spend'))
);
