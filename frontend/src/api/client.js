import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('atlas_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Backstop for view-only accounts: block every write client-side too, so
  // stray writes (e.g. Report Generator's autosave effect) never reach the
  // network. The server enforces this independently (blockWriteIfViewOnly);
  // this only saves a doomed round-trip.
  //
  // Daily Tracking is a deliberate exception: view-only client accounts are
  // allowed to write their own brand's daily sales + ad spend there (the
  // server enforces the brand lock via requireBrandAccess, not
  // blockWriteIfViewOnly — see backend/src/routes/dailyTrackingRoutes.js).
  const method = (config.method || 'get').toLowerCase();
  const isDailyTracking = /^\/daily-tracking(\/|\?|$)/.test(config.url || '');
  const isOwnPassword = /^\/auth\/(change-password|logout)$/.test(config.url || '');
  if (method !== 'get' && method !== 'head' && !isOwnPassword) {
    try {
      const stored = localStorage.getItem('atlas_user');
      const storedUser = stored ? JSON.parse(stored) : null;
      if (storedUser?.isViewOnly && !(isDailyTracking && storedUser.role === 'client')) {
        return Promise.reject(new Error('Akun ini hanya dapat melihat data (view-only).'));
      }
    } catch { /* ignore malformed storage, let the request through */ }
  }

  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('atlas_token');
      localStorage.removeItem('atlas_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

export default api;
