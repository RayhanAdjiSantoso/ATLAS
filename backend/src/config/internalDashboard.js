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
  // "Perlu Perhatian" (§2.8) has FOUR independent signals — a client can
  // surface on any of them (mockup MIL_Internal_Dashboard parity, user
  // decision "Opsi 1: tambah di samping rule relatif, bukan mengganti"):
  //
  //   (a) peer-relative: growth at least `perluPerhatianGrowthGap` points
  //       BELOW the AVERAGE growth of its sub-industry peers.
  //         - average, not median (median is S3's tool — breakdown §4)
  //         - sub_industry granularity (matches S5 peer groups)
  //         - no minimum-n gate (breakdown §4); peer_n is surfaced
  //   (b) overspend anomaly: spend growth > `perluPerhatianOverspendSpendGrowth`
  //       while sales growth is negative — belanja naik, penjualan tidak.
  //   (c) absolute ROAS floor: blended ROAS (revenue/spend) below
  //       `perluPerhatianRoasFloor`.
  //   (d) info only: count of clients excluded from this month's benchmark
  //       (partial-month data — see S5 is_partial_month handling).
  //
  // ALL of (a)/(b)/(c) are PROVISIONAL placeholders. In particular the ROAS
  // floor is lifted straight from the mockup's demo data — healthy ROAS
  // varies wildly by industry, so recalibrate against real client data
  // (same policy as `perluPerhatianGrowthGap`).
  perluPerhatianGrowthGap: 0.15,
  perluPerhatianOverspendSpendGrowth: 0.05,
  perluPerhatianRoasFloor: 3.2,

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

export const S4 = {
  // Growth heatmap (sub-industry x month). MoM aggregate growth per group
  // per month; a month-cell needs at least `growthHeatmapMinClients` clients
  // present in BOTH that month and the one before, else the cell is null
  // ("–" — seasonality reads as a column, not a per-client problem).
  //   - `growthHeatmapMonths`: how many trailing months the heatmap spans.
  //   - `growthHeatmapCap`: |growth| that maps to the strongest colour
  //     (PROVISIONAL — 0.25 from the mockup; recalibrate once real spread
  //     across sub-industries is observable).
  growthHeatmapMonths: 8,
  growthHeatmapMinClients: 2,
  growthHeatmapCap: 0.25,
};

// Maps the API `category` param to the stored kategori_besar value.
export const CATEGORY_MAP = { retail: 'Retail', b2b_service: 'B2B/Service', fnb: 'F&B' };
