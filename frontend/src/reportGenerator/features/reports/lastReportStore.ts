import { readSession, sessionKey } from '../../../hooks/useSessionState.js';
import type { Platform } from './types';

// The report_run a platform tab last generated (and auto-saved) for a brand,
// so leaving the page or refreshing it reopens that report instead of an
// empty tab. Same scope as useSessionState — per account and browser tab.
const key = (platform: Platform, clientId: number) => `generator:last-report:${platform}:${clientId}`;

export function readLastReport(platform: Platform, clientId: number | null): number | null {
  return clientId ? (readSession(key(platform, clientId), null) as number | null) : null;
}

export function rememberLastReport(platform: Platform, clientId: number, runId: number) {
  try {
    sessionStorage.setItem(sessionKey(key(platform, clientId)), JSON.stringify(runId));
  } catch {
    /* storage blocked — the report just isn't reopened */
  }
}

export function forgetLastReport(platform: Platform, clientId: number | null) {
  if (!clientId) return;
  try {
    sessionStorage.removeItem(sessionKey(key(platform, clientId)));
  } catch {
    /* storage blocked */
  }
}
