-- =====================================================================
-- 048 — Several brands per account, and guided tours that play by themselves
--
-- 1. user_brand_access — the brands an account may open. No row means
--    every brand (unchanged for admins and most of the team). A client
--    account holds exactly one row; an internal "user" account may hold
--    several, since one person often handles more than one brand.
--    Replaces users.allowed_brand_id (023), which could hold only one. The
--    old column is copied here and left in place but no longer read.
--
-- 2. users.tours_seen — the page tours (Panduan) an account has already
--    seen. A tour plays by itself the first time its page opens for an
--    account that has not seen it. Accounts that existed before this
--    migration keep NULL, which means "do not auto-play": they already know
--    ATLAS. Accounts created from now on start at '{}'.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.user_brand_access (
  user_id  INTEGER NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  brand_id INTEGER NOT NULL REFERENCES public.brands(brand_id),
  PRIMARY KEY (user_id, brand_id)
);
CREATE INDEX IF NOT EXISTS ix_user_brand_access_brand ON public.user_brand_access (brand_id);

INSERT INTO public.user_brand_access (user_id, brand_id)
SELECT user_id, allowed_brand_id FROM public.users WHERE allowed_brand_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tours_seen TEXT[];
ALTER TABLE public.users ALTER COLUMN tours_seen SET DEFAULT '{}';
