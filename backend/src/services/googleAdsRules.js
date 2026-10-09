// Every threshold the Google Ads diagnostics, alerts, data-quality checks
// and health scores use, in one place, with a version. Findings,
// recommendations, alerts and experiment results record RULESET_VERSION,
// so a historical diagnosis can be traced to the rules that produced it.
//
// Changing a number here is a calibration: bump RULESET_VERSION and add an
// entry to CALIBRATION_LOG saying what changed and why (false positives,
// missed problems, production evidence). Feedback marked in the report
// (Useful / Not useful / False positive / Needs more data) is the evidence;
// nothing here adjusts itself.
//
// Money thresholds are deliberately relative (multiples of a baseline CPA,
// shares of spend), never absolute amounts: brands report in RM and Rp.

export const RULESET_VERSION = 'google_ads_v1.1';

// Conversions over the period, per entity. Low-volume entities get
// "monitoring", not a diagnosis.
export const VOLUME_TIERS = { lowBelow: 5, highAbove: 30 };

export const RULES = {
  keyword: {
    minClicks: 20,              // below this, no verdict
    minExpectedConversions: 1,  // clicks × baseline CVR must reach this before "no conversion" is a finding
    minCostVsCpa: 1,            // and spend must reach this many baseline CPAs
    minConversions: 2,          // volume to call a keyword performing rather than promising
    goodCpaRatio: 1.0,
    poorCpaRatio: 1.5,
    roomLostRankIs: 0.3,
    lowQualityScore: 4,
  },
  searchTerm: {
    minClicks: 10,
    negativeMinCostVsCpa: 1.0,
    opportunityMaxCpaRatio: 1.0,
    coverageWarn: 0.85,
  },
  // Per rule: the minimum sample in BOTH periods before it may fire, and
  // the change that counts. minDays = days with spend in the current period.
  campaign: {
    cpa_increase: { minConversions: 5, minDays: 7, change: 0.2, high: 0.5 },
    conversion_volume_drop: { minConversions: 5, minDays: 7, change: 0.3, high: 0.5 },
    cvr_drop: { minClicks: 100, minConversions: 3, minDays: 7, change: 0.2, high: 0.4 },
    cpc_increase: { minClicks: 100, minDays: 7, change: 0.2, high: 0.5 },
    ctr_drop: { minImpressions: 1000, minDays: 7, change: 0.2 },
    cost_up_without_results: { minConversions: 5, minDays: 7, change: 0.2 },
    // A campaign that "usually converts": enough conversions spread over
    // enough days before, and enough clicks now that zero is meaningful.
    conversions_stopped: { minPrevConversions: 5, minPrevDays: 7, minClicks: 50 },
    lost_is_budget: { share: 0.2 },
    lost_is_rank: { share: 0.3 },
    budget_underused: { ratio: 0.5, minDays: 7 },
    budget_limited: { ratio: 0.95, minDays: 7 },
    newCampaignDays: 14,        // younger than this: confidence capped at low
  },
  anomaly: {
    k: 3,
    kHighVariance: 4,           // robust z for series whose day-to-day spread is large
    highVarianceCv: 0.5,        // MAD-based coefficient of variation that counts as high variance
    minBaselineDays: 7,
    minMedian: { cost: 1, clicks: 10, conversions: 3 },
  },
  schedule: { minConversions: 30, minDays: 28, minCellClicks: 30, poorCpaRatio: 2, minCostShare: 0.03 },
  device: { minClicks: 30, minCostShare: 0.1, poorCpaRatio: 1.5 },
  landingPage: { minClicks: 50, lowSpeedScore: 4, maxPages: 100 },
  quality: { minScoredKeywords: 10, belowShare: 0.4 },
  // Rows a report response lists; every total and summary uses all rows.
  // A large account (thousands of keywords, tens of thousands of search
  // terms) must stay under Vercel's 4.5MB response cap.
  report: { maxSearchTerms: 500, maxNegativeCandidates: 200, maxKeywords: 600, maxLegacyRows: 500, maxConvertingRows: 500, maxComparisonRows: 100 },
  // Recommendations the backend accepts from the model only with evidence.
  recommendation: {
    budgetIncreaseMinLostIsBudget: 0.15,  // or budget utilisation at/over budgetLimitedRatio
    budgetLimitedRatio: 0.95,
    budgetIncreaseMinConversions: 5,
    bidStrategyChangeMinConversions: 15,  // per period, before proposing a conversion-based strategy change
  },
  experiment: { minChange: 0.1, minConversions: 10, minClicks: 100, minImpressions: 1000, minDays: 14 },
};

