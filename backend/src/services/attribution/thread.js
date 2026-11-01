import { div, lmdi, mean, pearson, pctChange, sd } from './math.js';

// ===========================================================================
// Benang merah — bottom-up driver tracing without AI
// ===========================================================================
//
// The consultant's method, automated. The team used to lay one channel's
// spend over one outcome on a two-axis line chart (83 of them) and judge the
// "gap" between the lines by eye: the closer the lines move, the stronger
// the link. Here every pair is scored the same way, and the reading runs
// bottom-up from revenue, one step at a time:
//
//   1  Revenue       which sales channel moved total revenue
//   2  Funnel        which stage of that channel leaked (traffic, CR, AOV,
//                    ATC) — the metric to explain
//   3  Ad channel    which channel's activity moves with that metric
//   4  Campaign      inside it, which audience × goal group (NV/RM × View
//                    Content / ATC / Purchase / Traffic)
//   5  Audience      which age × gender serves that goal best, and which
//                    segments show anomalous metrics (e.g. a View Content
//                    campaign buying ATC unusually cheaply)
//
// "Gap" is measured on z-scored lines (kemiripan), correlation on 7-day
// sums (level) and on week-over-week changes (so two lines that merely
// share a trend are not called linked), with the driver allowed to lead by
// up to 7 days. Every link here is a correlation, not proof of cause — the
// page says so, and the contribution model (model.js) is the causal-ish read.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const fmtMonth = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const fmtPct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const fmtRp = (v) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `Rp${(v / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (a >= 1e6) return `Rp${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (a >= 1e3) return `Rp${(v / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 1 })} rb`;
  return `Rp${Math.round(v).toLocaleString('id-ID')}`;
};
const fmtNum = (v) => Math.round(v).toLocaleString('id-ID');

