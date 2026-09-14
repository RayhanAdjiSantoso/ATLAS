-- Status checklist MOM disimpan per catatan. Key dibuat dari sisi UI dari
-- kelompok + teks tugas, sehingga edit lain pada recap tidak mereset progres.
ALTER TABLE public.brand_minutes
    ADD COLUMN IF NOT EXISTS completed_task_keys JSONB NOT NULL DEFAULT '[]'::jsonb;
