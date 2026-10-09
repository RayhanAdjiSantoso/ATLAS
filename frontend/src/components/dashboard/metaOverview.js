import api from '../../api/client.js';
import { readSpreadsheetFile } from '../../reportGenerator/lib/xlsxUtils.ts';
import { aggSum, findDenomCol, findSpentCol, parseMetaDayValue, resolveConceptCount, stripCampaignSubtotals } from '../../reportGenerator/lib/meta.ts';

// Business Overview › Meta Ads, read from Data Collection Hub's three Meta
// datasets — Boost Post, Non Boost Post and CPAS — the split that replaced
// the old combined "Meta Ads" file. Every number goes through Report
// Generator's own Meta helpers (the same column finders and the same
// "prefer the Age=All/Gender=All row" sum), so the two pages agree.
//
// Files are monthly with a Day breakdown; a period may span months, so every
// month it touches is fetched (all parts) and rows are cut to the exact days.

const LEGACY = { channel: 'meta', label: 'Meta Ads (gabungan lama)', hint: 'Bulan sebelum Boost & Non-Boost dipisah' };

export const META_DATASETS = [
  { channel: 'boost', label: 'Boost Post', hint: 'Awareness · profile visit & interaksi' },
  { channel: 'nonboost', label: 'Non Boost Post', hint: 'E-commerce & B2B · website' },
  { channel: 'cpas', label: 'CPAS', hint: 'Katalog Shopee / Tokopedia' },
];

const pad = (n) => String(n).padStart(2, '0');
const monthsIn = (start, end) => {
  const out = [];
  let [y, m] = start.slice(0, 7).split('-').map(Number);
  const [ey, em] = end.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
};
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// One library listing and one parse per file, shared by every period read
// for the same brand in this session.
const listCache = new Map();
const rowsCache = new Map();

async function listFiles(brandId) {
  if (!listCache.has(brandId)) {
    listCache.set(brandId, api.get(`/brands/${brandId}/library`).then(({ data }) => data.files ?? data ?? [])
      .catch((err) => { listCache.delete(brandId); throw err; }));
  }
  return listCache.get(brandId);
}

async function rowsOf(brandId, f) {
  const key = `${f.id}:${f.version ?? f.updated_at ?? ''}`;
  if (!rowsCache.has(key)) {
    rowsCache.set(key, (async () => {
      const { data } = await api.get(`/brands/${brandId}/library/${f.id}/download`, { responseType: 'blob' });
      return readSpreadsheetFile(new File([data], f.original_filename || `file-${f.id}.xlsx`));
    })().catch((err) => { rowsCache.delete(key); throw err; }));
  }
  return rowsCache.get(key);
}

export function clearMetaOverviewCache(brandId) {
  listCache.delete(brandId);
}

const count = (rows, ...concepts) => {
  for (const c of concepts) {
    const v = resolveConceptCount(rows, c);
    if (v != null) return v;
  }
  return null;
};
const sumCol = (rows, ...keywords) => {
  for (const k of keywords) {
    const col = findDenomCol(rows, k);
    if (col) return aggSum(rows, col);
  }
  return null;
};
const div = (a, b) => (a != null && b ? a / b : null);

// The measures that matter for each dataset's purpose.
function measure(channel, rows) {
  if (!rows.length) return null;
  const spentCol = findSpentCol(rows);
  const spend = spentCol ? aggSum(rows, spentCol) : null;
  const impressions = sumCol(rows, 'impressions');
  const reach = sumCol(rows, 'reach');
  const clicks = count(rows, 'link clicks');
  const base = {
    spend, impressions, reach, clicks,
    ctr: div(clicks, impressions),
    cpm: div(spend, impressions) != null ? (spend / impressions) * 1000 : null,
    cpc: div(spend, clicks),
  };
  if (channel === 'boost') {
    const visits = count(rows, 'instagram profile visits', 'profile visits');
    const interactions = count(rows, 'post interactions', 'post engagement');
    return { ...base, visits, interactions, costPerVisit: div(spend, visits), costPerInteraction: div(spend, interactions) };
  }
  const shared = channel === 'cpas';
  const purchases = shared ? sumCol(rows, 'purchases with shared items') : count(rows, 'purchases', 'purchase');
  const value = shared
    ? sumCol(rows, 'purchases conversion value for shared items', 'conversion value for shared items')
    : sumCol(rows, 'purchases conversion value', 'purchase conversion value');
  const atc = shared ? sumCol(rows, 'adds to cart with shared items') : count(rows, 'adds to cart');
  return {
    ...base, purchases, value, atc,
    roas: div(value, spend),
    costPerPurchase: div(spend, purchases),
    costPerAtc: div(spend, atc),
  };
}

// One period: { boost, nonboost, cpas } measures (null where the dataset has
// no file for the period), plus the months with no file at all.
export async function readMetaPeriod(brandId, start, end) {
  const files = await listFiles(brandId);
  const months = monthsIn(start, end);
  const out = { datasets: {}, missing: {} };
  const monthOf = (f) => String(f.period_month).slice(0, 7);
  // A month still filed only as the old combined export (before Boost and
  // Non-Boost were split) is read from that file, as its own dataset, so a
  // period reaching back before the split still has its spend.
  const splitMonths = new Set(files.filter((f) => ['boost', 'nonboost'].includes(f.channel)).map(monthOf));
  const legacyMonths = months.filter((m) => !splitMonths.has(m) && files.some((f) => f.channel === 'meta' && monthOf(f) === m));
  const sets = legacyMonths.length ? [...META_DATASETS, LEGACY] : META_DATASETS;
  await Promise.all(sets.map(async (ds) => {
    const picked = files.filter((f) => f.channel === ds.channel && months.includes(monthOf(f))
      && (ds.channel !== 'meta' || legacyMonths.includes(monthOf(f))));
    out.missing[ds.channel] = months.filter((m) => !picked.some((f) => monthOf(f) === m));
    if (!picked.length) { out.datasets[ds.channel] = null; return; }
    const all = (await Promise.all(picked.map((f) => rowsOf(brandId, f)))).flat();
    const rows = stripCampaignSubtotals(all);
    const dayCol = Object.keys(rows[0] || {}).find((h) => h.trim().toLowerCase() === 'day');
    const inRange = dayCol
      ? rows.filter((r) => {
        const d = parseMetaDayValue(r[dayCol]);
        if (!d) return false;
        const iso = isoOf(d);
        return iso >= start && iso <= end;
      })
      : rows;
    out.datasets[ds.channel] = measure(ds.channel, inRange);
  }));
  // The account's total across the three: spend, and ROAS over the two
  // datasets that sell (Boost Post is awareness).
  const ds = out.datasets;
  const add = (list, key) => list.reduce((a, d) => (d?.[key] != null ? (a ?? 0) + d[key] : a), null);
  const selling = [ds.nonboost, ds.cpas, ds.meta];
  const spend = add([ds.boost, ...selling], 'spend');
  const value = add(selling, 'value');
  out.total = { spend, value, purchases: add(selling, 'purchases'), roas: div(value, add(selling, 'spend')) };
  out.legacyMonths = legacyMonths;
  return out;
}
