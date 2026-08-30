import type { DeltaClassName, DeltaResult, Sentiment } from './types';

// Shared Growth/Perubahan (%) calculation used by every platform (Meta, Shopee,
// TikTok, Overview, Cost-per-X). Business rule for Previous=0:
//   - Previous=0, Current=0  -> flat, "0%"
//   - Previous=0, Current>0  -> no baseline to compare against, "New"
//   - Previous=0, Current<0  -> not reachable by any metric in this app (all are
//     non-negative), but treated as N/A defensively
export function computeDelta(
  vOld: number | null | undefined,
  vCur: number | null | undefined,
): DeltaResult {
  if (vOld === null || vOld === undefined || vCur === null || vCur === undefined) {
    return { deltaNum: null, deltaStr: '—' };
  }
  if (vOld === 0) {
    if (vCur === 0) return { deltaNum: 0, deltaStr: '0%' };
    if (vCur > 0) return { deltaNum: null, deltaStr: 'New' };
    return { deltaNum: null, deltaStr: 'N/A' };
  }
  const deltaNum = ((vCur - vOld) / Math.abs(vOld)) * 100;
  return { deltaNum, deltaStr: (deltaNum >= 0 ? '+' : '') + deltaNum.toFixed(2) + '%' };
}

// Shopee Deep-Dive-only: renders a %Change using Indonesian numeral
// convention (comma decimal, e.g. "+12,34%") instead of computeDelta's own
// dot-decimal deltaStr — kept as a separate function rather than changing
// computeDelta itself, since that shared deltaStr format is already relied
// on (and tested) by every other platform's tables (Meta/TikTok/Business/
// Summary/the original Shopee Ads summary).
export function formatDeltaID(deltaNum: number | null, fallback: string): string {
  if (deltaNum === null) return fallback;
  const sign = deltaNum >= 0 ? '+' : '';
  return sign + deltaNum.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}

// Generic sentiment-aware delta class, used by Shopee/TikTok/Overview/Business
// Overview/Cost-per-X rows (originally `shopeeDeltaClass` despite being
// platform-agnostic).
export function deltaClassForSentiment(
  deltaNum: number | null,
  sentiment: Sentiment,
): DeltaClassName {
  if (deltaNum === null) return 'delta-neutral';
  if (sentiment === 'neutral') return 'delta-neutral';
  const up = deltaNum >= 0;
  if (sentiment === 'higher-better') return up ? 'delta-good' : 'delta-bad';
  return up ? 'delta-bad' : 'delta-good';
}
