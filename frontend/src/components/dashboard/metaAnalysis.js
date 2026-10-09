import { findCol } from '../../reportGenerator/lib/columns.ts';
import { findSpentCol, isAllValue, parseMetaDayValue, parseNum } from '../../reportGenerator/lib/meta.ts';
import { isBoostRow } from '../../reportGenerator/features/meta/metaReport.ts';
import { readMetaRows } from './metaOverview.js';

// Business Overview › Meta Ads analysis tabs (Business Growth, Traffic &
// Funnel, Audience, Campaign Performance, Root Cause). Every tab reads the
// same records: each leaf row of Boost Post, Non Boost Post and CPAS (and,
// for months before the split, the old combined export divided into Boost /
// Non-Boost by the same rule Report Generator uses), cut to the period and
// reduced to one flat shape.

export const DATASET_META = {
  boost: { label: 'Boost Post', short: 'Boost', color: '#7aa7ff' },
  nonboost: { label: 'Non Boost Post', short: 'Non Boost', color: '#1877f2' },
  cpas: { label: 'CPAS', short: 'CPAS', color: '#ee4d2d' },
};
export const SELLING = ['nonboost', 'cpas'];

const COLS = {
  impressions: ['impressions'],
  clicks: ['link clicks'],
  views: ['content views', 'content views with shared items'],
  atc: ['adds to cart', 'adds to cart with shared items'],
  purchases: ['purchases', 'purchases with shared items'],
  value: ['purchases conversion value', 'purchases conversion value for shared items only', 'purchases conversion value for shared items', 'purchase conversion value'],
  visits: ['instagram profile visits', 'profile visits'],
  interactions: ['post interactions', 'post engagement'],
};
const METRICS = ['spend', ...Object.keys(COLS)];

const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const text = (v) => String(v ?? '').trim();

function normalise(channel, rows) {
  if (!rows?.length) return [];
  const keys = Object.keys(rows[0]);
  const exact = (names) => names.map((n) => keys.find((k) => k.trim().toLowerCase() === n)).find(Boolean) ?? null;
  const col = { spend: findSpentCol(rows) };
  for (const [k, names] of Object.entries(COLS)) col[k] = exact(names);
  const dim = {
    day: exact(['day']),
    campaign: exact(['campaign name']) ?? findCol(rows, ['campaign']),
    adset: exact(['ad set name']),
    ad: exact(['ad name']),
    age: exact(['age']),
    gender: exact(['gender']),
  };
  // A "formatted table" export carries Age=All / Gender=All rollups next to
  // the breakdown cells; summing both would count the spend twice.
  const broken = (c) => c && rows.some((r) => !isAllValue(r[c]));
  let leaves = rows;
  if (broken(dim.age)) leaves = leaves.filter((r) => !isAllValue(r[dim.age]));
  if (broken(dim.gender)) leaves = leaves.filter((r) => !isAllValue(r[dim.gender]));
  const boost = channel === 'meta' ? isBoostRow(dim.campaign) : null;
  return leaves.map((r) => {
    const day = dim.day ? parseMetaDayValue(r[dim.day]) : null;
    const rec = {
      ds: boost ? (boost(r) ? 'boost' : 'nonboost') : channel,
      legacy: channel === 'meta',
      day: day ? isoOf(day) : null,
      campaign: text(r[dim.campaign]) || '(tanpa nama)',
      adset: text(r[dim.adset]) || '—',
      ad: text(r[dim.ad]) || '—',
      age: text(r[dim.age]) || 'Unknown',
      gender: text(r[dim.gender]) || 'unknown',
    };
    for (const m of METRICS) rec[m] = col[m] ? parseNum(r[col[m]]) ?? 0 : 0;
    return rec;
  });
}

const cache = new Map();
// Records for one period: [{ ds, day, campaign, adset, ad, age, gender,
// spend, impressions, clicks, views, atc, purchases, value, visits,
// interactions }], plus which file each month came from.
export function loadMetaRecords(brandId, start, end, mode = 'auto') {
  const key = [brandId, start, end, mode].join('|');
  if (!cache.has(key)) {
    cache.set(key, readMetaRows(brandId, start, end, mode).then((res) => ({
      records: ['boost', 'nonboost', 'cpas', 'meta'].flatMap((c) => normalise(c, res.rows[c])),
      monthSources: res.monthSources,
      missing: res.missing,
    })).catch((err) => { cache.delete(key); throw err; }));
  }
  return cache.get(key);
}

const div = (a, b) => (a != null && b ? a / b : null);

// Sum of a set of records with every derived ratio.
export function totals(records) {
  const t = Object.fromEntries(METRICS.map((m) => [m, 0]));
  for (const r of records) for (const m of METRICS) t[m] += r[m];
  return {
    ...t,
    rows: records.length,
    roas: div(t.value, t.spend),
    ctr: div(t.clicks, t.impressions),
    cpm: t.impressions ? (t.spend / t.impressions) * 1000 : null,
    cpc: div(t.spend, t.clicks),
    cpa: div(t.spend, t.purchases),
    aov: div(t.value, t.purchases),
    cvr: div(t.purchases, t.clicks),
    atcRate: div(t.atc, t.clicks),
    costPerAtc: div(t.spend, t.atc),
    costPerVisit: div(t.spend, t.visits),
    visitRate: div(t.visits, t.clicks || t.impressions),
  };
}

