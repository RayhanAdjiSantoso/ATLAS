import type { AudienceMetricDef } from './metaAudience';

// The names the Meta report shows for its metrics. A Meta table row is named
// after the file's own column ("Purchases conversion value for shared items
// only (IDR)"), and a chart menu after its own short label ("Purchase Rate");
// both are read through here so one metric carries one name on every table
// and chart. Keys are lower-cased, with "(IDR)" dropped — the value already
// reads Rp. A name not listed is shown in title case ("Cost per
// interaction" → "Cost per Interaction"), minus "(IDR)".
const RENAMES: Record<string, string> = {
  'purchases conversion value for shared items only': 'GMV',
  'purchases conversion value': 'GMV',
  'purchase value': 'GMV',
  'purchase roas for shared items only': 'ROAS',
  'purchase roas (return on ad spend)': 'ROAS',
  'purchase roas': 'ROAS',
  'cpm (cost per 1,000 impressions)': 'Cost per Mille (CPM)',
  'link clicks': 'Clicks',
  'ctr (link click-through rate)': 'Click-Through Rate (CTR)',
  'click-through rate': 'Click-Through Rate (CTR)',
  ctr: 'Click-Through Rate (CTR)',
  'cpc (cost per link click)': 'Cost per Click (CPC)',
  'content views with shared items': 'Content Views',
  'content views': 'Content Views',
  'cost per content view': 'Cost per Content Views',
  'cost per content view with shared items': 'Cost per Content Views',
  'adds to cart with shared items': 'Adds To Cart',
  'adds to cart': 'Adds To Cart',
  atc: 'Adds To Cart',
  'cost per add to cart': 'Cost per ATC (CPATC)',
  'cost per add to cart with shared items': 'Cost per ATC (CPATC)',
  'add to cart rate': 'Clicks → ATC Rate',
  'atc rate': 'Clicks → ATC Rate',
  'purchases with shared items': 'Purchases',
  purchases: 'Purchases',
  purchase: 'Purchases',
  'cost per purchase si': 'Cost per Purchase (CPP)',
  'cost per purchase with shared items': 'Cost per Purchase (CPP)',
  'cost per purchase': 'Cost per Purchase (CPP)',
  'purchase rate': 'ATC → Purchase Rate',
  'conversion rate': 'Conversion Rate (CVR)',
  'average order value': 'Average Order Value (AOV)',
};

// Small words stay lower-case unless they open the name.
const MINOR = new Set(['per', 'to', 'of', 'and', 'or', 'for', 'with', 'on', 'in', 'by', 'a', 'an', 'the', 'vs']);

// Every word capitalised, also after "-", "(" or "/" ("Click-Through");
// letters already upper-case (CTR, ROAS) are kept.
function titleCase(label: string): string {
  return label
    .split(' ')
    .map((w, i) => (i > 0 && MINOR.has(w.toLowerCase()) ? w.toLowerCase() : w.replace(/(^|[-(/])(\p{Ll})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())))
    .join(' ');
}

export function metaMetricLabel(label: string): string {
  const base = label.replace(/\s*\(IDR\)/gi, '').replace(/\s+/g, ' ').trim();
  return RENAMES[base.toLowerCase()] ?? titleCase(base);
}

export function relabelMetaRows<T extends { label: string }>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, label: metaMetricLabel(r.label) }));
}

// Cached per menu, so a chart keeps the same menu object across renders.
const menuCache = new WeakMap<object, unknown>();
export function relabelMetaMenu<M>(menu: readonly AudienceMetricDef<M>[]): readonly AudienceMetricDef<M>[] {
  const hit = menuCache.get(menu);
  if (hit) return hit as AudienceMetricDef<M>[];
  const next = menu.map((m) => ({ ...m, label: metaMetricLabel(m.label) }));
  menuCache.set(menu, next);
  return next;
}
