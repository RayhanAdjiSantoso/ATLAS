import type { SheetRow } from './types';

// Generic column finder shared across Meta/Shopee/TikTok/Overview parsing:
// first header whose lowercased name contains one of the given keywords.
export function findCol(rows: SheetRow[], keywords: string[]): string | null {
  const hs = Object.keys(rows[0] || {});
  return hs.find((h) => keywords.some((k) => h.toLowerCase().includes(k.toLowerCase()))) || null;
}

// Matches a list of keys against headers, in order, keeping first match per key
// (used to pick a fixed default metric set for a KPI card, e.g. DEFS.nonBoostDemo).
export function matchDef(keys: readonly string[], headers: string[]): string[] {
  const result: string[] = [];
  for (const k of keys) {
    const lc = k.toLowerCase();
    let match = headers.find((h) => h.toLowerCase().includes(lc));
    if (!match) {
      match = headers.find((h) => lc.split(' ').every((w) => w.length > 2 && h.toLowerCase().includes(w)));
    }
    if (match && !result.includes(match)) result.push(match);
  }
  return result;
}
