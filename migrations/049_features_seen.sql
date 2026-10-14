-- =====================================================================
-- 049 — "Fitur baru" spotlights
--
-- When a feature ships, the frontend lists it (components/common/
-- whatsNew.js) and every account except superadmin is shown a short guide
-- pointing at it, once, the first time it is on their screen. This column
-- records which of those an account has already seen.
--
-- Unlike tours_seen (048), every account starts at '{}' — existing ones
-- included — because a new feature is news to everyone. Accounts created
-- after a feature shipped never see it: the page tour already covers it.
-- =====================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS features_seen TEXT[] NOT NULL DEFAULT '{}';
