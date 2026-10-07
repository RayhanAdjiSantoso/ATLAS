import { sessionKey } from '../../hooks/useSessionState.js';

// Data Collection Hub restores its brand, view and platform from sessionStorage
// on mount. Writing them just before navigating is how a link elsewhere lands
// on the exact brand and tab it points at, without adding URL params the page
// would then have to own.
export function presetBrandSettings({ brandId, view, platform } = {}) {
  try {
    const accountPlatform = view === 'meta-automation' ? 'meta' : view === 'google-ads' ? 'google' : null;
    if (view) sessionStorage.setItem(sessionKey('brand-settings:view'), JSON.stringify(accountPlatform ? 'data' : view));
    if (view === 'data' || view === 'meta-automation' || view === 'google-ads') {
      sessionStorage.setItem(sessionKey('brand-settings:database-view'), JSON.stringify('files'));
    }
    if (brandId) sessionStorage.setItem(sessionKey('brand-settings:brand'), JSON.stringify(Number(brandId)));
    if (accountPlatform || platform) sessionStorage.setItem(sessionKey('brand-settings:platform'), JSON.stringify(accountPlatform || platform));
  } catch {
    /* storage blocked — the link still navigates, just without the preset */
  }
}
