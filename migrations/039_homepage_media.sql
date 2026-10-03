-- =====================================================================
-- 039 — Homepage publik: foto carousel, logo klien, dan teks portofolio
--
-- The public homepage (before login) shows a photo carousel inside the mil
-- wordmark, a running strip of client logos, and a short MIL Digital
-- portfolio. All three are managed from the homepage itself by roles that
-- Pengaturan Akses allows (module `homepage_content`, admin by default).
--
-- Images are stored as bytea, compressed in the browser before upload
-- (photos ≤1600px WebP, logos ≤480px WebP) to keep the Neon footprint small.
--
-- Idempotent / re-runnable, same as the other migrations.
-- =====================================================================

SET search_path TO public;

CREATE TABLE IF NOT EXISTS homepage_media (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('photo', 'logo')),
  title       TEXT,
  caption     TEXT,
  mime        TEXT NOT NULL,
  data        BYTEA NOT NULL,
  byte_size   INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS homepage_media_kind_order_idx ON homepage_media (kind, sort_order, id);

-- Editable copy (headline, portfolio paragraph). Key/value so a new field
-- needs no migration.
CREATE TABLE IF NOT EXISTS homepage_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
