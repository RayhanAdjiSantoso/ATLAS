import { sessionKey } from '../../hooks/useSessionState.js';

// Pengaturan Brand restores its brand, view and platform from sessionStorage
// on mount. Writing them just before navigating is how a link elsewhere lands
// on the exact brand and tab it points at, without adding URL params the page
// would then have to own.
export function presetBrandSettings({ brandId, view, platform } = {}) {
  try {
    if (view) sessionStorage.setItem(sessionKey('brand-settings:view'), JSON.stringify(view));
    if (brandId) sessionStorage.setItem(sessionKey('brand-settings:brand'), JSON.stringify(Number(brandId)));
    if (platform) sessionStorage.setItem(sessionKey('brand-settings:platform'), JSON.stringify(platform));
  } catch {
    /* storage blocked — the link still navigates, just without the preset */
  }
}
