// Pure mapping: the `rows` array from InternalDashboardSheets.gs's
// getMonthlyPerformance action -> the shapes internalDashboardRepository's
// upsertMonthlyMetric / upsertPlatformSpend expect. No DB, no network —
// testable directly against a getMonthlyPerformance response.
//
// Row labels verified against the full "[NEW] Monthly Performance Analysis"
// template (85 metric rows, Petite Fleur, 2026-09-15) — see
// scripts/appsScript/InternalDashboardSheets.gs's header comment for the
// grid-shape notes this relies on (label in column B, "- "/"  -> " prefixes,
// bare section headers).
//
// find(label) below matches by EXACT row.label (already stripped of the
// "-"/"->" prefix by the Apps Script side) + row.section, so a client sheet
// missing a section just yields nulls for it — never a thrown error.

function find(rows, section, label) {
  const row = rows.find((r) => r.section === section && r.label === label);
  return row ? row.values : null;
}

function at(values, month) {
  if (!values) return null;
  const v = values[month];
  return v === undefined || v === null || Number.isNaN(v) ? null : v;
}

// purchase_value isn't always a direct column in the sheet (e.g. CPAS
// blocks only give ROAS + spend) — derive it from roas * amount_spent when
// both are present, since that's algebraically exact (ROAS is defined as
// purchase_value / spend), not a guess.
function deriveValueFromRoas(roas, amountSpent) {
  if (roas === null || amountSpent === null) return null;
  return roas * amountSpent;
}

// One row per platform. `amount_spent` is required by the schema — if the
// sheet's spend cell for this month is null/0-absent, the whole platform
// row is skipped for that month (no meaningless zero-spend row written).
function platformRow(platform, amountSpent, metrics) {
  if (amountSpent === null) return null;
  return { platform, metrics: { amount_spent: amountSpent, ...metrics } };
}

/**
 * @param {Array<{section:string|null,label:string,values:Record<string,number|null>}>} rows
 * @param {string} month - "Jan".."Dec"
 * @returns {{ monthlyMetric: object|null, platformSpend: Array<{platform,metrics}> }}
 */
export function mapSheetToFacts(rows, month) {
  const g = (section, label) => at(find(rows, section, label), month);

  // --- top-level portfolio metrics -------------------------------------
  // revenue === 0 is treated as "not filled in yet", same as null: the
  // template defaults every future/unfilled month's formulas to 0 rather
  // than leaving the cell blank, so a whole client can otherwise look like
  // it crashed to zero revenue for the rest of the year the moment sync
  // runs. A client whose revenue was genuinely 0 in some real month still
  // has the manual form as an explicit override.
  const revenue = g(null, 'Total Revenue');
  const monthlyMetric = !revenue ? null : {
    revenue,
    qtySold: g(null, 'Total Qty'),
    transaksi: g(null, 'Total Trx'),
  };

  const platformSpend = [];

  // --- Main account: boost / non-boost are separate ad_platform rows,
  // but the sheet reports Profile Visits/Purchase/Revenue ONCE for the
  // combined Main Account (not split boost vs non-boost). JUDGMENT CALL:
  // attributed to the boost row (boost campaigns are the ones targeting
  // profile visits per this project's established convention — see
  // internal-dashboard-project memory, "campaign name contains 'profile
  // visit' -> Boost Post"); the non-boost row gets spend only, funnel
  // columns stay null. Flag this if it turns out wrong for some client.
  const mainBoostSpend = g('Main account', 'Boost post');
  const mainRoas = g('Main account', 'ROAS');
  platformSpend.push(platformRow('meta_boost', mainBoostSpend, {
    ig_profile_visit: g('Main account', 'Profile Visits'),
    purchase: g('Main account', 'Purchase'),
    purchase_value: g('Main account', 'Revenue'),
    roas: mainRoas,
  }));
  platformSpend.push(platformRow('meta_nonboost', g('Main account', 'Non-boost post'), {}));

  // --- CPAS Shopee / CPAS Tokopedia: identical shape. No direct
  // purchase_value cell — derived from roas * spend.
  for (const [section, platform] of [['CPAS Shopee', 'meta_cpas'], ['CPAS Tokopedia', 'cpas_tokopedia']]) {
    const amountSpent = g(section, 'Ads Spent');
    const roas = g(section, 'ROAS');
    platformSpend.push(platformRow(platform, amountSpent, {
      reach: g(section, 'Reach'),
      frequency: g(section, 'Frequency'),
      cpm: g(section, 'CPM'),
      ctr: g(section, 'CTR'),
      view_content: g(section, 'Content View'),
      cost_per_vc: g(section, 'Cost per Content View'),
      atc: g(section, 'Add To Cart'),
      cost_per_atc: g(section, 'Cost per Add To Cart'),
      purchase: g(section, 'Purchase'),
      cost_per_purchase: g(section, 'Cost per Purchase'),
      roas,
      purchase_value: deriveValueFromRoas(roas, amountSpent),
    }));
  }

  // --- Iklan Shopee / TTAM: identical shape except the ad-attributed
  // revenue cell's label ("Omzet Iklan" vs "Gross Revenue") — that maps to
  // purchase_value directly (NOT "Omzet Keseluruhan", which is the whole
  // store's revenue, ads-attributed or not).
  for (const [section, platform, revenueLabel] of [
    ['Iklan Shopee', 'iklanku_shopee', 'Omzet Iklan'],
    ['TTAM', 'ttam_tiktok', 'Gross Revenue'],
  ]) {
    platformSpend.push(platformRow(platform, g(section, 'Expenses'), {
      impressions: g(section, 'Impressions'),
      cpm: g(section, 'Cost per Miles (CPM)'),
      link_clicks: g(section, 'Clicks'),
      ctr: g(section, 'Click Trough Rate (CTR)'),
      cpc: g(section, 'Cost per Click (CPC)'),
      purchase: g(section, 'Orders'),
      cost_per_purchase: g(section, 'Cost per Action (CPA)'),
      purchase_value: g(section, revenueLabel),
      roas: g(section, 'Return of Ad Spend (ROAS)'),
    }));
  }

  // --- GMV Max Overall ---------------------------------------------------
  platformSpend.push(platformRow('gmv_max_tiktok', g('GMV Max Overall', 'Expenses'), {
    purchase: g('GMV Max Overall', 'Orders'),
    cost_per_purchase: g('GMV Max Overall', 'Cost per Order'),
    purchase_value: g('GMV Max Overall', 'Gross Revenue'),
    roas: g('GMV Max Overall', 'ROI'),
  }));

  return { monthlyMetric, platformSpend: platformSpend.filter(Boolean) };
}
