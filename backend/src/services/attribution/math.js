// ===========================================================================
// Atribusi & Kebocoran Channel — numeric helpers
// ===========================================================================
//
// Pure functions only: no DB, no Express. Small, dependency-free linear
// algebra (a few dozen regressors at most) — ridge regression via normal
// equations, Gaussian elimination, adstock, LMDI index decomposition and a
// seeded RNG so a bootstrap gives the same interval on every run.

export const sum = (xs) => xs.reduce((s, x) => s + (x ?? 0), 0);
export const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);

export function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function quantile(xs, q) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

// Null when either side is missing or the denominator is 0 — a ratio that
// cannot be computed is "—", never 0 or Infinity.
export function div(a, b) {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return a / b;
}

export function pctChange(a, b) {
  if (a == null || b == null || a === 0) return null;
  return (b - a) / Math.abs(a);
}

// Solves A x = b (A square) by Gaussian elimination with partial pivoting.
// Returns null when A is singular.
export function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function invert(A) {
  const n = A.length;
  const cols = [];
  for (let i = 0; i < n; i += 1) {
    const e = Array(n).fill(0);
    e[i] = 1;
    const x = solve(A, e);
    if (!x) return null;
    cols.push(x);
  }
  return A.map((_, r) => cols.map((col) => col[r]));
}

// Ridge regression on standardized columns (so one λ is fair to a column in
// Rupiah and a 0/1 day flag alike), reported back on the original scale.
// Returns { intercept, coef[], fitted[], rss, r2, gcv } or null.
export function ridge(X, y, lambda) {
  const n = y.length;
  const p = X[0]?.length ?? 0;
  if (n < p + 3) return null;
  const mu = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])));
  const sc = Array.from({ length: p }, (_, j) => sd(X.map((r) => r[j])) || 1);
  const my = mean(y);
  const Z = X.map((r) => r.map((v, j) => (v - mu[j]) / sc[j]));
  const yc = y.map((v) => v - my);
  const ZtZ = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Z[i][a] * Z[i][b];
    return s;
  }));
  const Zty = Array.from({ length: p }, (_, a) => {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Z[i][a] * yc[i];
    return s;
  });
  const A = ZtZ.map((row, i) => row.map((v, j) => v + (i === j ? lambda : 0)));
  const bz = solve(A, Zty);
  if (!bz) return null;
  const coef = bz.map((b, j) => b / sc[j]);
  const intercept = my - coef.reduce((s, b, j) => s + b * mu[j], 0);
  const fitted = X.map((r) => intercept + r.reduce((s, v, j) => s + v * coef[j], 0));
  const rss = y.reduce((s, v, i) => s + (v - fitted[i]) ** 2, 0);
  const tss = yc.reduce((s, v) => s + v * v, 0);
  // Effective degrees of freedom = trace((ZᵀZ + λI)⁻¹ ZᵀZ), for GCV.
  const Ainv = invert(A);
  let df = 1;
  if (Ainv) for (let i = 0; i < p; i += 1) for (let k = 0; k < p; k += 1) df += Ainv[i][k] * ZtZ[k][i];
  const gcv = n * rss / Math.max((n - df) ** 2, 1e-9);
  return { intercept, coef, fitted, rss, r2: tss > 0 ? 1 - rss / tss : null, gcv, df };
}

// Geometric adstock: today's effective pressure is today's spend plus a
// decaying echo of the days before (Meta audiences buy a day or three later).
export function adstock(xs, decay) {
  const out = [];
  let carry = 0;
  for (const x of xs) {
    carry = (x ?? 0) + decay * carry;
    out.push(carry);
  }
  return out;
}

// LMDI-I: splits the change of a product V = Π fᵢ into additive pieces, one
// per factor, that add up to V₁ − V₀ exactly (no residual, no ordering bias).
export function lmdi(factors0, factors1) {
  const v0 = factors0.reduce((p, f) => p * f, 1);
  const v1 = factors1.reduce((p, f) => p * f, 1);
  if (!(v0 > 0) || !(v1 > 0) || factors0.some((f) => !(f > 0)) || factors1.some((f) => !(f > 0))) return null;
  const L = v1 === v0 ? v0 : (v1 - v0) / (Math.log(v1) - Math.log(v0));
  return factors0.map((f0, i) => L * Math.log(factors1[i] / f0));
}

// Mulberry32 — a tiny seeded PRNG so the bootstrap is reproducible.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
