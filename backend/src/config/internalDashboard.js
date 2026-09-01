// =====================================================================
// Internal Dashboard — tunable analysis constants, ALL in one place.
//
// These are ANALYSIS KNOBS, not settings the app writes. They start as
// deliberate placeholders and are meant to be recalibrated against real
// client data once enough of it has been entered. Change them here and
// nowhere else — the API echoes the active values back to the UI
// (response `.thresholds`) so the frontend never hardcodes them.
// =====================================================================

export const S1 = {
  // "Perlu Perhatian" (§2.8): flag a client whose period-over-period
  // revenue growth is at least this many points BELOW the AVERAGE growth
  // of its sub-industry peers.
  //   - average, not median (median is S3's tool — breakdown §4)
  //   - sub_industry granularity (matches S5 peer groups — confirmed)
  //   - no minimum-n gate (breakdown §4); peer_n is surfaced instead
  //   - PROVISIONAL: 0.15 was an illustrative starting point, to be
  //     replaced once cross-client growth spread is observable.
  perluPerhatianGrowthGap: 0.15,

  // Growth-distribution histogram edges (fractions). Also provisional.
  growthBuckets: [
    { label: '< -20%', min: -Infinity, max: -0.20 },
    { label: '-20% s/d -5%', min: -0.20, max: -0.05 },
    { label: '-5% s/d +5%', min: -0.05, max: 0.05 },
    { label: '+5% s/d +20%', min: 0.05, max: 0.20 },
    { label: '> +20%', min: 0.20, max: Infinity },
  ],

  // Trailing window (months) for the sales/spend trend chart.
  trendWindowMonths: 13,
};

// Maps the API `category` param to the stored kategori_besar value.
export const CATEGORY_MAP = { retail: 'Retail', b2b_service: 'B2B/Service', fnb: 'F&B' };
