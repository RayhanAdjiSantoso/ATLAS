import type { ShopPlusGroup } from './shopeeChannelAnalysis';

// ══════════════════════════════════════════════════════
// SHOPEE — Shop+ Ads (Iklan Toko). Its table and root cause use the same
// funnel as Product Ads (shopeeFunnelReport.ts), with the Add-to-Cart rows
// left blank: neither Shop+ export has the column. What the funnel cannot say
// for Shop+ is what its ad groups did — that is added to the read here.
// ══════════════════════════════════════════════════════

const pctTxt = (v: number) => `${v.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;

// What the ad groups did — the one thing the funnel cannot say for Shop+.
export function shopPlusGroupsPoint(groups: ShopPlusGroup[]): string | null {
  const cur = groups.filter((g) => g.cur);
  const old = groups.filter((g) => g.old);
  if (!cur.length && !old.length) return null;
  const fresh = groups.filter((g) => g.presence === 'new').length;
  const gone = groups.filter((g) => g.presence === 'gone').length;
  const total = cur.reduce((s, g) => s + (g.cur?.gmv ?? 0), 0);
  const top = [...cur].sort((a, b) => (b.cur?.gmv ?? 0) - (a.cur?.gmv ?? 0))[0];
  const parts = [`${cur.length} grup iklan aktif periode ini (periode lalu ${old.length})`];
  if (fresh || gone) parts.push(`${fresh} grup baru, ${gone} grup tidak berjalan lagi`);
  let text = `${parts.join('; ')}.`;
  if (top && total > 0) text += ` "${top.name}" menyumbang ${pctTxt(((top.cur?.gmv ?? 0) / total) * 100)} omzet Shop+.`;
  return text;
}
