-- =====================================================================
-- 027 — Daily Tracking: free-text notes on a sales channel row
--
-- Some source sheets carry a Notes column right after a channel's
-- Revenue / Qty / Transaksi triplet — e.g. Drc's "RETUR" / "KKI - RETUR"
-- explaining a negative line (see 026). Stored per (brand, day, channel)
-- next to the numbers it explains. NULL = no note.
-- =====================================================================
ALTER TABLE daily_channel_sales ADD COLUMN IF NOT EXISTS notes TEXT;