export function byDataset(records) {
  return Object.fromEntries(Object.keys(DATASET_META).map((ds) => {
    const rows = records.filter((r) => r.ds === ds);
    return [ds, rows.length ? totals(rows) : null];
  }));
}

export const selling = (records) => records.filter((r) => SELLING.includes(r.ds));

// One entry per day of the period (empty days included, so gaps show).
export function daily(records, start, end) {
  const map = new Map();
  for (let d = new Date(`${start}T00:00:00`), last = new Date(`${end}T00:00:00`); d <= last; d.setDate(d.getDate() + 1)) {
    map.set(isoOf(d), { day: isoOf(d), boost: 0, nonboost: 0, cpas: 0, spend: 0, value: 0, sellSpend: 0, purchases: 0 });
  }
  for (const r of records) {
    const e = r.day && map.get(r.day);
    if (!e) continue;
    e[r.ds] += r.spend;
    e.spend += r.spend;
    if (SELLING.includes(r.ds)) { e.value += r.value; e.sellSpend += r.spend; e.purchases += r.purchases; }
  }
  return [...map.values()].map((e) => ({ ...e, roas: div(e.value, e.sellSpend) }));
}

// Rows grouped by one dimension, biggest spend first.
export function groupBy(records, key) {
  const groups = new Map();
  for (const r of records) {
    const k = r[key];
    if (!groups.has(k)) groups.set(k, { key: k, records: [], ds: new Set() });
    const g = groups.get(k);
    g.records.push(r);
    g.ds.add(r.ds);
  }
  return [...groups.values()]
    .map((g) => ({ key: g.key, ds: [...g.ds], ...totals(g.records) }))
    .sort((a, b) => b.spend - a.spend);
}

// ROAS = value ÷ spend = (impressions ÷ spend) × CTR × CVR × AOV. Each
// factor's share of the change is its share of the change in ln ROAS, so
// the effects add up exactly to the ROAS movement.
export function roasDrivers(cur, prev) {
  if (!cur?.roas || !prev?.roas) return null;
  const parts = [
    { key: 'cpm', say: 'biaya tayang (CPM)', label: 'Biaya tayang (CPM)', hint: 'Makin murah, makin banyak tayangan per rupiah', now: cur.cpm, before: prev.cpm, f: (t) => div(t.impressions, t.spend), inverse: true },
    { key: 'ctr', say: 'CTR link', label: 'CTR link', hint: 'Klik link per tayangan', now: cur.ctr, before: prev.ctr, f: (t) => t.ctr },
    { key: 'cvr', say: 'konversi klik → beli', label: 'Konversi klik → beli', hint: 'Purchase per klik link', now: cur.cvr, before: prev.cvr, f: (t) => t.cvr },
    { key: 'aov', say: 'nilai per pembelian (AOV)', label: 'Nilai per pembelian (AOV)', hint: 'Purchase value per purchase', now: cur.aov, before: prev.aov, f: (t) => t.aov },
  ];
  const dRoas = cur.roas - prev.roas;
  const lnTotal = Math.log(cur.roas / prev.roas);
  const out = parts.map((p) => {
    const a = p.f(cur);
    const b = p.f(prev);
    const ln = a && b ? Math.log(a / b) : null;
    return {
      ...p,
      change: p.now != null && p.before ? (p.now - p.before) / p.before : null,
      effect: ln != null && Math.abs(lnTotal) > 1e-9 ? dRoas * (ln / lnTotal) : null,
      ln,
    };
  });
  return { roasNow: cur.roas, roasBefore: prev.roas, dRoas, parts: out };
}

// The comparison period: the one set in the filter, else the same number
// of days right before.
export function comparisonRange(filters) {
  if (filters.compare && filters.compareStartDate && filters.compareEndDate) {
    return { start: filters.compareStartDate, end: filters.compareEndDate, auto: false };
  }
  const s = new Date(`${filters.startDate}T00:00:00`);
  const e = new Date(`${filters.endDate}T00:00:00`);
  const days = Math.round((e - s) / 86400000) + 1;
  const pe = new Date(s); pe.setDate(pe.getDate() - 1);
  const ps = new Date(pe); ps.setDate(ps.getDate() - (days - 1));
  // A whole calendar month compares with the whole month before.
  const wholeMonth = s.getDate() === 1 && new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate() === e.getDate() && s.getMonth() === e.getMonth();
  if (wholeMonth) {
    const ms = new Date(s.getFullYear(), s.getMonth() - 1, 1);
    const me = new Date(s.getFullYear(), s.getMonth(), 0);
    return { start: isoOf(ms), end: isoOf(me), auto: true };
  }
  return { start: isoOf(ps), end: isoOf(pe), auto: true };
}
