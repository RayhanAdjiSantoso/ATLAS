/**
 * RFM 1-5 scoring via K-Means natural-breaks clustering on percentile-capped
 * (winsorized) values -- ported from "RFM & Transaction Behavior.ipynb"
 * (cap_outliers_percentile + build_kmeans_score, default "K-Means Tanpa
 * Outlier" method used for customer segmentation).
 */

// Deterministic PRNG (mulberry32) so K-Means init is reproducible across runs,
// mirroring sklearn's random_state.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// pandas Series.quantile default (interpolation='linear').
function quantile(sortedValues, q) {
  const n = sortedValues.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedValues[0];
  const pos = (n - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const lo = sortedValues[base];
  const hi = sortedValues[Math.min(base + 1, n - 1)];
  return lo + rest * (hi - lo);
}

/**
 * Percentile-based winsorization: clip to [1st, 99th] percentile, loosening
 * the upper percentile step by step (99 -> 99.5 -> 99.9 -> 99.95 -> 99.99 ->
 * 100) until at least `minUniqueTarget` distinct values survive the clip.
 * Needed because Frequency's 99th percentile is often only 3-4 (Shopee
 * customers mostly order 1-4x), which would otherwise crush it down to a
 * handful of unique values before it ever reaches K-Means.
 */
export function capOutliersPercentile(values, { lowerQ = 0.01, upperQ = 0.99, minUniqueTarget = 5 } = {}) {
  const sorted = [...values].sort((a, b) => a - b);
  const lower = quantile(sorted, lowerQ);
  const candidateUpperQs = [upperQ, 0.995, 0.999, 0.9995, 0.9999, 1.0];

  let capped = values;
  let upper = lower;
  let appliedUq = upperQ;
  let nUnique = 0;

  for (const uq of candidateUpperQs) {
    upper = quantile(sorted, uq);
    capped = values.map((v) => Math.min(Math.max(v, lower), upper));
    nUnique = new Set(capped).size;
    appliedUq = uq;
    if (nUnique >= minUniqueTarget) break;
  }

  return { capped, lower, upper, appliedUq, nUnique };
}

function kmeansPlusPlusInit(values, k, rng) {
  const n = values.length;
  const centers = [values[Math.floor(rng() * n)]];
  while (centers.length < k) {
    const dist = values.map((v) => Math.min(...centers.map((c) => (v - c) ** 2)));
    const sum = dist.reduce((a, b) => a + b, 0);
    if (sum === 0) {
      centers.push(values[Math.floor(rng() * n)]);
      continue;
    }
    let r = rng() * sum;
    let idx = 0;
    for (; idx < n; idx++) {
      r -= dist[idx];
      if (r <= 0) break;
    }
    centers.push(values[Math.min(idx, n - 1)]);
  }
  return centers;
}

function kmeans1DOnce(values, k, rng, maxIter) {
  const n = values.length;
  const centers = kmeansPlusPlusInit(values, k, rng);
  const assign = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = (values[i] - centers[c]) ** 2;
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assign[i] !== bestC) {
        assign[i] = bestC;
        changed = true;
      }
    }

    const sums = new Array(k).fill(0);
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      sums[assign[i]] += values[i];
      counts[assign[i]] += 1;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) centers[c] = sums[c] / counts[c];
    }

    if (!changed) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += (values[i] - centers[assign[i]]) ** 2;

  return { centers, assign, inertia };
}

/** 1-D K-Means with k-means++ init and multiple restarts (best inertia wins), analogous to sklearn's n_init. */
export function kmeans1D(values, k, { randomState = 42, nInit = 10, maxIter = 300 } = {}) {
  const uniqueCount = new Set(values).size;
  const effectiveK = Math.min(k, uniqueCount);
  const rng = mulberry32(randomState);

  let best = null;
  for (let init = 0; init < nInit; init++) {
    const result = kmeans1DOnce(values, effectiveK, rng, maxIter);
    if (!best || result.inertia < best.inertia) best = result;
  }

  return { labels: best.assign, centers: best.centers, effectiveK };
}

/**
 * Scoring 1-5 based on K-Means natural breaks. Cluster centers are ranked
 * ascending; labelsAscending=true means higher raw value -> higher score
 * (Frequency/Monetary), labelsAscending=false means higher raw value ->
 * lower score (Recency, where "recent" = low days-since = best = score 5).
 */
export function buildKMeansScore(values, { labelsAscending = true, q = 5, randomState = 42, nInit = 10 } = {}) {
  if (values.length === 0) return [];
  const { labels, centers, effectiveK } = kmeans1D(values, q, { randomState, nInit });

  const order = centers.map((_, idx) => idx).sort((a, b) => centers[a] - centers[b]);
  const rankOfCluster = new Map(order.map((clusterIdx, rank) => [clusterIdx, rank]));

  return labels.map((clusterIdx) => {
    const rank = rankOfCluster.get(clusterIdx);
    return labelsAscending ? rank + 1 : effectiveK - rank;
  });
}
