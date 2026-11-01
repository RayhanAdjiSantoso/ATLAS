import { adstock, mean, pearson, quantile, ridge, rng } from './math.js';

// ===========================================================================
// L3 — statistical contribution (ESTIMASI)
// ===========================================================================
//
// Daily regression of a store metric (revenue, visitors, orders) on each
// channel's spend, read from the shop's side rather than from what any
// platform claims:
//
//   y_t = baseline + seasonality_t + Σ_c β_c · (adstock(spend_c, d_c)_t / 1jt)^α_c + ε_t
//
//   adstock d   the carry-over to the following days (Meta buyers often come
//               back 1–3 days later), picked per channel from a small grid
//   α ≤ 1       diminishing returns: α < 1 means each extra Rupiah buys less
//   seasonality day of week, twin dates (9.9, 10.10), mid-month (15),
//               payday (25th onward), and a linear trend
//
// Ridge keeps correlated channels (budgets that move together) from swinging
// to absurd values; a channel whose effect comes out negative is dropped and
// reported as "tidak terdeteksi" instead of being shown as harmful. A moving-
// block bootstrap gives each channel an interval. Everything here is an
// estimate and the UI labels it ESTIMASI.

const DECAYS = [0, 0.3, 0.5, 0.7];
const ALPHAS = [1, 0.75, 0.5];
const LAMBDAS = [0.5, 2, 8];
const BOOT_REPS = 120;
const BLOCK = 7;

function dayFlags(date, index, n) {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Minggu
  const dom = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  return [
    ...[1, 2, 3, 4, 5, 6].map((k) => (dow === k ? 1 : 0)),
    dom === month ? 1 : 0, // twin date
    dom === 15 ? 1 : 0, // mid-month
    dom >= 25 ? 1 : 0, // payday
    index / Math.max(n - 1, 1), // trend
  ];
}
const CONTROL_COUNT = 10;

function channelFeature(spend, decay, alpha) {
  return adstock(spend, decay).map((a) => (a > 0 ? (a / 1e6) ** alpha : 0));
}

function design(rows, channels, hp) {
  const feats = channels.map((c) => channelFeature(rows.map((r) => r.spend[c]), hp[c].decay, hp[c].alpha));
  return rows.map((r, i) => [...channels.map((_, k) => feats[k][i]), ...dayFlags(r.date, i, rows.length)]);
}

function fitWith(rows, y, channels, hp, lambda) {
  let active = [...channels];
  for (let guard = 0; guard <= channels.length; guard += 1) {
    const X = design(rows, active, hp);
    const fit = ridge(X, y, lambda);
    if (!fit) return null;
    const neg = active.filter((_, k) => fit.coef[k] < 0);
    if (!neg.length) return { fit, active, X };
    active = active.filter((c) => !neg.includes(c));
  }
  return null;
}

// Coordinate search over each channel's decay × α (two passes), λ by GCV.
function selectHyper(rows, y, channels) {
  const hp = Object.fromEntries(channels.map((c) => [c, { decay: 0.3, alpha: 1 }]));
  let lambda = LAMBDAS[1];
  let best = fitWith(rows, y, channels, hp, lambda);
  if (!best) return null;
  for (let pass = 0; pass < 2; pass += 1) {
    for (const c of channels) {
      for (const decay of DECAYS) {
        for (const alpha of ALPHAS) {
          const trial = { ...hp, [c]: { decay, alpha } };
          const r = fitWith(rows, y, channels, trial, lambda);
          if (r && r.fit.gcv < best.fit.gcv) {
            best = r;
            hp[c] = { decay, alpha };
          }
        }
      }
    }
    for (const l of LAMBDAS) {
      const r = fitWith(rows, y, channels, hp, l);
      if (r && r.fit.gcv < best.fit.gcv) {
        best = r;
        lambda = l;
      }
    }
  }
  return { hp, lambda, best };
}

// Each channel's contribution per day for a fit (0 for a dropped channel).
function contributions(rows, channels, hp, active, coef) {
  const out = Object.fromEntries(channels.map((c) => [c, rows.map(() => 0)]));
  active.forEach((c, k) => {
    const f = channelFeature(rows.map((r) => r.spend[c]), hp[c].decay, hp[c].alpha);
    out[c] = f.map((v) => coef[k] * v);
  });
  return out;
}

// Extra outcome from scaling one channel's recent spend by `m`, others fixed.
function responseAt(rows, c, hp, beta, m) {
  const scaled = rows.map((r) => r.spend[c] * m);
  return channelFeature(scaled, hp[c].decay, hp[c].alpha).reduce((s, v) => s + beta * v, 0);
}

function grade(n, r2) {
  if (n >= 90 && r2 != null && r2 >= 0.5) return 'kuat';
  if (n >= 60 && r2 != null && r2 >= 0.3) return 'sedang';
  return 'lemah';
}

