import { useCallback, useState } from 'react';

// Remember navigation context per signed-in account and browser tab.
export function sessionKey(key) {
  try {
    const user = JSON.parse(localStorage.getItem('atlas_user') || '{}');
    return `atlas:${user.userId ?? user.user_id ?? user.email ?? 'session'}:${key}`;
  } catch { return `atlas:session:${key}`; }
}
export function readSession(key, fallback) {
  try { const raw = sessionStorage.getItem(sessionKey(key)); return raw === null ? fallback : JSON.parse(raw); }
  catch { return fallback; }
}
export default function useSessionState(key, initial) {
  const [value, setValue] = useState(() => readSession(key, initial));
  const update = useCallback((next) => setValue(previous => {
    const resolved = typeof next === 'function' ? next(previous) : next;
    try { sessionStorage.setItem(sessionKey(key), JSON.stringify(resolved)); } catch { /* storage may be disabled */ }
    return resolved;
  }), [key]);
  return [value, update];
}
