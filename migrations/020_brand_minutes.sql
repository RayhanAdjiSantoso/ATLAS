-- Minutes of Meeting: catatan operasional per brand yang dipakai bersama
-- oleh Pengaturan Brand dan Dashboard Business Overview.
SET search_path TO public;

CREATE TABLE IF NOT EXISTS public.brand_minutes (
    id                  SERIAL PRIMARY KEY,
    brand_id            INTEGER NOT NULL REFERENCES public.brands(brand_id) ON DELETE CASCADE,
    meeting_date        DATE NOT NULL,
    meeting_type        TEXT NOT NULL CHECK (meeting_type IN ('regular', 'non_regular', 'whatsapp_quick_call')),
    meeting_recap       TEXT,
    todo_client         TEXT,
    todo_mil            TEXT,
    created_by          INTEGER REFERENCES public.users(user_id),
    updated_by          INTEGER REFERENCES public.users(user_id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_brand_minutes_brand_date
    ON public.brand_minutes (brand_id, meeting_date DESC, id DESC);
