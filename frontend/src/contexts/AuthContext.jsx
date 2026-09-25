import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
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

    api.get('/auth/me')
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
    localStorage.removeItem('atlas_token');
    localStorage.removeItem('atlas_user');
    setUser(null);
  };

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