// Reconciliation of datasets against the campaign totals (relative difference).
export const RECONCILE = { exact: 0.001, acceptable: 0.01, critical: 0.05 };

// When a dataset counts as stale.
export const FRESHNESS = {
  dailyLagDays: 2,       // daily datasets: last day older than today − this
  snapshotHours: 48,     // snapshots (settings, Quality Score, …): last fetch older than this
  auctionInsightsDays: 45, // manual upload: newest file older than this
};

// Days an alert stays quiet after it stops firing or is marked done.
// 0 = it reopens as soon as it fires again; `sticky` alerts cannot be
// silenced while the condition holds.
export const ALERT_COOLDOWN_DAYS = {
  default: 3,
  sync_failed: 0,
  sync_stale: 1,
  data_stale: 1,
  tracking_no_primary_conversion: 0,
  tracking_health: 0,
  conversions_stopped: 2,
  cpa_increase: 7,
  cost_up_without_results: 7,
  conversion_volume_drop: 7,
  settings_changed: 0,
  unverified_conversion_actions: 7,
  data_quality: 1,
};
export const STICKY_ALERTS = new Set(['tracking_no_primary_conversion', 'tracking_health', 'sync_failed']);

// Conversion Tracking Health, 0–100 per campaign / account. An internal
// indicator, not a fact: each deduction names its reason.
export const TRACKING_HEALTH = {
  noPrimaryConversion: 50,     // conversion-based bidding with zero primary conversions
  primaryActionsInactive: 30,  // every primary action removed / hidden
  noRecentConversions: 10,     // converted before, none in the last 7 days
  unverifiedMapping: 10,       // conversion actions still on the default goal
  staleConfiguration: 10,      // conversion action metadata not refreshed recently
};

// Account Health, 0–100: weights of each component (sum 100).
export const ACCOUNT_HEALTH = {
  tracking: 30, freshness: 15, sync: 15, configuration: 10, diagnostics: 20, alerts: 10,
};

// Confidence 0–100 of a finding: starts from volume, then each factor
// subtracts. Levels: ≥ 70 high, ≥ 45 medium, below that low.
export const CONFIDENCE = {
  volume: { low: 35, medium: 65, high: 85 },
  bonusSupportingMetric: 5,   // per extra metric pointing the same way (max 2)
  penaltyDataQuality: 20,     // a dataset the finding relies on is partial / inconsistent
  penaltyTracking: 25,        // conversion tracking unhealthy (conversion-based findings)
  penaltyNewCampaign: 30,     // campaign younger than newCampaignDays
  penaltyOverlappingChanges: 10, // account changes inside the period
  levels: { high: 70, medium: 45 },
};

export const CALIBRATION_LOG = [
  {
    version: 'google_ads_v1.0', date: '2026-10-04', rule: '*',
    change: 'Initial defaults (Milestone 2).', reason: 'No production data yet.',
  },
  {
    version: 'google_ads_v1.1', date: '2026-10-05', rule: 'campaign.*',
    change: 'Per-rule minimum samples (conversions / clicks / impressions / days with spend) replace one shared minimum; cvr_drop also needs ≥ 3 conversions per period; conversions_stopped needs ≥ 5 prior conversions over ≥ 7 active days.',
    reason: 'Production hardening: a diagnosis must not fire on a handful of events.',
  },
  {
    version: 'google_ads_v1.1', date: '2026-10-05', rule: 'confidence',
    change: 'Confidence is a 0–100 score from volume minus data-quality, tracking-health, new-campaign and overlapping-change penalties (was volume only).',
    reason: 'JKT (no primary conversion) and partial datasets made volume-only confidence overstate findings.',
  },
  {
    version: 'google_ads_v1.1', date: '2026-10-05', rule: 'anomaly',
    change: 'High-variance series (MAD CV > 0.5) use z ≥ 4 instead of 3; low-volume days are listed as monitoring.',
    reason: 'Avoid flagging normal swings of noisy campaigns.',
  },
  {
    version: 'google_ads_v1.1', date: '2026-10-05', rule: 'alerts.cooldown',
    change: 'Cooldown per alert type (sync failures and tracking: 0 days and cannot be silenced while firing; CPA / cost / volume: 7 days).',
    reason: 'Critical configuration problems stayed hidden for 3 days after "Selesai"; performance alerts repeated too often.',
  },
];

export const volumeTier = (conversions) => (conversions < VOLUME_TIERS.lowBelow ? 'low' : conversions > VOLUME_TIERS.highAbove ? 'high' : 'medium');
export const cooldownDays = (type) => ALERT_COOLDOWN_DAYS[type] ?? ALERT_COOLDOWN_DAYS.default;
