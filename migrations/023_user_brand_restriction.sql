-- =====================================================================
-- Per-user brand restriction + view-only flag
-- Lets an account be locked to exactly one brand (all pages) and/or
-- blocked from any write action, independent of `role`. NULL/FALSE
-- (the default) means "unrestricted", so existing admin/user accounts
-- are unaffected.
-- =====================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_brand_id INTEGER REFERENCES public.brands(brand_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_view_only BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ix_users_allowed_brand ON users (allowed_brand_id);
