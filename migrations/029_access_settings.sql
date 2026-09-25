-- =====================================================================
-- 029 — Pengaturan Akses: roles, per-role module permissions, audit log
--
-- Accounts are created by the team from the dashboard, never by public
-- sign-up (removed for Shopee Open Platform's data-protection audit). This
-- adds what that page needs:
--
--   • two roles beside admin/user: superadmin (everything, including who may
--     do what) and client (a brand's own account, dashboard only by default);
--   • a password the account must replace on first login, so the admin who
--     created it never knows the one in use;
--   • per-role module permissions the superadmin edits in the dashboard.
--     Only overrides are stored — a role/module pair with no row falls back
--     to the default in services/access/permissions.js;
--   • an audit log of who created or changed which account, and when.
--
-- Additive only: no existing row changes meaning.
-- =====================================================================

SET search_path TO public;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'superadmin';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'client';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- role is TEXT here on purpose: the enum values added above cannot be used in
-- the same transaction that adds them, and this table only stores keys.
CREATE TABLE IF NOT EXISTS role_permissions (
  role        TEXT NOT NULL,
  module      TEXT NOT NULL,
  allowed     BOOLEAN NOT NULL,
  updated_by  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role, module)
);

CREATE TABLE IF NOT EXISTS access_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  actor_user_id   INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  target_user_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  detail          JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_access_audit_created ON access_audit_log (created_at DESC);