// rows: [{ date, y: { revenue, visitors, orders }, spend: { [channel]: Rp } }]
// (consecutive, complete days only). Returns per-target results.
export function fitChannelModel(rows, channels, target, { seed = 7 } = {}) {
  const n = rows.length;
  const y = rows.map((r) => r.y[target]);
  if (n < 28 || !channels.length || y.every((v) => v === y[0])) return { target, ok: false, n, reason: 'Data harian kurang dari 28 hari lengkap.' };

  const sel = selectHyper(rows, y, channels);
  if (!sel) return { target, ok: false, n, reason: 'Model tidak dapat dihitung (data terlalu seragam).' };
  const { hp, lambda, best } = sel;
  const { fit, active, X } = best;
  const contrib = contributions(rows, channels, hp, active, fit.coef);
  const totalContrib = Object.fromEntries(channels.map((c) => [c, contrib[c].reduce((s, v) => s + v, 0)]));
  const totalSpend = Object.fromEntries(channels.map((c) => [c, rows.reduce((s, r) => s + r.spend[c], 0)]));

  // Seasonality vs baseline, per day: everything that is not a channel.
  const controlsStart = active.length;
  const seasonal = X.map((row) => row.slice(controlsStart, controlsStart + CONTROL_COUNT - 1).reduce((s, v, k) => s + v * fit.coef[controlsStart + k], 0));
  const trend = X.map((row) => row[controlsStart + CONTROL_COUNT - 1] * fit.coef[controlsStart + CONTROL_COUNT - 1]);
  const baseline = rows.map((_, i) => fit.intercept + trend[i]);

  // Moving-block bootstrap with the chosen hyper-parameters fixed.
  const rand = rng(seed);
  const boot = Object.fromEntries(channels.map((c) => [c, []]));
  const blocks = Math.ceil(n / BLOCK);
  for (let b = 0; b < BOOT_REPS; b += 1) {
    const idx = [];
    for (let k = 0; k < blocks; k += 1) {
      const start = Math.floor(rand() * Math.max(n - BLOCK, 1));
      for (let j = 0; j < BLOCK && idx.length < n; j += 1) idx.push(start + j);
    }
    // Features are built on the original timeline (adstock needs order),
    // then the resampled rows are fitted.
    const Xb = idx.map((i) => X[i]);
    const yb = idx.map((i) => y[i]);
    const fb = ridge(Xb, yb, lambda);
    if (!fb) continue;
    channels.forEach((c) => {
      const k = active.indexOf(c);
      if (k < 0 || !totalSpend[c]) return;
      const f = channelFeature(rows.map((r) => r.spend[c]), hp[c].decay, hp[c].alpha);
      const total = f.reduce((s, v) => s + Math.max(fb.coef[k], 0) * v, 0);
      boot[c].push(total / totalSpend[c]);
    });
  }

  // Marginal effect of one more Rupiah at the last 30 days' spend level,
  // and the response curve around it.
  const recent = rows.slice(-30);
  const perChannel = channels.map((c) => {
    const k = active.indexOf(c);
    const beta = k >= 0 ? fit.coef[k] : 0;
    const recentSpend = recent.reduce((s, r) => s + r.spend[c], 0);
    const at = (m) => responseAt(recent, c, hp, beta, m);
    const base = at(1);
    const step = 0.1;
    const marginal = recentSpend > 0 ? (at(1 + step) - base) / (recentSpend * step) : null;
    const curve = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((m) => ({ multiplier: m, spend: recentSpend * m, outcome: at(m) }));
    const lags = [0, 1, 2, 3].map((lag) => pearson(rows.slice(0, n - lag).map((r) => r.spend[c]), y.slice(lag)));
    return {
      channel: c,
      detected: k >= 0 && beta > 0,
      decay: hp[c].decay,
      alpha: hp[c].alpha,
      spend: totalSpend[c],
      contribution: totalContrib[c],
      // Average return per Rupiah over the window (revenue: iROAS).
      average: totalSpend[c] > 0 ? totalContrib[c] / totalSpend[c] : null,
      // Return of the next Rupiah at today's level (revenue: mROAS).
      marginal,
      interval: boot[c].length >= 20 ? { low: quantile(boot[c], 0.1), high: quantile(boot[c], 0.9) } : null,
      recentSpend,
      curve,
      lagCorrelation: lags,
    };
  });

  const fitted = fit.fitted;
  const resid = y.map((v, i) => v - fitted[i]);
  const residSd = Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / Math.max(n - 1, 1));
  const mape = mean(y.map((v, i) => (v > 0 ? Math.abs(resid[i]) / v : 0)));

  return {
    target,
    ok: true,
    n,
    from: rows[0].date,
    to: rows[n - 1].date,
    r2: fit.r2,
    mape,
    lambda,
    grade: grade(n, fit.r2),
    channels: perChannel,
    daily: rows.map((r, i) => ({
      date: r.date,
      actual: y[i],
      fitted: fitted[i],
      baseline: baseline[i],
      seasonal: seasonal[i],
      residual: resid[i],
      z: residSd > 0 ? resid[i] / residSd : 0,
      contrib: Object.fromEntries(channels.map((c) => [c, contrib[c][i]])),
    })),
  };
}
