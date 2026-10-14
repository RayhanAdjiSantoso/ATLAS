import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import Coachmark, { findVisible } from './Coachmark.jsx';
import { SHOW_FOR_DAYS, WHATS_NEW } from './whatsNew.js';

// Shows the "fitur baru" guides from whatsNew.js. Mounted once in AppLayout,
// so it covers every page and tab: it keeps checking the screen for a
// feature this account has not seen yet, and when one appears — the page
// loaded, a tab was opened, a modal came up — it points at it.

const CHECK_MS = 1000;
const DAY_MS = 86_400_000;
const releasedAt = (feature) => new Date(`${feature.released}T00:00:00`).getTime();

export default function FeatureSpotlight() {
  const { user, featuresSeen, markFeaturesSeen } = useAuth();
  const { pathname } = useLocation();
  const [batch, setBatch] = useState(null); // { key, ids, steps }

  const pending = useMemo(() => {
    if (!user || user.role === 'superadmin' || user.mustChangePassword || !featuresSeen || !user.createdAt) return [];
    const created = new Date(user.createdAt).getTime();
    const now = Date.now();
    return WHATS_NEW.filter((f) => !featuresSeen.includes(f.id)
      && created < releasedAt(f)
      && now - releasedAt(f) < SHOW_FOR_DAYS * DAY_MS
      && (!f.path || pathname.startsWith(f.path)));
  }, [user, featuresSeen, pathname]);

  useEffect(() => {
    if (batch || !pending.length) return undefined;
    const check = () => {
      // Never on top of another guide (a page tour playing, say).
      if (document.querySelector('.cm-root')) return;
      const present = pending.filter((f) => findVisible(f.target));
      if (!present.length) return;
      setBatch({
        key: present.map((f) => f.id).join('|'),
        ids: present.map((f) => f.id),
        steps: present.map((f) => ({ target: f.target, kicker: 'Fitur baru', title: f.title, body: f.body, padding: 6 })),
      });
    };
    const timer = setInterval(check, CHECK_MS);
    return () => clearInterval(timer);
  }, [batch, pending]);

  if (!batch) return null;
  return (
    <Coachmark
      key={batch.key}
      id={`fitur-baru:${batch.key}`}
      steps={batch.steps}
      autoStart
      onAutoStart={() => markFeaturesSeen(batch.ids)}
      onClose={() => setBatch(null)}
    />
  );
}
