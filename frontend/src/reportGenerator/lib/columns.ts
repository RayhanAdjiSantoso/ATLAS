import type { SheetRow } from './types';

// Rows from several exports — Periode Lalu and Periode Ini, or a period's
// part files — are read as one list, and every parser here learns the
// columns from the FIRST row (findCol, stripCampaignSubtotals, …). When the
// exports differ, e.g. this month's adds an "Objective" breakdown last
// month's lacked, the later file's extra column is invisible to all of them:
// its "Objective = All" subtotal rows are no longer recognised as subtotals
// and its spend is counted twice. Giving every row every column (blank where
// a file had none) makes the first row speak for the whole list.
export function alignRowKeys(rows: SheetRow[]): SheetRow[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  if (rows.every((r) => Object.keys(r).length === keys.length)) return rows;
  return rows.map((r) => {
    if (Object.keys(r).length === keys.length) return r;
    const out: SheetRow = {};
    for (const k of keys) out[k] = k in r ? r[k] : '';
    return out;
  });
}

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
