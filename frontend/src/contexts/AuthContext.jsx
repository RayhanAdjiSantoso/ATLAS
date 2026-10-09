import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client.js';

const AuthContext = createContext(null);

// Idle session limit. A session nobody has touched for this long ends and the
// next visit asks for the password again. Activity in any tab counts — the
// timestamp lives in localStorage, which every tab shares. The token's own
// expiry (JWT_EXPIRES_IN on the server) still caps a session that stays busy.
const IDLE_MINUTES = Number(import.meta.env.VITE_SESSION_IDLE_MINUTES) || 120;
const IDLE_MS = IDLE_MINUTES * 60_000;
const LAST_ACTIVE = 'atlas_last_active';
export const SESSION_EXPIRED_FLAG = 'atlas_session_expired';

const lastActive = () => Number(localStorage.getItem(LAST_ACTIVE)) || 0;
const markActive = () => localStorage.setItem(LAST_ACTIVE, String(Date.now()));
const idleExpired = () => {
  const last = lastActive();
  return last > 0 && Date.now() - last > IDLE_MS;
};
function clearSession() {
  localStorage.removeItem('atlas_token');
  localStorage.removeItem('atlas_user');
  localStorage.removeItem(LAST_ACTIVE);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    // A session left idle past the limit is over before anything renders.
    if (localStorage.getItem('atlas_token') && idleExpired()) {
      clearSession();
      sessionStorage.setItem(SESSION_EXPIRED_FLAG, '1');
      return null;
    }
    const stored = localStorage.getItem('atlas_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('atlas_token');
    if (!token) {
      setLoading(false);
      return;
    }
    // Sessions from before the idle limit existed start counting now.
    if (!lastActive()) markActive();

    // An expired token just means a guest; the homepage greets them rather
    // than the 401 handler bouncing them to the login form.
    api.get('/auth/me', { skipAuthRedirect: true })
      .then((res) => setUser(res.data.user))
      .catch(() => {
        localStorage.removeItem('atlas_token');
        localStorage.removeItem('atlas_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('atlas_token', res.data.token);
    localStorage.setItem('atlas_user', JSON.stringify(res.data.user));
    markActive();
    sessionStorage.removeItem(SESSION_EXPIRED_FLAG);
    setUser(res.data.user);
    return res.data;
  };

  // Re-read the account after something about it changed on the server (a
  // replaced temporary password, a permission edit) so the menu follows.
  const refresh = async () => {
    const res = await api.get('/auth/me');
    localStorage.setItem('atlas_user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    return res.data.user;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    clearSession();
    setUser(null);
  };

  // While signed in: any interaction keeps the session alive (written at most
  // every 30 s), and a minute-by-minute check ends it once the limit passes —
  // also when the laptop wakes from sleep or the tab comes back into view.
  useEffect(() => {
    if (!user) return undefined;
    let written = 0;
    const touch = () => {
      const now = Date.now();
      if (now - written < 30_000) return;
      written = now;
      if (idleExpired()) return; // too late: the check below ends it
      markActive();
    };
    const check = () => {
      if (!idleExpired()) return;
      clearSession();
      sessionStorage.setItem(SESSION_EXPIRED_FLAG, '1');
      window.location.assign('/login');
    };
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, 60_000);
    check();
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      refresh,
      // Superadmin is an admin with more rights, never fewer, so every
      // existing "admin" check keeps working for it.
      isAdmin: user?.role === 'admin' || user?.role === 'superadmin',
      isSuperAdmin: user?.role === 'superadmin',
      isClient: user?.role === 'client',
      isViewOnly: !!user?.isViewOnly,
      allowedBrandId: user?.allowedBrandId ?? null,
      mustChangePassword: !!user?.mustChangePassword,
      // What Pengaturan Akses lets this role open. An account loaded from an
      // older session without the list falls back to "everything the server
      // allows" — the server still checks every request.
      can: (module) => user?.role === 'superadmin' || !user?.modules || user.modules.includes(module),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
