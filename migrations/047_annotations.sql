-- =====================================================================
-- 047 — Website Annotation & Feedback
--
-- A reviewer opens ATLAS as usual, switches Annotation Mode on, clicks a
-- part of a page and leaves a comment on it. This adds what that needs:
--
--   • one role beside the existing four: reviewer — opens every module an
--     admin does (its defaults live in services/access/permissions.js) but
--     not Pengaturan Akses, and carries the `annotations` module;
--   • annotations — one row per comment, tied to the element it was left on.
--     `anchor` is the element's description (a selector path, a text
--     fingerprint and where inside the element the click landed), never a
--     screen coordinate, so the pin follows the element through scrolling,
--     resizing and layout changes;
--   • annotation_replies — the thread under a comment.
--
-- status is TEXT with a CHECK rather than an enum: an enum value added in a
-- migration cannot be used in the same transaction, and three keys do not
-- need a type of their own.
--
-- Additive only: no existing row changes meaning.
-- =====================================================================

SET search_path TO public;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'reviewer';

CREATE TABLE IF NOT EXISTS annotations (
    annotation_id      SERIAL PRIMARY KEY,
    page_path          TEXT    NOT NULL,
    anchor             JSONB   NOT NULL,
    element_label      TEXT,
    body               TEXT    NOT NULL,
    status             TEXT    NOT NULL DEFAULT 'open',
    viewport_width     INTEGER,
    viewport_height    INTEGER,
    created_by         INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    status_changed_by  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    status_changed_at  TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_annotations_status CHECK (status IN ('open', 'in_progress', 'resolved'))
);
CREATE INDEX IF NOT EXISTS ix_annotations_page ON annotations (page_path);
CREATE INDEX IF NOT EXISTS ix_annotations_created ON annotations (created_at DESC);

CREATE TABLE IF NOT EXISTS annotation_replies (
    reply_id       SERIAL PRIMARY KEY,
    annotation_id  INTEGER NOT NULL REFERENCES annotations(annotation_id) ON DELETE CASCADE,
    body           TEXT    NOT NULL,
    created_by     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_annotation_replies_annotation ON annotation_replies (annotation_id, created_at);