const SALES_LABELS = {
  shopee: 'Shopee', tiktok: 'TikTok', tokopedia: 'Tokopedia', website: 'Website', web: 'Website', chat: 'Chat',
  chat_wa: 'Chat WhatsApp', chat_ig: 'Chat Instagram', offline_store: 'Offline', offline: 'Offline', blibli: 'Blibli', lazada: 'Lazada',
};
const salesLabel = (k) => SALES_LABELS[k] ?? (k.length <= 3 ? k.toUpperCase() : k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

const AD_LABELS = {
  shopee_ads: 'Iklan Shopee', cpas: 'CPAS Shopee', meta_boost: 'Meta Boost Post', meta_nonboost: 'Meta Non-Boost',
  gmv_max: 'GMV Max TikTok', ttam: 'TikTok Ads', google_ads: 'Google Ads', cpas_tokopedia: 'CPAS Tokopedia',
};
const AUDIENCE_LABELS = { nv: 'New (NV)', rm: 'Remarketing (RM)', other: 'Audiens lain' };
const GOAL_LABELS = { vc: 'View Content', atc: 'Add to Cart', purchase: 'Purchase', traffic: 'Traffic', boost: 'Boost Post', other: 'Lainnya' };
// The cost each goal is bought at, and the result it is judged on.
const GOAL_RESULT = { vc: 'contentViews', atc: 'atc', purchase: 'purchases', traffic: 'clicks', boost: 'clicks', other: 'clicks' };
const RESULT_LABEL = { contentViews: 'View Content', atc: 'Add to Cart', purchases: 'Purchase', clicks: 'Link click' };
// How deep in the funnel a result sits.
const DEPTH = { clicks: 0, contentViews: 1, atc: 2, purchases: 3 };
const COST_LABEL = { contentViews: 'Cost per View Content', atc: 'Cost per ATC', purchases: 'Cost per Purchase', clicks: 'CPC' };

// ── Campaign naming: audience and goal ───────────────────────────────────
export function campaignAudience(name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (/^nv\b|^nv\(|new visitor|prospect|\bbroad\b/.test(n)) return 'nv';
  if (/^rm\b|^rm\(|remarket|retarget/.test(n)) return 'rm';
  return 'other';
}

export function campaignGoals(name, objective, channel) {
  if (channel === 'meta_boost') return ['boost'];
  const n = String(name ?? '').toLowerCase();
  const goals = [];
  if (/\bvc\b|view content|content view/.test(n)) goals.push('vc');
  if (/\batc\b|add to cart/.test(n)) goals.push('atc');
  if (/\bpur\b|purchase/.test(n)) goals.push('purchase');
  if (!goals.length) {
    if (/traffic|\blp\b|link click|profile visit/.test(n) || objective === 'LINK_CLICKS') goals.push('traffic');
    else if (objective === 'OUTCOME_SALES') goals.push('purchase');
    else goals.push('other');
  }
  return goals;
}
// The goal a campaign is optimised for — the deepest one it names.
const primaryGoal = (goals) => (goals.includes('purchase') ? 'purchase' : goals.includes('atc') ? 'atc' : goals.includes('vc') ? 'vc' : goals[0]);

// ── Calendar helpers ─────────────────────────────────────────────────────
const monthOf = (d) => d.slice(0, 7);
function weekOf(d) {
  const t = new Date(`${d}T00:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}

// ── Series: one value per day (sum) or a num/den pair (ratio) ────────────
function seriesSum(key, label, group, unit, dates, valueOf) {
  return { key, label, group, unit, kind: 'sum', dates, num: dates.map(valueOf), den: null };
}
function seriesRatio(key, label, group, unit, dates, numOf, denOf, scale = 1) {
  return { key, label, group, unit, kind: 'ratio', scale, dates, num: dates.map(numOf), den: dates.map(denOf) };
}

// Bucketed values (week / month): sums, or Σnum ÷ Σden for a ratio.
function bucket(series, keyOf) {
  const acc = new Map();
  series.dates.forEach((d, i) => {
    const n = series.num[i];
    if (n == null) return;
    const k = keyOf(d);
    const a = acc.get(k) ?? { num: 0, den: 0, days: 0 };
    a.num += n;
    if (series.den) a.den += series.den[i] ?? 0;
    a.days += 1;
    acc.set(k, a);
  });
  return [...acc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, a]) => ({
    key: k,
    days: a.days,
    value: series.kind === 'ratio' ? (a.den > 0 ? (a.num / a.den) * series.scale : null) : a.num,
  }));
}

// 7-day rolling value per day (null until 7 known days are in the window).
function rolling7(series) {
  const out = [];
  for (let i = 0; i < series.dates.length; i += 1) {
    let n = 0;
    let dn = 0;
    let known = 0;
    for (let j = Math.max(0, i - 6); j <= i; j += 1) {
      if (series.num[j] == null) continue;
      known += 1;
      n += series.num[j];
      if (series.den) dn += series.den[j] ?? 0;
    }
    out.push(known < 7 ? null : series.kind === 'ratio' ? (dn > 0 ? (n / dn) * series.scale : null) : n);
  }
  return out;
}

// Rank-based (Spearman) correlation: one spike day cannot make two lines
// look linked.
function ranks(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = Array(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    for (let k = i; k <= j; k += 1) out[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}
const spearman = (a, b) => pearson(ranks(a), ranks(b));

const zscore = (xs) => {
  const m = mean(xs);
  const s = sd(xs) || 1;
  return xs.map((x) => (x - m) / s);
};

// ── One pair: how closely does the driver's line follow the target's? ────
function relate(target, driver, rollT, rollD) {
  let best = null;
  for (let lag = 0; lag <= 7; lag += 1) {
    const t = [];
    const d = [];
    const dt = [];
    const dd = [];
    for (let i = lag + 7; i < rollT.length; i += 1) {
      const a = rollT[i];
      const b = rollD[i - lag];
      if (a == null || b == null) continue;
      t.push(a);
      d.push(b);
      const a0 = rollT[i - 7];
      const b0 = rollD[i - lag - 7];
      if (a0 != null && b0 != null) {
        dt.push(a - a0);
        dd.push(b - b0);
      }
    }
    if (t.length < 21) continue;
    // The driver must actually vary (be live on most of the window).
    if (d.filter((v) => v > 0).length < 21) continue;
    const r = spearman(t, d);
    const rChange = dt.length >= 14 ? spearman(dt, dd) : null;
    if (r == null) continue;
    const score = 0.5 * r + 0.5 * (rChange ?? 0);
    if (!best || Math.abs(score) > Math.abs(best.score)) {
      const zt = zscore(t);
      const zd = zscore(d);
      const gap = mean(zt.map((v, i) => Math.abs(v - zd[i])));
      best = { lag, r, rChange, score, n: t.length, similarity: Math.max(0, 1 - gap / 1.6) };
    }
  }
  if (!best) return null;
  const strength = best.score >= 0.55 ? 'kuat' : best.score >= 0.35 ? 'sedang' : best.score >= 0.15 ? 'lemah' : best.score <= -0.35 ? 'berlawanan' : 'tidak ada';
  return { target: target.key, driver: driver.key, ...best, strength };
}

// Change between two months, per day (months differ in length).
function periodChange(series, a, b) {
  const m = new Map(bucket(series, monthOf).map((x) => [x.key, x]));
  const pa = m.get(a);
  const pb = m.get(b);
  if (!pa || !pb || pa.value == null || pb.value == null) return null;
  const perDay = series.kind === 'sum';
  const va = perDay ? pa.value / pa.days : pa.value;
  const vb = perDay ? pb.value / pb.days : pb.value;
  return { from: va, to: vb, change: pctChange(va, vb), perDay };
}

// ── Build every series from the day data ─────────────────────────────────
function buildSeries(data, channels) {
  const dates = data.days.map((d) => d.date);
  const byDate = new Map(data.days.map((d) => [d.date, d]));
  const outcomes = [];
  const drivers = [];

  // Revenue per sales channel (Brand Tracking) and in total.
  const salesKeys = Object.keys(data.sales ?? {}).filter((k) => Object.values(data.sales[k]).some((v) => v.revenue > 0));
  if (salesKeys.length) {
    outcomes.push(seriesSum('rev_total', 'Revenue total (semua channel)', 'Revenue', 'idr', dates, (d) => {
      const vals = salesKeys.map((k) => data.sales[k][d]?.revenue);
      return vals.every((v) => v == null) ? null : vals.reduce((s, v) => s + (v ?? 0), 0);
    }));
    for (const k of salesKeys) outcomes.push(seriesSum(`sales:${k}`, `Revenue ${salesLabel(k)}`, 'Revenue', 'idr', dates, (d) => data.sales[k][d]?.revenue ?? null));
  }

  // The Shopee shop's own funnel.
  const st = (f) => (d) => byDate.get(d)?.store?.[f] ?? null;
  if (data.days.some((d) => d.store)) {
    outcomes.push(seriesSum('shp_revenue', 'Shopee · Revenue toko', 'Funnel Shopee', 'idr', dates, st('revenue')));
    outcomes.push(seriesSum('shp_visitors', 'Shopee · Pengunjung', 'Funnel Shopee', 'count', dates, st('visitors')));
    outcomes.push(seriesRatio('shp_clickrate', 'Shopee · Klik produk per pengunjung', 'Funnel Shopee', 'ratio', dates, st('clicks'), st('visitors')));
    outcomes.push(seriesRatio('shp_cr', 'Shopee · Conversion Rate', 'Funnel Shopee', 'pct', dates, st('orders'), st('visitors')));
    outcomes.push(seriesSum('shp_orders', 'Shopee · Pesanan', 'Funnel Shopee', 'count', dates, st('orders')));
    outcomes.push(seriesRatio('shp_aov', 'Shopee · AOV', 'Funnel Shopee', 'idr', dates, st('revenue'), st('orders')));
  }

  // Ad channel spend.
  for (const c of channels) {
    drivers.push(seriesSum(`spend:${c}`, `Spend ${AD_LABELS[c]}`, 'Channel iklan', 'idr', dates, (d) => byDate.get(d)?.ch[c]?.spend ?? null));
  }
  for (const [k, perDay] of Object.entries(data.otherSpend ?? {})) {
    if (!Object.values(perDay).some((v) => v > 0)) continue;
    drivers.push(seriesSum(`spend:${k}`, `Spend ${AD_LABELS[k] ?? k}`, 'Channel iklan', 'idr', dates, (d) => perDay[d] ?? (d >= Object.keys(perDay).sort()[0] ? 0 : null)));
  }
  // Iklan Shopee by type (GMV Max ROAS / Shop / Auto …).
  const subs = new Set();
  for (const d of data.days) for (const s of Object.keys(d.ch.shopee_ads?.bySub ?? {})) subs.add(s);
  for (const s of subs) {
    const has = data.days.some((d) => (d.ch.shopee_ads?.bySub?.[s]?.spend ?? 0) > 0);
    if (has) drivers.push(seriesSum(`shpsub:${s}`, `Iklan Shopee · ${s}`, 'Iklan Shopee per jenis', 'idr', dates, (d) => (byDate.get(d)?.ch.shopee_ads ? byDate.get(d).ch.shopee_ads.bySub?.[s]?.spend ?? 0 : null)));
  }

  // Meta activity — what the ads delivered, not only what they cost.
  const metaSum = (field, keys) => (d) => {
    const day = byDate.get(d);
    const vals = keys.map((k) => day?.ch[k]);
    return vals.every((v) => v == null) ? null : vals.reduce((s, v) => s + (v?.[field] ?? 0), 0);
  };
  const metaKeys = channels.filter((c) => ['meta_boost', 'meta_nonboost', 'cpas'].includes(c));
  if (metaKeys.length) {
    drivers.push(seriesSum('meta:impressions', 'Meta · Impressions (semua akun)', 'Aktivitas Meta', 'count', dates, metaSum('impressions', metaKeys)));
    drivers.push(seriesSum('meta:clicks', 'Meta · Link click (semua akun)', 'Aktivitas Meta', 'count', dates, metaSum('clicks', metaKeys)));
  }
  if (channels.includes('cpas')) {
    drivers.push(seriesSum('cpas:cv', 'CPAS · View Content', 'Aktivitas Meta', 'count', dates, metaSum('contentViews', ['cpas'])));
    drivers.push(seriesSum('cpas:atc', 'CPAS · Add to Cart', 'Aktivitas Meta', 'count', dates, metaSum('atc', ['cpas'])));
  }
  return { outcomes, drivers };
}

// ── Meta groups (channel × audience × goal) and segments (× age × gender) ─
function metaGroups(data, dates) {
  const groups = new Map();
  for (const r of data.metaDetail ?? []) {
    const goals = campaignGoals(r.campaign, r.objective, r.channel);
    const audience = campaignAudience(r.campaign);
    const goal = goals.join('+');
    const key = `${r.channel}|${audience}|${goal}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        channel: r.channel,
        audience,
        goals,
        primary: primaryGoal(goals),
        label: `${AD_LABELS[r.channel]} · ${AUDIENCE_LABELS[audience]} · ${goals.map((x) => GOAL_LABELS[x]).join(' + ')}`,
        campaigns: new Set(),
        byDate: new Map(),
        rows: [],
      };
      groups.set(key, g);
    }
    g.campaigns.add(r.campaign);
    const day = g.byDate.get(r.d) ?? { spend: 0, impressions: 0, clicks: 0, atc: 0, purchases: 0, value: 0, contentViews: 0 };
    for (const f of Object.keys(day)) day[f] += r[f];
    g.byDate.set(r.d, day);
    g.rows.push(r);
  }
  const firstMeta = (data.metaDetail ?? []).reduce((m, r) => (m && m < r.d ? m : r.d), null);
  for (const g of groups.values()) {
    g.spendSeries = seriesSum(`group:${g.key}`, g.label, 'Campaign Meta', 'idr', dates, (d) => g.byDate.get(d)?.spend ?? (firstMeta && d >= firstMeta ? 0 : null));
  }
  return [...groups.values()];
}

// Totals of a set of rows / day map over a month.
function sumRows(rows) {
  return rows.reduce((a, r) => {
    for (const f of ['spend', 'impressions', 'clicks', 'atc', 'purchases', 'value', 'contentViews']) a[f] += r[f] ?? 0;
    return a;
  }, { spend: 0, impressions: 0, clicks: 0, atc: 0, purchases: 0, value: 0, contentViews: 0 });
}
const costOf = (s, result) => div(s.spend, s[result]);
const metricsOf = (s) => ({
  spend: s.spend,
  cpm: div(s.spend * 1000, s.impressions),
  ctr: div(s.clicks, s.impressions),
  cpc: div(s.spend, s.clicks),
  cpv: div(s.spend, s.contentViews),
  cpatc: div(s.spend, s.atc),
  cpp: div(s.spend, s.purchases),
  atcRate: div(s.atc, s.clicks),
  roas: div(s.value, s.spend),
  results: { clicks: s.clicks, contentViews: s.contentViews, atc: s.atc, purchases: s.purchases },
});

// ── Anomaly finder over audience segments of one month ───────────────────
// A segment (campaign group × age × gender) whose cost for a result is far
// from its peers', on a log scale with a median/MAD z-score so one
// extreme does not hide the others. The "benang merah" kind: a segment buys
// a result its campaign is NOT optimised for unusually cheaply — e.g. a
// View Content campaign producing cheap ATC.
function findAnomalies(groups, month) {
  const segs = [];
  for (const g of groups) {
    const bySeg = new Map();
    for (const r of g.rows) {
      if (monthOf(r.d) !== month) continue;
      const k = `${r.age}|${r.gender}`;
      const acc = bySeg.get(k) ?? [];
      acc.push(r);
      bySeg.set(k, acc);
    }
    for (const [k, rows] of bySeg) {
      const [age, gender] = k.split('|');
      segs.push({ group: g, age, gender, totals: sumRows(rows) });
    }
  }
  const totalSpend = segs.reduce((s, x) => s + x.totals.spend, 0);
  const minSpend = Math.max(totalSpend * 0.01, 100000);
  const live = segs.filter((s) => s.totals.spend >= minSpend);
  const out = [];
  for (const result of ['clicks', 'contentViews', 'atc', 'purchases']) {
    const pts = live.map((s) => ({ s, cost: costOf(s.totals, result) })).filter((p) => p.cost != null && p.s.totals[result] >= 5);
    if (pts.length < 5) continue;
    const logs = pts.map((p) => Math.log(p.cost));
    const med = [...logs].sort((a, b) => a - b)[Math.floor(logs.length / 2)];
    const mad = [...logs.map((v) => Math.abs(v - med))].sort((a, b) => a - b)[Math.floor(logs.length / 2)] || 0.25;
    // Peers that are optimised for this result, for the comparison line.
    const goalPeers = pts.filter((p) => GOAL_RESULT[p.s.group.primary] === result).map((p) => p.cost).sort((a, b) => a - b);
    const peerMedian = goalPeers.length ? goalPeers[Math.floor(goalPeers.length / 2)] : Math.exp(med);
    pts.forEach((p, i) => {
      const z = (logs[i] - med) / (1.4826 * mad);
      if (Math.abs(z) < 1.5) return;
      if (Math.abs(p.cost - peerMedian) / peerMedian < 0.15) return;
      const optimisedFor = GOAL_RESULT[p.s.group.primary] === result || p.s.group.goals.some((g) => GOAL_RESULT[g] === result);
      // Expensive is only news for a result the campaign is meant to buy.
      if (z > 0 && !optimisedFor) return;
      out.push({
        month,
        group: p.s.group.key,
        groupLabel: p.s.group.label,
        age: p.s.age,
        gender: p.s.gender,
        result,
        resultLabel: RESULT_LABEL[result],
        costLabel: COST_LABEL[result],
        cost: p.cost,
        peerMedian,
        vsPeers: div(p.cost - peerMedian, peerMedian),
        volume: p.s.totals[result],
        spend: p.s.totals.spend,
        z,
        tone: z < 0 ? 'good' : 'bad',
        // A buying-intent result (ATC / Purchase) bought cheaply by a
        // campaign not optimised for it. A cheap View Content from an ATC
        // campaign is just the funnel's upper step, not a find.
        sideEffect: z < 0 && !optimisedFor && DEPTH[result] >= 2,
      });
    });
  }
  return out.sort((a, b) => Number(b.sideEffect) - Number(a.sideEffect) || Math.abs(b.z) - Math.abs(a.z)).slice(0, 14);
}

// ── Best audiences of one group for its own goal ─────────────────────────
function bestAudiences(group, month) {
  const result = GOAL_RESULT[group.primary];
  const bySeg = new Map();
  for (const r of group.rows) {
    if (monthOf(r.d) !== month) continue;
    const k = `${r.age}|${r.gender}`;
    bySeg.set(k, [...(bySeg.get(k) ?? []), r]);
  }
  const total = sumRows(group.rows.filter((r) => monthOf(r.d) === month));
  const rows = [...bySeg.entries()].map(([k, rs]) => {
    const [age, gender] = k.split('|');
    const t = sumRows(rs);
    return { age, gender, spend: t.spend, spendShare: div(t.spend, total.spend), results: t[result], cost: costOf(t, result), roas: div(t.value, t.spend) };
  }).filter((x) => x.spendShare != null && x.spendShare >= 0.03 && x.results > 0);
  const groupCost = costOf(total, result);
  return {
    result,
    resultLabel: RESULT_LABEL[result],
    costLabel: COST_LABEL[result],
    groupCost,
    rows: rows.sort((a, b) => a.cost - b.cost).map((x) => ({ ...x, vsGroup: div(x.cost - groupCost, groupCost) })),
  };
}

// ── Store funnel leak between two months ─────────────────────────────────
function funnelLeak(monthly, a, b) {
  const ma = monthly.find((m) => m.month === a);
  const mb = monthly.find((m) => m.month === b);
  if (!ma || !mb || !ma.storeDays || !mb.storeDays) return null;
  const perDay = (m, f) => div(m.store[f], m.storeDays);
  const stages = [
    { key: 'shp_visitors', label: 'Traffic (pengunjung per hari)', from: perDay(ma, 'visitors'), to: perDay(mb, 'visitors'), unit: 'count' },
    { key: 'shp_clickrate', label: 'Klik produk per pengunjung', from: div(ma.store.clicks, ma.store.visitors), to: div(mb.store.clicks, mb.store.visitors), unit: 'ratio' },
    ma.store.atc != null && mb.store.atc != null
      ? { key: 'shp_atc', label: 'Add to Cart per pengunjung', from: div(ma.store.atc, ma.store.visitors), to: div(mb.store.atc, mb.store.visitors), unit: 'pct', monthlyOnly: true }
      : null,
    ma.store.atc != null && mb.store.atc != null
      ? { key: 'shp_atc_purchase', label: 'Pesanan per Add to Cart', from: div(ma.store.orders, ma.store.atc), to: div(mb.store.orders, mb.store.atc), unit: 'pct', monthlyOnly: true }
      : null,
    { key: 'shp_cr', label: 'Conversion Rate', from: ma.store.cr, to: mb.store.cr, unit: 'pct' },
    { key: 'shp_aov', label: 'AOV', from: ma.store.aov, to: mb.store.aov, unit: 'idr' },
  ].filter(Boolean).map((s) => ({ ...s, change: pctChange(s.from, s.to) }));
  // Rupiah per stage (days × traffic/day × CR × AOV).
  const f = (m) => [m.storeDays, perDay(m, 'visitors'), m.store.cr, m.store.aov];
  const parts = lmdi(f(ma), f(mb));
  const rupiah = parts ? { days: parts[0], shp_visitors: parts[1], shp_cr: parts[2], shp_aov: parts[3] } : {};
  stages.forEach((s) => { s.rupiah = rupiah[s.key] ?? null; });
  // The leak: the core stage (traffic / CR / AOV) that cost the most Rupiah;
  // the sub-steps (clicks, ATC) say where inside CR it happened.
  const core = stages.filter((s) => s.rupiah != null).sort((x, y) => x.rupiah - y.rupiah);
  const worst = core[0] && core[0].rupiah < 0 ? core[0] : null;
  // When nothing leaked, the stage that lifted revenue the most.
  const best = core.length && core[core.length - 1].rupiah > 0 ? core[core.length - 1] : null;
  return {
    from: a,
    to: b,
    revenueFrom: ma.store.revenue,
    revenueTo: mb.store.revenue,
    daysFrom: ma.storeDays,
    daysTo: mb.storeDays,
    daysRupiah: rupiah.days ?? null,
    stages,
    leak: worst ? { key: worst.key, label: worst.label, change: worst.change, rupiah: worst.rupiah } : null,
    lift: best ? { key: best.key, label: best.label, change: best.change, rupiah: best.rupiah } : null,
  };
}

// ── Pick the two months to compare ───────────────────────────────────────
function pickMonths(monthly, opts) {
  const ok = (m) => m && m.storeDays >= Math.min(m.calendarDays, 20);
  if (opts?.from && opts?.to) return [opts.from, opts.to];
  const full = monthly.filter((m) => m.complete);
  if (full.length >= 2) return [full[full.length - 2].month, full[full.length - 1].month];
  const usable = monthly.filter(ok);
  if (usable.length >= 2) return [usable[usable.length - 2].month, usable[usable.length - 1].month];
  return null;
}

// ── Entry point ──────────────────────────────────────────────────────────
export function analyzeThread(data, { monthly, channels }, opts = {}) {
  const dates = data.days.map((d) => d.date);
  const { outcomes, drivers } = buildSeries(data, channels);
  const groups = metaGroups(data, dates);
  // Campaign groups as drivers too — the biggest ones by spend.
  const groupDrivers = groups
    .map((g) => ({ g, spend: g.rows.reduce((s, r) => s + r.spend, 0) }))
    .filter((x) => x.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 12)
    .map((x) => x.g.spendSeries);
  const allDrivers = [...drivers, ...groupDrivers];

  const roll = new Map([...outcomes, ...allDrivers].map((s) => [s.key, rolling7(s)]));
  const months = pickMonths(monthly, opts);
  const [mA, mB] = months ?? [null, null];

  // Correlation matrix: every outcome × every driver.
  const matrix = [];
  for (const t of outcomes) {
    for (const d of allDrivers) {
      const rel = relate(t, d, roll.get(t.key), roll.get(d.key));
      if (!rel) continue;
      const ct = mA ? periodChange(t, mA, mB) : null;
      const cd = mA ? periodChange(d, mA, mB) : null;
      matrix.push({
        ...rel,
        targetChange: ct?.change ?? null,
        driverChange: cd?.change ?? null,
        // The two moved the way the link says they should between the months.
        agrees: ct?.change != null && cd?.change != null && Math.sign(ct.change) * Math.sign(cd.change) * Math.sign(rel.score) > 0,
      });
    }
  }

  // Chains between outcomes (Reach → View Content → Revenue in the old
  // sheet): how each Shopee funnel stage moves with revenue.
  const chain = [];
  const rev = outcomes.find((o) => o.key === 'shp_revenue');
  if (rev) {
    for (const o of outcomes.filter((x) => x.group === 'Funnel Shopee' && x.key !== 'shp_revenue')) {
      const rel = relate(rev, o, roll.get(rev.key), roll.get(o.key));
      if (rel) chain.push({ ...rel, label: o.label });
    }
  }

  // ── The bottom-up thread ────────────────────────────────────────────────
  const steps = [];
  const leak = mA ? funnelLeak(monthly, mA, mB) : null;

  // Step 1 — which sales channel moved total revenue.
  let focusChannel = 'shopee';
  const salesKeys = outcomes.filter((o) => o.key.startsWith('sales:'));
  if (mA && salesKeys.length) {
    const rows = salesKeys
      .map((o) => {
        const m = new Map(bucket(o, monthOf).map((x) => [x.key, x]));
        const a = m.get(mA);
        const b = m.get(mB);
        if (!a || !b) return null;
        // A month carried by one or two days (a bulk/B2B order) is a spike,
        // not a trend an ad channel could explain.
        const peak = (m) => {
          const vals = o.dates.map((d, i) => (monthOf(d) === m ? o.num[i] ?? 0 : 0));
          const top2 = [...vals].sort((x, y) => y - x).slice(0, 2).reduce((x, y) => x + y, 0);
          const total = vals.reduce((x, y) => x + y, 0);
          return total > 0 ? top2 / total : 0;
        };
        const spike = Math.max(peak(mA), peak(mB)) >= 0.5;
        return { key: o.key.slice(6), label: o.label.replace('Revenue ', ''), from: a.value, to: b.value, change: b.value - a.value, spike };
      })
      .filter(Boolean);
    const total = rows.reduce((s, r) => s + r.change, 0);
    const sorted = [...rows].sort((x, y) => (total < 0 ? x.change - y.change : y.change - x.change));
    const spikeRow = sorted[0]?.spike ? sorted[0] : null;
    const main = sorted.find((r) => !r.spike) ?? sorted[0];
    if (main) focusChannel = main.key;
    steps.push({
      level: 'revenue',
      title: 'Revenue',
      question: 'Channel penjualan mana yang menggerakkan revenue total?',
      total: { from: rows.reduce((s, r) => s + r.from, 0), to: rows.reduce((s, r) => s + r.to, 0), change: total },
      rows: rows.sort((x, y) => Math.abs(y.change) - Math.abs(x.change)),
      answer: main
        ? `Revenue total ${total < 0 ? 'turun' : 'naik'} ${fmtRp(Math.abs(total))} (${fmtMonth(mA)} → ${fmtMonth(mB)}).${spikeRow && spikeRow !== main ? ` ${spikeRow.label} berubah ${spikeRow.change < 0 ? '−' : '+'}${fmtRp(Math.abs(spikeRow.change))}, tapi didominasi 1–2 hari (kemungkinan order besar/B2B) — tidak ditelusuri ke iklan.` : ''} Ditelusuri: ${main.label} (${main.change < 0 ? '−' : '+'}${fmtRp(Math.abs(main.change))}).`
        : null,
      focus: main?.key ?? null,
    });
  }

  // Step 2 — the funnel stage that leaked (Shopee), or the channel's revenue.
  let targetKey = focusChannel === 'shopee' || !salesKeys.length ? null : `sales:${focusChannel}`;
  if (!targetKey && leak) {
    targetKey = leak.leak?.key ?? leak.lift?.key ?? 'shp_revenue';
    const subLeak = leak.stages.filter((s) => s.monthlyOnly || s.key === 'shp_clickrate').filter((s) => (s.change ?? 0) < -0.05).sort((x, y) => x.change - y.change)[0];
    steps.push({
      level: 'funnel',
      title: 'Funnel Shopee',
      question: 'Tahap funnel mana yang bocor?',
      leak,
      answer: leak.leak
        ? `Kebocoran terbesar di ${leak.leak.label}: ${fmtPct(leak.leak.change)}, setara ${fmtRp(Math.abs(leak.leak.rupiah))} revenue.${subLeak ? ` Di dalamnya, ${subLeak.label} ${fmtPct(subLeak.change)}.` : ''}`
        : leak.lift
          ? `Tidak ada tahap yang bocor. Kenaikan terbesar dari ${leak.lift.label}: ${fmtPct(leak.lift.change)}, setara +${fmtRp(leak.lift.rupiah)} revenue — ini yang ditelusuri.`
          : 'Funnel toko stabil — tidak ada tahap yang bergerak berarti.',
      focus: targetKey,
    });
  } else if (targetKey) {
    steps.push({ level: 'funnel', title: 'Channel penjualan', question: 'Metrik yang ditelusuri', answer: `Ditelusuri: revenue ${salesLabel(focusChannel)} (data funnel per tahap hanya tersedia untuk Shopee).`, focus: targetKey });
  }
  if (!targetKey) targetKey = outcomes.find((o) => o.key === 'shp_revenue') ? 'shp_revenue' : outcomes[0]?.key;
  const target = outcomes.find((o) => o.key === targetKey);

  // Steps 3–4 — which ad channel, then which campaign group, moves with it.
  const rank = (keys) => matrix
    .filter((m) => m.target === targetKey && keys.includes(m.driver))
    .map((m) => ({ ...m, label: allDrivers.find((d) => d.key === m.driver)?.label, weight: m.score * (m.agrees ? 1.25 : 0.8) * (1 + Math.min(Math.abs(m.driverChange ?? 0), 1)) }))
    .sort((x, y) => y.weight - x.weight);
  if (target) {
    const adKeys = allDrivers.filter((d) => d.group === 'Channel iklan').map((d) => d.key);
    const adRank = rank(adKeys);
    const topAd = adRank.find((x) => x.score >= 0.15);
    const lagTxt = (x) => (x.lag ? `, efek terlihat ±${x.lag} hari kemudian` : '');
    steps.push({
      level: 'channel',
      title: 'Channel iklan',
      question: `Channel iklan mana yang bergerak bersama ${target.label}?`,
      rows: adRank,
      answer: topAd
        ? `${topAd.label.replace('Spend ', '')} paling sejalan dengan ${target.label} (hubungan ${topAd.strength}, kemiripan garis ${Math.round(topAd.similarity * 100)}%${lagTxt(topAd)}).${topAd.driverChange != null && topAd.targetChange != null ? ` Spend ${fmtPct(topAd.driverChange)} per hari, ${target.label} ${fmtPct(topAd.targetChange)}.` : ''}`
        : `Tidak ada channel iklan yang bergerak sejalan dengan ${target.label} — penyebabnya kemungkinan di luar iklan (stok, harga, promo, musim).`,
      focus: topAd?.driver ?? null,
    });

    const adChannel = topAd?.driver?.replace('spend:', '');
    const inChannel = groups.filter((g) => !adChannel || g.channel === adChannel || !['meta_boost', 'meta_nonboost', 'cpas'].includes(adChannel));
    if (adChannel === 'shopee_ads') {
      const subRank = rank(allDrivers.filter((d) => d.key.startsWith('shpsub:')).map((d) => d.key));
      steps.push({
        level: 'campaign',
        title: 'Jenis iklan',
        question: 'Jenis Iklan Shopee mana?',
        rows: subRank,
        answer: subRank[0] ? `${subRank[0].label} paling sejalan (hubungan ${subRank[0].strength}).` : 'Belum ada rincian jenis Iklan Shopee yang cukup.',
        focus: subRank[0]?.driver ?? null,
      });
    } else if (adChannel && ['meta_boost', 'meta_nonboost', 'cpas'].includes(adChannel)) {
      const gKeys = inChannel.filter((g) => g.channel === adChannel).map((g) => g.spendSeries.key);
      // Groups not in the top-12 driver list still get scored here.
      for (const g of inChannel.filter((x) => x.channel === adChannel)) {
        if (!roll.has(g.spendSeries.key)) roll.set(g.spendSeries.key, rolling7(g.spendSeries));
        if (!matrix.some((m) => m.target === targetKey && m.driver === g.spendSeries.key)) {
          const rel = relate(target, g.spendSeries, roll.get(targetKey), roll.get(g.spendSeries.key));
          if (rel) {
            const ct = mA ? periodChange(target, mA, mB) : null;
            const cd = mA ? periodChange(g.spendSeries, mA, mB) : null;
            matrix.push({ ...rel, targetChange: ct?.change ?? null, driverChange: cd?.change ?? null, agrees: ct?.change != null && cd?.change != null && Math.sign(ct.change) * Math.sign(cd.change) * Math.sign(rel.score) > 0 });
          }
          if (!allDrivers.includes(g.spendSeries)) allDrivers.push(g.spendSeries);
        }
      }
      const gRank = rank(gKeys).map((x) => {
        const g = groups.find((y) => y.spendSeries.key === x.driver);
        const ta = mA ? metricsOf(sumRows(g.rows.filter((r) => monthOf(r.d) === mA))) : null;
        const tb = mB ? metricsOf(sumRows(g.rows.filter((r) => monthOf(r.d) === mB))) : null;
        return { ...x, group: g.key, campaigns: [...g.campaigns].slice(0, 6), campaignCount: g.campaigns.size, primary: g.primary, metricsFrom: ta, metricsTo: tb };
      });
      const topG = gRank.find((x) => x.score >= 0.15) ?? gRank[0];
      steps.push({
        level: 'campaign',
        title: 'Campaign',
        question: `Di dalam ${AD_LABELS[adChannel]}, kelompok campaign mana (audiens × tujuan)?`,
        rows: gRank,
        answer: topG
          ? `${topG.label.split(' · ').slice(1).join(' · ')} paling sejalan (hubungan ${topG.strength}${topG.driverChange != null ? `, spend ${fmtPct(topG.driverChange)} per hari` : ''}).`
          : 'Belum ada kelompok campaign dengan data cukup.',
        focus: topG?.group ?? null,
      });
      // Step 5 — audiences of the leading group that still ran in the month.
      const live = gRank.filter((x) => x.score >= 0.15 && (x.metricsTo?.spend ?? 0) > 0);
      const g = live[0] ? groups.find((y) => y.key === live[0].group) : null;
      if (g && mB) {
        const aud = bestAudiences(g, mB);
        const best = aud.rows[0];
        steps.push({
          level: 'audience',
          title: 'Audiens',
          question: `Audiens mana yang paling efisien untuk tujuan ${GOAL_LABELS[g.primary]}?`,
          audiences: aud,
          answer: best
            ? `${best.gender === 'female' ? 'Perempuan' : best.gender === 'male' ? 'Laki-laki' : 'Gender tak diketahui'} ${best.age}: ${aud.costLabel} ${fmtRp(best.cost)}${best.vsGroup != null ? ` (${fmtPct(best.vsGroup)} vs rata-rata kelompok)` : ''}, ${Math.round((best.spendShare ?? 0) * 100)}% spend kelompok — kandidat dipisah jadi ad set sendiri dan dinaikkan budgetnya.`
            : 'Belum ada audiens dengan volume cukup di bulan ini.',
        });
      }
    }
  }

  const anomalies = mB ? findAnomalies(groups, mB) : [];
  const sideEffect = anomalies.find((a) => a.sideEffect);
  if (sideEffect) {
    steps.push({
      level: 'anomaly',
      title: 'Benang merah',
      question: 'Ada metrik yang anomali murah di tempat yang tidak terduga?',
      answer: `${sideEffect.groupLabel} (${sideEffect.gender === 'female' ? 'perempuan' : sideEffect.gender === 'male' ? 'laki-laki' : 'gender tak diketahui'} ${sideEffect.age}) menghasilkan ${sideEffect.resultLabel} dengan ${sideEffect.costLabel} ${fmtRp(sideEffect.cost)} — ${fmtPct(sideEffect.vsPeers)} dibanding campaign yang memang dioptimasi untuk ${sideEffect.resultLabel}. Uji duplikasi audiens ini dengan tujuan ${sideEffect.resultLabel}.`,
      anomaly: sideEffect,
    });
  }

  // Series for the trend-gap chart: weekly and monthly values per series.
  const pack = (s) => ({ key: s.key, label: s.label, group: s.group, unit: s.unit, weekly: bucket(s, weekOf).map((x) => [x.key, x.value, x.days]), monthly: bucket(s, monthOf).map((x) => [x.key, x.value, x.days]) });
  const usedDrivers = new Set(matrix.map((m) => m.driver));

  return {
    months: months ? { from: mA, to: mB } : null,
    target: targetKey,
    steps,
    leak,
    matrix,
    chain,
    anomalies,
    outcomes: outcomes.map((o) => ({ key: o.key, label: o.label, group: o.group, unit: o.unit })),
    drivers: allDrivers.filter((d) => usedDrivers.has(d.key)).map((d) => ({ key: d.key, label: d.label, group: d.group, unit: d.unit })),
    series: [...outcomes, ...allDrivers.filter((d) => usedDrivers.has(d.key))].map(pack),
    groups: groups.map((g) => ({
      key: g.key,
      label: g.label,
      channel: g.channel,
      audience: g.audience,
      audienceLabel: AUDIENCE_LABELS[g.audience],
      goal: g.goals.map((x) => GOAL_LABELS[x]).join(' + '),
      primary: g.primary,
      campaigns: [...g.campaigns],
      byMonth: [...new Set(g.rows.map((r) => monthOf(r.d)))].sort().map((m) => ({ month: m, ...metricsOf(sumRows(g.rows.filter((r) => monthOf(r.d) === m))) })),
    })),
  };
}
