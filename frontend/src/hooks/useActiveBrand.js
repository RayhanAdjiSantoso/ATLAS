import { useCallback } from 'react';
import useSessionState, { sessionKey } from './useSessionState.js';

// The brand being worked on, shared by every page that picks one (Brand
// Overview, Brand Tracking, Brand Setting, Data Collection Hub, Report
// Generator, Business Insight): pick a brand on one page and the next page
// opens on it. Same scope as useSessionState — per account and browser tab.
// Always a number, or null when none is picked.
export const ACTIVE_BRAND_KEY = 'active-brand';

const toId = (v) => (v == null || v === '' ? null : Number(v) || null);

export function presetActiveBrand(brandId) {
  try {
    if (toId(brandId)) sessionStorage.setItem(sessionKey(ACTIVE_BRAND_KEY), JSON.stringify(toId(brandId)));
  } catch { /* storage blocked — the next page just opens on its default */ }
}

export default function useActiveBrand() {
  const [raw, setRaw] = useSessionState(ACTIVE_BRAND_KEY, null);
  const set = useCallback((next) => setRaw((prev) => toId(typeof next === 'function' ? next(toId(prev)) : next)), [setRaw]);
  return [toId(raw), set];
}
